"""Subtitle-cue dictation use cases."""
from datetime import datetime
from app.core.errors import ApplicationError
from app.domain.dictation import score
from app.repositories.database import Database, transaction
from app.repositories.dictation import DictationRepository

def submit_dictation(database: Database, *, subtitle_id: int, cue_id: int, user_input: str,
                     attempt_token: str, now) -> dict:
    if not attempt_token.strip() or len(attempt_token) > 128:
        raise ApplicationError("invalid_attempt_token", "听写提交标识无效。", status_code=422)
    if user_input is None or len(user_input) > 10000:
        raise ApplicationError("invalid_dictation_input", "听写内容无效或过长。", status_code=422)
    with database.connection() as connection:
        repo = DictationRepository(connection)
        existing = repo.get_by_token(attempt_token)
        if existing:
            return _result(existing, duplicate=True)
        cue = repo.get_cue(subtitle_id, cue_id)
        if cue is None:
            raise ApplicationError("cue_not_found", "听写句子不存在或不可用。", status_code=404)
        result = score(cue[1], user_input)
        with transaction(connection):
            attempt = repo.insert(attempt_token=attempt_token, subtitle_id=subtitle_id, cue_id=cue[0],
                                  target_text=cue[1], user_input=user_input,
                                  normalized_input=result.normalized_input,
                                  matched_word_count=result.matched_word_count,
                                  target_word_count=result.target_word_count,
                                  accuracy_percent=result.accuracy_percent,
                                  is_exact=result.is_exact, attempted_at=now())
    return _result(attempt, duplicate=False)

def _result(item, duplicate):
    return {"attempt": {"id": item.id, "attempt_token": item.attempt_token, "subtitle_id": item.subtitle_id,
        "cue_id": item.cue_id, "target_text": item.target_text, "user_input": item.user_input,
        "matched_word_count": item.matched_word_count, "target_word_count": item.target_word_count,
        "accuracy_percent": item.accuracy_percent, "is_exact": item.is_exact,
        "attempted_at": item.attempted_at}, "duplicate": duplicate}
