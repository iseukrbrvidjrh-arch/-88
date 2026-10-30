"""Production migration list. Add new versions; never edit released ones."""

from dataclasses import dataclass
import sqlite3
from typing import Callable


@dataclass(frozen=True)
class Migration:
    version: int
    description: str
    apply: Callable[["MigrationSession"], None]


class MigrationSession:
    """Restrict migrations to SQL statements, with no commit/executescript escape."""

    def __init__(self, connection: sqlite3.Connection):
        self._connection = connection

    def execute(self, sql: str, parameters: tuple = ()) -> sqlite3.Cursor:
        return self._connection.execute(sql, parameters)

    def executemany(self, sql: str, parameters) -> sqlite3.Cursor:
        return self._connection.executemany(sql, parameters)


def _initialize_storage(session: MigrationSession) -> None:
    # TASK-002 intentionally creates no business tables. The version itself is the baseline.
    session.execute("SELECT 1")


def _create_subtitle_tables(session: MigrationSession) -> None:
    session.execute("""
        CREATE TABLE subtitle (
            id INTEGER PRIMARY KEY,
            title TEXT NOT NULL CHECK(length(trim(title)) > 0),
            source_format TEXT NOT NULL CHECK(source_format IN ('srt', 'vtt')),
            content_fingerprint TEXT NOT NULL CHECK(length(content_fingerprint) = 64),
            status TEXT NOT NULL DEFAULT 'imported' CHECK(status IN ('imported', 'archived', 'deleted')),
            cue_count INTEGER NOT NULL CHECK(cue_count >= 0),
            token_occurrence_count INTEGER NOT NULL CHECK(token_occurrence_count >= 0),
            unique_token_count INTEGER NOT NULL CHECK(unique_token_count >= 0),
            imported_at TEXT NOT NULL,
            archived_at TEXT,
            deleted_at TEXT
        )
    """)
    session.execute("""
        CREATE UNIQUE INDEX uq_subtitle_active_fingerprint
        ON subtitle(content_fingerprint) WHERE status <> 'deleted'
    """)
    session.execute("""
        CREATE TABLE cue (
            id INTEGER PRIMARY KEY,
            subtitle_id INTEGER NOT NULL REFERENCES subtitle(id) ON DELETE CASCADE,
            sequence INTEGER NOT NULL CHECK(sequence >= 1),
            start_ms INTEGER NOT NULL CHECK(start_ms >= 0),
            end_ms INTEGER NOT NULL CHECK(end_ms > start_ms),
            raw_text TEXT NOT NULL CHECK(length(trim(raw_text)) > 0),
            clean_text TEXT NOT NULL CHECK(length(trim(clean_text)) > 0),
            is_valid INTEGER NOT NULL DEFAULT 1 CHECK(is_valid IN (0, 1)),
            UNIQUE(subtitle_id, sequence)
        )
    """)
    session.execute("CREATE INDEX idx_cue_subtitle_sequence ON cue(subtitle_id, sequence)")
    session.execute("""
        CREATE TABLE subtitle_token (
            subtitle_id INTEGER NOT NULL REFERENCES subtitle(id) ON DELETE CASCADE,
            token_key TEXT NOT NULL CHECK(length(token_key) > 0),
            display_form TEXT NOT NULL CHECK(length(display_form) > 0),
            occurrence_count INTEGER NOT NULL CHECK(occurrence_count >= 1),
            first_cue_id INTEGER REFERENCES cue(id) ON DELETE SET NULL,
            PRIMARY KEY(subtitle_id, token_key)
        )
    """)
    session.execute("CREATE INDEX idx_subtitle_token_key ON subtitle_token(token_key)")


def _add_invalid_cue_count(session: MigrationSession) -> None:
    # NULL deliberately means "unknown for a pre-V3 import"; new imports always write a value.
    session.execute(
        "ALTER TABLE subtitle ADD COLUMN invalid_cue_count INTEGER "
        "CHECK(invalid_cue_count IS NULL OR invalid_cue_count >= 0)"
    )


