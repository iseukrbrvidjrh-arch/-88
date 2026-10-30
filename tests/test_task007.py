"""TASK-007 review rules, dates, atomicity, idempotency and cross-module flow."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timedelta,timezone
from pathlib import Path
import sqlite3

from fastapi.testclient import TestClient
import pytest

from app.core.config import Settings
from app.core.errors import ApplicationError
from app.domain.review.rules import mastery,next_interval,spelling_correct
from app.main import create_app
from app.repositories.database import Database
from app.repositories.migrations.runner import initialize_database
from app.repositories.migrations.versions import MIGRATIONS
from app.repositories.review import ReviewRepository
from app.services.review import review_history,review_queue,submit_review
from app.services.subtitle_import import import_subtitle
from app.services.vocabulary import add_word,candidates,library

DATA=b"1\n00:00:01,000 --> 00:00:02,000\nDon't wait\n\n2\n00:00:03,000 --> 00:00:04,000\nWait now\n"

def setup(tmp_path:Path):
    db=Database(tmp_path/"data/scenelingo.db"); initialize_database(db)
    sub=import_subtitle(db,filename="review.srt",data=DATA).subtitle
    with db.connection() as c: cue=c.execute("SELECT id FROM cue ORDER BY sequence LIMIT 1").fetchone()[0]
    item=add_word(db,subtitle_id=sub.id,cue_id=cue,token_key="don't")["learning_item_id"]
    return db,sub.id,item

def clock(day:str,hour=12,offset=8):
    value=datetime.fromisoformat(f"{day}T{hour:02d}:00:00").replace(tzinfo=timezone(timedelta(hours=offset)))
    return lambda:value

def submit(db,item,day,token,rating="good",answer="don't",offset=8):
    return submit_review(db,item_id=item,mode="spelling",user_input=answer,final_rating=rating,
                         attempt_token=token,now=clock(day,offset=offset))

def test_interval_and_spelling_rules_exact():
    assert [next_interval(value,"good",False) for value in (None,1,3,7,14,30)]==[1,3,7,14,30,30]
    assert [next_interval(value,"hard",False) for value in (7,3,1,None)]==[3,1,1,1]
    assert next_interval(30,"hard",True)==1 and next_interval(30,"again",True)==1
    assert spelling_correct(" DON’T ","don't") and not spelling_correct("well known","well-known")

def test_mastery_date_matrix_and_same_day_counterexample(tmp_path):
    db,_,item=setup(tmp_path)
    for i in range(3): assert submit(db,item,"2026-01-01",f"d1-{i}")["status"]=="learning"
    assert submit(db,item,"2026-01-02","d2")["status"]=="learning"
    final=submit(db,item,"2026-01-08","d8")
    assert final["status"]=="mastered"
    with db.connection() as c:
        state=c.execute("SELECT success_count,distinct_success_dates,first_success_date FROM review_state WHERE learning_item_id=?",(item,)).fetchone()
    assert state==(5,3,"2026-01-01")

def test_mastered_hard_and_again_return_to_learning(tmp_path):
    db,_,item=setup(tmp_path)
    for day in ("2026-01-01","2026-01-02","2026-01-08"): submit(db,item,day,day)
    result=submit(db,item,"2026-01-09","hard",rating="hard")
    assert result["status"]=="learning" and result["interval_after_days"]==1
    result=submit(db,item,"2026-01-10","again",rating="again",answer="wrong")
    assert result["status"]=="learning" and not result["is_success"]

def test_spelling_rating_corrections_do_not_count_success(tmp_path):
    db,_,item=setup(tmp_path)
    assert not submit(db,item,"2026-01-01","wrong-hard",rating="hard",answer="wrong")["is_success"]
    assert not submit(db,item,"2026-01-02","right-hard",rating="hard")["is_success"]
    with pytest.raises(ApplicationError) as caught: submit(db,item,"2026-01-03","wrong-good",answer="wrong")
    assert caught.value.code=="invalid_final_rating"

@pytest.mark.parametrize("day,expected,offset",[("2024-02-28","2024-02-29",8),("2024-02-29","2024-03-01",8),("2026-12-31","2027-01-01",8),("2026-03-31","2026-04-01",8),("2026-01-01","2026-01-02",-5)])
def test_date_boundaries_and_timezones(tmp_path,day,expected,offset):
    db,_,item=setup(tmp_path); assert submit(db,item,day,f"{day}-{offset}",offset=offset)["next_review_date"]==expected

def test_idempotent_replay_and_concurrent_duplicate(tmp_path):
    db,_,item=setup(tmp_path)
    def work(): return submit(db,item,"2026-01-01","same-token")
    with ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(lambda _:work(),range(2)))
    assert sorted(r["idempotent_replay"] for r in results)==[False,True]
    assert review_history(db,item)["total"]==1
    again=work(); assert again["idempotent_replay"] and review_history(db,item)["total"]==1

def test_transaction_failure_rolls_back_and_retry_succeeds(tmp_path):
    db,_,item=setup(tmp_path)
    class Failing(ReviewRepository):
        def update_state(self,*args,**kwargs): raise RuntimeError("injected")
    with pytest.raises(RuntimeError): submit_review(db,item_id=item,mode="spelling",user_input="don't",final_rating="good",attempt_token="retry",now=clock("2026-01-01"),repository_type=Failing)
    assert review_history(db,item)["total"]==0
    assert submit(db,item,"2026-01-01","retry")["idempotent_replay"] is False

def test_queue_due_sort_limit_and_meaning_without_definition(tmp_path):
    db,sub,item=setup(tmp_path)
    with db.connection() as c:
        cue=c.execute("SELECT id FROM cue WHERE sequence=2").fetchone()[0]
    second=add_word(db,subtitle_id=sub,cue_id=cue,token_key="wait")["learning_item_id"]
    with db.connection() as c:
        c.execute("UPDATE review_state SET status='learning',next_review_date='2026-01-01' WHERE learning_item_id=?",(second,)); c.commit()
    queue=review_queue(db,mode="spelling",today=datetime(2026,1,2).date())
    assert [x["learning_item_id"] for x in queue["items"]]==[second,item]
    assert "____" in queue["items"][1]["context"] and "Don't" not in queue["items"][1]["context"]
    assert review_queue(db,mode="meaning",today=datetime(2026,1,2).date())["message"]=="暂无释义，先获取释义"

def test_restart_history_projection_consistency(tmp_path):
    db,_,item=setup(tmp_path); submit(db,item,"2026-01-01","one"); submit(db,item,"2026-01-02","two",rating="hard")
    reopened=Database(db.path); history=review_history(reopened,item)
    with reopened.connection() as c: state=c.execute("SELECT success_count FROM review_state WHERE learning_item_id=?",(item,)).fetchone()[0]
    assert history["total"]==2 and state==sum(bool(row["is_success"]) for row in history["items"])

def test_v5_migrates_v4_with_backup(tmp_path):
    db=Database(tmp_path/"data/scenelingo.db"); initialize_database(db,migrations=MIGRATIONS[:4]); result=initialize_database(db,migrations=MIGRATIONS[:5])
    assert result.applied_versions==(5,) and result.backup_path is not None
    with sqlite3.connect(result.backup_path) as backup: assert backup.execute("PRAGMA user_version").fetchone()[0]==4

def test_cross_module_api_flow(tmp_path):
    app=create_app(Settings(data_dir=tmp_path/"api"),clock=clock("2026-01-01"))
    with TestClient(app,base_url="http://127.0.0.1:8765") as client:
        sub=import_subtitle(client.app.state.database,filename="chain.srt",data=DATA,now=clock("2026-01-01")).subtitle
        with client.app.state.database.connection() as c: cue=c.execute("SELECT id FROM cue ORDER BY sequence LIMIT 1").fetchone()[0]
        h={"Origin":"http://127.0.0.1:8765","X-SceneLingo-Token":client.app.state.token,"Content-Type":"application/json"}
        assert client.get(f"/api/v1/subtitles/{sub.id}/candidates",headers=h).status_code==200
        item=client.post("/api/v1/vocabulary",headers=h,json={"subtitle_id":sub.id,"cue_id":cue,"token_key":"don't"}).json()["learning_item_id"]
        assert client.get("/api/v1/vocabulary",headers=h).json()["total"]==1
        assert client.get("/api/v1/review/queue?mode=spelling",headers=h).json()["total"]==1
        result=client.post("/api/v1/review/attempts",headers=h,json={"learning_item_id":item,"mode":"spelling","user_input":"DON’T","final_rating":"good","attempt_token":"api-chain"})
        assert result.status_code==200 and result.json()["status"]=="learning"
        history=client.get(f"/api/v1/review/items/{item}/history",headers=h).json()
        assert history["total"]==1 and history["items"][0]["is_success"]==1
