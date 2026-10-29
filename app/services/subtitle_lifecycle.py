"""Safe archive, restore, preflight and transactional subtitle deletion."""

from datetime import datetime, timezone

from app.core.errors import ApplicationError
from app.domain.subtitle.lifecycle import deletion_allowed
from app.repositories.database import Database, transaction
from app.repositories.subtitle_lifecycle import SubtitleLifecycleRepository
from app.repositories.subtitles import SubtitleRepository


def _missing() -> ApplicationError:
    return ApplicationError("subtitle_not_found", "字幕不存在或已删除。", status_code=404)


def change_archive(database: Database, subtitle_id: int, archive: bool):
    with database.connection() as conn, transaction(conn):
        repo = SubtitleLifecycleRepository(conn); status = repo.status(subtitle_id)
        if status is None: raise _missing()
        target = "archived" if archive else "imported"
        repo.set_status(subtitle_id, target)
    return {"subtitle_id": subtitle_id, "status": target}


def deletion_preview(database: Database, subtitle_id: int):
    with database.connection() as conn:
        repo = SubtitleLifecycleRepository(conn)
        if repo.status(subtitle_id) is None: raise _missing()
        contexts = repo.context_count(subtitle_id); items = repo.item_count(subtitle_id)
        reviews = repo.review_count(subtitle_id)
    return {"subtitle_id":subtitle_id,"associated_context_count":contexts,
            "associated_learning_item_count":items,"associated_review_count":reviews,
            "direct_delete_allowed":contexts == 0}


def delete_subtitle(database: Database, subtitle_id: int, *, strategy: str, confirmed: bool,
                    now=lambda: datetime.now(timezone.utc),
                    repository_type=SubtitleLifecycleRepository):
    with database.connection() as conn, transaction(conn):
        repo = repository_type(conn)
        if repo.status(subtitle_id) is None: raise _missing()
        count = repo.context_count(subtitle_id); deletion_allowed(count, strategy, confirmed)
        frozen = repo.freeze_contexts(subtitle_id, now().astimezone(timezone.utc).isoformat()) if count else 0
        repo.delete(subtitle_id)
        stats = SubtitleRepository(conn).library_statistics()
    return {"subtitle_id":subtitle_id,"deleted":True,"frozen_context_count":frozen,
            "library_statistics":{"subtitle_count":stats.subtitle_count,
            "token_occurrence_count":stats.token_occurrence_count,"unique_token_count":stats.unique_token_count}}
