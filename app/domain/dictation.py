"""Pure scoring rules for subtitle-cue dictation."""
from dataclasses import dataclass
import re

_WORD = re.compile(r"[A-Za-z]+(?:['’-][A-Za-z]+)*")

@dataclass(frozen=True)
class DictationResult:
    normalized_input: str
    normalized_target: str
    is_exact: bool
    target_word_count: int
    matched_word_count: int
    accuracy_percent: int

def normalize(text: str) -> str:
    return " ".join(text.replace("’", "'").strip().lower().split())

def score(target: str, user_input: str) -> DictationResult:
    normalized_target = normalize(target)
    normalized_input = normalize(user_input)
    expected = _WORD.findall(normalized_target)
    actual = _WORD.findall(normalized_input)
    matched = sum(a == b for a, b in zip(expected, actual))
    accuracy = round(matched * 100 / len(expected)) if expected else 0
    return DictationResult(normalized_input, normalized_target,
                           normalized_input == normalized_target, len(expected), matched, accuracy)
