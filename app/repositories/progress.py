"""Read-through progress aggregates and small continue-learning settings."""

from app.repositories.base import Repository


class ProgressRepository(Repository):
    def daily_records(self, start_date: str, end_date: str):
        return self.connection.execute(
            """WITH dates(day) AS (
                 SELECT attempted_local_date FROM review_attempt
                  WHERE attempted_local_date BETWEEN ? AND ?
                 UNION
                 SELECT created_local_date FROM learning_item
                  WHERE created_local_date BETWEEN ? AND ?
               ), reviews AS (
                 SELECT attempted_local_date day, count(*) attempts,
                        sum(CASE WHEN final_rating='good'
                                  AND (mode<>'spelling' OR is_spelling_correct=1)
                                 THEN 1 ELSE 0 END) correct,
                        count(DISTINCT learning_item_id) distinct_items
                   FROM review_attempt WHERE attempted_local_date BETWEEN ? AND ?
                  GROUP BY attempted_local_date
               ), additions AS (
                 SELECT created_local_date day,
                        sum(CASE WHEN entry_type='word' THEN 1 ELSE 0 END) new_words,
                        sum(CASE WHEN saved_from_ai=1 THEN 1 ELSE 0 END) ai_saves
                   FROM learning_item WHERE created_local_date BETWEEN ? AND ?
                  GROUP BY created_local_date
               )
               SELECT dates.day,coalesce(attempts,0),coalesce(correct,0),
                      coalesce(distinct_items,0),coalesce(new_words,0),coalesce(ai_saves,0)
                 FROM dates LEFT JOIN reviews ON reviews.day=dates.day
                 LEFT JOIN additions ON additions.day=dates.day
                WHERE coalesce(attempts,0)>0 OR coalesce(new_words,0)>0 OR coalesce(ai_saves,0)>0
                ORDER BY dates.day DESC""",
            (start_date, end_date, start_date, end_date, start_date, end_date,
             start_date, end_date),
        ).fetchall()

    def status_counts(self, today: str):
        return self.connection.execute(
            """SELECT
                 sum(CASE WHEN rs.status IN ('new','learning','mastered') THEN 1 ELSE 0 END),
                 sum(CASE WHEN rs.status='new' THEN 1 ELSE 0 END),
                 sum(CASE WHEN rs.status='learning' THEN 1 ELSE 0 END),
                 sum(CASE WHEN rs.status='mastered' THEN 1 ELSE 0 END),
                 sum(CASE WHEN rs.status<>'archived' AND
                     (rs.status='new' OR rs.next_review_date<=?) THEN 1 ELSE 0 END)
               FROM learning_item li JOIN review_state rs ON rs.learning_item_id=li.id
              WHERE li.entry_type='word'""", (today,)).fetchone()

    def consistency_issues(self):
        issues=[]
        missing=self.connection.execute("""SELECT count(*) FROM learning_item li
            LEFT JOIN review_state rs ON rs.learning_item_id=li.id
            WHERE li.entry_type='word' AND rs.learning_item_id IS NULL""").fetchone()[0]
        if missing: issues.append({"code":"missing_review_state","count":int(missing)})
        mismatched=self.connection.execute("""SELECT count(*) FROM review_state rs
            JOIN learning_item li ON li.id=rs.learning_item_id
            WHERE li.entry_type='word' AND rs.success_count<>(SELECT count(*) FROM review_attempt ra
              WHERE ra.learning_item_id=li.id AND ra.is_success=1)""").fetchone()[0]
        if mismatched: issues.append({"code":"review_projection_mismatch","count":int(mismatched)})
        return issues

    def settings(self):
        keys=("learning.last_subtitle_id","learning.last_cue_id",
              "learning.last_review_item_id","learning.last_active_at")
        rows=self.connection.execute(
            f"SELECT key,value FROM app_setting WHERE key IN ({','.join('?' for _ in keys)})", keys
        ).fetchall()
        return {row[0]:row[1] for row in rows}

    def save_settings(self, values: dict[str,str|None], updated_at: str):
        for key,value in values.items():
            if value is None:
                self.connection.execute("DELETE FROM app_setting WHERE key=?",(key,))
            else:
                self.connection.execute("""INSERT INTO app_setting(key,value,updated_at) VALUES (?,?,?)
                    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at""",
                    (key,value,updated_at))

    def continue_subtitle(self, subtitle_id: int, cue_id: int):
        return self.connection.execute("""SELECT s.id,s.title,c.id,c.sequence FROM subtitle s
            JOIN cue c ON c.id=? AND c.subtitle_id=s.id
            WHERE s.id=? AND s.status<>'deleted'""",(cue_id,subtitle_id)).fetchone()

    def continue_review(self, item_id: int, today: str):
        return self.connection.execute("""SELECT li.id,li.display_text,rs.status,rs.next_review_date
            FROM learning_item li JOIN review_state rs ON rs.learning_item_id=li.id
            WHERE li.id=? AND li.entry_type='word' AND rs.status<>'archived'
              AND (rs.status='new' OR rs.next_review_date<=?)""",(item_id,today)).fetchone()

    def due_ids(self, today: str):
        return [int(row[0]) for row in self.connection.execute("""SELECT li.id FROM learning_item li
            JOIN review_state rs ON rs.learning_item_id=li.id
            WHERE li.entry_type='word' AND rs.status<>'archived'
              AND (rs.status='new' OR rs.next_review_date<=?)
            ORDER BY COALESCE(rs.next_review_date,li.created_local_date),
              CASE rs.status WHEN 'learning' THEN 0 WHEN 'mastered' THEN 1 ELSE 2 END,
              li.created_at,li.dedupe_key""",(today,)).fetchall()]
