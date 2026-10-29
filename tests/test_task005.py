"""TASK-005 explicit vocabulary, dedupe, contexts, queries and API."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from app.core.config import Settings
from app.core.errors import ApplicationError
from app.main import create_app
from app.repositories.database import Database
from app.repositories.migrations.runner import initialize_database
from app.repositories.migrations.versions import MIGRATIONS
from app.services.subtitle_import import import_subtitle
from app.services.vocabulary import add_word, candidates, detail, library, normalize_key


NOW = datetime(2026, 10, 30, 12, tzinfo=timezone.utc)
DATA = b"""1
00:00:01,000 --> 00:00:02,000
Don't wait, don't go.

2
00:00:03,000 --> 00:00:04,000
DON'T stop. Well-known fact.
"""


def setup(tmp_path: Path):
    database = Database(tmp_path / "data" / "scenelingo.db"); initialize_database(database)
    subtitle = import_subtitle(database, filename="words.srt", data=DATA, now=lambda: NOW).subtitle
    with database.connection() as connection:
        cues = connection.execute("SELECT id,sequence FROM cue ORDER BY sequence").fetchall()
    return database, subtitle.id, cues


def test_candidates_frequency_order_and_import_does_not_auto_add(tmp_path):
    database, subtitle_id, _ = setup(tmp_path)
    result = candidates(database, subtitle_id)
    assert result["items"][0]["token_key"] == "don't"
    assert result["items"][0]["occurrence_count"] == 3
    assert all(not item["in_library"] for item in result["items"])
    assert library(database)["total"] == 0


def test_add_word_creates_new_state_context_and_candidate_marker(tmp_path):
    database, subtitle_id, cues = setup(tmp_path)
    result = add_word(database, subtitle_id=subtitle_id, cue_id=cues[0][0], token_key="Don't", now=lambda: NOW)
    assert result == {"learning_item_id": 1, "created": True, "context_added": True, "context_count": 1, "status": "new"}
    marked = next(item for item in candidates(database, subtitle_id)["items"] if item["token_key"] == "don't")
    assert marked["in_library"] is True and marked["learning_item_id"] == 1


def test_same_cue_is_idempotent_and_second_cue_adds_context_without_changing_display(tmp_path):
    database, subtitle_id, cues = setup(tmp_path)
    first = add_word(database, subtitle_id=subtitle_id, cue_id=cues[0][0], token_key="don't", now=lambda: NOW)
    repeated = add_word(database, subtitle_id=subtitle_id, cue_id=cues[0][0], token_key="DON’T", now=lambda: NOW)
    second = add_word(database, subtitle_id=subtitle_id, cue_id=cues[1][0], token_key="don’t", now=lambda: NOW)
    assert not repeated["created"] and not repeated["context_added"]
    assert second["learning_item_id"] == first["learning_item_id"] and second["context_count"] == 2
    item = detail(database, first["learning_item_id"])
    assert item["display_text"] == "Don't" and len(item["contexts"]) == 2


def test_normalization_preserves_hyphen_and_space_as_different_keys():
    assert normalize_key(" Well-Known ") == "well-known"
    assert normalize_key("well known") == "well known"
    assert normalize_key("DON’T") == "don't"


def test_concurrent_add_same_word_from_two_cues_has_one_item_two_contexts(tmp_path):
    database, subtitle_id, cues = setup(tmp_path)
    def add(cue):
        return add_word(database, subtitle_id=subtitle_id, cue_id=cue, token_key="don't", now=lambda: NOW)
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(add, [cues[0][0], cues[1][0]]))
    assert {item["learning_item_id"] for item in results} == {1}
    assert detail(database, 1)["contexts"] and len(detail(database, 1)["contexts"]) == 2


def test_library_search_sort_pagination_filters_and_missing_placeholders(tmp_path):
    database, subtitle_id, cues = setup(tmp_path)
    add_word(database, subtitle_id=subtitle_id, cue_id=cues[0][0], token_key="don't", now=lambda: NOW)
    add_word(database, subtitle_id=subtitle_id, cue_id=cues[1][0], token_key="well-known", now=lambda: NOW)
    result = library(database, search="DON", sort="alphabetical", page_size=1)
    assert result["total"] == 1 and result["items"][0]["dedupe_key"] == "don't"
    assert library(database, status="archived")["items"] == []
    item = detail(database, result["items"][0]["id"])
    assert (item["ipa_display"], item["definition_display"], item["next_review_display"], item["review_history_display"]) == ("暂无", "暂无", "尚未安排", "暂无")


def test_restart_persists_item_context_and_jump_target(tmp_path):
    database, subtitle_id, cues = setup(tmp_path)
    created = add_word(database, subtitle_id=subtitle_id, cue_id=cues[0][0], token_key="don't", now=lambda: NOW)
    reopened = Database(database.path); item = detail(reopened, created["learning_item_id"])
    assert item["status"] == "new" and item["contexts"][0]["available"] is True
    assert item["contexts"][0]["cue_id"] == cues[0][0]


def test_api_requires_explicit_post_and_uses_only_local_dependencies(tmp_path, monkeypatch):
    app = create_app(Settings(data_dir=tmp_path / "data"), clock=lambda: NOW)
    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        subtitle = import_subtitle(client.app.state.database, filename="api.srt", data=DATA, now=lambda: NOW).subtitle
        with client.app.state.database.connection() as connection:
            cue_id = connection.execute("SELECT id FROM cue ORDER BY sequence LIMIT 1").fetchone()[0]
        headers = {"Origin":"http://127.0.0.1:8765","X-SceneLingo-Token":client.app.state.token,"Content-Type":"application/json"}
        assert client.get(f"/api/v1/subtitles/{subtitle.id}/candidates", headers=headers).status_code == 200
        assert client.get("/api/v1/vocabulary", headers=headers).json()["total"] == 0
        response = client.post("/api/v1/vocabulary", headers=headers, json={"subtitle_id":subtitle.id,"cue_id":cue_id,"token_key":"don't"})
        assert response.status_code == 201
        assert client.get("/api/v1/vocabulary", headers=headers).json()["total"] == 1
        assert "全部加入" not in client.get("/").text


def test_add_rejects_token_not_present_in_selected_cue(tmp_path):
    database, subtitle_id, cues = setup(tmp_path)
    with pytest.raises(ApplicationError) as caught:
        add_word(database, subtitle_id=subtitle_id, cue_id=cues[0][0], token_key="well-known", now=lambda: NOW)
    assert getattr(caught.value, "code", None) == "vocabulary_source_invalid"
    assert library(database)["total"] == 0


def test_v4_migration_backs_up_v3_and_preserves_subtitles(tmp_path):
    database = Database(tmp_path / "data" / "scenelingo.db")
    initialize_database(database, migrations=MIGRATIONS[:3])
    import_subtitle(database, filename="legacy.srt", data=DATA, now=lambda: NOW)
    result = initialize_database(database, migrations=MIGRATIONS[:4])
    assert result.applied_versions == (4,) and result.backup_path is not None
    with database.connection() as connection:
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert {"learning_item", "context_ref", "review_state"} <= tables
        assert connection.execute("SELECT count(*) FROM subtitle").fetchone()[0] == 1
