"""Pure BR-SUB-08 English token extraction and aggregation."""

from dataclasses import dataclass
import re

from app.domain.subtitle.parser import ParsedCue


_BRACKETED = re.compile(r"\[[^\]]*\]")
_SPEAKER = re.compile(r"^\s*[A-Z][A-Z ]{1,19}:\s*")
_CANDIDATE = re.compile(r"[A-Za-z0-9]+(?:['’\-][A-Za-z0-9]+)*")


@dataclass(frozen=True)
class TokenOccurrence:
    key: str
    display_form: str


@dataclass(frozen=True)
class TokenStat:
    key: str
    display_form: str
    occurrence_count: int
    first_sequence: int


def tokenize(text: str) -> tuple[TokenOccurrence, ...]:
    occurrences: list[TokenOccurrence] = []
    for line in text.splitlines():
        eligible = _SPEAKER.sub("", _BRACKETED.sub(" ", line), count=1)
        for match in _CANDIDATE.finditer(eligible):
            display = match.group(0)
            if any(char.isdigit() for char in display):
                continue
            letters = sum(char.isalpha() for char in display)
            key = display.replace("’", "'").lower()
            if letters >= 2 or key in {"a", "i"}:
                occurrences.append(TokenOccurrence(key, display))
    return tuple(occurrences)


def count_tokens(cues: tuple[ParsedCue, ...]) -> tuple[TokenStat, ...]:
    ordered: dict[str, list[object]] = {}
    for cue in cues:
        for token in tokenize(cue.clean_text):
            if token.key not in ordered:
                ordered[token.key] = [token.display_form, 0, cue.sequence]
            ordered[token.key][1] = int(ordered[token.key][1]) + 1
    return tuple(
        TokenStat(key, str(values[0]), int(values[1]), int(values[2]))
        for key, values in ordered.items()
    )
