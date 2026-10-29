"""TASK-002: storage startup, migrations, backup, locks and transactions."""

from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
import sqlite3
import stat
import subprocess

from fastapi import Depends
from fastapi.testclient import TestClient
import pytest

from app.core.config import Settings, load_settings
from app.api.dependencies import get_db_connection
from app.main import create_app
from app.repositories.database import Database, StorageBusyError, StorageError, transaction
from app.repositories.migrations.runner import MigrationError, initialize_database
from app.repositories.migrations.versions import MIGRATIONS, Migration


BASE_URL = "http://127.0.0.1:8765"
FIXED_TIME = lambda: datetime(2026, 10, 30, 8, 0, tzinfo=timezone.utc)
TASK002_MIGRATIONS = (MIGRATIONS[0],)


def database_at(tmp_path: Path, *, timeout: int = 5_000) -> Database:
    return Database(tmp_path / "private" / "scenelingo.db", busy_timeout_ms=timeout)


def read_version(db: Database) -> int:
    with db.connection() as conn:
        return conn.execute("PRAGMA user_version").fetchone()[0]


def initialize_task002(db: Database, **kwargs):
    return initialize_database(db, migrations=TASK002_MIGRATIONS, **kwargs)


def test_first_start_creates_versioned_empty_schema_and_private_backup(tmp_path):
    db = database_at(tmp_path)
    result = initialize_task002(db, now=FIXED_TIME)
    assert result.previous_version == 0
    assert result.target_version == 1
    assert result.applied_versions == (1,)
    assert result.backup_path is not None and result.backup_path.exists()
    assert result.backup_path.parent == db.path.parent / "backups"
    assert read_version(db) == 1
    with db.connection() as conn:
        assert conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall() == []
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        assert conn.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"
        assert conn.execute("PRAGMA busy_timeout").fetchone()[0] == 5_000
    with closing(sqlite3.connect(result.backup_path)) as backup:
        assert backup.execute("PRAGMA user_version").fetchone()[0] == 0
    assert stat.S_IMODE(db.path.parent.stat().st_mode) == 0o700
    assert stat.S_IMODE(db.backup_dir.stat().st_mode) == 0o700
    assert stat.S_IMODE(db.path.stat().st_mode) == 0o600
    assert stat.S_IMODE(result.backup_path.stat().st_mode) == 0o600


def test_restart_does_not_rerun_or_create_another_backup(tmp_path):
    db = database_at(tmp_path)
    first = initialize_task002(db, now=FIXED_TIME)
    second = initialize_task002(db, now=FIXED_TIME)
    assert second.previous_version == second.target_version == 1
    assert second.applied_versions == ()
    assert second.backup_path is None
    assert list(db.backup_dir.glob("*.db")) == [first.backup_path]


def test_migration_plan_rejects_gaps_before_touching_database(tmp_path):
    db = database_at(tmp_path)
    with pytest.raises(MigrationError, match="连续递增"):
        initialize_database(db, migrations=(MIGRATIONS[0], Migration(3, "skipped", lambda session: None)))
    assert not db.path.exists()


def test_migrations_run_in_order_and_keep_only_latest_own_backup(tmp_path):
    db = database_at(tmp_path)
    first = initialize_task002(db, now=FIXED_TIME)
    unrelated = db.backup_dir / "manual-copy.db"
    unrelated.write_bytes(b"not managed by SceneLingo")
    order = []

    def second(session):
        order.append(2)
        session.execute("CREATE TABLE task002_probe (id INTEGER PRIMARY KEY)")

    def third(session):
        order.append(3)
        session.execute("INSERT INTO task002_probe (id) VALUES (1)")

    result = initialize_database(db, migrations=(MIGRATIONS[0], Migration(2, "test table", second),
                                                Migration(3, "test row", third)), now=FIXED_TIME)
    assert order == [2, 3]
    assert result.applied_versions == (2, 3)
    assert read_version(db) == 3
    assert set(db.backup_dir.glob("*.db")) == {result.backup_path, unrelated}
    assert unrelated.read_bytes() == b"not managed by SceneLingo"
    assert first.backup_path != result.backup_path
    with closing(sqlite3.connect(result.backup_path)) as backup:
        assert backup.execute("PRAGMA user_version").fetchone()[0] == 1


