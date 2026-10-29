"""Subtitle lifecycle persistence used within service-owned transactions."""

from app.repositories.base import Repository


class SubtitleLifecycleRepository(Repository):
    def status(self, subtitle_id: int) -> str | None:
        row = self.connection.execute("SELECT status FROM subtitle WHERE id=?", (subtitle_id,)).fetchone()
        return row[0] if row else None

    def set_status(self, subtitle_id: int, status: str) -> None:
        column = "archived_at" if status == "archived" else "archived_at"
        value = "CURRENT_TIMESTAMP" if status == "archived" else "NULL"
        self.connection.execute(f"UPDATE subtitle SET status=?, {column}={value} WHERE id=?", (status, subtitle_id))

    def context_count(self, subtitle_id: int) -> int:
        return int(self.connection.execute("""SELECT count(*) FROM context_ref cr
            JOIN cue c ON c.id=cr.cue_id WHERE c.subtitle_id=?""", (subtitle_id,)).fetchone()[0])

    def item_count(self, subtitle_id: int) -> int:
        return int(self.connection.execute("""SELECT count(DISTINCT cr.learning_item_id) FROM context_ref cr
            JOIN cue c ON c.id=cr.cue_id WHERE c.subtitle_id=?""", (subtitle_id,)).fetchone()[0])

    def review_count(self, subtitle_id: int) -> int:
        exists = self.connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='review_attempt'"
        ).fetchone()
        if exists is None:
            return 0
        return int(self.connection.execute("""SELECT count(DISTINCT ra.id) FROM review_attempt ra
            JOIN context_ref cr ON cr.learning_item_id=ra.learning_item_id
            JOIN cue c ON c.id=cr.cue_id WHERE c.subtitle_id=?""", (subtitle_id,)).fetchone()[0])

    def freeze_contexts(self, subtitle_id: int, frozen_at: str) -> int:
        cursor = self.connection.execute("""UPDATE context_ref SET
            subtitle_id_snapshot=COALESCE(subtitle_id_snapshot, ?),
            subtitle_title_snapshot=COALESCE(subtitle_title_snapshot,(SELECT title FROM subtitle WHERE id=?)),
            cue_text_snapshot=COALESCE(cue_text_snapshot,(SELECT clean_text FROM cue WHERE id=context_ref.cue_id)),
            start_ms_snapshot=COALESCE(start_ms_snapshot,(SELECT start_ms FROM cue WHERE id=context_ref.cue_id)),
            end_ms_snapshot=COALESCE(end_ms_snapshot,(SELECT end_ms FROM cue WHERE id=context_ref.cue_id)),
            is_frozen=1,frozen_at=?,cue_id=NULL
            WHERE cue_id IN (SELECT id FROM cue WHERE subtitle_id=?)""",
            (subtitle_id, subtitle_id, frozen_at, subtitle_id))
        return cursor.rowcount

    def delete(self, subtitle_id: int) -> None:
        self.connection.execute("DELETE FROM subtitle WHERE id=?", (subtitle_id,))
