"""Private SQLite connection factory and explicit transaction boundary."""

from contextlib import contextmanager
import os
from pathlib import Path
import sqlite3
import stat
import tempfile
from typing import Iterator
from urllib.parse import quote


BUSY_TIMEOUT_MS = 5_000


class StorageError(RuntimeError):
    """Storage could not be opened or validated without risking existing data."""


class StorageBusyError(StorageError):
    """Another writer held the database longer than the configured wait."""


def _storage_error(exc: sqlite3.Error) -> StorageError:
    message = str(exc).lower()
    if "locked" in message or "busy" in message:
        return StorageBusyError("数据库正被其他写入占用，请稍后重试；原有数据未被清除。")
    return StorageError("数据库无法打开或读写。请检查权限与备份，勿删除原库。")


def _private_directory(path: Path) -> None:
    try:
        if path.is_symlink():
            raise StorageError("数据库或备份目录不能是符号链接。")
        if not path.exists():
            path.mkdir(mode=0o700, parents=True)
        if not path.is_dir():
            raise StorageError("数据库或备份目录不是文件夹。")
        if stat.S_IMODE(path.stat().st_mode) != 0o700:
            raise StorageError("数据库目录权限必须是 0700，请调整权限后重试。")
        with tempfile.NamedTemporaryFile(dir=path, prefix=".storage-check-", delete=True):
            pass
    except StorageError:
        raise
    except OSError as exc:
        raise StorageError("数据库目录不可写，请检查路径与权限；未创建新数据库。") from exc


class Database:
    """One connection per operation; no connection is shared across threads."""

    def __init__(self, path: Path, *, busy_timeout_ms: int = BUSY_TIMEOUT_MS):
        if not path.is_absolute():
            raise StorageError("数据库路径必须是绝对路径。")
        if isinstance(busy_timeout_ms, bool) or not isinstance(busy_timeout_ms, int) or busy_timeout_ms < 1:
            raise StorageError("数据库忙等待时间必须是正整数。")
        self.path = path
        self.backup_dir = path.parent / "backups"
        self.busy_timeout_ms = busy_timeout_ms

    def _prepare_file(self) -> None:
        _private_directory(self.path.parent)
        try:
            if self.path.is_symlink():
                raise StorageError("数据库文件不能是符号链接。")
            if self.path.exists():
                if not self.path.is_file():
                    raise StorageError("数据库路径不是普通文件。")
                if stat.S_IMODE(self.path.stat().st_mode) != 0o600:
                    raise StorageError("数据库文件权限必须是 0600，请恢复读写权限后重试。")
            else:
                flags = os.O_CREAT | os.O_EXCL | os.O_RDWR | os.O_NOFOLLOW
                fd = os.open(self.path, flags, 0o600)
                try:
                    os.fchmod(fd, 0o600)
                finally:
                    os.close(fd)
        except StorageError:
            raise
        except OSError as exc:
            raise StorageError("数据库文件不可写或无法创建，请检查权限；未覆盖原库。") from exc

    def open_connection(self) -> sqlite3.Connection:
        """Open an existing DB only, to avoid recreating a deleted database."""
        if self.path.is_symlink() or not self.path.is_file():
            raise StorageError("数据库文件不存在或不是普通文件；不会自动重建。")
        try:
            uri = f"file:{quote(str(self.path))}?mode=rw"
            conn = sqlite3.connect(uri, uri=True, timeout=self.busy_timeout_ms / 1000,
                                   isolation_level="DEFERRED")
            conn.execute("PRAGMA foreign_keys = ON")
            journal_mode = conn.execute("PRAGMA journal_mode = WAL").fetchone()[0]
            conn.execute(f"PRAGMA busy_timeout = {self.busy_timeout_ms}")
            if journal_mode.lower() != "wal" or conn.execute("PRAGMA foreign_keys").fetchone()[0] != 1:
                raise StorageError("数据库无法启用 WAL 或外键约束，已停止启动。")
            return conn
        except StorageError:
            if "conn" in locals():
                conn.close()
            raise
        except sqlite3.Error as exc:
            if "conn" in locals():
                conn.close()
            raise _storage_error(exc) from exc

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        conn = self.open_connection()
        try:
            yield conn
        finally:
            if conn.in_transaction:
                conn.rollback()
            conn.close()

    def self_check(self, conn: sqlite3.Connection) -> int:
        try:
            if conn.execute("SELECT 1").fetchone()[0] != 1:
                raise StorageError("数据库自检失败，已停止启动。")
            result = conn.execute("PRAGMA quick_check").fetchone()
            if result is None or result[0] != "ok":
                raise StorageError("数据库完整性检查失败，请检查 backups/ 中的备份；原库未被覆盖。")
            return int(conn.execute("PRAGMA user_version").fetchone()[0])
        except sqlite3.Error as exc:
            raise _storage_error(exc) from exc


@contextmanager
def transaction(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """Service-layer write boundary: commit once, or roll back every change."""
    if conn.in_transaction:
        raise StorageError("已有未完成事务，不能嵌套写事务。")
    try:
        conn.execute("BEGIN IMMEDIATE")
        yield conn
        conn.commit()
    except sqlite3.OperationalError as exc:
        if conn.in_transaction:
            conn.rollback()
        raise _storage_error(exc) from exc
    except BaseException:
        if conn.in_transaction:
            conn.rollback()
        raise
