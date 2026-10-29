"""Atomic local subtitle import use case."""

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
from typing import Callable

from app.core.errors import ApplicationError
from app.domain.subtitle.parser import MAX_CUES, InvalidCue, ParsedCue, parse_subtitle
from app.domain.subtitle.tokens import count_tokens
from app.repositories.database import Database, StorageBusyError, StorageError, transaction
from app.repositories.subtitles import StoredSubtitle, SubtitleRepository


MAX_FILE_BYTES = 10 * 1024 * 1024
PREVIEW_LIMIT = 10


@dataclass(frozen=True)
class ImportResult:
    subtitle: StoredSubtitle
    preview: list[dict[str, object]]
    invalid_cues: tuple[InvalidCue, ...]


def decode_subtitle(data: bytes) -> str:
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ApplicationError(
            "subtitle_encoding_unsupported",
            "字幕必须是 UTF-8 编码（可含 BOM），请另存为 UTF-8 后重试。",
        ) from exc


def content_fingerprint(cues: tuple[ParsedCue, ...]) -> str:
    digest = hashlib.sha256()
    for cue in cues:
        record = json.dumps(
            [cue.sequence, cue.start_ms, cue.end_ms, cue.clean_text],
            ensure_ascii=False, separators=(",", ":"),
        ).encode("utf-8")
        digest.update(len(record).to_bytes(8, "big"))
        digest.update(record)
    return digest.hexdigest()


def _safe_name(filename: str) -> tuple[str, str]:
    safe = filename.replace("\\", "/").rsplit("/", 1)[-1].strip()
    suffix = Path(safe).suffix.lower()
    if suffix not in {".srt", ".vtt"}:
        raise ApplicationError("subtitle_format_unsupported", "仅支持 .srt 和 .vtt 字幕文件。")
    title = Path(safe).stem.strip()
    if not title:
        raise ApplicationError("subtitle_filename_invalid", "字幕文件名无效，请重命名后重试。")
    return title, suffix[1:]


def import_subtitle(database: Database, *, filename: str, data: bytes,
                    now: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
                    repository_type: type[SubtitleRepository] = SubtitleRepository) -> ImportResult:
    if len(data) > MAX_FILE_BYTES:
        raise ApplicationError("subtitle_file_too_large", "字幕文件超过 10 MB，请拆分后重试。", status_code=413)
    if not data:
        raise ApplicationError("subtitle_file_empty", "字幕文件为空，请选择有效文件。")
    title, source_format = _safe_name(filename)
    parsed = parse_subtitle(decode_subtitle(data), source_format, max_cues=MAX_CUES)
    tokens = count_tokens(parsed.cues)
    fingerprint = content_fingerprint(parsed.cues)
    imported_at = now().astimezone(timezone.utc).isoformat()
    token_count = sum(token.occurrence_count for token in tokens)

    try:
        with database.connection() as conn, transaction(conn):
            repository = repository_type(conn)
            existing = repository.find_active_by_fingerprint(fingerprint)
            if existing is not None:
                raise ApplicationError(
                    "subtitle_already_exists", "相同内容的字幕已存在，可打开已有字幕。",
                    status_code=409, details={"subtitle_id": existing.id},
                )
            try:
                subtitle_id = repository.insert_subtitle(
                    title=title, source_format=source_format, fingerprint=fingerprint,
                    cue_count=len(parsed.cues), token_count=token_count,
                    unique_count=len(tokens), imported_at=imported_at,
                    invalid_cue_count=len(parsed.invalid_cues),
                )
            except sqlite3.IntegrityError as exc:
                existing = repository.find_active_by_fingerprint(fingerprint)
                if existing is not None:
                    raise ApplicationError(
                        "subtitle_already_exists", "相同内容的字幕已存在，可打开已有字幕。",
                        status_code=409, details={"subtitle_id": existing.id},
                    ) from exc
                raise
            cue_ids = repository.insert_cues(subtitle_id, parsed.cues)
            repository.insert_tokens(subtitle_id, tokens, cue_ids)
            stored = repository.get(subtitle_id)
            if stored is None:
                raise StorageError("字幕写入后无法读取，事务已回滚。")
            preview = repository.preview_cues(subtitle_id, PREVIEW_LIMIT)
            return ImportResult(stored, preview, parsed.invalid_cues)
    except ApplicationError:
        raise
    except StorageBusyError:
        raise
    except StorageError as exc:
        raise StorageError("字幕写入失败，事务已回滚；已有数据未改变。") from exc
    except sqlite3.Error as exc:
        raise StorageError("字幕写入失败，事务已回滚；已有数据未改变。") from exc
