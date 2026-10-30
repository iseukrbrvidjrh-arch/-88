"""TASK-012 real aggregates, date boundaries and durable continue learning."""

from datetime import datetime,timedelta,timezone
from pathlib import Path

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.repositories.database import Database,transaction
from app.repositories.migrations.runner import initialize_database
from app.services.progress import daily_progress,status_summary
from app.services.review import submit_review
from app.services.subtitle_import import import_subtitle
from app.services.vocabulary import add_word

DATA=b"1\n00:00:01,000 --> 00:00:02,000\nLearn bright words\n\n2\n00:00:03,000 --> 00:00:04,000\nBright ideas last\n"

def at(day,hour=12,offset=8):
    value=datetime.fromisoformat(f"{day}T{hour:02d}:00:00").replace(tzinfo=timezone(timedelta(hours=offset)))
    return lambda:value

def setup(tmp_path:Path,day="2026-10-30"):
    db=Database(tmp_path/"data/scenelingo.db");initialize_database(db)
    sub=import_subtitle(db,filename="original.srt",data=DATA,now=at(day)).subtitle
    with db.connection() as conn: cues=[r[0] for r in conn.execute("SELECT id FROM cue ORDER BY sequence")]
    return db,sub.id,cues

def add(db,sid,cue,word,day): return add_word(db,subtitle_id=sid,cue_id=cue,token_key=word,now=at(day))["learning_item_id"]

def test_empty_database_and_open_or_import_do_not_create_learning_day(tmp_path):
    db=Database(tmp_path/"empty/scenelingo.db");initialize_database(db)
    assert daily_progress(db,today=datetime(2026,10,30).date())["items"]==[]
    assert status_summary(db,today=datetime(2026,10,30).date())["total_active"]==0
    import_subtitle(db,filename="only-import.srt",data=DATA,now=at("2026-10-30"))
    assert daily_progress(db,today=datetime(2026,10,30).date())["items"]==[]

def test_daily_metrics_same_word_repeated_and_accuracy(tmp_path):
    db,sid,cues=setup(tmp_path);item=add(db,sid,cues[0],"bright","2026-10-30")
    submit_review(db,item_id=item,mode="spelling",user_input="bright",final_rating="good",attempt_token="one",now=at("2026-10-30"))
    submit_review(db,item_id=item,mode="spelling",user_input="wrong",final_rating="again",attempt_token="two",now=at("2026-10-30"))
    submit_review(db,item_id=item,mode="meaning",user_input=None,final_rating="good",attempt_token="three",now=at("2026-10-30"))
    row=daily_progress(db,today=datetime(2026,10,30).date())["items"][0]
    assert (row["review_attempt_count"],row["correct_review_count"],row["distinct_review_item_count"])==(3,2,1)
    assert row["review_accuracy"]==2/3 and row["new_learning_item_count"]==1

def test_two_days_are_separate_and_local_timezone_wins(tmp_path):
    db,sid,cues=setup(tmp_path,"2026-12-31");item=add(db,sid,cues[0],"bright","2026-12-31")
    submit_review(db,item_id=item,mode="spelling",user_input="bright",final_rating="good",attempt_token="east",now=at("2026-12-31",23,8))
    submit_review(db,item_id=item,mode="spelling",user_input="bright",final_rating="good",attempt_token="west",now=at("2027-01-01",1,-5))
    rows=daily_progress(db,today=datetime(2027,1,1).date(),start="2026-12-31",end="2027-01-01")["items"]
    assert [(r["date"],r["review_attempt_count"]) for r in rows]==[("2027-01-01",1),("2026-12-31",1)]

def test_ai_save_counts_once_and_ai_word_can_count_both_metrics(tmp_path):
    db,_,_=setup(tmp_path)
    with db.connection() as conn,transaction(conn):
        conn.execute("""INSERT INTO learning_item(entry_type,dedupe_key,display_text,source_kind,source_label,saved_from_ai,created_at,updated_at,created_local_date)
          VALUES('word','novel','novel','ai','confirmed',1,'now','now','2026-10-30'),
                ('note','note','A note','ai','confirmed',1,'now','now','2026-10-30')""")
        word=conn.execute("SELECT id FROM learning_item WHERE dedupe_key='novel'").fetchone()[0]
        conn.execute("INSERT INTO review_state(learning_item_id,status,current_interval_days,success_count,distinct_success_dates,updated_at) VALUES(?,'new',0,0,0,'now')",(word,))
    row=daily_progress(db,today=datetime(2026,10,30).date())["items"][0]
    assert row["new_learning_item_count"]==1 and row["ai_saved_content_count"]==2

def test_status_sum_due_and_archived_exclusion(tmp_path):
    db,sid,cues=setup(tmp_path);first=add(db,sid,cues[0],"bright","2026-10-20");second=add(db,sid,cues[0],"learn","2026-10-29");add(db,sid,cues[1],"ideas","2026-10-30")
    for day in ("2026-10-20","2026-10-21","2026-10-30"):
        submit_review(db,item_id=first,mode="spelling",user_input="bright",final_rating="good",attempt_token=day,now=at(day))
    with db.connection() as conn,transaction(conn):
        conn.execute("UPDATE review_state SET status='archived' WHERE learning_item_id=?",(second,))
    result=status_summary(db,today=datetime(2026,10,30).date())
    assert result["total_active"]==result["new_count"]+result["learning_count"]+result["mastered_count"]==2
    assert result["mastered_count"]==1 and result["new_count"]==1
    assert result["due_today_count"]==1

