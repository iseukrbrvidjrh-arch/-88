"""Authenticated local subtitle upload API."""

from collections import Counter
from functools import partial

from fastapi import APIRouter, File, Query, Request, UploadFile
from starlette.concurrency import run_in_threadpool

from app.core.errors import ApplicationError
from app.services.subtitle_import import MAX_FILE_BYTES, import_subtitle
from app.services.subtitle_query import list_subtitles, locate_cue, subtitle_detail


router = APIRouter(prefix="/api/v1/subtitles")


@router.get("")
async def subtitle_library(request: Request, status: str = "imported", q: str = "",
                           sort: str = "imported_at", page: int = 1,
                           page_size: int = 50):
    return await run_in_threadpool(partial(
        list_subtitles, request.app.state.database, status=status, search=q,
        sort=sort, page=page, page_size=page_size,
    ))


@router.get("/{subtitle_id}")
async def get_subtitle(request: Request, subtitle_id: int, page: int = 1, page_size: int = 50):
    return await run_in_threadpool(partial(
        subtitle_detail, request.app.state.database, subtitle_id,
        page=page, page_size=page_size,
    ))


@router.get("/{subtitle_id}/locate")
async def get_cue_location(request: Request, subtitle_id: int,
                           cue_id: int | None = None, sequence: int | None = None,
                           radius: int = Query(2, ge=0, le=10)):
    return await run_in_threadpool(partial(
        locate_cue, request.app.state.database, subtitle_id,
        cue_id=cue_id, sequence=sequence, radius=radius,
    ))


@router.post("", status_code=201)
async def upload_subtitle(request: Request, file: UploadFile = File(...)):
    filename = file.filename or ""
    chunks: list[bytes] = []
    size = 0
    try:
        while True:
            chunk = await file.read(64 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_FILE_BYTES:
                raise ApplicationError(
                    "subtitle_file_too_large", "字幕文件超过 10 MB，请拆分后重试。", status_code=413,
                )
            chunks.append(chunk)
    finally:
        await file.close()
    result = await run_in_threadpool(
        partial(
            import_subtitle, request.app.state.database, filename=filename,
            data=b"".join(chunks), now=request.app.state.clock,
        )
    )
    reasons = Counter(issue.reason for issue in result.invalid_cues)
    return {
        "subtitle": {
            "id": result.subtitle.id,
            "title": result.subtitle.title,
            "source_format": result.subtitle.source_format,
            "status": result.subtitle.status,
            "cue_count": result.subtitle.cue_count,
            "token_occurrence_count": result.subtitle.token_occurrence_count,
            "unique_token_count": result.subtitle.unique_token_count,
            "imported_at": result.subtitle.imported_at,
            "partially_invalid": bool(result.invalid_cues),
        },
        "import_report": {
            "valid_cue_count": result.subtitle.cue_count,
            "invalid_cue_count": len(result.invalid_cues),
            "invalid_reasons": dict(sorted(reasons.items())),
            "invalid_cues": [
                {"line": issue.line, "reason": issue.reason} for issue in result.invalid_cues
            ],
        },
        "preview": result.preview,
    }
