"""TASK-010 gateway, consent, immutable plans, cache, cost and degradation tests."""

from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import urllib.error

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.config import load_settings
from app.core.errors import ApplicationError
from app.integrations.qwen_gateway import GatewayResult, QwenGateway
from app.integrations.keychain import MacOSKeychain
from app.main import create_app


class FakeSecrets:
    def __init__(self,value=None): self.value=value
    def configured(self): return bool(self.value)
    def read(self):
        if not self.value: raise ApplicationError("api_key_not_configured","missing",status_code=409)
        return self.value
    def write(self,value): self.value=value
    def delete(self): self.value=None

class FakeGateway:
    def __init__(self,result=None,error=None): self.calls=[]; self.result=result or GatewayResult("你好","qwen3.8-max",10,4); self.error=error
    def complete(self,**kwargs):
        self.calls.append(kwargs)
        if self.error: raise self.error
        return self.result

class MutableClock:
    def __init__(self): self.now=datetime(2026,10,30,10,0,tzinfo=timezone.utc)
    def __call__(self): return self.now

def client_for(tmp_path,key="sk-secret-test",gateway=None,clock=None):
    secret=FakeSecrets(key); gateway=gateway or FakeGateway(); clock=clock or MutableClock()
    app=create_app(Settings(data_dir=tmp_path/"data"),clock=clock,secret_store=secret,qwen_gateway=gateway)
    client=TestClient(app,base_url="http://127.0.0.1:8765"); client.__enter__()
    headers={"Origin":"http://127.0.0.1:8765","X-SceneLingo-Token":client.app.state.token}
    return client,headers,secret,gateway,clock

def put(client,headers,path,payload): return client.put(path,headers=headers,json=payload)
def post(client,headers,path,payload): return client.post(path,headers=headers,json=payload)
def ready(client,headers):
    assert put(client,headers,"/api/v1/ai/settings",{"cloud_enabled":True,"consent_accepted":True}).status_code==200

def plan(client,headers,kind="translation",text="Hello",context=""):
    return post(client,headers,"/api/v1/ai/send-plans",{"kind":kind,"text":text,"context":context})

def execute(client,headers,p): return post(client,headers,"/api/v1/ai/execute",{"plan_id":p["plan_id"],"execution_token":p["execution_token"]})

def test_missing_key_disabled_and_no_consent_all_make_zero_requests(tmp_path):
    client,h,_,gateway,_=client_for(tmp_path,key=None)
    try:
        assert plan(client,h).json()["error"]["code"]=="cloud_disabled"
        put(client,h,"/api/v1/ai/settings",{"cloud_enabled":True})
        assert plan(client,h).json()["error"]["code"]=="cloud_consent_required"
        put(client,h,"/api/v1/ai/settings",{"consent_accepted":True})
        assert plan(client,h).json()["error"]["code"]=="api_key_not_configured"
        assert gateway.calls==[]
    finally: client.__exit__(None,None,None)

def test_preview_is_exact_request_and_contains_no_history_or_secret(tmp_path):
    client,h,_,gateway,_=client_for(tmp_path)
    try:
        ready(client,h); p=plan(client,h,"context_explanation","break a leg","Break a leg tonight.").json()
        assert p["history_count"]==0 and p["attachments"]==[] and p["destination"]=="千问 API"
        assert "sk-secret-test" not in json.dumps(p,ensure_ascii=False)
        result=execute(client,h,p)
        assert result.status_code==200 and gateway.calls[0]["messages"]==p["actual_content"]
    finally: client.__exit__(None,None,None)

def test_plan_one_time_bad_token_and_expiry(tmp_path):
    clock=MutableClock(); client,h,_,gateway,_=client_for(tmp_path,clock=clock)
    try:
        ready(client,h); p=plan(client,h).json()
        bad=dict(p); bad["execution_token"]="wrong"
        assert execute(client,h,bad).json()["error"]["code"]=="send_plan_token_invalid"
        assert execute(client,h,p).json()["error"]["code"]=="send_plan_used_or_missing"
        p2=plan(client,h).json(); clock.now+=timedelta(minutes=6)
        assert execute(client,h,p2).json()["error"]["code"]=="send_plan_expired"
        assert gateway.calls==[]
    finally: client.__exit__(None,None,None)

def test_tampered_server_plan_is_rejected(tmp_path):
    client,h,_,gateway,_=client_for(tmp_path)
    try:
        ready(client,h); p=plan(client,h).json(); service=client.app.state.ai_service
        original=service._plans[p["plan_id"]]
        object.__setattr__(original,"messages_json",original.messages_json+" ")
        response=execute(client,h,p)
        assert response.json()["error"]["code"]=="send_plan_changed" and gateway.calls==[]
    finally: client.__exit__(None,None,None)

