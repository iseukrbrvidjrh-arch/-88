"""TASK-003 subtitle parsing, statistics, atomic persistence and upload API."""

from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
import sqlite3

from fastapi.testclient import TestClient
import pytest

from app.core.config import Settings
from app.core.errors import ApplicationError
from app.domain.subtitle.parser import MAX_CUES, clean_text, parse_subtitle
from app.domain.subtitle.tokens import count_tokens, tokenize
from app.main import create_app
from app.repositories.database import Database, StorageError
from app.repositories.migrations.runner import initialize_database
from app.repositories.migrations.versions import MIGRATIONS
from app.repositories.subtitles import SubtitleRepository
from app.services.subtitle_import import MAX_FILE_BYTES, content_fingerprint, import_subtitle


BASE_URL = "http://127.0.0.1:8765"
ORIGIN = BASE_URL
FIXED_TIME = datetime(2026, 10, 30, 9, 0, tzinfo=timezone.utc)


STAT_SAMPLE = b"""1
00:00:01,000 --> 00:00:03,000
I don't think it's well-known.

2
00:00:04,000 --> 00:00:05,000
Don't go! 1999

3
00:00:06,000 --> 00:00:07,000
[MUSIC] JOHN: Hello...

4
00:00:08,000 --> 00:00:10,000
Mr. Smith's U.S. trip
"""


def ready_database(tmp_path: Path) -> Database:
    db = Database(tmp_path / "data" / "scenelingo.db")
    initialize_database(db)
    return db


def row_counts(db: Database) -> tuple[int, int, int]:
    with db.connection() as conn:
        return tuple(
            conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
            for table in ("subtitle", "cue", "subtitle_token")
        )


def test_approved_four_cue_sample_is_exact_11_occurrences_and_10_unique():
    parsed = parse_subtitle(STAT_SAMPLE.decode(), "srt")
    stats = count_tokens(parsed.cues)
    assert sum(item.occurrence_count for item in stats) == 11
    assert len(stats) == 10
    assert [item.key for item in stats] == [
        "i", "don't", "think", "it's", "well-known", "go", "hello", "mr", "smith's", "trip",
    ]
    assert next(item for item in stats if item.key == "don't").occurrence_count == 2
    assert "u" not in {item.key for item in stats} and "s" not in {item.key for item in stats}


def test_contractions_possessives_hyphens_stopwords_and_curly_apostrophe():
    occurrences = tokenize("don't it's its John's John well-known well known the a to I can’t")
    keys = [item.key for item in occurrences]
    assert keys == [
        "don't", "it's", "its", "john's", "john", "well-known", "well", "known",
        "the", "a", "to", "i", "can't",
    ]
    assert occurrences[-1].display_form == "can’t"


def test_music_speaker_numbers_and_non_latin_text_do_not_count():
    keys = [item.key for item in tokenize("[MUSIC] JOHN: Hello the MP3 B2B 1999 中文 A x")]
    assert keys == ["hello", "the", "a"]


def test_srt_cleaning_preserves_display_newlines_and_reports_invalid_cues():
    text = """1
00:00:01,000 --> 00:00:02,000
  <i>Hello &amp;</i>
  world {\\an8}

BAD INDEX
not a timeline
ignored text

3
00:00:03,000 --> 00:00:02,000
backwards

4
00:00:04,000 --> 00:00:05,000
<b>Valid</b>
"""
    parsed = parse_subtitle(text, "srt")
    assert len(parsed.cues) == 2
    assert parsed.cues[0].raw_text == "<i>Hello &amp;</i>\n  world {\\an8}"
    assert parsed.cues[0].clean_text == "Hello &\nworld"
    assert [issue.reason for issue in parsed.invalid_cues] == ["missing_timeline", "invalid_time_range"]
    assert [cue.sequence for cue in parsed.cues] == [1, 2]


