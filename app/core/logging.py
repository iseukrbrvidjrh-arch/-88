"""Small JSON logger that never receives request data or tokens."""

from datetime import datetime, timezone
import json
import logging
from logging.handlers import TimedRotatingFileHandler
import os
from pathlib import Path
from uuid import uuid4


class PrivateDailyFileHandler(TimedRotatingFileHandler):
    def _open(self):
        flags = os.O_CREAT | os.O_APPEND | os.O_WRONLY | os.O_NOFOLLOW
        fd = os.open(self.baseFilename, flags, 0o600)
        os.chmod(self.baseFilename, 0o600)
        return os.fdopen(fd, self.mode, encoding=self.encoding)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        item = {
            "time": datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
            "level": record.levelname,
            "operation": getattr(record, "operation", "application"),
            "code": getattr(record, "code", "ok"),
        }
        status = getattr(record, "status", None)
        if status is not None:
            item["status"] = status
        request_id = getattr(record, "request_id", None)
        if request_id is not None:
            item["request_id"] = request_id
        for name in ("current_version", "target_version", "applied_count"):
            value = getattr(record, name, None)
            if value is not None:
                item[name] = value
        return json.dumps(item, ensure_ascii=False, separators=(",", ":"))


def open_logger(data_dir: Path, level: str) -> logging.Logger:
    logger = logging.getLogger(f"scenelingo.{uuid4().hex}")
    logger.setLevel(level)
    logger.propagate = False
    handler = PrivateDailyFileHandler(
        data_dir / "logs" / "scenelingo.log", when="midnight", backupCount=7,
        encoding="utf-8",
    )
    handler.setFormatter(JsonFormatter())
    logger.addHandler(handler)
    return logger


def close_logger(logger: logging.Logger) -> None:
    for handler in logger.handlers[:]:
        logger.removeHandler(handler)
        handler.close()
