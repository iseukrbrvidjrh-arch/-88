"""Local review queue, submission and immutable history API."""

from datetime import datetime
from functools import partial
from fastapi import APIRouter, Request
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app.services.review import review_history, review_queue, submit_review

router = APIRouter(prefix="/api/v1/review")

class ReviewSubmission(BaseModel):
    learning_item_id: int
    mode: str
    user_input: str | None = None
    final_rating: str
    attempt_token: str

@router.get("/queue")
async def queue(request:Request,mode:str="spelling",limit:int|None=None):
    today=request.app.state.clock().date()
    return await run_in_threadpool(partial(review_queue,request.app.state.database,mode=mode,today=today,limit=limit))

@router.post("/attempts")
async def submit(request:Request,body:ReviewSubmission):
    return await run_in_threadpool(partial(submit_review,request.app.state.database,item_id=body.learning_item_id,
        mode=body.mode,user_input=body.user_input,final_rating=body.final_rating,
        attempt_token=body.attempt_token,now=request.app.state.clock))

@router.get("/items/{item_id}/history")
async def history(request:Request,item_id:int,page:int=1,page_size:int=50):
    return await run_in_threadpool(partial(review_history,request.app.state.database,item_id,page,page_size))
