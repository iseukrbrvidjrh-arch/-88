"""TASK-012 daily aggregates, status totals and durable resume state."""

from datetime import date, datetime, timedelta, timezone

from app.core.errors import ApplicationError
from app.repositories.database import Database, transaction
from app.repositories.progress import ProgressRepository


def _date(value: str | None, fallback: date) -> date:
    if value is None: return fallback
    try: return date.fromisoformat(value)
    except ValueError as exc:
        raise ApplicationError("invalid_date","日期必须使用 YYYY-MM-DD。",status_code=422) from exc


def daily_progress(database:Database,*,today:date,start:str|None=None,end:str|None=None):
    end_day=_date(end,today); start_day=_date(start,end_day-timedelta(days=6))
    if start_day>end_day or (end_day-start_day).days>366:
        raise ApplicationError("invalid_date_range","日期范围无效或超过 366 天。",status_code=422)
    with database.connection() as conn: rows=ProgressRepository(conn).daily_records(start_day.isoformat(),end_day.isoformat())
    items=[]
    for day,attempts,correct,distinct,new_words,ai_saves in rows:
        items.append({"date":day,"review_attempt_count":attempts,"correct_review_count":correct,
            "distinct_review_item_count":distinct,
            "review_accuracy":correct/attempts if attempts else None,
            "new_learning_item_count":new_words,"ai_saved_content_count":ai_saves})
    return {"start_date":start_day.isoformat(),"end_date":end_day.isoformat(),"items":items,"total":len(items)}


def status_summary(database:Database,*,today:date,logger=None):
    with database.connection() as conn:
        repo=ProgressRepository(conn); row=repo.status_counts(today.isoformat()); issues=repo.consistency_issues()
    if issues and logger:
        logger.warning("progress_consistency_warning",extra={"operation":"progress_recompute","code":"inconsistent","issue_count":len(issues)})
    values=[int(value or 0) for value in row]
    return {"as_of_date":today.isoformat(),"total_active":values[0],"new_count":values[1],
        "learning_count":values[2],"mastered_count":values[3],"due_today_count":values[4],
        "consistent":not issues,"consistency_issues":issues}


def save_progress(database:Database,*,subtitle_id:int|None,cue_id:int|None,
                  review_item_id:int|None,clear_review:bool,now):
    moment=now(); stamp=moment.astimezone(timezone.utc).isoformat()
    with database.connection() as conn,transaction(conn):
        repo=ProgressRepository(conn); values={"learning.last_active_at":stamp}
        if subtitle_id is not None or cue_id is not None:
            if subtitle_id is None or cue_id is None or repo.continue_subtitle(subtitle_id,cue_id) is None:
                raise ApplicationError("progress_target_invalid","字幕与 cue 定位无效。",status_code=422)
            values.update({"learning.last_subtitle_id":str(subtitle_id),"learning.last_cue_id":str(cue_id)})
        if clear_review: values["learning.last_review_item_id"]=None
        elif review_item_id is not None:
            if repo.continue_review(review_item_id,moment.date().isoformat()) is None:
                raise ApplicationError("progress_target_invalid","复习位置无效。",status_code=422)
            values["learning.last_review_item_id"]=str(review_item_id)
        repo.save_settings(values,stamp)
    return {"saved":True,"last_active_at":stamp}


def continue_learning(database:Database,*,today:date):
    with database.connection() as conn:
        repo=ProgressRepository(conn); settings=repo.settings(); subtitle=None; review=None; stale=False
        try:
            if "learning.last_subtitle_id" in settings and "learning.last_cue_id" in settings:
                row=repo.continue_subtitle(int(settings["learning.last_subtitle_id"]),int(settings["learning.last_cue_id"]))
                if row: subtitle={"subtitle_id":row[0],"subtitle_title":row[1],"cue_id":row[2],"cue_sequence":row[3]}
                else: stale=True
            if "learning.last_review_item_id" in settings:
                row=repo.continue_review(int(settings["learning.last_review_item_id"]),today.isoformat())
                if row:
                    due_ids=repo.due_ids(today.isoformat()); position=due_ids.index(row[0])
                    review={"learning_item_id":row[0],"display_text":row[1],"status":row[2],
                        "next_review_date":row[3],"remaining_count":len(due_ids)-position}
                else: stale=True
        except (TypeError,ValueError): stale=True
    available=subtitle is not None or review is not None
    return {"available":available,"subtitle":subtitle,"review":review,
        "last_active_at":settings.get("learning.last_active_at"),"stale_reference":stale,
        "fallback":"subtitle_library" if stale and not available else None}
