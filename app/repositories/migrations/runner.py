"""Atomic migration runner and consistent pre-migration backups."""

from dataclasses import dataclass
from datetime import datetime, timezone
import os
from pathlib import Path
import re
import sqlite3
import tempfile
from typing import Callable, Sequence
from uuid import uuid4

from app.repositories.database import Database, StorageError, _private_directory, transaction
from app.repositories.migrations.versions import MIGRATIONS, Migration, MigrationSession


class MigrationError(StorageError):
    """A migration failed; the original database and pre-migration backup remain."""


@dataclass(frozen=True)
class MigrationResult:
    previous_version: int
    target_version: int
    applied_versions: tuple[int, ...]
    backup_path: Path | None


def _validate_plan(migrations: Sequence[Migration]) -> None:
    versions = tuple(m.version for m in migrations)
    if versions != tuple(range(1, len(versions) + 1)):
        raise MigrationError("迁移版本必须从 1 开始连续递增，且不可重复。")
    if any(not m.description.strip() for m in migrations):
        raise MigrationError("每个迁移都必须有说明。")


def _backup_name(version: int, now: Callable[[], datetime]) -> str:
    stamp = now().astimezone(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    return f"scenelingo-before-v{version}-{stamp}-{uuid4().hex[:8]}.db"


def _prune_own_backups(backup_dir: Path, keep: Path) -> None:
    own_name = re.compile(r"scenelingo-before-v[0-9]+-[0-9]{8}T[0-9]{12}Z-[0-9a-f]{8}\.db")
    for candidate in backup_dir.iterdir():
        if candidate != keep and candidate.is_file() and not candidate.is_symlink() and own_name.fullmatch(candidate.name):
            candidate.unlink()


def _make_backup(conn: sqlite3.Connection, database: Database, version: int,
                 now: Callable[[], datetime]) -> Path:
    _private_directory(database.backup_dir)
    destination = database.backup_dir / _backup_name(version, now)
    temporary: Path | None = None
    try:
        # SQLite online backup reads a consistent snapshot; checkpoint first as required.
        checkpoint = conn.execute("PRAGMA wal_checkpoint(FULL)").fetchone()
        if checkpoint is None or checkpoint[0] != 0:
            raise StorageError("WAL 检查点被占用，未执行迁移；请关闭其他写入后重试。")
        with tempfile.NamedTemporaryFile(dir=database.backup_dir, prefix=".backup-", suffix=".db", delete=False) as f:
            temporary = Path(f.name)
        os.chmod(temporary, 0o600)
        backup_conn = sqlite3.connect(temporary)
        try:
            conn.backup(backup_conn)
        finally:
            backup_conn.close()
        os.replace(temporary, destination)
        temporary = None
        _prune_own_backups(database.backup_dir, destination)
        return destination
    except (sqlite3.Error, OSError) as exc:
        raise StorageError("迁移前备份失败，未执行迁移；请检查 backups/ 与磁盘空间。") from exc
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def initialize_database(database: Database, *, migrations: Sequence[Migration] = MIGRATIONS,
                        now: Callable[[], datetime] = lambda: datetime.now(timezone.utc)) -> MigrationResult:
    """Create/open, check, back up, then atomically apply pending migrations."""
    _validate_plan(migrations)
    database._prepare_file()
    with database.connection() as conn:
        current = database.self_check(conn)
        target = len(migrations)
        if current > target:
            raise MigrationError("数据库版本高于当前程序，已停止启动；请使用对应版本程序，勿覆盖原库。")
        pending = tuple(m for m in migrations if m.version > current)
        if not pending:
            return MigrationResult(current, target, (), None)
        backup_path = _make_backup(conn, database, current, now)
        failed_version = pending[0].version
        try:
            with transaction(conn):
                actual_version = int(conn.execute("PRAGMA user_version").fetchone()[0])
                if actual_version != current:
                    raise MigrationError(
                        "备份后数据库版本发生变化，已停止本次迁移；请重新启动并检查 backups/。"
                    )
                session = MigrationSession(conn)
                for migration in pending:
                    failed_version = migration.version
                    migration.apply(session)
                    if not conn.in_transaction:
                        raise MigrationError("迁移提前结束了事务，已停止启动；请检查迁移代码。")
                    conn.execute(f"PRAGMA user_version = {migration.version}")
        except MigrationError:
            raise
        except BaseException as exc:
            raise MigrationError(
                f"数据库迁移 V{failed_version} 失败，已停止启动；原库未删除。"
                "请检查 backups/ 中的迁移前备份，修复原因后重试；不要自动重建数据库。"
            ) from exc
        final = database.self_check(conn)
        if final != target:
            raise MigrationError("迁移后版本核验失败，已停止启动；请检查 backups/ 中的备份。")
        return MigrationResult(current, target, tuple(m.version for m in pending), backup_path)