def test_archiving_subtitle_does_not_change_word_statistics(tmp_path):
    db,sid,cues=setup(tmp_path);add(db,sid,cues[0],"bright","2026-10-30")
    before=status_summary(db,today=datetime(2026,10,30).date())
    with db.connection() as conn,transaction(conn): conn.execute("UPDATE subtitle SET status='archived' WHERE id=?",(sid,))
    assert status_summary(db,today=datetime(2026,10,30).date())["total_active"]==before["total_active"]

def test_recompute_reads_mutated_detail_and_warns_on_projection_mismatch(tmp_path,caplog):
    db,sid,cues=setup(tmp_path);item=add(db,sid,cues[0],"bright","2026-10-30")
    submit_review(db,item_id=item,mode="spelling",user_input="bright",final_rating="good",attempt_token="audit",now=at("2026-10-30"))
    with db.connection() as conn,transaction(conn):
        conn.execute("UPDATE review_attempt SET final_rating='again',is_success=0 WHERE attempt_token='audit'")
    assert daily_progress(db,today=datetime(2026,10,30).date())["items"][0]["correct_review_count"]==0
    result=status_summary(db,today=datetime(2026,10,30).date(),logger=__import__('logging').getLogger("test.progress"))
    assert not result["consistent"] and result["consistency_issues"]==[{"code":"review_projection_mismatch","count":1}]
    assert "progress_consistency_warning" in caplog.text

def test_continue_position_survives_restart_and_stale_subtitle_degrades(tmp_path):
    clock=at("2026-10-30");app=create_app(Settings(data_dir=tmp_path/"app"),clock=clock)
    with TestClient(app,base_url="http://127.0.0.1:8765") as client:
        h={"Origin":"http://127.0.0.1:8765","X-SceneLingo-Token":client.app.state.token}
        sub=import_subtitle(client.app.state.database,filename="resume.srt",data=DATA,now=clock).subtitle
        with client.app.state.database.connection() as conn: cue=conn.execute("SELECT id FROM cue WHERE subtitle_id=? ORDER BY sequence DESC",(sub.id,)).fetchone()[0]
        add_word(client.app.state.database,subtitle_id=sub.id,cue_id=cue,token_key="bright",now=clock)
        assert client.get("/api/v1/progress/summary",headers=h).json()["total_active"]==1
        assert client.put("/api/v1/progress/continue",headers=h,json={"subtitle_id":sub.id,"cue_id":cue}).status_code==200
    app=create_app(Settings(data_dir=tmp_path/"app"),clock=clock)
    with TestClient(app,base_url="http://127.0.0.1:8765") as client:
        h={"Origin":"http://127.0.0.1:8765","X-SceneLingo-Token":client.app.state.token}
        resumed=client.get("/api/v1/progress/continue",headers=h).json();assert resumed["available"] and resumed["subtitle"]["cue_sequence"]==2
        assert client.get("/api/v1/progress/summary",headers=h).json()["total_active"]==1
        with client.app.state.database.connection() as conn,transaction(conn): conn.execute("UPDATE subtitle SET status='deleted' WHERE id=?",(sub.id,))
        stale=client.get("/api/v1/progress/continue",headers=h).json()
        assert not stale["available"] and stale["stale_reference"] and stale["fallback"]=="subtitle_library"

def test_review_resume_and_duplicate_request_do_not_double_count(tmp_path):
    db,sid,cues=setup(tmp_path);item=add(db,sid,cues[0],"bright","2026-10-30")
    app=create_app(Settings(data_dir=tmp_path/"unused"),clock=at("2026-10-30"),startup_storage=(db,initialize_database(db)))
    with TestClient(app,base_url="http://127.0.0.1:8765") as client:
        h={"Origin":"http://127.0.0.1:8765","X-SceneLingo-Token":client.app.state.token}
        assert client.put("/api/v1/progress/continue",headers=h,json={"review_item_id":item}).status_code==200
        body={"learning_item_id":item,"mode":"spelling","user_input":"bright","final_rating":"good","attempt_token":"same"}
        assert client.post("/api/v1/review/attempts",headers=h,json=body).status_code==200
        assert client.post("/api/v1/review/attempts",headers=h,json=body).json()["idempotent_replay"]
        row=client.get("/api/v1/progress/daily",headers=h).json()["items"][0]
        assert row["review_attempt_count"]==1

def test_progress_endpoints_do_not_touch_cloud_gateway(tmp_path):
    class NoCloud:
        def __getattr__(self,name): raise AssertionError(f"cloud called: {name}")
    app=create_app(Settings(data_dir=tmp_path/"api"),clock=at("2026-10-30"),qwen_gateway=NoCloud())
    with TestClient(app,base_url="http://127.0.0.1:8765") as client:
        h={"Origin":"http://127.0.0.1:8765","X-SceneLingo-Token":client.app.state.token}
        assert client.get("/api/v1/progress/daily",headers=h).status_code==200
        assert client.get("/api/v1/progress/summary",headers=h).status_code==200
        assert client.get("/api/v1/progress/continue",headers=h).status_code==200
