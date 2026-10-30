"""TASK-010 cloud settings, immutable send plans, execution and costs."""

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from app.repositories.ai import AiRepository

router=APIRouter(prefix="/api/v1/ai")

class KeyBody(BaseModel): key:str=Field(min_length=1,max_length=500)
class SettingsBody(BaseModel):
    cloud_enabled:bool|None=None; consent_accepted:bool|None=None; model:str|None=None
class PlanBody(BaseModel):
    kind:str; text:str=Field(min_length=1,max_length=4000); context:str=Field(default="",max_length=4000)
class ExecuteBody(BaseModel):
    plan_id:str=Field(min_length=1,max_length=100); execution_token:str=Field(min_length=1,max_length=200)

@router.get("/settings")
async def status(request:Request): return await run_in_threadpool(request.app.state.ai_service.status)

@router.put("/settings")
async def configure(request:Request,body:SettingsBody):
    return await run_in_threadpool(request.app.state.ai_service.configure,enabled=body.cloud_enabled,consent=body.consent_accepted,model=body.model)

@router.put("/key")
async def put_key(request:Request,body:KeyBody):
    await run_in_threadpool(request.app.state.secret_store.write,body.key)
    return {"key_status":"configured","masked":"••••••••"}

@router.delete("/key")
async def delete_key(request:Request):
    await run_in_threadpool(request.app.state.secret_store.delete)
    return {"key_status":"not_configured"}

@router.post("/send-plans")
async def plan(request:Request,body:PlanBody):
    return await run_in_threadpool(request.app.state.ai_service.create,body.kind,body.text,body.context)

@router.post("/execute")
async def execute(request:Request,body:ExecuteBody):
    return await run_in_threadpool(request.app.state.ai_service.execute,body.plan_id,body.execution_token)

@router.get("/costs")
async def costs(request:Request):
    def read():
        with request.app.state.database.connection() as conn:
            rows=AiRepository(conn).costs()
            return {"items":[dict(zip(("request_id","purpose","model","input_tokens","output_tokens","usage_source","estimated_cost","currency","price_version","status","created_at"),row)) for row in rows]}
    return await run_in_threadpool(read)
