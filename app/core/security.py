"""Strict checks for the loopback HTTP boundary."""

import re
import secrets
from urllib.parse import urlsplit

from fastapi import Request


TOKEN_HEADER = "X-SceneLingo-Token"
SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'none'; script-src 'self'; style-src 'self'; "
        "connect-src 'self'; img-src 'self'; base-uri 'none'; "
        "form-action 'none'; frame-ancestors 'none'"
    ),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
}


def new_token() -> str:
    return secrets.token_urlsafe(32)


def valid_host(host: str | None, port: int) -> bool:
    if not host:
        return False
    match = re.fullmatch(r"(127\.0\.0\.1|localhost)(?::([0-9]{1,5}))?", host, re.IGNORECASE)
    return match is not None and (match.group(2) is None or int(match.group(2)) == port)


def valid_origin(origin: str | None, host: str) -> bool:
    if not origin:
        return False
    try:
        url = urlsplit(origin)
        return (
            url.scheme == "http"
            and url.netloc.lower() == host.lower()
            and not url.path and not url.query and not url.fragment
            and url.username is None and url.password is None
        )
    except ValueError:
        return False


def check_request(request: Request, *, port: int, token: str) -> tuple[int, str, str] | None:
    host = request.headers.get("host")
    if not valid_host(host, port):
        return 403, "invalid_host", "访问地址不受允许。请使用本机地址。"

    origin = request.headers.get("origin")
    if origin is not None and not valid_origin(origin, host):
        return 403, "invalid_origin", "请求来源不受允许。请从本机应用页面操作。"
    if request.method in {"POST", "PUT", "PATCH", "DELETE"} and origin is None:
        return 403, "missing_origin", "缺少请求来源。请从本机应用页面操作。"

    path = request.url.path
    if path.startswith("/api/"):
        if not (request.method == "GET" and path == "/api/v1/health"):
            supplied = request.headers.get(TOKEN_HEADER, "")
            if not secrets.compare_digest(supplied, token):
                return 401, "invalid_token", "访问令牌缺失或无效。请刷新本机页面。"
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
            is_subtitle_upload = request.method == "POST" and path == "/api/v1/subtitles"
            expected = "multipart/form-data" if is_subtitle_upload else "application/json"
            if content_type != expected:
                message = "字幕上传必须使用 multipart/form-data。" if is_subtitle_upload else "API 请求必须使用 application/json。"
                return 415, "invalid_content_type", message
    return None
