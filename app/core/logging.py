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


def read_log_entries(data_dir: Path, limit: int = 200) -> list[dict[str, object]]:
    """Return bounded structured diagnostics; malformed lines are ignored."""
    path = data_dir / "logs" / "scenelingo.log"
    if not path.is_file() or path.is_symlink():
        return []
    entries=[]
    try:
        for line in path.read_text(encoding="utf-8",errors="replace").splitlines()[-limit:]:
            try:
                item=json.loads(line)
            except (TypeError,ValueError):
                continue
            allowed={key:item[key] for key in ("time","level","operation","code","status","request_id",
                "current_version","target_version","applied_count") if key in item}
            if {"time","level","operation","code"} <= allowed.keys(): entries.append(allowed)
    except OSError:
        return []
    return entries


def clear_log_files(data_dir: Path) -> int:
    """Clear only SceneLingo's own current/rotated logs, never arbitrary paths."""
    log_dir=data_dir / "logs"; current=log_dir / "scenelingo.log"; cleared=0
    if current.is_file() and not current.is_symlink():
        fd=os.open(current,os.O_WRONLY|os.O_TRUNC|os.O_NOFOLLOW)
        os.close(fd);os.chmod(current,0o600);cleared+=1
    for path in log_dir.glob("scenelingo.log.*"):
        if path.is_file() and not path.is_symlink():
            path.unlink();cleared+=1
    return cleared
