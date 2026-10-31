"""Read-only system endpoints for TASK-001."""

from datetime import datetime
from typing import Callable

from fastapi import APIRouter, Request
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app.core.errors import ApplicationError
from app.core.logging import clear_log_files,read_log_entries


VERSION = "0.1.0"
router = APIRouter(prefix="/api/v1")


@router.get("/health")
def health(request: Request) -> dict[str, str]:
    now: Callable[[], datetime] = request.app.state.clock
    return {"status": "ok", "version": VERSION, "time": now().isoformat()}


@router.get("/system/info")
def system_info(request: Request) -> dict[str, str | bool]:
    return {
        "version": VERSION,
        "security_mode": "local_only",
        "data_dir_available": request.app.state.data_dir_ready,
    }


@router.get("/system/logs")
async def logs(request:Request,limit:int=100):
    if limit<1 or limit>200:
        raise ApplicationError("invalid_log_limit","日志条数必须在 1 到 200 之间。",status_code=422)
    items=await run_in_threadpool(read_log_entries,request.app.state.settings.data_dir,limit)
    return {"items":items,"total":len(items)}


class LogClearRequest(BaseModel):
    confirmed:bool


@router.delete("/system/logs")
async def clear_logs(request:Request,body:LogClearRequest):
    if not body.confirmed:
        raise ApplicationError("log_clear_confirmation_required","必须确认后才能清除日志。",status_code=409)
    count=await run_in_threadpool(clear_log_files,request.app.state.settings.data_dir)
    request.app.state.logger.info("logs_cleared",extra={"operation":"log_maintenance","code":"cleared"})
    return {"cleared":True,"file_count":count}