def test_vtt_header_metadata_note_style_region_identifier_and_settings():
    text = """WEBVTT
Kind: captions
Language: en

NOTE this is not dialogue
hidden words

STYLE
::cue { color: lime }

REGION
id:fred

cue-one
00:01.000 --> 00:02.500 align:start
<v Roger><i>Hello</i> &quot;there&quot;

00:00:03.000 --> 00:00:04.000
Second cue
"""
    parsed = parse_subtitle(text, "vtt")
    assert [(cue.start_ms, cue.end_ms, cue.clean_text) for cue in parsed.cues] == [
        (1000, 2500, 'Hello "there"'), (3000, 4000, "Second cue"),
    ]
    assert parsed.invalid_cues == ()


@pytest.mark.parametrize("source_format,text", [
    ("srt", "not a subtitle"),
    ("vtt", "00:00.000 --> 00:01.000\nNo header"),
    ("srt", "1\n00:00:02,000 --> 00:00:01,000\nBackwards"),
])
def test_all_invalid_or_mismatched_content_is_rejected(source_format, text):
    with pytest.raises(ApplicationError) as caught:
        parse_subtitle(text, source_format)
    assert caught.value.code in {"subtitle_all_cues_invalid", "subtitle_parse_failed"}


def test_cue_limit_is_enforced_without_database_access():
    block = "1\n00:00:00,000 --> 00:00:01,000\nHi"
    text = "\n\n".join(block for _ in range(MAX_CUES + 1))
    with pytest.raises(ApplicationError) as caught:
        parse_subtitle(text, "srt")
    assert caught.value.code == "subtitle_cue_limit_exceeded"


def test_import_persists_summary_cues_tokens_and_current_schema(tmp_path):
    db = ready_database(tmp_path)
    result = import_subtitle(db, filename="episode.srt", data=STAT_SAMPLE, now=lambda: FIXED_TIME)
    assert result.subtitle.title == "episode"
    assert result.subtitle.source_format == "srt"
    assert result.subtitle.cue_count == 4
    assert result.subtitle.token_occurrence_count == 11
    assert result.subtitle.unique_token_count == 10
    assert len(result.preview) == 4
    assert row_counts(db) == (1, 4, 10)
    with db.connection() as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == len(MIGRATIONS)
        first = conn.execute(
            """SELECT st.token_key, st.occurrence_count, c.sequence
               FROM subtitle_token st JOIN cue c ON c.id = st.first_cue_id
               WHERE st.token_key = 'don''t'"""
        ).fetchone()
        assert first == ("don't", 2, 1)


def test_partial_invalid_import_reports_reasons_and_does_not_store_invalid_cue(tmp_path):
    data = b"""1
00:00:01,000 --> 00:00:02,000
Valid one

bad block without timeline

3
00:00:03,000 --> 00:00:04,000
Valid two
"""
    db = ready_database(tmp_path)
    result = import_subtitle(db, filename="partial.srt", data=data, now=lambda: FIXED_TIME)
    assert result.subtitle.cue_count == 2
    assert len(result.invalid_cues) == 1
    assert result.invalid_cues[0].reason == "missing_timeline"
    assert row_counts(db)[1] == 2


def test_duplicate_content_is_rejected_but_same_filename_new_content_imports(tmp_path):
    db = ready_database(tmp_path)
    first = import_subtitle(db, filename="first.srt", data=STAT_SAMPLE, now=lambda: FIXED_TIME)
    with pytest.raises(ApplicationError) as duplicate:
        import_subtitle(db, filename="renamed.srt", data=STAT_SAMPLE, now=lambda: FIXED_TIME)
    assert duplicate.value.code == "subtitle_already_exists"
    assert duplicate.value.details == {"subtitle_id": first.subtitle.id}
    changed = STAT_SAMPLE.replace(b"trip\n", b"journey\n")
    second = import_subtitle(db, filename="first.srt", data=changed, now=lambda: FIXED_TIME)
    assert second.subtitle.id != first.subtitle.id
    assert row_counts(db)[0] == 2
    with db.connection() as conn:
        library = SubtitleRepository(conn).library_statistics()
        assert (library.subtitle_count, library.token_occurrence_count, library.unique_token_count) == (2, 22, 11)


