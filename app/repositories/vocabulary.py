"""Vocabulary persistence; all writes are owned by the service transaction."""

import sqlite3

from app.repositories.base import Repository


class VocabularyRepository(Repository):
    def candidates(self, subtitle_id: int, limit: int, offset: int):
        total = self.connection.execute("SELECT count(*) FROM subtitle_token WHERE subtitle_id=?", (subtitle_id,)).fetchone()[0]
        rows = self.connection.execute("""
            SELECT st.token_key, st.display_form, st.occurrence_count, st.first_cue_id,
                   c.sequence, li.id
            FROM subtitle_token st JOIN cue c ON c.id=st.first_cue_id
            LEFT JOIN learning_item li ON li.entry_type='word' AND li.dedupe_key=st.token_key
            WHERE st.subtitle_id=? ORDER BY st.occurrence_count DESC, st.token_key ASC
            LIMIT ? OFFSET ?
        """, (subtitle_id, limit, offset)).fetchall()
        return rows, int(total)

    def source(self, subtitle_id: int, cue_id: int, token_key: str):
        return self.connection.execute("""
            SELECT st.display_form, s.title, c.clean_text, c.start_ms, c.end_ms
            FROM subtitle_token st JOIN subtitle s ON s.id=st.subtitle_id
            JOIN cue c ON c.id=? AND c.subtitle_id=s.id
            WHERE st.subtitle_id=? AND st.token_key=? AND s.status<>'deleted'
        """, (cue_id, subtitle_id, token_key)).fetchone()

    def get_by_key(self, key: str):
        return self.connection.execute("SELECT id,display_text FROM learning_item WHERE entry_type='word' AND dedupe_key=?", (key,)).fetchone()

    def create_word(self, key: str, display: str, label: str, now: str, local_date: str) -> int:
        cursor = self.connection.execute("""INSERT INTO learning_item
            (entry_type,dedupe_key,display_text,source_kind,source_label,saved_from_ai,created_at,updated_at,created_local_date)
            VALUES ('word',?,?, 'subtitle',?,0,?,?,?)""", (key, display, label, now, now, local_date))
        item_id = int(cursor.lastrowid)
        self.connection.execute("""INSERT INTO review_state
            (learning_item_id,status,next_review_date,current_interval_days,success_count,distinct_success_dates,updated_at)
            VALUES (?,'new',NULL,0,0,0,?)""", (item_id, now))
        return item_id

    def add_context(self, item_id: int, cue_id: int, subtitle_id: int, title: str,
                    text: str, start: int, end: int, now: str) -> bool:
        cursor = self.connection.execute("""INSERT OR IGNORE INTO context_ref
            (learning_item_id,cue_id,subtitle_id_snapshot,subtitle_title_snapshot,cue_text_snapshot,
             start_ms_snapshot,end_ms_snapshot,is_frozen,added_at)
            VALUES (?,?,?,?,?,?,?,0,?)""", (item_id,cue_id,subtitle_id,title,text,start,end,now))
        return cursor.rowcount == 1

    def context_count(self, item_id: int) -> int:
        return int(self.connection.execute("SELECT count(*) FROM context_ref WHERE learning_item_id=?", (item_id,)).fetchone()[0])

    def list_items(self, status: str, search: str, sort: str, limit: int, offset: int):
        where = "li.entry_type='word' AND rs.status=? AND li.display_text LIKE ? COLLATE NOCASE"
        params = (status, f"%{search}%")
        total = self.connection.execute(f"SELECT count(*) FROM learning_item li JOIN review_state rs ON rs.learning_item_id=li.id WHERE {where}", params).fetchone()[0]
        order = {"alphabetical":"li.dedupe_key ASC, li.id ASC", "created_at":"li.created_at DESC, li.id DESC",
                 "frequency":"frequency DESC, li.dedupe_key ASC"}[sort]
        rows = self.connection.execute(f"""SELECT li.id,li.display_text,li.dedupe_key,rs.status,rs.next_review_date,
            li.created_at,count(DISTINCT cr.id),COALESCE((SELECT sum(st.occurrence_count)
              FROM subtitle_token st WHERE st.token_key=li.dedupe_key AND st.subtitle_id IN
              (SELECT DISTINCT source.subtitle_id_snapshot FROM context_ref source WHERE source.learning_item_id=li.id)),0) AS frequency
            FROM learning_item li JOIN review_state rs ON rs.learning_item_id=li.id
            LEFT JOIN context_ref cr ON cr.learning_item_id=li.id
            WHERE {where} GROUP BY li.id ORDER BY {order} LIMIT ? OFFSET ?""", (*params,limit,offset)).fetchall()
        return rows, int(total)

    def detail(self, item_id: int):
        item = self.connection.execute("""SELECT li.id,li.display_text,li.dedupe_key,li.ipa,rs.status,
            rs.next_review_date,li.created_at FROM learning_item li JOIN review_state rs ON rs.learning_item_id=li.id
            WHERE li.id=? AND li.entry_type='word'""", (item_id,)).fetchone()
        contexts = self.connection.execute("""SELECT id,cue_id,subtitle_id_snapshot,subtitle_title_snapshot,
            cue_text_snapshot,start_ms_snapshot,end_ms_snapshot,is_frozen FROM context_ref
            WHERE learning_item_id=? ORDER BY added_at,id""", (item_id,)).fetchall()
        return item, contexts
