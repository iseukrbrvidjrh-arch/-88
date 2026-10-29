"""SQL persistence for parsed subtitles; transaction ownership stays in the service."""

from dataclasses import dataclass
import sqlite3

from app.domain.subtitle.parser import ParsedCue
from app.domain.subtitle.tokens import TokenStat
from app.repositories.base import Repository


@dataclass(frozen=True)
class StoredSubtitle:
    id: int
    title: str
    source_format: str
    content_fingerprint: str
    status: str
    cue_count: int
    token_occurrence_count: int
    unique_token_count: int
    imported_at: str
    invalid_cue_count: int | None


@dataclass(frozen=True)
class LibraryStatistics:
    subtitle_count: int
    token_occurrence_count: int
    unique_token_count: int


@dataclass(frozen=True)
class CueRecord:
    id: int
    subtitle_id: int
    sequence: int
    start_ms: int
    end_ms: int
    clean_text: str
    is_valid: bool


class SubtitleRepository(Repository):
    def find_active_by_fingerprint(self, fingerprint: str) -> StoredSubtitle | None:
        row = self.connection.execute(
            """SELECT id, title, source_format, content_fingerprint, status, cue_count,
                      token_occurrence_count, unique_token_count, imported_at, invalid_cue_count
               FROM subtitle WHERE content_fingerprint = ? AND status <> 'deleted'""",
            (fingerprint,),
        ).fetchone()
        return StoredSubtitle(*row) if row else None

    def insert_subtitle(self, *, title: str, source_format: str, fingerprint: str,
                        cue_count: int, token_count: int, unique_count: int,
                        imported_at: str, invalid_cue_count: int) -> int:
        cursor = self.connection.execute(
            """INSERT INTO subtitle
               (title, source_format, content_fingerprint, status, cue_count,
                token_occurrence_count, unique_token_count, imported_at, invalid_cue_count)
               VALUES (?, ?, ?, 'imported', ?, ?, ?, ?, ?)""",
            (title, source_format, fingerprint, cue_count, token_count, unique_count,
             imported_at, invalid_cue_count),
        )
        return int(cursor.lastrowid)

    def insert_cues(self, subtitle_id: int, cues: tuple[ParsedCue, ...]) -> dict[int, int]:
        ids: dict[int, int] = {}
        for cue in cues:
            cursor = self.connection.execute(
                """INSERT INTO cue
                   (subtitle_id, sequence, start_ms, end_ms, raw_text, clean_text, is_valid)
                   VALUES (?, ?, ?, ?, ?, ?, 1)""",
                (subtitle_id, cue.sequence, cue.start_ms, cue.end_ms, cue.raw_text, cue.clean_text),
            )
            ids[cue.sequence] = int(cursor.lastrowid)
        return ids

    def insert_tokens(self, subtitle_id: int, tokens: tuple[TokenStat, ...],
                      cue_ids: dict[int, int]) -> None:
        self.connection.executemany(
            """INSERT INTO subtitle_token
               (subtitle_id, token_key, display_form, occurrence_count, first_cue_id)
               VALUES (?, ?, ?, ?, ?)""",
            ((subtitle_id, token.key, token.display_form, token.occurrence_count,
              cue_ids[token.first_sequence]) for token in tokens),
        )

    def get(self, subtitle_id: int) -> StoredSubtitle | None:
        row = self.connection.execute(
            """SELECT id, title, source_format, content_fingerprint, status, cue_count,
                      token_occurrence_count, unique_token_count, imported_at, invalid_cue_count
               FROM subtitle WHERE id = ?""",
            (subtitle_id,),
        ).fetchone()
        return StoredSubtitle(*row) if row else None

    def preview_cues(self, subtitle_id: int, limit: int) -> list[dict[str, object]]:
        rows = self.connection.execute(
            """SELECT sequence, start_ms, end_ms, clean_text
               FROM cue WHERE subtitle_id = ? ORDER BY sequence LIMIT ?""",
            (subtitle_id, limit),
        ).fetchall()
        return [
            {"sequence": row[0], "start_ms": row[1], "end_ms": row[2], "text": row[3]}
            for row in rows
        ]

    def count_subtitles(self) -> int:
        return int(self.connection.execute("SELECT count(*) FROM subtitle WHERE status <> 'deleted'").fetchone()[0])

    def library_statistics(self) -> LibraryStatistics:
        subtitle_count, token_count = self.connection.execute(
            """SELECT count(*), COALESCE(sum(token_occurrence_count), 0)
               FROM subtitle WHERE status <> 'deleted'"""
        ).fetchone()
        unique_count = self.connection.execute(
            """SELECT count(DISTINCT st.token_key)
               FROM subtitle_token st
               JOIN subtitle s ON s.id = st.subtitle_id
               WHERE s.status <> 'deleted'"""
        ).fetchone()[0]
        return LibraryStatistics(int(subtitle_count), int(token_count), int(unique_count))

    def list_subtitles(self, *, status: str, search: str, sort: str,
                       limit: int, offset: int) -> tuple[list[StoredSubtitle], int]:
        where = "status = ? AND title LIKE ? COLLATE NOCASE"
        parameters: tuple[object, ...] = (status, f"%{search}%")
        total = int(self.connection.execute(
            f"SELECT count(*) FROM subtitle WHERE {where}", parameters
        ).fetchone()[0])
        order = "title COLLATE NOCASE ASC, id ASC" if sort == "title" else "imported_at DESC, id DESC"
        rows = self.connection.execute(
            f"""SELECT id, title, source_format, content_fingerprint, status, cue_count,
                       token_occurrence_count, unique_token_count, imported_at, invalid_cue_count
                FROM subtitle WHERE {where} ORDER BY {order} LIMIT ? OFFSET ?""",
            (*parameters, limit, offset),
        ).fetchall()
        return [StoredSubtitle(*row) for row in rows], total

    def list_cues(self, subtitle_id: int, *, limit: int, offset: int) -> tuple[list[CueRecord], int]:
        total = int(self.connection.execute(
            "SELECT count(*) FROM cue WHERE subtitle_id = ?", (subtitle_id,)
        ).fetchone()[0])
        rows = self.connection.execute(
            """SELECT id, subtitle_id, sequence, start_ms, end_ms, clean_text, is_valid
               FROM cue WHERE subtitle_id = ? ORDER BY sequence LIMIT ? OFFSET ?""",
            (subtitle_id, limit, offset),
        ).fetchall()
        return [CueRecord(*row[:-1], bool(row[-1])) for row in rows], total

    def locate_cue(self, subtitle_id: int, *, cue_id: int | None = None,
                   sequence: int | None = None, radius: int = 2) -> tuple[CueRecord | None, list[CueRecord]]:
        column, value = ("id", cue_id) if cue_id is not None else ("sequence", sequence)
        row = self.connection.execute(
            f"""SELECT id, subtitle_id, sequence, start_ms, end_ms, clean_text, is_valid
                FROM cue WHERE subtitle_id = ? AND {column} = ?""", (subtitle_id, value)
        ).fetchone()
        if row is None:
            return None, []
        target = CueRecord(*row[:-1], bool(row[-1]))
        rows = self.connection.execute(
            """SELECT id, subtitle_id, sequence, start_ms, end_ms, clean_text, is_valid
               FROM cue WHERE subtitle_id = ? AND sequence BETWEEN ? AND ? ORDER BY sequence""",
            (subtitle_id, max(1, target.sequence - radius), target.sequence + radius),
        ).fetchall()
        return target, [CueRecord(*item[:-1], bool(item[-1])) for item in rows]
