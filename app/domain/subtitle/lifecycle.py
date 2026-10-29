"""Pure deletion policy for subtitle lifecycle decisions."""

from app.core.errors import ApplicationError


def deletion_allowed(association_count: int, strategy: str, confirmed: bool) -> None:
    if not confirmed:
        raise ApplicationError("deletion_confirmation_required", "删除字幕需要二次确认。", status_code=422)
    if strategy not in {"direct", "freeze_snapshot"}:
        raise ApplicationError("invalid_deletion_strategy", "删除策略无效。", status_code=422)
    if association_count and strategy == "direct":
        raise ApplicationError(
            "subtitle_has_associations", "字幕有关联学习语境，直接删除已被阻止。",
            status_code=409, details={"associated_context_count": association_count},
        )
