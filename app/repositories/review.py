"""Review queue, immutable attempts and review-state projection persistence."""

from app.repositories.base import Repository


class ReviewRepository(Repository):
    def existing_attempt(self, token: str):
        return self.connection.execute("SELECT id,learning_item_id,final_rating,is_success,interval_after_days,next_review_date FROM review_attempt WHERE attempt_token=?",(token,)).fetchone()

    def item_state(self, item_id: int):
        return self.connection.execute("""SELECT li.display_text,rs.status,rs.current_interval_days,rs.mastered_at
            FROM learning_item li JOIN review_state rs ON rs.learning_item_id=li.id
            WHERE li.id=? AND li.entry_type='word'""",(item_id,)).fetchone()

    def success_dates(self, item_id: int):
        return [row[0] for row in self.connection.execute("SELECT attempted_local_date FROM review_attempt WHERE learning_item_id=? AND is_success=1 ORDER BY attempted_at,id",(item_id,))]

    def insert_attempt(self, values: tuple) -> int:
        cursor=self.connection.execute("""INSERT INTO review_attempt
            (attempt_token,learning_item_id,mode,attempted_at,attempted_local_date,user_input,is_spelling_correct,
             self_rating,final_rating,is_success,interval_before_days,interval_after_days,next_review_date,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",values)
        return int(cursor.lastrowid)

    def update_state(self,item_id:int,*,status:str,next_date:str,interval:int,success_count:int,
                     distinct_dates:int,first_date:str|None,rating:str,attempted_at:str,mastered_at:str|None):
        self.connection.execute("""UPDATE review_state SET status=?,next_review_date=?,current_interval_days=?,
            success_count=?,distinct_success_dates=?,first_success_date=?,last_attempt_at=?,
            last_attempt_final_rating=?,mastered_at=?,updated_at=? WHERE learning_item_id=?""",
            (status,next_date,interval,success_count,distinct_dates,first_date,attempted_at,rating,mastered_at,attempted_at,item_id))

    def queue(self,today:str,mode:str,limit:int|None):
        definition_clause="1=0" if mode=="meaning" else "1=1"
        # word_sense is introduced by the dictionary task; until then meaning queue is correctly empty.
        sql=f"""SELECT li.id,li.display_text,rs.status,rs.next_review_date,li.created_at,
              (SELECT cr.cue_text_snapshot FROM context_ref cr WHERE cr.learning_item_id=li.id ORDER BY cr.added_at,cr.id LIMIT 1)
            FROM learning_item li JOIN review_state rs ON rs.learning_item_id=li.id
            WHERE li.entry_type='word' AND rs.status<>'archived'
              AND (rs.status='new' OR rs.next_review_date<=?) AND {definition_clause}
            ORDER BY COALESCE(rs.next_review_date,li.created_local_date),
              CASE rs.status WHEN 'learning' THEN 0 WHEN 'mastered' THEN 1 ELSE 2 END,
              li.created_at,li.dedupe_key"""
        if limit is not None: sql += " LIMIT ?"; params=(today,limit)
        else: params=(today,)
        return self.connection.execute(sql,params).fetchall()

    def history(self,item_id:int,limit:int,offset:int):
        total=self.connection.execute("SELECT count(*) FROM review_attempt WHERE learning_item_id=?",(item_id,)).fetchone()[0]
        rows=self.connection.execute("""SELECT id,attempt_token,mode,attempted_at,attempted_local_date,user_input,
            is_spelling_correct,self_rating,final_rating,is_success,interval_before_days,interval_after_days,next_review_date
            FROM review_attempt WHERE learning_item_id=? ORDER BY attempted_at DESC,id DESC LIMIT ? OFFSET ?""",(item_id,limit,offset)).fetchall()
        return rows,int(total)
