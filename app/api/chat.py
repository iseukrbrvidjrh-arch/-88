"""AI Tutor conversation, preview, SSE execution and confirmed-save API."""

from functools import partial
import json

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

router=APIRouter(prefix="/api/v1/ai/chat")

class ConversationBody(BaseModel): title:str="新会话"
class PlanBody(BaseModel):
    conversation_id:int; text:str=Field(min_length=1,max_length=4000); template:str="free"
    history_count:int=0; cue_id:int|None=None; learning_item_id:int|None=None
class ExecuteBody(BaseModel):
    plan_id:str=Field(min_length=1,max_length=100); execution_token:str=Field(min_length=1,max_length=200)
class SaveBody(BaseModel):
    message_id:int; entry_type:str; text:str=Field(min_length=1,max_length=4000); confirmed:bool=False

@router.post("/conversations",status_code=201)
async def create_conversation(request:Request,body:ConversationBody):
    return await run_in_threadpool(request.app.state.chat_service.create_conversation,body.title)

@router.get("/conversations")
async def list_conversations(request:Request):
    return await run_in_threadpool(request.app.state.chat_service.list_conversations)

@router.get("/conversations/{conversation_id}")
async def get_conversation(request:Request,conversation_id:int):
    return await run_in_threadpool(request.app.state.chat_service.conversation,conversation_id)

@router.delete("/conversations/{conversation_id}")
async def delete_conversation(request:Request,conversation_id:int):
    return await run_in_threadpool(request.app.state.chat_service.delete,conversation_id)

@router.post("/send-plans")
async def create_plan(request:Request,body:PlanBody):
    return await run_in_threadpool(partial(request.app.state.chat_service.create_plan,body.conversation_id,
        text=body.text,template=body.template,history_count=body.history_count,cue_id=body.cue_id,
        learning_item_id=body.learning_item_id))

def _sse(events):
    for item in events:
        yield f"event: {item['event']}\ndata: {json.dumps(item['data'],ensure_ascii=False,separators=(',',':'))}\n\n"

@router.post("/execute")
async def execute(request:Request,body:ExecuteBody):
    events=await run_in_threadpool(request.app.state.chat_service.stream,body.plan_id,body.execution_token)
    return StreamingResponse(_sse(events),media_type="text/event-stream",headers={"Cache-Control":"no-store","X-Accel-Buffering":"no"})

@router.post("/save",status_code=201)
async def save_content(request:Request,body:SaveBody):
    return await run_in_threadpool(partial(request.app.state.chat_service.save,body.message_id,
        entry_type=body.entry_type,text=body.text,confirmed=body.confirmed))
