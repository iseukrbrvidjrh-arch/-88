"""Explicit vocabulary add and read-only query use cases."""

from datetime import datetime, timezone
import sqlite3

from app.core.errors import ApplicationError
from app.repositories.database import Database, transaction
from app.repositories.vocabulary import VocabularyRepository
from app.services.subtitle_query import _page, _timeline
from app.domain.subtitle.tokens import tokenize


def normalize_key(value: str) -> str:
    key = value.strip().replace("’", "'").lower()
    if not key:
        raise ApplicationError("invalid_token", "词形不能为空。", status_code=422)
    return key


def candidates(database: Database, subtitle_id: int, page: int = 1, page_size: int = 50):
    limit, offset = _page(page, page_size)
    with database.connection() as conn:
        if conn.execute("SELECT 1 FROM subtitle WHERE id=? AND status<>'deleted'", (subtitle_id,)).fetchone() is None:
            raise ApplicationError("subtitle_not_found", "字幕不存在或来源已不可用。", status_code=404)
        rows, total = VocabularyRepository(conn).candidates(subtitle_id, limit, offset)
    return {"items":[{"token_key":r[0],"display_form":r[1],"occurrence_count":r[2],"first_cue_id":r[3],"first_sequence":r[4],"learning_item_id":r[5],"in_library":r[5] is not None} for r in rows], "page":page,"page_size":page_size,"total":total}


def add_word(database: Database, *, subtitle_id: int, cue_id: int, token_key: str,
             now=lambda: datetime.now(timezone.utc)):
    key = normalize_key(token_key); moment = now(); stamp = moment.astimezone(timezone.utc).isoformat()
    with database.connection() as conn, transaction(conn):
        repo = VocabularyRepository(conn); source = repo.source(subtitle_id, cue_id, key)
        if source is None or key not in {token.key for token in tokenize(source[2])}:
            raise ApplicationError("vocabulary_source_invalid", "词形与来源 cue 不匹配。", status_code=422)
        existing = repo.get_by_key(key); created = existing is None
        if existing is None:
            try: item_id = repo.create_word(key, source[0], source[1], stamp, moment.astimezone().date().isoformat())
            except sqlite3.IntegrityError:
                existing = repo.get_by_key(key)
                if existing is None: raise
                item_id = int(existing[0]); created = False
        else: item_id = int(existing[0])
        context_added = repo.add_context(item_id,cue_id,subtitle_id,source[1],source[2],source[3],source[4],stamp)
        count = repo.context_count(item_id)
    return {"learning_item_id":item_id,"created":created,"context_added":context_added,"context_count":count,"status":"new"}


def library(database: Database, status="new", search="", sort="created_at", page=1, page_size=50):
    if status not in {"new","learning","mastered","archived"}: raise ApplicationError("invalid_status","词条状态筛选无效。",status_code=422)
    if sort not in {"frequency","alphabetical","created_at"}: raise ApplicationError("invalid_sort","词条排序无效。",status_code=422)
    limit,offset=_page(page,page_size)
    with database.connection() as conn: rows,total=VocabularyRepository(conn).list_items(status,search.strip(),sort,limit,offset)
    return {"items":[{"id":r[0],"display_text":r[1],"dedupe_key":r[2],"status":r[3],"next_review_date":r[4],"created_at":r[5],"context_count":r[6],"frequency":r[7]} for r in rows],"page":page,"page_size":page_size,"total":total}


def detail(database: Database, item_id: int):
    with database.connection() as conn: item, contexts=VocabularyRepository(conn).detail(item_id)
    if item is None: raise ApplicationError("learning_item_not_found","词条不存在。",status_code=404)
    return {"id":item[0],"display_text":item[1],"dedupe_key":item[2],"ipa":item[3],"ipa_display":item[3] or "暂无","status":item[4],"next_review_date":item[5],"next_review_display":item[5] or "尚未安排","created_at":item[6],"definition_display":"暂无","review_history_display":"暂无","contexts":[{"id":r[0],"cue_id":r[1],"subtitle_id":r[2],"subtitle_title":r[3],"text":r[4],"start_time":_timeline(r[5]),"end_time":_timeline(r[6]),"available":not bool(r[7]) and r[1] is not None} for r in contexts]}
