"""Learning records, current statistics and continue-learning API."""

from functools import partial
from fastapi import APIRouter, Request
from pydantic import BaseModel, model_validator
from starlette.concurrency import run_in_threadpool

from app.services.progress import continue_learning,daily_progress,save_progress,status_summary

router=APIRouter(prefix="/api/v1/progress")

class ProgressSave(BaseModel):
    subtitle_id:int|None=None
    cue_id:int|None=None
    review_item_id:int|None=None
    clear_review:bool=False

    @model_validator(mode="after")
    def has_target(self):
        if self.subtitle_id is None and self.cue_id is None and self.review_item_id is None and not self.clear_review:
            raise ValueError("missing progress target")
        return self

@router.get("/daily")
async def daily(request:Request,start_date:str|None=None,end_date:str|None=None):
    return await run_in_threadpool(partial(daily_progress,request.app.state.database,
        today=request.app.state.clock().date(),start=start_date,end=end_date))

@router.get("/summary")
async def summary(request:Request):
    return await run_in_threadpool(partial(status_summary,request.app.state.database,
        today=request.app.state.clock().date(),logger=request.app.state.logger))

@router.get("/continue")
async def resume(request:Request):
    return await run_in_threadpool(partial(continue_learning,request.app.state.database,
        today=request.app.state.clock().date()))

@router.put("/continue")
async def save(request:Request,body:ProgressSave):
    return await run_in_threadpool(partial(save_progress,request.app.state.database,
        subtitle_id=body.subtitle_id,cue_id=body.cue_id,review_item_id=body.review_item_id,
        clear_review=body.clear_review,now=request.app.state.clock))