def test_failed_migration_rolls_back_schema_and_data_and_preserves_backup(tmp_path):
    db = database_at(tmp_path)

    def stable(session):
        session.execute("CREATE TABLE task002_data (value TEXT NOT NULL)")

    plan = (MIGRATIONS[0], Migration(2, "test data", stable))
    initialize_database(db, migrations=plan, now=FIXED_TIME)
    with db.connection() as conn, transaction(conn):
        conn.execute("INSERT INTO task002_data (value) VALUES (?)", ("preserved",))

    def fail_after_ddl(session):
        session.execute("CREATE TABLE task002_half (value TEXT)")
        session.execute("INSERT INTO task002_data (value) VALUES ('not committed')")
        raise RuntimeError("injected failure")

    with pytest.raises(MigrationError, match="V3.*backups/"):
        initialize_database(db, migrations=(*plan, Migration(3, "injected failure", fail_after_ddl)), now=FIXED_TIME)
    assert db.path.exists()
    assert read_version(db) == 2
    with db.connection() as conn:
        assert conn.execute("SELECT value FROM task002_data").fetchall() == [("preserved",)]
        assert conn.execute("SELECT name FROM sqlite_master WHERE name='task002_half'").fetchall() == []
    backups = list(db.backup_dir.glob("*.db"))
    assert len(backups) == 1
    with closing(sqlite3.connect(backups[0])) as backup:
        assert backup.execute("PRAGMA user_version").fetchone()[0] == 2
        assert backup.execute("SELECT value FROM task002_data").fetchall() == [("preserved",)]


def test_multiple_pending_migrations_roll_back_as_one_unit(tmp_path):
    db = database_at(tmp_path)
    initialize_task002(db)

    def second(session):
        session.execute("CREATE TABLE task002_should_rollback (value INTEGER)")

    def third(session):
        session.execute("INSERT INTO task002_should_rollback (value) VALUES (7)")
        raise RuntimeError("stop")

    with pytest.raises(MigrationError, match="V3"):
        initialize_database(db, migrations=(MIGRATIONS[0], Migration(2, "temporary", second),
                                            Migration(3, "fails", third)))
    assert read_version(db) == 1
    with db.connection() as conn:
        assert conn.execute("SELECT name FROM sqlite_master WHERE name='task002_should_rollback'").fetchall() == []


def test_backup_failure_prevents_migration(tmp_path):
    db = database_at(tmp_path)
    db.path.parent.mkdir(mode=0o700)
    db.path.parent.chmod(0o700)
    db.backup_dir.write_text("cannot be a backup directory")
    with pytest.raises(StorageError, match="备份目录"):
        initialize_task002(db)
    assert db.path.exists()
    assert read_version(db) == 0


def test_version_change_between_backup_and_write_stops_migration(tmp_path, monkeypatch):
    from app.repositories.migrations import runner

    db = database_at(tmp_path)
    original_backup = runner._make_backup

    def backup_then_external_change(conn, database, version, now):
        path = original_backup(conn, database, version, now)
        with database.connection() as other, transaction(other):
            other.execute("PRAGMA user_version = 1")
        return path

    monkeypatch.setattr(runner, "_make_backup", backup_then_external_change)
    with pytest.raises(MigrationError, match="版本发生变化"):
        initialize_task002(db)
    assert read_version(db) == 1
    assert len(list(db.backup_dir.glob("*.db"))) == 1


def test_foreign_keys_reject_orphan_and_transaction_failure_rolls_back(tmp_path):
    db = database_at(tmp_path)
    initialize_task002(db)
    with db.connection() as conn:
        with transaction(conn):
            conn.execute("CREATE TABLE task002_parent (id INTEGER PRIMARY KEY)")
            conn.execute("CREATE TABLE task002_child (parent_id INTEGER REFERENCES task002_parent(id))")
        with pytest.raises(sqlite3.IntegrityError):
            with transaction(conn):
                conn.execute("INSERT INTO task002_child (parent_id) VALUES (99)")
        with pytest.raises(RuntimeError, match="rollback"):
            with transaction(conn):
                conn.execute("INSERT INTO task002_parent (id) VALUES (1)")
                raise RuntimeError("rollback")
        assert conn.execute("SELECT count(*) FROM task002_parent").fetchone()[0] == 0
        assert conn.execute("SELECT count(*) FROM task002_child").fetchone()[0] == 0


