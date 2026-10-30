"""AI cache, local settings and cost ledger persistence."""

from app.repositories.base import Repository


class AiRepository(Repository):
    def setting(self, key):
        row = self.connection.execute("SELECT value FROM app_setting WHERE key=?", (key,)).fetchone()
        return row[0] if row else None

    def set_setting(self, key, value, now):
        self.connection.execute("""INSERT INTO app_setting(key,value,updated_at) VALUES(?,?,?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at""", (key,value,now))

    def cached(self, key):
        return self.connection.execute("SELECT result_text,model_id,created_at FROM ai_cache WHERE cache_key=?", (key,)).fetchone()

    def cache(self, values):
        self.connection.execute("""INSERT INTO ai_cache
            (cache_key,cache_type,source_text,context_hash,target_language,result_text,model_id,prompt_version,created_at,refreshed_at)
            VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET
            result_text=excluded.result_text,model_id=excluded.model_id,refreshed_at=excluded.refreshed_at""", values)

    def add_cost(self, values):
        self.connection.execute("""INSERT INTO cost_record
            (request_id,purpose,model_id,input_tokens,output_tokens,usage_source,estimated_cost,currency,price_version,status,created_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)""", values)

    def costs(self, limit=100):
        return self.connection.execute("""SELECT request_id,purpose,model_id,input_tokens,output_tokens,usage_source,
            estimated_cost,currency,price_version,status,created_at FROM cost_record ORDER BY id DESC LIMIT ?""", (limit,)).fetchall()