def _create_vocabulary_tables(session: MigrationSession) -> None:
    session.execute("""
        CREATE TABLE learning_item (
            id INTEGER PRIMARY KEY, entry_type TEXT NOT NULL CHECK(entry_type IN ('word','phrase','sentence','note')),
            dedupe_key TEXT NOT NULL, display_text TEXT NOT NULL, ipa TEXT,
            source_kind TEXT NOT NULL CHECK(source_kind IN ('subtitle','ai','manual')),
            source_conversation_id INTEGER, source_label TEXT, saved_from_ai INTEGER NOT NULL DEFAULT 0 CHECK(saved_from_ai IN (0,1)),
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_local_date TEXT NOT NULL, archived_at TEXT,
            UNIQUE(entry_type, dedupe_key)
        )
    """)
    session.execute("""
        CREATE TABLE context_ref (
            id INTEGER PRIMARY KEY, learning_item_id INTEGER NOT NULL REFERENCES learning_item(id) ON DELETE CASCADE,
            cue_id INTEGER REFERENCES cue(id) ON DELETE SET NULL,
            subtitle_id_snapshot INTEGER, subtitle_title_snapshot TEXT, cue_text_snapshot TEXT,
            start_ms_snapshot INTEGER, end_ms_snapshot INTEGER, is_frozen INTEGER NOT NULL DEFAULT 0 CHECK(is_frozen IN (0,1)),
            frozen_at TEXT, added_at TEXT NOT NULL, frozen_content_hash TEXT,
            UNIQUE(learning_item_id, cue_id)
        )
    """)
    session.execute("CREATE INDEX idx_context_item ON context_ref(learning_item_id, added_at)")
    session.execute("""
        CREATE TABLE review_state (
            learning_item_id INTEGER PRIMARY KEY REFERENCES learning_item(id) ON DELETE CASCADE,
            status TEXT NOT NULL CHECK(status IN ('new','learning','mastered','archived')),
            next_review_date TEXT, current_interval_days INTEGER NOT NULL DEFAULT 0 CHECK(current_interval_days >= 0),
            success_count INTEGER NOT NULL DEFAULT 0 CHECK(success_count >= 0),
            distinct_success_dates INTEGER NOT NULL DEFAULT 0 CHECK(distinct_success_dates >= 0),
            first_success_date TEXT, last_attempt_at TEXT, last_attempt_final_rating TEXT,
            mastered_at TEXT, updated_at TEXT NOT NULL
        )
    """)


def _create_review_attempts(session: MigrationSession) -> None:
    session.execute("""
        CREATE TABLE review_attempt (
            id INTEGER PRIMARY KEY, attempt_token TEXT NOT NULL UNIQUE,
            learning_item_id INTEGER NOT NULL REFERENCES learning_item(id) ON DELETE RESTRICT,
            mode TEXT NOT NULL CHECK(mode IN ('spelling','meaning')),
            attempted_at TEXT NOT NULL, attempted_local_date TEXT NOT NULL,
            user_input TEXT, is_spelling_correct INTEGER CHECK(is_spelling_correct IS NULL OR is_spelling_correct IN (0,1)),
            self_rating TEXT NOT NULL CHECK(self_rating IN ('good','hard','again')),
            final_rating TEXT NOT NULL CHECK(final_rating IN ('good','hard','again')),
            is_success INTEGER NOT NULL CHECK(is_success IN (0,1)),
            interval_before_days INTEGER, interval_after_days INTEGER NOT NULL CHECK(interval_after_days >= 1),
            next_review_date TEXT NOT NULL, created_at TEXT NOT NULL
        )
    """)
    session.execute("CREATE INDEX idx_review_item_date ON review_attempt(learning_item_id, attempted_at DESC)")


def _create_ai_gateway_tables(session: MigrationSession) -> None:
    session.execute("""CREATE TABLE ai_cache (
        id INTEGER PRIMARY KEY, cache_key TEXT NOT NULL UNIQUE,
        cache_type TEXT NOT NULL CHECK(cache_type IN ('word_definition','sentence_translation','context_explanation')),
        source_text TEXT NOT NULL, context_hash TEXT NOT NULL DEFAULT '',
        target_language TEXT NOT NULL, result_text TEXT NOT NULL,
        model_id TEXT, prompt_version TEXT NOT NULL,
        created_at TEXT NOT NULL, refreshed_at TEXT NOT NULL
    )""")
    session.execute("""CREATE TABLE cost_record (
        id INTEGER PRIMARY KEY, request_id TEXT NOT NULL UNIQUE,
        purpose TEXT NOT NULL CHECK(purpose IN ('translation','definition','context_explanation')),
        model_id TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER,
        usage_source TEXT CHECK(usage_source IS NULL OR usage_source IN ('api','estimated_chars')),
        estimated_cost TEXT, currency TEXT NOT NULL,
        price_version TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('success','failed','cancelled')),
        created_at TEXT NOT NULL,
        CHECK(status <> 'success' OR (usage_source IS NOT NULL AND estimated_cost IS NOT NULL))
    )""")
    session.execute("""CREATE TABLE app_setting (
        key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
    )""")


