"""TASK-008 local assets, safe rendering and integrated offline-capable UI contract."""

from datetime import datetime,timezone
from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app

BASE="http://127.0.0.1:8765"

def client(tmp_path:Path): return TestClient(create_app(Settings(data_dir=tmp_path/"data"),clock=lambda:datetime(2026,10,30,tzinfo=timezone.utc)),base_url=BASE)

def headers(c): return {"Origin":BASE,"X-SceneLingo-Token":c.app.state.token}

def test_page_uses_only_local_assets_and_module_script(tmp_path):
    with client(tmp_path) as c:
        page=c.get("/"); css=c.get("/static/style.css"); js=c.get("/static/app.js")
        assert page.status_code==css.status_code==js.status_code==200
        assert 'type="module"' in page.text and 'src="/static/app.js"' in page.text
        assert "http://" not in page.text and "https://" not in page.text
        assert "http://" not in css.text and "https://" not in css.text

def test_xss_subtitle_is_returned_as_inert_text_and_frontend_never_uses_innerhtml(tmp_path):
    data=b"1\n00:00:01,000 --> 00:00:02,000\n<script>alert(1)</script><img src=x onerror=alert(2)>Safe\n"
    with client(tmp_path) as c:
        h=headers(c); result=c.post("/api/v1/subtitles",headers=h,files={"file":("xss.srt",data)})
        assert result.status_code==201 and result.json()["preview"][0]["text"]=="alert(1)Safe"
        source=c.get("/static/app.js").text
        assert "innerHTML" not in source and "textContent" in source

def test_ui_contains_complete_local_learning_path_and_accessible_controls(tmp_path):
    with client(tmp_path) as c:
        page=c.get("/").text
        for marker in ("subtitle-upload","subtitle-library","subtitle-detail","candidate-list","vocabulary-library","vocabulary-detail","review-panel","review-history","settings-panel"):
            assert f'id="{marker}"' in page
        assert "role=\"status\"" in page and "type=\"file\"" in page

def test_frontend_calls_existing_contracts_without_recalculating_review_rules(tmp_path):
    with client(tmp_path) as c:
        source=c.get("/static/app.js").text
        for endpoint in ("/api/v1/subtitles","/candidates","/api/v1/vocabulary","/api/v1/review/queue","/api/v1/review/attempts","/history"):
            assert endpoint in source
        for forbidden in ("current_interval_days","success_count","distinct_success_dates","is_success ="):
            assert forbidden not in source

def test_duplicate_and_empty_states_are_structured_for_ui(tmp_path):
    data=b"1\n00:00:01,000 --> 00:00:02,000\nHello\n"
    with client(tmp_path) as c:
        h=headers(c)
        assert c.get("/api/v1/subtitles",headers=h).json()=={"items":[],"page":1,"page_size":50,"total":0}
        assert c.post("/api/v1/subtitles",headers=h,files={"file":("a.srt",data)}).status_code==201
        duplicate=c.post("/api/v1/subtitles",headers=h,files={"file":("b.srt",data)})
        assert duplicate.status_code==409 and duplicate.json()["error"]["code"]=="subtitle_already_exists"

def test_large_lists_remain_server_paginated(tmp_path):
    with client(tmp_path) as c:
        source=c.get("/static/app.js").text
        assert "page_size=50" in source and "state.detailPage" in source and "state.libraryPage" in source

def test_offline_ui_has_no_cloud_client_or_external_dependency(tmp_path):
    with client(tmp_path) as c:
        source=c.get("/static/app.js").text
        assert "navigator.onLine" in source and "外部网络不可用" in source
        assert "qwen" not in source.lower() and "fetch('http" not in source and 'fetch("http' not in source
