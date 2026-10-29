"""Pure BR-REV-03..05 rules."""

from dataclasses import dataclass
from datetime import date
import math


RATINGS = {"good", "hard", "again"}


def normalize_spelling(value: str) -> str:
    return value.strip().replace("’", "'").lower()


def spelling_correct(user_input: str, answer: str) -> bool:
    return normalize_spelling(user_input) == normalize_spelling(answer)


def validate_rating(mode: str, correct: bool | None, final_rating: str) -> None:
    if final_rating not in RATINGS:
        raise ValueError("invalid rating")
    if mode == "spelling" and correct is False and final_rating == "good":
        raise ValueError("incorrect spelling cannot be good")


def is_success(mode: str, correct: bool | None, rating: str) -> bool:
    return rating == "good" and (mode == "meaning" or correct is True)


def next_interval(current: int | None, rating: str, mastered: bool) -> int:
    if rating == "again" or (rating == "hard" and mastered): return 1
    if rating == "hard": return max(1, math.floor((current or 0) / 2))
    sequence = (1, 3, 7, 14, 30)
    if current is None or current < 1: return 1
    for value in sequence:
        if value > current: return value
    return 30


@dataclass(frozen=True)
class SuccessSummary:
    count: int
    distinct_dates: int
    first_date: date | None
    mastered: bool


def mastery(success_dates: list[date], latest_success: bool) -> SuccessSummary:
    if not success_dates: return SuccessSummary(0, 0, None, False)
    first = min(success_dates); distinct = len(set(success_dates))
    span = max(success_dates) - first
    mastered = len(success_dates) >= 3 and distinct >= 3 and span.days >= 7 and latest_success
    return SuccessSummary(len(success_dates), distinct, first, mastered)