@pytest.mark.parametrize("filename,data,code", [
    ("episode.txt", STAT_SAMPLE, "subtitle_format_unsupported"),
    ("episode.srt", b"\xff\xfeinvalid", "subtitle_encoding_unsupported"),
    ("episode.srt", b"", "subtitle_file_empty"),
    ("episode.srt", b"x" * (MAX_FILE_BYTES + 1), "subtitle_file_too_large"),
])
def test_invalid_file_inputs_leave_database_empty(tmp_path, filename, data, code):
    db = ready_database(tmp_path)
    with pytest.raises(ApplicationError) as caught:
        import_subtitle(db, filename=filename, data=data)
    assert caught.value.code == code
    assert row_counts(db) == (0, 0, 0)


def test_utf8_bom_is_supported(tmp_path):
    db = ready_database(tmp_path)
    result = import_subtitle(db, filename="bom.srt", data=b"\xef\xbb\xbf" + STAT_SAMPLE)
    assert result.subtitle.cue_count == 4


def test_injected_repository_failure_rolls_back_all_three_tables(tmp_path):
    db = ready_database(tmp_path)

    class FailingRepository(SubtitleRepository):
        def insert_tokens(self, subtitle_id, tokens, cue_ids):
            raise sqlite3.OperationalError("injected write failure")

    with pytest.raises(StorageError, match="回滚"):
        import_subtitle(db, filename="atomic.srt", data=STAT_SAMPLE,
                        repository_type=FailingRepository)
    assert row_counts(db) == (0, 0, 0)


def test_persisted_statistics_survive_new_database_instance(tmp_path):
    db = ready_database(tmp_path)
    created = import_subtitle(db, filename="restart.srt", data=STAT_SAMPLE)
    reopened = Database(db.path)
    with reopened.connection() as conn:
        stored = SubtitleRepository(conn).get(created.subtitle.id)
        assert stored is not None
        assert (stored.cue_count, stored.token_occurrence_count, stored.unique_token_count) == (4, 11, 10)


def test_v2_migration_backs_up_v1_and_creates_only_approved_tables(tmp_path):
    db = Database(tmp_path / "data" / "scenelingo.db")
    initialize_database(db, migrations=(MIGRATIONS[0],))
    result = initialize_database(db, migrations=MIGRATIONS[:2])
    assert result.previous_version == 1
    assert result.applied_versions == (2,)
    with closing(sqlite3.connect(result.backup_path)) as backup:
        assert backup.execute("PRAGMA user_version").fetchone()[0] == 1
        assert backup.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall() == []
    with db.connection() as conn:
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert tables == {"subtitle", "cue", "subtitle_token"}


