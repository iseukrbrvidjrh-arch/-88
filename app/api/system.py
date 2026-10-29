"""Read-only system endpoints for TASK-001."""

from datetime import datetime
from typing import Callable

from fastapi import APIRouter, Request


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
