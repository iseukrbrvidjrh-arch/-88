"""Read-only subtitle library, pagination and cue location use cases."""

from dataclasses import asdict

from app.core.errors import ApplicationError
from app.repositories.database import Database
from app.repositories.subtitles import CueRecord, StoredSubtitle, SubtitleRepository


DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200


def _page(page: int, page_size: int) -> tuple[int, int]:
    if page < 1 or page_size < 1 or page_size > MAX_PAGE_SIZE:
        raise ApplicationError("invalid_pagination", "分页参数无效。", status_code=422)
    return page_size, (page - 1) * page_size


def _subtitle(item: StoredSubtitle) -> dict[str, object]:
    result = asdict(item)
    result.pop("content_fingerprint")
    result["has_invalid_cues"] = None if item.invalid_cue_count is None else item.invalid_cue_count > 0
    return result


def _timeline(milliseconds: int) -> str:
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    seconds, millis = divmod(remainder, 1_000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}.{millis:03d}"


def _cue(item: CueRecord) -> dict[str, object]:
    return {
        "id": item.id, "sequence": item.sequence,
        "start_ms": item.start_ms, "end_ms": item.end_ms,
        "start_time": _timeline(item.start_ms), "end_time": _timeline(item.end_ms),
        "text": item.clean_text, "is_valid": item.is_valid,
    }


def list_subtitles(database: Database, *, status: str = "imported", search: str = "",
                   sort: str = "imported_at", page: int = 1,
                   page_size: int = DEFAULT_PAGE_SIZE) -> dict[str, object]:
    if status not in {"imported", "archived"}:
        raise ApplicationError("invalid_status", "字幕状态筛选无效。", status_code=422)
    if sort not in {"imported_at", "title"}:
        raise ApplicationError("invalid_sort", "字幕排序参数无效。", status_code=422)
    limit, offset = _page(page, page_size)
    with database.connection() as connection:
        items, total = SubtitleRepository(connection).list_subtitles(
            status=status, search=search.strip(), sort=sort, limit=limit, offset=offset,
        )
    return {"items": [_subtitle(item) for item in items], "page": page,
            "page_size": page_size, "total": total}


def subtitle_detail(database: Database, subtitle_id: int, *, page: int = 1,
                    page_size: int = DEFAULT_PAGE_SIZE) -> dict[str, object]:
    limit, offset = _page(page, page_size)
    with database.connection() as connection:
        repository = SubtitleRepository(connection)
        subtitle = repository.get(subtitle_id)
        if subtitle is None or subtitle.status == "deleted":
            raise ApplicationError("subtitle_not_found", "字幕不存在或来源已不可用。", status_code=404)
        cues, total = repository.list_cues(subtitle_id, limit=limit, offset=offset)
    return {"subtitle": _subtitle(subtitle), "cues": [_cue(item) for item in cues],
            "page": page, "page_size": page_size, "total": total}


def locate_cue(database: Database, subtitle_id: int, *, cue_id: int | None = None,
               sequence: int | None = None, radius: int = 2) -> dict[str, object]:
    if (cue_id is None) == (sequence is None) or radius < 0 or radius > 10:
        raise ApplicationError("invalid_location", "cue 定位参数无效。", status_code=422)
    with database.connection() as connection:
        repository = SubtitleRepository(connection)
        subtitle = repository.get(subtitle_id)
        if subtitle is None or subtitle.status == "deleted":
            return {"available": False, "target": None, "context": []}
        target, context = repository.locate_cue(
            subtitle_id, cue_id=cue_id, sequence=sequence, radius=radius,
        )
    if target is None:
        return {"available": False, "target": None, "context": []}
    return {"available": True, "target": _cue(target), "context": [_cue(item) for item in context]}
