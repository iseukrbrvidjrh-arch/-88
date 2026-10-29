"""TASK-004 legacy compatibility, subtitle library, pagination and cue location."""

from datetime import datetime, timedelta, timezone
from pathlib import Path
import sqlite3
import time

from fastapi.testclient import TestClient
import pytest

from app.core.config import Settings
from app.core.errors import ApplicationError
from app.main import create_app
from app.repositories.database import Database, transaction
from app.repositories.migrations.runner import initialize_database
from app.repositories.migrations.versions import MIGRATIONS
from app.repositories.subtitles import SubtitleRepository
from app.services.subtitle_import import import_subtitle
from app.services.subtitle_query import list_subtitles, locate_cue, subtitle_detail


BASE_URL = "http://127.0.0.1:8765"
ORIGIN = BASE_URL
SAMPLE = b"1\n01:02:03,004 --> 01:02:05,006\nHello world\n"
PARTIAL = SAMPLE + b"\nbad block without timeline\n"


def ready(tmp_path: Path) -> Database:
    database = Database(tmp_path / "data" / "scenelingo.db")
    initialize_database(database)
    return database


def imported(database: Database, filename: str, data: bytes, when: datetime):
    return import_subtitle(database, filename=filename, data=data, now=lambda: when)


def test_v3_migration_preserves_legacy_unknown_and_new_imports_write_exact_counts(tmp_path):
    database = Database(tmp_path / "data" / "scenelingo.db")
    initialize_database(database, migrations=MIGRATIONS[:2])
    with database.connection() as connection, transaction(connection):
        connection.execute(
            """INSERT INTO subtitle
               (title, source_format, content_fingerprint, status, cue_count,
                token_occurrence_count, unique_token_count, imported_at)
               VALUES ('legacy', 'srt', ?, 'imported', 0, 0, 0, ?)""",
            ("a" * 64, "2026-10-29T00:00:00+00:00"),
        )
    result = initialize_database(database, migrations=MIGRATIONS[:3])
    assert result.applied_versions == (3,)
    assert result.backup_path is not None
    with sqlite3.connect(result.backup_path) as backup:
        assert backup.execute("PRAGMA user_version").fetchone()[0] == 2
        assert backup.execute("SELECT title FROM subtitle").fetchone()[0] == "legacy"
        columns = {row[1] for row in backup.execute("PRAGMA table_info(subtitle)")}
        assert "invalid_cue_count" not in columns
    with database.connection() as connection:
        assert SubtitleRepository(connection).get(1).invalid_cue_count is None
    zero = imported(database, "clean.srt", SAMPLE, datetime.now(timezone.utc))
    partial = imported(database, "partial.srt", PARTIAL.replace(b"Hello world", b"Different text"),
                       datetime.now(timezone.utc))
    assert zero.subtitle.invalid_cue_count == 0
    assert partial.subtitle.invalid_cue_count == 1


def test_all_invalid_still_rejected_and_writes_nothing(tmp_path):
    database = ready(tmp_path)
    with pytest.raises(ApplicationError, match="没有可导入"):
        import_subtitle(database, filename="invalid.srt", data=b"private invalid text")
    with database.connection() as connection:
        assert SubtitleRepository(connection).count_subtitles() == 0


def test_default_list_search_sort_filter_pagination_and_stats_are_persisted(tmp_path):
    database = ready(tmp_path)
    base = datetime(2026, 10, 30, tzinfo=timezone.utc)
    alpha = imported(database, "Alpha.srt", SAMPLE, base)
    beta = imported(database, "beta.srt", SAMPLE.replace(b"world", b"again"), base + timedelta(seconds=1))
    with database.connection() as connection, transaction(connection):
        connection.execute("UPDATE subtitle SET status = 'archived' WHERE id = ?", (alpha.subtitle.id,))
    default = list_subtitles(database)
    assert [item["title"] for item in default["items"]] == ["beta"]
    assert default["items"][0]["token_occurrence_count"] == 2
    archived = list_subtitles(database, status="archived", search="LPH", sort="title")
    assert [item["title"] for item in archived["items"]] == ["Alpha"]
    assert list_subtitles(database, search="missing")["items"] == []
    assert list_subtitles(database, page=2, page_size=1)["items"] == []
    assert default["total"] == 1


