"""TASK-001: local-only skeleton and HTTP safety checks."""

from datetime import datetime, timezone
import json
from pathlib import Path
import re
import stat

from fastapi.testclient import TestClient
import pytest

from app.core.config import DEFAULT_PORT, ConfigError, Settings, load_settings
from app.main import WEB_DIR, create_app


FIXED_TIME = datetime(2026, 10, 29, 8, 0, tzinfo=timezone.utc)
BASE_URL = f"http://127.0.0.1:{DEFAULT_PORT}"


def client_for(tmp_path: Path) -> TestClient:
    app = create_app(Settings(data_dir=tmp_path / "data"), clock=lambda: FIXED_TIME)
    return TestClient(app, base_url=BASE_URL)


def test_default_port_and_configuration_precedence(monkeypatch, tmp_path):
    monkeypatch.delenv("SCENELINGO_PORT", raising=False)
    assert load_settings(data_dir=str(tmp_path)).port == DEFAULT_PORT
    monkeypatch.setenv("SCENELINGO_PORT", "18765")
    assert load_settings(data_dir=str(tmp_path)).port == 18765
    assert load_settings(port=str(DEFAULT_PORT), data_dir=str(tmp_path)).port == DEFAULT_PORT


def test_health_is_public_minimal_and_json(tmp_path):
    with client_for(tmp_path) as client:
        response = client.get("/api/v1/health")
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/json"
        assert response.json() == {
            "status": "ok", "version": "0.1.0", "time": FIXED_TIME.isoformat(),
        }
        body = response.text
        assert str(tmp_path) not in body
        assert "data_dir" not in body
        assert client.app.state.token not in body


@pytest.mark.parametrize("host", ["example.com", "192.168.1.50:8765", "localhost.evil:8765", "127.0.0.1:9999"])
def test_nonlocal_or_wrong_port_host_is_forbidden(tmp_path, host):
    with client_for(tmp_path) as client:
        response = client.get("/api/v1/health", headers={"Host": host})
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "invalid_host"


def test_mutating_origin_is_required_and_same_origin_passes_boundary(tmp_path):
    with client_for(tmp_path) as client:
        token = client.app.state.token
        headers = {"X-SceneLingo-Token": token, "Content-Type": "application/json"}
        missing = client.post("/api/v1/system/info", headers=headers, json={})
        assert missing.status_code == 403
        external = client.post("/api/v1/system/info", headers={**headers, "Origin": "https://evil.example"}, json={})
        assert external.status_code == 403
        same = client.post("/api/v1/system/info", headers={**headers, "Origin": BASE_URL}, json={})
        assert same.status_code == 405  # Security passed; TASK-001 defines no POST route.
        assert same.json()["error"]["code"] == "method_not_allowed"


def test_protected_info_requires_correct_token(tmp_path):
    with client_for(tmp_path) as client:
        assert client.get("/api/v1/system/info").status_code == 401
        assert client.get("/api/v1/system/info", headers={"X-SceneLingo-Token": "wrong"}).status_code == 401
        good = client.get("/api/v1/system/info", headers={"X-SceneLingo-Token": client.app.state.token})
        assert good.status_code == 200
        assert good.json() == {
            "version": "0.1.0", "security_mode": "local_only", "data_dir_available": True,
        }
        assert str(tmp_path) not in good.text


def test_security_headers_and_no_cors(tmp_path):
    with client_for(tmp_path) as client:
        response = client.get("/api/v1/health")
        assert "script-src 'self'" in response.headers["content-security-policy"]
        assert "'unsafe-inline'" not in response.headers["content-security-policy"]
        assert response.headers["x-content-type-options"] == "nosniff"
        assert response.headers["referrer-policy"] == "no-referrer"
        assert response.headers["cache-control"] == "no-store"
        assert re.fullmatch(r"[0-9a-f]{32}", response.headers["x-request-id"])
        assert "access-control-allow-origin" not in response.headers
        assert client.get("/docs", headers={"X-SceneLingo-Token": client.app.state.token}).status_code == 404
        assert client.get("/openapi.json", headers={"X-SceneLingo-Token": client.app.state.token}).status_code == 404


def test_token_and_query_are_absent_from_json_logs(tmp_path):
    with client_for(tmp_path) as client:
        token = client.app.state.token
        query = "private_query_marker_12345"
        response = client.get(f"/api/v1/system/info?value={query}", headers={"X-SceneLingo-Token": token})
        assert response.status_code == 200
    log_path = tmp_path / "data" / "logs" / "scenelingo.log"
    log = log_path.read_text(encoding="utf-8")
    assert token not in log
    assert query not in log
    assert str(tmp_path) not in log
    for line in log.splitlines():
        entry = json.loads(line)
        assert {"time", "level", "operation", "code"} <= entry.keys()
        if entry["operation"] == "http_request":
            assert re.fullmatch(r"[0-9a-f]{32}", entry["request_id"])


def test_invalid_configuration_fails_readably(tmp_path):
    with pytest.raises(ConfigError, match="端口"):
        Settings(port=0, data_dir=tmp_path)
    with pytest.raises(ConfigError, match="端口"):
        Settings(port=65536, data_dir=tmp_path)
    with pytest.raises(ConfigError, match="端口"):
        load_settings(port="not-a-number", data_dir=str(tmp_path))
    file_instead_of_dir = tmp_path / "file"
    file_instead_of_dir.write_text("cannot be a directory")
    app = create_app(Settings(data_dir=file_instead_of_dir), clock=lambda: FIXED_TIME)
    with pytest.raises(ConfigError, match="数据目录不可写"):
        with TestClient(app, base_url=BASE_URL):
            pass


