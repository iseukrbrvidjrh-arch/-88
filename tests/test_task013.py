"""TASK-013 MVP hardening: recovery, dates, diagnostics and isolation."""

from datetime import datetime,timedelta,timezone
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.repositories.database import Database,transaction
from app.repositories.migrations.runner import initialize_database
from app.services.progress import continue_learning,daily_progress,save_progress
from app.services.review import submit_review
from app.services.subtitle_import import import_subtitle
from app.services.subtitle_import import MAX_FILE_BYTES
from app.domain.subtitle.parser import MAX_CUES,parse_subtitle
from app.core.errors import ApplicationError
from app.services.vocabulary import add_word

DATA=b"1\n00:00:01,000 --> 00:00:02,000\nBright ideas remain\n\n2\n00:00:03,000 --> 00:00:04,000\nIdeas become useful\n"

def clock(day,hour=12,offset=8):
    moment=datetime.fromisoformat(f"{day}T{hour:02d}:00:00").replace(tzinfo=timezone(timedelta(hours=offset)))
    return lambda:moment

def seeded(tmp_path):
    db=Database(tmp_path/"data/scenelingo.db");initialize_database(db)
    subtitle=import_subtitle(db,filename="original.srt",data=DATA,now=clock("2026-10-30")).subtitle
    with db.connection() as conn: cues=[row[0] for row in conn.execute("SELECT id FROM cue ORDER BY sequence")]
    item=add_word(db,subtitle_id=subtitle.id,cue_id=cues[0],token_key="bright",now=clock("2026-10-30"))["learning_item_id"]
    return db,subtitle.id,cues,item

def test_clock_rollback_keeps_positive_intervals_and_distinct_local_days(tmp_path):
    db,_,_,item=seeded(tmp_path)
    later=submit_review(db,item_id=item,mode="spelling",user_input="bright",final_rating="good",attempt_token="later",now=clock("2026-11-02",1,8))
    earlier=submit_review(db,item_id=item,mode="spelling",user_input="bright",final_rating="good",attempt_token="earlier",now=clock("2026-11-01",23,-5))
    assert later["interval_after_days"]>0 and earlier["interval_after_days"]>0
    assert earlier["next_review_date"]=="2026-11-04"
    rows=daily_progress(db,today=datetime(2026,11,2).date(),start="2026-11-01",end="2026-11-02")["items"]
    assert [(row["date"],row["review_attempt_count"]) for row in rows]==[("2026-11-02",1),("2026-11-01",1)]

def test_continue_learning_degrades_when_queue_changes_but_keeps_valid_subtitle(tmp_path):
    db,subtitle,cues,item=seeded(tmp_path)
    save_progress(db,subtitle_id=subtitle,cue_id=cues[1],review_item_id=item,clear_review=False,now=clock("2026-10-30"))
    with db.connection() as conn,transaction(conn):
        conn.execute("UPDATE review_state SET status='learning',next_review_date='2026-12-01' WHERE learning_item_id=?",(item,))
    result=continue_learning(db,today=datetime(2026,10,30).date())
    assert result["available"] and result["subtitle"]["cue_sequence"]==2
    assert result["review"] is None and result["stale_reference"]
    with db.connection() as conn,transaction(conn): conn.execute("UPDATE subtitle SET status='deleted' WHERE id=?",(subtitle,))
    result=continue_learning(db,today=datetime(2026,10,30).date())
    assert not result["available"] and result["fallback"]=="subtitle_library"

def test_clean_shutdown_backup_copy_and_restore_preserve_all_facts(tmp_path):
    db,subtitle,_,item=seeded(tmp_path)
    submit_review(db,item_id=item,mode="spelling",user_input="bright",final_rating="good",attempt_token="saved",now=clock("2026-10-30"))
    source=db.path.parent;backup=tmp_path/"manual-backup";shutil.copytree(source,backup)
    restored_dir=tmp_path/"restored";shutil.copytree(backup,restored_dir)
    restored=Database(restored_dir/"scenelingo.db");result=initialize_database(restored)
    assert result.applied_versions==()
    with restored.connection() as conn:
        assert conn.execute("PRAGMA quick_check").fetchone()==("ok",)
        assert conn.execute("SELECT count(*) FROM subtitle WHERE id=?",(subtitle,)).fetchone()[0]==1
        assert conn.execute("SELECT count(*) FROM learning_item WHERE id=?",(item,)).fetchone()[0]==1
        assert conn.execute("SELECT count(*) FROM review_attempt WHERE attempt_token='saved'").fetchone()[0]==1

