"""Stable application errors rendered without internal exception details."""

from typing import Any


class ApplicationError(RuntimeError):
    def __init__(self, code: str, message: str, *, status_code: int = 400,
                 details: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.details = details
