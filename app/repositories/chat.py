"""AI Tutor conversation, message, context and confirmed-save persistence."""

from app.repositories.base import Repository


class ChatRepository(Repository):
    def create_conversation(self,title,now):
        cursor=self.connection.execute("INSERT INTO ai_conversation(title,started_at) VALUES(?,?)",(title,now))
        return int(cursor.lastrowid)

    def conversations(self):
        return self.connection.execute("""SELECT c.id,c.title,c.started_at,c.last_message_at,count(m.id)
            FROM ai_conversation c LEFT JOIN ai_message m ON m.conversation_id=c.id
            WHERE c.deleted_at IS NULL GROUP BY c.id ORDER BY COALESCE(c.last_message_at,c.started_at) DESC,c.id DESC""").fetchall()

    def conversation(self,conversation_id):
        return self.connection.execute("SELECT id,title,started_at,last_message_at FROM ai_conversation WHERE id=? AND deleted_at IS NULL",(conversation_id,)).fetchone()

    def messages(self,conversation_id):
        return self.connection.execute("""SELECT id,sequence,role,content,status,model_id,request_id,error_code,created_at,completed_at
            FROM ai_message WHERE conversation_id=? ORDER BY sequence""",(conversation_id,)).fetchall()

    def recent_complete_messages(self,conversation_id,count):
        if count<=0:return []
        pairs=self.connection.execute("""SELECT u.id,u.content,a.id,a.content
            FROM ai_message u JOIN ai_message a ON a.conversation_id=u.conversation_id
              AND a.sequence=u.sequence+1 AND a.role='assistant' AND a.status='complete'
            WHERE u.conversation_id=? AND u.role='user' AND u.status='complete'
            ORDER BY a.sequence DESC LIMIT ?""",(conversation_id,max(1,count//2))).fetchall()
        flattened=[]
        for user_id,user_content,assistant_id,assistant_content in reversed(pairs):
            flattened.extend(((user_id,"user",user_content),(assistant_id,"assistant",assistant_content)))
        return flattened[-count:]

    def cue(self,cue_id):
        return self.connection.execute("""SELECT c.id,c.clean_text,s.title FROM cue c JOIN subtitle s ON s.id=c.subtitle_id
            WHERE c.id=? AND s.status<>'deleted'""",(cue_id,)).fetchone()

    def item(self,item_id):
        return self.connection.execute("SELECT id,display_text FROM learning_item WHERE id=? AND archived_at IS NULL",(item_id,)).fetchone()

    def insert_exchange(self,conversation_id,user_text,model,request_id,now,contexts):
        next_sequence=int(self.connection.execute("SELECT COALESCE(max(sequence),0)+1 FROM ai_message WHERE conversation_id=?",(conversation_id,)).fetchone()[0])
        user=self.connection.execute("""INSERT INTO ai_message(conversation_id,sequence,role,content,status,created_at,completed_at)
            VALUES(?,?,'user',?,'complete',?,?)""",(conversation_id,next_sequence,user_text,now,now))
        user_id=int(user.lastrowid)
        assistant=self.connection.execute("""INSERT INTO ai_message(conversation_id,sequence,role,content,status,model_id,request_id,created_at)
            VALUES(?,?,'assistant','','pending',?,?,?)""",(conversation_id,next_sequence+1,model,request_id,now))
        assistant_id=int(assistant.lastrowid)
        for ref_type,ref_id,text in contexts:
            columns={"cue":"cue_id","learning_item":"learning_item_id","history_message":"history_message_id"}
            column=columns[ref_type]
            self.connection.execute(f"INSERT INTO ai_message_context(message_id,ref_type,{column},text_snapshot) VALUES(?,?,?,?)",(user_id,ref_type,ref_id,text))
        self.connection.execute("UPDATE ai_conversation SET last_message_at=?,title=CASE WHEN title='新会话' THEN ? ELSE title END WHERE id=?",(now,user_text[:40],conversation_id))
        return user_id,assistant_id

    def finish_message(self,message_id,status,content,completed_at,error_code=None):
        self.connection.execute("UPDATE ai_message SET status=?,content=?,completed_at=?,error_code=? WHERE id=?",(status,content,completed_at,error_code,message_id))

    def add_chat_cost(self,values):
        self.connection.execute("""INSERT INTO cost_record
            (request_id,conversation_id,message_id,purpose,model_id,input_tokens,output_tokens,usage_source,estimated_cost,currency,price_version,status,created_at)
            VALUES(?,?,?,'chat',?,?,?,?,?,?,?,?,?)""",values)

    def delete_conversation(self,conversation_id):
        self.connection.execute("UPDATE learning_item SET source_conversation_id=NULL WHERE source_conversation_id=?",(conversation_id,))
        return self.connection.execute("DELETE FROM ai_conversation WHERE id=?",(conversation_id,)).rowcount

    def assistant_message(self,message_id):
        return self.connection.execute("""SELECT m.id,m.conversation_id,m.content,m.status,c.title
            FROM ai_message m JOIN ai_conversation c ON c.id=m.conversation_id
            WHERE m.id=? AND m.role='assistant' AND c.deleted_at IS NULL""",(message_id,)).fetchone()

    def learning_item_by_key(self,entry_type,dedupe_key):
        return self.connection.execute("SELECT id FROM learning_item WHERE entry_type=? AND dedupe_key=?",(entry_type,dedupe_key)).fetchone()

    def save_item(self,entry_type,key,text,conversation_id,label,now,local_date):
        cursor=self.connection.execute("""INSERT INTO learning_item
            (entry_type,dedupe_key,display_text,source_kind,source_conversation_id,source_label,saved_from_ai,created_at,updated_at,created_local_date)
            VALUES(?,?,?,'ai',?,?,1,?,?,?)""",(entry_type,key,text,conversation_id,label,now,now,local_date))
        item_id=int(cursor.lastrowid)
        if entry_type=='word':
            self.connection.execute("""INSERT INTO review_state
                (learning_item_id,status,next_review_date,current_interval_days,success_count,distinct_success_dates,updated_at)
                VALUES(?,'new',NULL,0,0,0,?)""",(item_id,now))
        return item_id