def test_abnormal_process_exit_keeps_commit_and_rolls_back_partial_write(tmp_path):
    data_dir=tmp_path/"crash-data";script="""
import os,sys
from pathlib import Path
from app.repositories.database import Database,transaction
from app.repositories.migrations.runner import initialize_database
db=Database(Path(sys.argv[1])/"scenelingo.db");initialize_database(db)
with db.connection() as conn,transaction(conn):
    conn.execute("INSERT INTO app_setting(key,value,updated_at) VALUES('crash.committed','yes','now')")
conn=db.open_connection();conn.execute("BEGIN IMMEDIATE");conn.execute("INSERT INTO app_setting(key,value,updated_at) VALUES('crash.partial','no','now')")
os._exit(17)
"""
    result=subprocess.run([sys.executable,"-c",script,str(data_dir)],cwd=Path(__file__).parents[1])
    assert result.returncode==17
    db=Database(data_dir/"scenelingo.db")
    with db.connection() as conn:
        assert conn.execute("PRAGMA quick_check").fetchone()==("ok",)
        assert conn.execute("SELECT value FROM app_setting WHERE key='crash.committed'").fetchone()==("yes",)
        assert conn.execute("SELECT value FROM app_setting WHERE key='crash.partial'").fetchone() is None

def test_diagnostic_log_view_and_confirmed_clear_are_private(tmp_path):
    app=create_app(Settings(data_dir=tmp_path/"app"),clock=clock("2026-10-30"))
    with TestClient(app,base_url="http://127.0.0.1:8765") as client:
        token=client.app.state.token;headers={"Origin":"http://127.0.0.1:8765","X-SceneLingo-Token":token}
        secret="TEST_SECRET_NEVER_LOG_123456789";private_text="PRIVATE SUBTITLE SENTENCE"
        client.get(f"/api/v1/system/info?probe={private_text}",headers=headers)
        shown=client.get("/api/v1/system/logs?limit=200",headers=headers)
        assert shown.status_code==200 and shown.json()["total"]>0
        assert secret not in shown.text and private_text not in shown.text and str(tmp_path) not in shown.text
        denied=client.request("DELETE","/api/v1/system/logs",headers={**headers,"Content-Type":"application/json"},json={"confirmed":False})
        assert denied.status_code==409
        cleared=client.request("DELETE","/api/v1/system/logs",headers={**headers,"Content-Type":"application/json"},json={"confirmed":True})
        assert cleared.status_code==200
        remaining=client.get("/api/v1/system/logs?limit=200",headers=headers).json()["items"]
        assert all(entry["operation"] in {"log_maintenance","http_request"} for entry in remaining)

def test_key_never_enters_database_log_page_or_static_assets(tmp_path):
    class SecretStore:
        def __init__(self): self.value=None
        def write(self,value): self.value=value
        def read(self): return self.value
        def configured(self): return self.value is not None
        def delete(self): self.value=None
    key="TEST_SECRET_TASK013_MARKER_987654321";store=SecretStore()
    app=create_app(Settings(data_dir=tmp_path/"app"),clock=clock("2026-10-30"),secret_store=store)
    with TestClient(app,base_url="http://127.0.0.1:8765") as client:
        headers={"Origin":"http://127.0.0.1:8765","X-SceneLingo-Token":client.app.state.token,"Content-Type":"application/json"}
        response=client.put("/api/v1/ai/key",headers=headers,json={"key":key})
        assert response.status_code==200 and key not in response.text
        assert key not in client.get("/",headers={"Host":"127.0.0.1:8765"}).text
        assert key not in client.get("/static/app.js").text
    assert key.encode() not in (tmp_path/"app/scenelingo.db").read_bytes()
    assert key not in (tmp_path/"app/logs/scenelingo.log").read_text()


def test_size_and_twenty_thousand_cue_boundaries_are_exact(tmp_path):
    blocks=[f"{index+1}\n00:00:00,000 --> 00:00:01,000\nWord {index}" for index in range(MAX_CUES)]
    parsed=parse_subtitle("\n\n".join(blocks),"srt")
    assert len(parsed.cues)==MAX_CUES
    db=Database(tmp_path/"limits/scenelingo.db");initialize_database(db)
    try:
        import_subtitle(db,filename="exact.srt",data=b"x"*MAX_FILE_BYTES)
    except ApplicationError as exc:
        assert exc.code!="subtitle_file_too_large"
    else:
        raise AssertionError("non-subtitle bytes must not import")
    try:
        import_subtitle(db,filename="over.srt",data=b"x"*(MAX_FILE_BYTES+1))
    except ApplicationError as exc:
        assert exc.code=="subtitle_file_too_large"
    else:
        raise AssertionError("over-limit payload must fail")