def _create_ai_chat_tables(session: MigrationSession) -> None:
    session.execute("""CREATE TABLE ai_conversation (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL CHECK(length(trim(title)) > 0),
        started_at TEXT NOT NULL,
        last_message_at TEXT,
        deleted_at TEXT
    )""")
    session.execute("""CREATE TABLE ai_message (
        id INTEGER PRIMARY KEY,
        conversation_id INTEGER NOT NULL REFERENCES ai_conversation(id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL CHECK(sequence >= 1),
        role TEXT NOT NULL CHECK(role IN ('user','assistant')),
        content TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','complete','incomplete','failed','cancelled')),
        model_id TEXT,
        request_id TEXT UNIQUE,
        error_code TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        UNIQUE(conversation_id, sequence)
    )""")
    session.execute("CREATE INDEX idx_ai_message_conversation ON ai_message(conversation_id,sequence)")
    session.execute("""CREATE TABLE ai_message_context (
        id INTEGER PRIMARY KEY,
        message_id INTEGER NOT NULL REFERENCES ai_message(id) ON DELETE CASCADE,
        ref_type TEXT NOT NULL CHECK(ref_type IN ('cue','learning_item','history_message')),
        cue_id INTEGER REFERENCES cue(id) ON DELETE SET NULL,
        learning_item_id INTEGER REFERENCES learning_item(id) ON DELETE SET NULL,
        history_message_id INTEGER REFERENCES ai_message(id) ON DELETE SET NULL,
        text_snapshot TEXT NOT NULL
    )""")
    # V6 was released without chat purpose and message links; rebuild without editing V6.
    session.execute("ALTER TABLE cost_record RENAME TO cost_record_v6")
    session.execute("""CREATE TABLE cost_record (
        id INTEGER PRIMARY KEY, request_id TEXT NOT NULL UNIQUE,
        conversation_id INTEGER REFERENCES ai_conversation(id) ON DELETE SET NULL,
        message_id INTEGER REFERENCES ai_message(id) ON DELETE SET NULL,
        purpose TEXT NOT NULL CHECK(purpose IN ('chat','translation','definition','context_explanation')),
        model_id TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER,
        usage_source TEXT CHECK(usage_source IS NULL OR usage_source IN ('api','estimated_chars')),
        estimated_cost TEXT, currency TEXT NOT NULL, price_version TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('success','failed','cancelled')),
        created_at TEXT NOT NULL,
        CHECK(status <> 'success' OR (usage_source IS NOT NULL AND estimated_cost IS NOT NULL))
    )""")
    session.execute("""INSERT INTO cost_record
        (id,request_id,purpose,model_id,input_tokens,output_tokens,usage_source,estimated_cost,currency,price_version,status,created_at)
        SELECT id,request_id,purpose,model_id,input_tokens,output_tokens,usage_source,estimated_cost,currency,price_version,status,created_at
        FROM cost_record_v6""")
    session.execute("DROP TABLE cost_record_v6")


MIGRATIONS = (
    Migration(1, "Initialize storage baseline without business tables", _initialize_storage),
    Migration(2, "Create subtitle, cue and subtitle token tables", _create_subtitle_tables),
    Migration(3, "Persist skipped invalid cue count with legacy unknown semantics", _add_invalid_cue_count),
    Migration(4, "Create vocabulary items, contexts and initial review state", _create_vocabulary_tables),
    Migration(5, "Create immutable idempotent review attempt history", _create_review_attempts),
    Migration(6, "Create AI result cache, cost ledger and non-secret settings", _create_ai_gateway_tables),
    Migration(7, "Create AI Tutor conversations, messages, contexts and chat cost links", _create_ai_chat_tables),
)
