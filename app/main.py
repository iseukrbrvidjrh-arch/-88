"""Local-only SceneLingo entry point. Run with ``python -m app.main``."""

import argparse
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import html
from pathlib import Path
import sys
from typing import Callable
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
import uvicorn

from app.api.system import router
from app.api.subtitles import router as subtitles_router
from app.api.vocabulary import router as vocabulary_router
from app.api.review import router as review_router
from app.api.speech import router as speech_router
from app.core.errors import ApplicationError
from app.core.config import DEFAULT_PORT, ConfigError, Settings, load_settings, prepare_data_dir
from app.core.logging import close_logger, open_logger
from app.core.security import SECURITY_HEADERS, check_request, new_token
from app.repositories.database import Database, StorageError
from app.repositories.migrations.runner import MigrationResult, initialize_database
from app.integrations.ipa_dictionary import LocalIpaDictionary
from app.integrations.macos_tts import MacOSTTS


WEB_DIR = Path(__file__).parent / "web"
IPA_PATH = Path(__file__).parent / "data" / "ipa" / "en_US.txt"


def error_response(status: int, code: str, message: str,
                   details: dict | None = None) -> JSONResponse:
    error: dict[str, object] = {"code": code, "message": message}
    if details is not None:
        error["details"] = details
    return JSONResponse(status_code=status, content={"error": error})


def create_app(settings: Settings | None = None,
               clock: Callable[[], datetime] | None = None,
               startup_storage: tuple[Database, MigrationResult] | None = None) -> FastAPI:
    settings = settings or load_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        prepare_data_dir(settings.data_dir)
        logger = open_logger(settings.data_dir, settings.log_level)
        app.state.logger = logger
        try:
            try:
                database, result = startup_storage or (
                    Database(settings.database_path), None
                )
                if result is None:
                    result = initialize_database(database)
                else:
                    with database.connection() as connection:
                        if database.self_check(connection) != result.target_version:
                            raise StorageError("启动前数据库版本发生变化，已停止启动；请检查 backups/。")
            except StorageError:
                logger.error("database_startup_failed", extra={
                    "operation": "database_migration", "code": "storage_error",
                })
                raise
            app.state.database = database
            app.state.ipa_dictionary = LocalIpaDictionary(IPA_PATH)
            app.state.tts = MacOSTTS(settings.data_dir / "temp" / "tts")
            app.state.data_dir_ready = True
            app.state.token = new_token()
            logger.info("database_ready", extra={
                "operation": "database_migration",
                "code": "applied" if result.applied_versions else "already_current",
                "current_version": result.previous_version,
                "target_version": result.target_version,
                "applied_count": len(result.applied_versions),
            })
            logger.info("startup", extra={"operation": "startup"})
            yield
        finally:
            if hasattr(app.state, "tts"):
                app.state.tts.stop()
            logger.info("shutdown", extra={"operation": "shutdown"})
            close_logger(logger)
            app.state.token = None

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.clock = clock or (lambda: datetime.now().astimezone())

    @app.middleware("http")
    async def local_security(request: Request, call_next):
        request.state.request_id = uuid4().hex
        result = check_request(request, port=settings.port, token=request.app.state.token)
        if result is None:
            response = await call_next(request)
            code = "ok" if response.status_code < 400 else "http_error"
        else:
            status, code, message = result
            response = error_response(status, code, message)
        for name, value in SECURITY_HEADERS.items():
            response.headers[name] = value
        response.headers["X-Request-ID"] = request.state.request_id
        request.app.state.logger.info(
            "http_request", extra={"operation": "http_request", "code": code,
                                   "status": response.status_code,
                                   "request_id": request.state.request_id},
        )
        return response

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_request: Request, exc: StarletteHTTPException):
        code = "not_found" if exc.status_code == 404 else "method_not_allowed" if exc.status_code == 405 else "http_error"
        return error_response(exc.status_code, code, "请求无法完成。请检查地址或请求方法。")

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, _exc: RequestValidationError):
        return error_response(422, "invalid_request", "请求内容无效，请检查输入。")

    @app.exception_handler(ApplicationError)
    async def application_error(_request: Request, exc: ApplicationError):
        return error_response(exc.status_code, exc.code, exc.message, exc.details)

    @app.exception_handler(StorageError)
    async def storage_error(request: Request, _exc: StorageError):
        request.app.state.logger.error("storage_error", extra={
            "operation": "subtitle_import", "code": "storage_error",
            "request_id": request.state.request_id,
        })
        return error_response(503, "storage_error", "本地存储暂时不可用；导入未保存，请稍后重试。")

    @app.exception_handler(Exception)
    async def unexpected_error(request: Request, _exc: Exception):
        request.app.state.logger.error("internal_error", extra={
            "operation": "request", "code": "internal_error",
            "request_id": request.state.request_id,
        })
        return error_response(500, "internal_error", "服务发生错误，请查看本地日志。")

    @app.get("/", response_class=HTMLResponse)
    def index(request: Request):
        template = (WEB_DIR / "index.html").read_text(encoding="utf-8")
        page = template.replace("__SCENELINGO_TOKEN__", html.escape(request.app.state.token, quote=True))
        return HTMLResponse(page)

    app.include_router(router)
    app.include_router(subtitles_router)
    app.include_router(vocabulary_router)
    app.include_router(review_router)
    app.include_router(speech_router)
    app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")
    return app


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="启动 SceneLingo 本地服务（仅 127.0.0.1）。")
    parser.add_argument("--port", help=f"本地端口，默认 {DEFAULT_PORT}；可由 SCENELINGO_PORT 覆盖")
    parser.add_argument("--data-dir", help="数据目录，默认 ~/Library/Application Support/SceneLingo")
    parser.add_argument("--db-path", help="SQLite 数据库路径；相对路径以数据目录为基准")
    parser.add_argument("--log-level", help="日志级别：DEBUG/INFO/WARNING/ERROR")
    args = parser.parse_args(argv)
    try:
        settings = load_settings(port=args.port, data_dir=args.data_dir,
                                 db_path=args.db_path, log_level=args.log_level)
    except ConfigError as exc:
        print(f"启动失败：{exc}", file=sys.stderr)
        return 2
    try:
        prepare_data_dir(settings.data_dir)
        database = Database(settings.database_path)
        result = initialize_database(database)
    except (ConfigError, StorageError) as exc:
        try:
            failure_logger = open_logger(settings.data_dir, settings.log_level)
            failure_logger.error("storage_startup_failed", extra={
                "operation": "database_migration", "code": "storage_error",
            })
            close_logger(failure_logger)
        except OSError:
            pass  # The directory itself may be unavailable; stderr remains the recovery channel.
        print(f"启动失败：{exc}", file=sys.stderr)
        return 2
    uvicorn.run(create_app(settings, startup_storage=(database, result)), host="127.0.0.1", port=settings.port,
                workers=1, reload=False, access_log=False, log_level=settings.log_level.lower())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