def test_upload_api_requires_local_origin_token_and_multipart(tmp_path):
    data_dir = tmp_path / "app-data"
    app = create_app(Settings(data_dir=data_dir), clock=lambda: FIXED_TIME)
    with TestClient(app, base_url=BASE_URL) as client:
        token = client.app.state.token
        files = {"file": ("episode.srt", STAT_SAMPLE, "application/x-subrip")}
        no_origin = client.post("/api/v1/subtitles", files=files, headers={"X-SceneLingo-Token": token})
        assert no_origin.status_code == 403
        foreign = client.post("/api/v1/subtitles", files=files, headers={
            "X-SceneLingo-Token": token, "Origin": "https://evil.example",
        })
        assert foreign.status_code == 403
        no_token = client.post("/api/v1/subtitles", files=files, headers={"Origin": ORIGIN})
        assert no_token.status_code == 401
        wrong_type = client.post("/api/v1/subtitles", content=b"{}", headers={
            "Origin": ORIGIN, "X-SceneLingo-Token": token, "Content-Type": "application/json",
        })
        assert wrong_type.status_code == 415
        success = client.post("/api/v1/subtitles", files=files, headers={
            "Origin": ORIGIN, "X-SceneLingo-Token": token,
        })
        assert success.status_code == 201
        body = success.json()
        assert body["subtitle"]["token_occurrence_count"] == 11
        assert body["subtitle"]["unique_token_count"] == 10
        assert body["import_report"] == {
            "valid_cue_count": 4, "invalid_cue_count": 0,
            "invalid_reasons": {}, "invalid_cues": [],
        }
        duplicate = client.post("/api/v1/subtitles", files=files, headers={
            "Origin": ORIGIN, "X-SceneLingo-Token": token,
        })
        assert duplicate.status_code == 409
        assert duplicate.json()["error"]["code"] == "subtitle_already_exists"
        assert duplicate.json()["error"]["details"]["subtitle_id"] == body["subtitle"]["id"]
    assert list(data_dir.rglob("*.srt")) == []
    assert list(data_dir.rglob("*.vtt")) == []


def test_api_partial_invalid_report_is_classified(tmp_path):
    data = b"""1
00:00:01,000 --> 00:00:02,000
Valid

missing timeline
"""
    app = create_app(Settings(data_dir=tmp_path / "app-data"), clock=lambda: FIXED_TIME)
    with TestClient(app, base_url=BASE_URL) as client:
        response = client.post("/api/v1/subtitles", files={"file": ("partial.srt", data)}, headers={
            "Origin": ORIGIN, "X-SceneLingo-Token": client.app.state.token,
        })
        assert response.status_code == 201
        assert response.json()["subtitle"]["partially_invalid"] is True
        assert response.json()["import_report"]["invalid_reasons"] == {"missing_timeline": 1}


def test_api_rejects_oversize_upload_without_persisting_data(tmp_path):
    data_dir = tmp_path / "app-data"
    app = create_app(Settings(data_dir=data_dir), clock=lambda: FIXED_TIME)
    with TestClient(app, base_url=BASE_URL) as client:
        response = client.post(
            "/api/v1/subtitles",
            files={"file": ("large.srt", b"x" * (MAX_FILE_BYTES + 1))},
            headers={"Origin": ORIGIN, "X-SceneLingo-Token": client.app.state.token},
        )
        assert response.status_code == 413
        assert response.json()["error"]["code"] == "subtitle_file_too_large"
        assert row_counts(client.app.state.database) == (0, 0, 0)


def test_api_all_invalid_error_does_not_echo_subtitle_or_write_it_to_log(tmp_path):
    secret_marker = "PRIVATE-SUBTITLE-CONTENT"
    data_dir = tmp_path / "app-data"
    app = create_app(Settings(data_dir=data_dir), clock=lambda: FIXED_TIME)
    with TestClient(app, base_url=BASE_URL) as client:
        response = client.post(
            "/api/v1/subtitles",
            files={"file": ("invalid.srt", secret_marker.encode())},
            headers={"Origin": ORIGIN, "X-SceneLingo-Token": client.app.state.token},
        )
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "subtitle_all_cues_invalid"
        assert secret_marker not in response.text
        assert row_counts(client.app.state.database) == (0, 0, 0)
    assert secret_marker not in "\n".join(
        path.read_text(encoding="utf-8") for path in data_dir.rglob("*.log")
    )


def test_cleaning_function_is_pure_and_deterministic():
    source = " <i>Hello</i> &amp;\n[MUSIC] "
    assert clean_text(source) == "Hello &\n[MUSIC]"
    assert clean_text(source) == "Hello &\n[MUSIC]"
    parsed = parse_subtitle(STAT_SAMPLE.decode(), "srt")
    assert content_fingerprint(parsed.cues) == content_fingerprint(parsed.cues)