def test_title_sort_is_stable_and_pagination_limits_are_validated(tmp_path):
    database = ready(tmp_path)
    base = datetime(2026, 10, 30, tzinfo=timezone.utc)
    for index, title in enumerate(("zeta", "Alpha", "alpha")):
        imported(database, f"{title}.srt", SAMPLE.replace(b"world", str(index).encode()),
                 base + timedelta(seconds=index))
    result = list_subtitles(database, sort="title", page_size=2)
    assert [item["title"] for item in result["items"]] == ["Alpha", "alpha"]
    with pytest.raises(ApplicationError) as caught:
        list_subtitles(database, page_size=201)
    assert caught.value.code == "invalid_pagination"


def test_detail_orders_and_formats_cues_and_out_of_range_page_is_empty(tmp_path):
    database = ready(tmp_path)
    data = b"""1
01:02:03,004 --> 01:02:05,006
First

2
01:02:06,007 --> 01:02:07,008
Second
"""
    created = imported(database, "detail.srt", data, datetime.now(timezone.utc))
    detail = subtitle_detail(database, created.subtitle.id, page=1, page_size=1)
    assert detail["total"] == 2
    assert detail["cues"][0]["sequence"] == 1
    assert (detail["cues"][0]["start_time"], detail["cues"][0]["end_time"]) == (
        "01:02:03.004", "01:02:05.006",
    )
    assert subtitle_detail(database, created.subtitle.id, page=3, page_size=1)["cues"] == []


def test_locate_by_id_or_sequence_returns_context_and_missing_is_available_false(tmp_path):
    database = ready(tmp_path)
    blocks = [f"{i}\n00:00:{i:02d},000 --> 00:00:{i:02d},500\nCue {i}" for i in range(1, 6)]
    created = imported(database, "locate.srt", "\n\n".join(blocks).encode(), datetime.now(timezone.utc))
    by_sequence = locate_cue(database, created.subtitle.id, sequence=3, radius=1)
    assert by_sequence["available"] is True
    assert [cue["sequence"] for cue in by_sequence["context"]] == [2, 3, 4]
    cue_id = by_sequence["target"]["id"]
    assert locate_cue(database, created.subtitle.id, cue_id=cue_id)["target"]["sequence"] == 3
    assert locate_cue(database, created.subtitle.id, sequence=999) == {
        "available": False, "target": None, "context": [],
    }


def test_partial_count_and_unknown_survive_restart_and_duplicate_does_not_change_count(tmp_path):
    database = ready(tmp_path)
    created = imported(database, "partial.srt", PARTIAL, datetime.now(timezone.utc))
    reopened = Database(database.path)
    item = list_subtitles(reopened)["items"][0]
    assert item["invalid_cue_count"] == 1 and item["has_invalid_cues"] is True
    with pytest.raises(ApplicationError) as duplicate:
        import_subtitle(reopened, filename="renamed.srt", data=PARTIAL)
    assert duplicate.value.code == "subtitle_already_exists"
    assert list_subtitles(reopened)["total"] == 1
    assert created.subtitle.invalid_cue_count == 1


def test_api_and_page_expose_read_only_library_states(tmp_path):
    app = create_app(Settings(data_dir=tmp_path / "data"))
    with TestClient(app, base_url=BASE_URL) as client:
        imported(client.app.state.database, "api.srt", SAMPLE, datetime.now(timezone.utc))
        headers = {"X-SceneLingo-Token": client.app.state.token, "Origin": ORIGIN}
        library = client.get("/api/v1/subtitles", headers=headers)
        assert library.status_code == 200 and library.json()["total"] == 1
        subtitle_id = library.json()["items"][0]["id"]
        assert client.get(f"/api/v1/subtitles/{subtitle_id}", headers=headers).json()["total"] == 1
        missing = client.get(f"/api/v1/subtitles/{subtitle_id}/locate?sequence=999", headers=headers)
        assert missing.status_code == 200 and missing.json()["available"] is False
        page = client.get("/")
        assert "subtitle-library" in page.text


def test_five_thousand_cues_query_returns_only_one_page(tmp_path):
    database = ready(tmp_path)
    blocks = [
        f"{i}\n00:{(i // 60) % 60:02d}:{i % 60:02d},000 --> 00:{(i // 60) % 60:02d}:{i % 60:02d},500\nLine {i}"
        for i in range(1, 5001)
    ]
    created = imported(database, "large.srt", "\n\n".join(blocks).encode(), datetime.now(timezone.utc))
    started = time.perf_counter()
    result = subtitle_detail(database, created.subtitle.id)
    elapsed = time.perf_counter() - started
    assert result["total"] == 5000 and len(result["cues"]) == 50
    assert elapsed < 1.0