def test_success_cache_context_separation_usage_and_cost(tmp_path):
    gateway=FakeGateway(GatewayResult("你好","qwen3.8-max",12,3)); client,h,_,_,_=client_for(tmp_path,gateway=gateway)
    try:
        ready(client,h); first=execute(client,h,plan(client,h,text="Hello",context="A").json()).json()
        second=execute(client,h,plan(client,h,text="Hello",context="A").json()).json()
        third=execute(client,h,plan(client,h,text="Hello",context="B").json()).json()
        assert first["source"]==third["source"]=="qwen_api" and second["source"]=="local_cache"
        assert len(gateway.calls)==2 and first["cost"]["usage_source"]=="api"
        costs=client.get("/api/v1/ai/costs",headers=h).json()["items"]
        assert len(costs)==2 and costs[0]["input_tokens"]==12 and costs[0]["currency"]=="CNY"
    finally: client.__exit__(None,None,None)

def test_v6_migrates_existing_v5_without_changing_existing_data(tmp_path):
    from app.repositories.database import Database, transaction
    from app.repositories.migrations.runner import initialize_database
    from app.repositories.migrations.versions import MIGRATIONS
    db=Database(tmp_path/"migration"/"scenelingo.db")
    initialize_database(db,migrations=MIGRATIONS[:5])
    with db.connection() as conn, transaction(conn):
        conn.execute("INSERT INTO learning_item(entry_type,dedupe_key,display_text,source_kind,saved_from_ai,created_at,updated_at,created_local_date) VALUES('word','hello','hello','manual',0,'now','now','2026-10-30')")
    result=initialize_database(db)
    assert result.applied_versions==(6,) and result.backup_path is not None
    with db.connection() as conn:
        assert conn.execute("SELECT display_text FROM learning_item").fetchone()==("hello",)
        assert {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")} >= {"ai_cache","cost_record","app_setting"}

def test_missing_usage_is_marked_character_estimate(tmp_path):
    gateway=FakeGateway(GatewayResult("释义内容","qwen3.8-max",None,None)); client,h,_,_,_=client_for(tmp_path,gateway=gateway)
    try:
        ready(client,h); result=execute(client,h,plan(client,h,"definition","serendipity").json()).json()
        assert result["cost"]["usage_source"]=="estimated_chars"
        row=client.get("/api/v1/ai/costs",headers=h).json()["items"][0]
        assert row["input_tokens"] is None and row["usage_source"]=="estimated_chars"
    finally: client.__exit__(None,None,None)

@pytest.mark.parametrize("error,code",[
    (ApplicationError("ai_timeout","timeout",status_code=504),"ai_timeout"),
    (ApplicationError("ai_rate_limited","limited",status_code=503),"ai_rate_limited"),
    (ApplicationError("ai_offline","offline",status_code=503),"ai_offline"),
    (ApplicationError("ai_upstream_error","server",status_code=502),"ai_upstream_error"),
    (ApplicationError("ai_invalid_response","format",status_code=502),"ai_invalid_response"),
])
def test_gateway_errors_are_classified_without_retry(tmp_path,error,code):
    gateway=FakeGateway(error=error); client,h,_,_,_=client_for(tmp_path,gateway=gateway)
    try:
        ready(client,h); response=execute(client,h,plan(client,h).json())
        assert response.json()["error"]["code"]==code and len(gateway.calls)==1
        costs=client.get("/api/v1/ai/costs",headers=h).json()["items"]
        assert len(costs)==1 and costs[0]["status"]=="failed"
        assert costs[0]["estimated_cost"] is None and costs[0]["usage_source"] is None
    finally: client.__exit__(None,None,None)

def test_key_api_masks_and_never_persists_secret(tmp_path):
    client,h,secret,_,_=client_for(tmp_path,key=None)
    try:
        value="test-secret-never-store-this"
        response=put(client,h,"/api/v1/ai/key",{"key":value})
        assert response.json()=={"key_status":"configured","masked":"••••••••"} and secret.value==value
        assert value not in (tmp_path/"data"/"logs"/"scenelingo.log").read_text()
        db_bytes=(tmp_path/"data"/"scenelingo.db").read_bytes()
        assert value.encode() not in db_bytes
    finally: client.__exit__(None,None,None)

def test_keychain_denial_is_mapped_without_backend_details():
    class Denied:
        def get_password(self,*args): raise RuntimeError("secret backend detail")
    with pytest.raises(ApplicationError) as caught:
        MacOSKeychain(Denied()).read()
    assert caught.value.code=="keychain_access_denied"
    assert "secret backend detail" not in caught.value.message

def test_keychain_status_uses_metadata_lookup_without_password_flag():
    seen=[]
    class Result: returncode=0
    def runner(argv,**kwargs): seen.append((argv,kwargs)); return Result()
    assert MacOSKeychain(status_runner=runner).configured() is True
    argv,kwargs=seen[0]
    assert argv==["/usr/bin/security","find-generic-password","-a","default","-s","SceneLingo.Qwen"]
    assert "-w" not in argv and kwargs["check"] is False

def test_approved_highest_model_and_no_silent_fallback(tmp_path):
    error=ApplicationError("ai_upstream_error","unavailable",status_code=502)
    gateway=FakeGateway(error=error); client,h,_,_,_=client_for(tmp_path,gateway=gateway)
    try:
        ready(client,h); p=plan(client,h).json(); execute(client,h,p)
        assert p["model"]=="qwen3.8-max" and [call["model"] for call in gateway.calls]==["qwen3.8-max"]
    finally: client.__exit__(None,None,None)

def test_actual_gateway_parses_limits_and_maps_failures_without_key_leak():
    class Response:
        def __enter__(self): return self
        def __exit__(self,*args): pass
        def read(self,n): return json.dumps({"model":"qwen-turbo","choices":[{"message":{"content":"ok"}}],"usage":{"prompt_tokens":2,"completion_tokens":1}}).encode()
    seen={}
    def opener(request,timeout): seen["auth"]=request.headers["Authorization"]; seen["timeout"]=timeout; return Response()
    gateway=QwenGateway("https://example.invalid/compatible-mode/v1",7,50,1000,opener)
    result=gateway.complete(api_key="sk-private",model="qwen-turbo",messages=[{"role":"user","content":"hi"}])
    assert result.text=="ok" and seen=={"auth":"Bearer sk-private","timeout":7}
    def limited(request,timeout): raise urllib.error.HTTPError(request.full_url,429,"limited",{},None)
    with pytest.raises(ApplicationError) as caught:
        QwenGateway("https://example.invalid/compatible-mode/v1",7,50,1000,limited).complete(api_key="sk-private",model="qwen-turbo",messages=[])
    assert caught.value.code=="ai_rate_limited" and "sk-private" not in caught.value.message
    class ChangedModel(Response):
        def read(self,n): return json.dumps({"model":"qwen-plus","choices":[{"message":{"content":"ok"}}]}).encode()
    with pytest.raises(ApplicationError) as mismatch:
        QwenGateway("https://example.invalid/compatible-mode/v1",7,50,1000,lambda request,timeout:ChangedModel()).complete(api_key="sk-private",model="qwen-turbo",messages=[])
    assert mismatch.value.code=="ai_model_mismatch"

def test_only_gateway_module_has_cloud_http_imports_and_local_features_survive(tmp_path):
    root=Path(__file__).parents[1]/"app"
    offenders=[]
    for path in root.rglob("*.py"):
        source=path.read_text()
        if any(term in source for term in ("import httpx","import requests","urlopen")) and path.name!="qwen_gateway.py": offenders.append(path)
    assert offenders==[]
    gateway=FakeGateway(error=ApplicationError("ai_offline","offline",status_code=503)); client,h,_,_,_=client_for(tmp_path,gateway=gateway)
    try:
        ready(client,h); execute(client,h,plan(client,h).json())
        assert client.get("/api/v1/health").status_code==200
        assert client.get("/api/v1/subtitles",headers=h).status_code==200
        assert client.get("/api/v1/pronunciation?word=hello",headers=h).json()["found"] is True
    finally: client.__exit__(None,None,None)

def test_frontend_has_explicit_preview_and_never_embeds_or_persists_key():
    root=Path(__file__).parents[1]/"app/web"
    html=(root/"index.html").read_text(); script=(root/"app.js").read_text()
    assert "实际发送内容" in html and "确认发送" in html and "history_count" not in html
    assert "localStorage" not in script and "sessionStorage" not in script
    assert "api-key" in html and "type=\"password\"" in html
    assert "JSON.stringify(aiPlan.actual_content" in script

def test_default_endpoint_matches_approved_pay_as_you_go_credential(monkeypatch):
    monkeypatch.delenv("SCENELINGO_QWEN_BASE_URL",raising=False)
    settings=load_settings()
    assert settings.qwen_base_url=="https://maas.qianwenaiapi.com/compatible-mode/v1"
    assert settings.qwen_model=="qwen3.8-max"