def test_data_and_log_directories_are_private(tmp_path):
    with client_for(tmp_path) as client:
        page = client.get("/")
        assert page.status_code == 200
        assert "SceneLingo" in page.text
        assert client.app.state.token in page.text
        assert client.app.state.token not in str(page.url)
        assert not re.search(r"https?://", page.text)
        assert client.get("/static/app.js").status_code == 200
        assert client.get("/static/style.css").status_code == 200
        assert client.app.state.token not in client.get("/static/app.js").text
        assert client.app.state.token not in (WEB_DIR / "index.html").read_text()
        assert client.app.state.token not in (WEB_DIR / "app.js").read_text()
    for directory in (tmp_path / "data", tmp_path / "data" / "logs"):
        assert stat.S_IMODE(directory.stat().st_mode) == 0o700
    assert stat.S_IMODE((tmp_path / "data" / "logs" / "scenelingo.log").stat().st_mode) == 0o600


def test_token_is_rotated_on_restart_and_not_written_to_disk(tmp_path):
    app = create_app(Settings(data_dir=tmp_path / "data"), clock=lambda: FIXED_TIME)
    with TestClient(app, base_url=BASE_URL) as client:
        first = client.app.state.token
        assert first in client.get("/").text
    with TestClient(app, base_url=BASE_URL) as client:
        second = client.app.state.token
        assert second != first
        assert second in client.get("/").text
    for file in (tmp_path / "data").rglob("*"):
        if file.is_file():
            content = file.read_bytes()
            assert first.encode() not in content and second.encode() not in content


def test_json_only_api_and_uniform_error(tmp_path):
    with client_for(tmp_path) as client:
        token = client.app.state.token
        response = client.post("/api/v1/system/info", headers={
            "X-SceneLingo-Token": token, "Origin": BASE_URL,
            "Content-Type": "application/x-www-form-urlencoded",
        }, content="a=b")
        assert response.status_code == 415
        assert response.json() == {"error": {
            "code": "invalid_content_type", "message": "API 请求必须使用 application/json。",
        }}


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_every_mutating_method_rejects_missing_or_foreign_origin(tmp_path, method):
    with client_for(tmp_path) as client:
        headers = {"X-SceneLingo-Token": client.app.state.token,
                   "Content-Type": "application/json"}
        for origin, expected_code in ((None, "missing_origin"),
                                      ("https://evil.example", "invalid_origin"),
                                      ("null", "invalid_origin"),
                                      ("http://localhost:9999", "invalid_origin")):
            attempt_headers = {**headers, **({"Origin": origin} if origin else {})}
            response = client.request(method, "/api/v1/system/info",
                                      headers=attempt_headers, content="{}")
            assert response.status_code == 403
            assert response.json()["error"]["code"] == expected_code
            assert "access-control-allow-origin" not in response.headers


@pytest.mark.parametrize("content_type", [
    "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", "text/plain",
])
def test_same_origin_form_content_types_cannot_reach_api(tmp_path, content_type):
    with client_for(tmp_path) as client:
        response = client.post("/api/v1/system/info", headers={
            "Origin": BASE_URL, "Content-Type": content_type,
            "X-SceneLingo-Token": client.app.state.token,
        }, content="a=b")
        assert response.status_code == 415
        assert response.json()["error"]["code"] == "invalid_content_type"
        assert "access-control-allow-origin" not in response.headers


def test_browser_preflight_never_grants_cross_origin_access(tmp_path):
    with client_for(tmp_path) as client:
        preflight = {
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "x-scenelingo-token,content-type",
        }
        foreign = client.options("/api/v1/system/info", headers={
            **preflight, "Origin": "https://evil.example",
        })
        assert foreign.status_code == 403
        assert foreign.json()["error"]["code"] == "invalid_origin"
        local = client.options("/api/v1/system/info", headers={
            **preflight, "Origin": BASE_URL,
        })
        assert local.status_code == 401  # No token on a browser preflight.
        for response in (foreign, local):
            assert "access-control-allow-origin" not in response.headers
            assert "access-control-allow-headers" not in response.headers
            assert "access-control-allow-methods" not in response.headers


def test_cross_site_read_cannot_use_api_and_page_has_browser_guards(tmp_path):
    with client_for(tmp_path) as client:
        foreign_page = client.get("/", headers={"Origin": "https://evil.example"})
        assert foreign_page.status_code == 403
        foreign_api = client.get("/api/v1/system/info", headers={
            "Origin": "https://evil.example", "X-SceneLingo-Token": client.app.state.token,
        })
        assert foreign_api.status_code == 403
        navigation = client.get("/")  # Top-level navigation normally has no Origin.
        assert navigation.status_code == 200
        assert client.app.state.token in navigation.text
        assert "frame-ancestors 'none'" in navigation.headers["content-security-policy"]
        assert navigation.headers["x-content-type-options"] == "nosniff"
        assert navigation.headers["cache-control"] == "no-store"
        assert "access-control-allow-origin" not in navigation.headers


def test_local_process_can_read_page_token_with_no_origin_by_design(tmp_path):
    with client_for(tmp_path) as client:
        page = client.get("/")
        token = re.search(r'name="scenelingo-token" content="([^"]+)"', page.text).group(1)
        response = client.get("/api/v1/system/info", headers={"X-SceneLingo-Token": token})
        assert response.status_code == 200
