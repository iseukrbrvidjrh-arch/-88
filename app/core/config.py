"""Validated local-only runtime configuration."""

from dataclasses import dataclass
import os
from pathlib import Path
import tempfile


DEFAULT_PORT = 8765
DEFAULT_DATA_DIR = Path.home() / "Library" / "Application Support" / "SceneLingo"


class ConfigError(ValueError):
    """A setting or local data directory cannot be used safely."""


@dataclass(frozen=True)
class Settings:
    port: int = DEFAULT_PORT
    data_dir: Path = DEFAULT_DATA_DIR
    db_path: Path | None = None
    log_level: str = "INFO"

    def __post_init__(self) -> None:
        if isinstance(self.port, bool) or not isinstance(self.port, int) or not 1 <= self.port <= 65535:
            raise ConfigError("端口必须是 1–65535 之间的整数。")
        if not isinstance(self.log_level, str) or self.log_level.upper() not in {"DEBUG", "INFO", "WARNING", "ERROR"}:
            raise ConfigError("日志级别必须是 DEBUG、INFO、WARNING 或 ERROR。")
        object.__setattr__(self, "log_level", self.log_level.upper())
        if not isinstance(self.data_dir, Path):
            raise ConfigError("数据目录必须是有效路径。")
        if not self.data_dir.is_absolute():
            object.__setattr__(self, "data_dir", self.data_dir.absolute())
        if self.db_path is not None:
            if not isinstance(self.db_path, Path):
                raise ConfigError("数据库路径必须是有效路径。")
            if not self.db_path.is_absolute():
                object.__setattr__(self, "db_path", self.data_dir / self.db_path)

    @property
    def database_path(self) -> Path:
        return self.db_path if self.db_path is not None else self.data_dir / "scenelingo.db"


def load_settings(*, port: str | None = None, data_dir: str | None = None,
                  db_path: str | None = None, log_level: str | None = None) -> Settings:
    """Load CLI values first, then environment, then safe defaults."""
    raw_port = port if port is not None else os.environ.get("SCENELINGO_PORT", str(DEFAULT_PORT))
    try:
        parsed_port = int(raw_port)
    except (TypeError, ValueError) as exc:
        raise ConfigError("端口必须是 1–65535 之间的整数。") from exc
    raw_dir = data_dir if data_dir is not None else os.environ.get("SCENELINGO_DATA_DIR")
    resolved_dir = Path(raw_dir).expanduser().absolute() if raw_dir else DEFAULT_DATA_DIR
    raw_db = db_path if db_path is not None else os.environ.get("SCENELINGO_DB_PATH")
    resolved_db = Path(raw_db).expanduser() if raw_db else None
    raw_level = log_level if log_level is not None else os.environ.get("SCENELINGO_LOG_LEVEL", "INFO")
    return Settings(port=parsed_port, data_dir=resolved_dir, db_path=resolved_db,
                    log_level=raw_level.upper())


def prepare_data_dir(data_dir: Path) -> Path:
    """Create private directories and prove the data directory is writable."""
    try:
        for directory in (data_dir, data_dir / "logs"):
            if directory.is_symlink():
                raise ConfigError("数据目录或日志目录不能是符号链接。")
            directory.mkdir(mode=0o700, parents=True, exist_ok=True)
            if not directory.is_dir():
                raise ConfigError("数据目录或日志目录不是文件夹。")
            directory.chmod(0o700)
        with tempfile.NamedTemporaryFile(dir=data_dir, prefix=".write-check-", delete=True):
            pass
    except ConfigError:
        raise
    except OSError as exc:
        raise ConfigError("数据目录不可写或无法创建，请检查路径和权限。") from exc
    return data_dir