def test_second_writer_gets_classified_busy_error_without_lost_write(tmp_path):
    db = database_at(tmp_path, timeout=60)
    initialize_task002(db)
    first = db.open_connection()
    second = db.open_connection()
    try:
        with transaction(first):
            first.execute("CREATE TABLE task002_lock (value INTEGER)")
        with transaction(first):
            first.execute("INSERT INTO task002_lock (value) VALUES (1)")
            with pytest.raises(StorageBusyError, match="占用"):
                with transaction(second):
                    second.execute("INSERT INTO task002_lock (value) VALUES (2)")
        assert first.execute("SELECT value FROM task002_lock").fetchall() == [(1,)]
    finally:
        first.close()
        second.close()


def test_bad_path_and_readonly_database_fail_without_replacement(tmp_path):
    private = tmp_path / "private"
    private.mkdir(mode=0o700)
    private.chmod(0o500)
    db = Database(private / "scenelingo.db")
    try:
        with pytest.raises(StorageError, match="0700"):
            initialize_task002(db)
        assert not db.path.exists()
    finally:
        private.chmod(0o700)
    initialize_task002(db)
    before = db.path.read_bytes()
    db.path.chmod(0o400)
    try:
        with pytest.raises(StorageError, match="0600"):
            initialize_task002(db)
        assert db.path.read_bytes() == before
    finally:
        db.path.chmod(0o600)


def test_newer_database_version_is_not_downgraded(tmp_path):
    db = database_at(tmp_path)
    initialize_task002(db)
    with db.connection() as conn, transaction(conn):
        conn.execute("PRAGMA user_version = 99")
    with pytest.raises(MigrationError, match="版本高于"):
        initialize_task002(db)
    assert read_version(db) == 99


def test_custom_database_path_and_app_startup(tmp_path, monkeypatch):
    monkeypatch.setenv("SCENELINGO_DB_PATH", "environment.db")
    settings = load_settings(data_dir=str(tmp_path / "app-data"), db_path="custom.db")
    assert settings.database_path == tmp_path / "app-data" / "custom.db"
    with TestClient(create_app(settings), base_url=BASE_URL) as client:
        assert client.get("/api/v1/health").status_code == 200
        assert client.get("/api/v1/system/info", headers={
            "X-SceneLingo-Token": client.app.state.token,
        }).json()["data_dir_available"] is True
    assert settings.database_path.exists()
    assert not (settings.data_dir / "environment.db").exists()
    assert read_version(Database(settings.database_path)) == len(MIGRATIONS)


def test_request_connection_scope_opens_in_synchronous_route_thread(tmp_path):
    app = create_app(Settings(data_dir=tmp_path / "app-data"))

    @app.get("/api/v1/task002-connection-probe")
    def probe(scope=Depends(get_db_connection)):
        with scope as conn:
            return {"version": conn.execute("PRAGMA user_version").fetchone()[0]}

    with TestClient(app, base_url=BASE_URL) as client:
        response = client.get("/api/v1/task002-connection-probe", headers={
            "X-SceneLingo-Token": client.app.state.token,
        })
        assert response.status_code == 200
        assert response.json() == {"version": len(MIGRATIONS)}


def test_migration_failure_prevents_app_startup(tmp_path, monkeypatch):
    import app.main as main_module

    def fail(_database):
        raise MigrationError("测试迁移失败；请检查 backups/。")

    monkeypatch.setattr(main_module, "initialize_database", fail)
    app = create_app(Settings(data_dir=tmp_path / "app-data"))
    with pytest.raises(MigrationError, match="backups/"):
        with TestClient(app, base_url=BASE_URL):
            pass


def test_git_ignores_database_and_backup_paths():
    root = Path(__file__).resolve().parents[1]
    for relative in ("data/scenelingo.db", "backups/scenelingo-before-v0.db",
                     "app-data/scenelingo.db-wal", "app-data/scenelingo.db-shm"):
        result = subprocess.run(["git", "check-ignore", "-q", str(root / relative)], cwd=root)
        assert result.returncode == 0, relative
