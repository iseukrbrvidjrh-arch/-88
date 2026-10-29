"""Transactional BR-REV review use cases."""

from datetime import date,datetime,timedelta,timezone
import sqlite3
import re

from app.core.errors import ApplicationError
from app.domain.review.rules import is_success,mastery,next_interval,spelling_correct,validate_rating
from app.repositories.database import Database,transaction
from app.repositories.review import ReviewRepository
from app.services.subtitle_query import _page


def review_queue(database:Database,*,mode:str,today:date,limit:int|None=None):
    if mode not in {"spelling","meaning"}: raise ApplicationError("invalid_review_mode","复习模式无效。",status_code=422)
    if limit is not None and (limit<1 or limit>1000): raise ApplicationError("invalid_review_limit","复习数量无效。",status_code=422)
    with database.connection() as conn: rows=ReviewRepository(conn).queue(today.isoformat(),mode,limit)
    def item(row):
        context=row[5]
        if mode=="spelling" and context:
            pattern=re.escape(row[1]).replace("'","['’]")
            context=re.sub(pattern,"____",context,flags=re.IGNORECASE)
        return {"learning_item_id":row[0],"display_text":row[1] if mode=="meaning" else None,
                "status":row[2],"next_review_date":row[3],"context":context}
    return {"mode":mode,"today":today.isoformat(),"items":[item(row) for row in rows],"total":len(rows),"message":("暂无释义，先获取释义" if mode=="meaning" and not rows else None)}


def submit_review(database:Database,*,item_id:int,mode:str,user_input:str|None,final_rating:str,
                  attempt_token:str,now=lambda:datetime.now(timezone.utc),repository_type=ReviewRepository):
    moment=now(); local_day=moment.date(); attempted_at=moment.astimezone(timezone.utc).isoformat()
    if mode not in {"spelling","meaning"} or not attempt_token.strip(): raise ApplicationError("invalid_review_request","复习提交无效。",status_code=422)
    try:
      with database.connection() as conn,transaction(conn):
        repo=repository_type(conn); existing=repo.existing_attempt(attempt_token)
        if existing: return {"attempt_id":existing[0],"learning_item_id":existing[1],"final_rating":existing[2],"is_success":bool(existing[3]),"interval_after_days":existing[4],"next_review_date":existing[5],"idempotent_replay":True}
        state=repo.item_state(item_id)
        if state is None: raise ApplicationError("learning_item_not_found","词条不存在。",status_code=404)
        correct=spelling_correct(user_input or "",state[0]) if mode=="spelling" else None
        try: validate_rating(mode,correct,final_rating)
        except ValueError as exc: raise ApplicationError("invalid_final_rating","最终评分不符合拼写结果。",status_code=422) from exc
        success=is_success(mode,correct,final_rating); before=state[2] or None
        interval=next_interval(before,final_rating,state[1]=="mastered"); next_date=(local_day+timedelta(days=interval)).isoformat()
        prior=[date.fromisoformat(value) for value in repo.success_dates(item_id)]; all_success=prior+([local_day] if success else [])
        summary=mastery(all_success,success); status="mastered" if summary.mastered else "learning"
        mastered_at=attempted_at if summary.mastered and state[1]!="mastered" else (state[3] if summary.mastered else None)
        self_rating=("good" if correct else "again") if mode=="spelling" else final_rating
        attempt_id=repo.insert_attempt((attempt_token,item_id,mode,attempted_at,local_day.isoformat(),user_input,
            None if correct is None else int(correct),self_rating,final_rating,int(success),before,interval,next_date,attempted_at))
        repo.update_state(item_id,status=status,next_date=next_date,interval=interval,success_count=summary.count,
            distinct_dates=summary.distinct_dates,first_date=summary.first_date.isoformat() if summary.first_date else None,
            rating=final_rating,attempted_at=attempted_at,mastered_at=mastered_at)
        return {"attempt_id":attempt_id,"learning_item_id":item_id,"spelling_correct":correct,"final_rating":final_rating,
            "is_success":success,"interval_after_days":interval,"next_review_date":next_date,"status":status,"idempotent_replay":False}
    except sqlite3.IntegrityError:
      with database.connection() as conn:
        existing=ReviewRepository(conn).existing_attempt(attempt_token)
        if existing: return {"attempt_id":existing[0],"learning_item_id":existing[1],"final_rating":existing[2],"is_success":bool(existing[3]),"interval_after_days":existing[4],"next_review_date":existing[5],"idempotent_replay":True}
      raise


def review_history(database:Database,item_id:int,page=1,page_size=50):
    limit,offset=_page(page,page_size)
    with database.connection() as conn: rows,total=ReviewRepository(conn).history(item_id,limit,offset)
    keys=("id","attempt_token","mode","attempted_at","attempted_local_date","user_input","is_spelling_correct","self_rating","final_rating","is_success","interval_before_days","interval_after_days","next_review_date")
    return {"items":[dict(zip(keys,row)) for row in rows],"page":page,"page_size":page_size,"total":total}
