"""Local subtitle-cue dictation API."""
from functools import partial
from fastapi import APIRouter, Request
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool
from app.services.dictation import submit_dictation

router = APIRouter(prefix="/api/v1/dictation")
class DictationSubmission(BaseModel):
    subtitle_id: int
    cue_id: int
    user_input: str
    attempt_token: str

@router.post("/attempts", status_code=201)
async def submit(request: Request, body: DictationSubmission):
    return await run_in_threadpool(partial(submit_dictation, request.app.state.database,
        subtitle_id=body.subtitle_id, cue_id=body.cue_id, user_input=body.user_input,
        attempt_token=body.attempt_token, now=request.app.state.clock))
