"""Pure SRT/VTT parsing and text cleaning under BR-SUB-01..07."""

from dataclasses import dataclass
import html
import re

from app.core.errors import ApplicationError


MAX_CUES = 20_000
_SRT_TIME = re.compile(
    r"^(?P<sh>\d{1,3}):(?P<sm>\d{2}):(?P<ss>\d{2}),(?P<sms>\d{3})\s*-->\s*"
    r"(?P<eh>\d{1,3}):(?P<em>\d{2}):(?P<es>\d{2}),(?P<ems>\d{3})$"
)
_VTT_TIME = re.compile(
    r"^(?:(?P<sh>\d{1,3}):)?(?P<sm>\d{2}):(?P<ss>\d{2})\.(?P<sms>\d{3})\s*-->\s*"
    r"(?:(?P<eh>\d{1,3}):)?(?P<em>\d{2}):(?P<es>\d{2})\.(?P<ems>\d{3})(?:\s+.*)?$"
)
_HTML_TAG = re.compile(r"<[^>]*>")
_BRACE_STYLE = re.compile(r"\{\\[^}]*\}")


@dataclass(frozen=True)
class ParsedCue:
    sequence: int
    start_ms: int
    end_ms: int
    raw_text: str
    clean_text: str
    source_line: int


@dataclass(frozen=True)
class InvalidCue:
    line: int
    reason: str


@dataclass(frozen=True)
class ParsedSubtitle:
    source_format: str
    cues: tuple[ParsedCue, ...]
    invalid_cues: tuple[InvalidCue, ...]


def clean_text(text: str) -> str:
    """Remove formatting while retaining display newlines and readable content."""
    cleaned_lines = []
    for line in text.splitlines():
        value = _BRACE_STYLE.sub("", line)
        value = _HTML_TAG.sub("", value)
        value = html.unescape(value).strip()
        if value:
            cleaned_lines.append(value)
    return "\n".join(cleaned_lines)


def _blocks(text: str) -> list[tuple[int, list[str]]]:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = normalized.split("\n")
    result: list[tuple[int, list[str]]] = []
    current: list[str] = []
    start = 1
    for line_number, line in enumerate(lines, 1):
        if not line.strip():
            if current:
                result.append((start, current))
                current = []
            start = line_number + 1
        else:
            if not current:
                start = line_number
            current.append(line)
    if current:
        result.append((start, current))
    return result


def _timestamp_ms(match: re.Match[str], prefix: str) -> int | None:
    hours = int(match.group(f"{prefix}h") or 0)
    minutes = int(match.group(f"{prefix}m"))
    seconds = int(match.group(f"{prefix}s"))
    millis = int(match.group(f"{prefix}ms"))
    if minutes > 59 or seconds > 59:
        return None
    return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis


def _cue_from_lines(lines: list[str], line: int, source_format: str,
                    sequence: int) -> tuple[ParsedCue | None, InvalidCue | None]:
    timeline_index = 0
    timeline_re = _SRT_TIME if source_format == "srt" else _VTT_TIME
    if source_format == "srt":
        if lines[0].strip().isdigit():
            timeline_index = 1
        elif "-->" not in lines[0]:
            return None, InvalidCue(line, "missing_timeline")
    elif "-->" not in lines[0]:
        timeline_index = 1  # VTT cue identifier.
    if timeline_index >= len(lines):
        return None, InvalidCue(line, "missing_timeline")
    match = timeline_re.fullmatch(lines[timeline_index].strip())
    if match is None:
        return None, InvalidCue(line + timeline_index, "invalid_timeline")
    start_ms = _timestamp_ms(match, "s")
    end_ms = _timestamp_ms(match, "e")
    if start_ms is None or end_ms is None or start_ms >= end_ms:
        return None, InvalidCue(line + timeline_index, "invalid_time_range")
    text_lines = lines[timeline_index + 1:]
    raw_text = "\n".join(text_lines).strip()
    cleaned = clean_text(raw_text)
    if not cleaned:
        return None, InvalidCue(line + timeline_index + 1, "empty_text")
    return ParsedCue(sequence, start_ms, end_ms, raw_text, cleaned, line), None


def parse_subtitle(text: str, source_format: str, *, max_cues: int = MAX_CUES) -> ParsedSubtitle:
    """Parse decoded text without file-system or database access."""
    if source_format not in {"srt", "vtt"}:
        raise ApplicationError("subtitle_format_unsupported", "仅支持 SRT 和 VTT 字幕。")
    blocks = _blocks(text)
    if source_format == "vtt":
        if not blocks or not blocks[0][1][0].lstrip("\ufeff").startswith("WEBVTT"):
            raise ApplicationError("subtitle_parse_failed", "VTT 文件缺少 WEBVTT 文件头。")
        blocks = blocks[1:]
        blocks = [block for block in blocks if block[1][0].strip().split(maxsplit=1)[0] not in {"NOTE", "STYLE", "REGION"}]
    if len(blocks) > max_cues:
        raise ApplicationError("subtitle_cue_limit_exceeded", "字幕条目超过 20,000 条，请拆分文件后重试。", status_code=413)
    cues: list[ParsedCue] = []
    invalid: list[InvalidCue] = []
    for line, lines in blocks:
        cue, issue = _cue_from_lines(lines, line, source_format, len(cues) + 1)
        if cue is not None:
            cues.append(cue)
        elif issue is not None:
            invalid.append(issue)
    if not cues:
        raise ApplicationError("subtitle_all_cues_invalid", "没有可导入的有效字幕条目，请检查时间轴和文本。")
    return ParsedSubtitle(source_format, tuple(cues), tuple(invalid))
