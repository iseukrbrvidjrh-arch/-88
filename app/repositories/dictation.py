"""Persistence for isolated subtitle-cue dictation attempts."""
from dataclasses import dataclass
from datetime import datetime
import sqlite3
from app.repositories.base import Repository

@dataclass(frozen=True)
class DictationAttempt:
    id: int
    attempt_token: str
    subtitle_id: int
    cue_id: int
    target_text: str
    user_input: str
    normalized_input: str
    matched_word_count: int
    target_word_count: int
    accuracy_percent: int
    is_exact: bool
    attempted_at: str

class DictationRepository(Repository):
    def get_cue(self, subtitle_id: int, cue_id: int):
        return self.connection.execute(
            "SELECT id, clean_text FROM cue WHERE id=? AND subtitle_id=? AND is_valid=1",
            (cue_id, subtitle_id)).fetchone()

    def get_by_token(self, token: str):
        row = self.connection.execute("SELECT id,attempt_token,subtitle_id,cue_id,target_text,user_input,normalized_input,matched_word_count,target_word_count,accuracy_percent,is_exact,attempted_at FROM dictation_attempt WHERE attempt_token=?", (token,)).fetchone()
        return DictationAttempt(*row) if row else None

    def insert(self, *, attempt_token: str, subtitle_id: int, cue_id: int, target_text: str,
               user_input: str, normalized_input: str, matched_word_count: int,
               target_word_count: int, accuracy_percent: int, is_exact: bool,
               attempted_at: datetime) -> DictationAttempt:
        self.connection.execute("""INSERT INTO dictation_attempt
            (attempt_token,subtitle_id,cue_id,target_text,user_input,normalized_input,
             matched_word_count,target_word_count,accuracy_percent,is_exact,attempted_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)""", (attempt_token,subtitle_id,cue_id,target_text,user_input,
            normalized_input,matched_word_count,target_word_count,accuracy_percent,int(is_exact),attempted_at.isoformat()))
        return self.get_by_token(attempt_token)
