"""Authenticated local vocabulary API."""

from functools import partial
from fastapi import APIRouter, Request
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app.services.vocabulary import add_word, candidates, detail, library


router = APIRouter(prefix="/api/v1")


class AddWordRequest(BaseModel):
    subtitle_id: int
    cue_id: int
    token_key: str


@router.get("/subtitles/{subtitle_id}/candidates")
async def get_candidates(request: Request, subtitle_id: int, page: int = 1, page_size: int = 50):
    return await run_in_threadpool(partial(candidates, request.app.state.database, subtitle_id, page, page_size))


@router.post("/vocabulary", status_code=201)
async def create_vocabulary(request: Request, body: AddWordRequest):
    return await run_in_threadpool(partial(add_word, request.app.state.database,
        subtitle_id=body.subtitle_id, cue_id=body.cue_id, token_key=body.token_key,
        now=request.app.state.clock))


@router.get("/vocabulary")
async def get_library(request: Request, status: str = "new", q: str = "", sort: str = "created_at",
                      page: int = 1, page_size: int = 50):
    return await run_in_threadpool(partial(library, request.app.state.database,
        status=status, search=q, sort=sort, page=page, page_size=page_size))


@router.get("/vocabulary/{item_id}")
async def get_detail(request: Request, item_id: int):
    return await run_in_threadpool(partial(detail, request.app.state.database, item_id))
