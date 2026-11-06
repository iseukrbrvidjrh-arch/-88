from datetime import datetime, timezone
from app.domain.dictation import score
from app.core.config import Settings
from app.main import create_app
from fastapi.testclient import TestClient

def test_dictation_scoring_normalizes_case_and_whitespace():
    result = score("She's ready now", "  she's   ready now ")
    assert result.is_exact is True
    assert result.accuracy_percent == 100

def test_dictation_endpoint_is_idempotent_and_uses_temp_db(tmp_path):
    app = create_app(Settings(data_dir=tmp_path / "data"), clock=lambda: datetime(2026, 11, 5, tzinfo=timezone.utc))
    with TestClient(app, base_url="http://127.0.0.1:8765") as client:
        token = client.app.state.token
        headers = {"X-SceneLingo-Token": token, "Origin": "http://127.0.0.1:8765"}
        response = client.post("/api/v1/subtitles", files={"file": ("x.srt", b"1\n00:00:00,000 --> 00:00:02,000\nHello world\n")}, headers=headers)
        subtitle_id = response.json()["subtitle"]["id"]
        detail = client.get(f"/api/v1/subtitles/{subtitle_id}", headers=headers).json()
        cue_id = detail["cues"][0]["id"]
        body = {"subtitle_id": subtitle_id, "cue_id": cue_id, "user_input": "hello", "attempt_token": "same"}
        first = client.post("/api/v1/dictation/attempts", json=body, headers=headers)
        second = client.post("/api/v1/dictation/attempts", json=body, headers=headers)
        assert first.status_code == 201
        assert second.status_code == 201
        assert first.json()["attempt"]["id"] == second.json()["attempt"]["id"]
        assert second.json()["duplicate"] is True
