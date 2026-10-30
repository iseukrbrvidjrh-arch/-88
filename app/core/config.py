"""Validated local-only runtime configuration."""

from dataclasses import dataclass
import os
from pathlib import Path
import tempfile


DEFAULT_PORT = 8765
DEFAULT_DATA_DIR = Path.home() / "Library" / "Application Support" / "SceneLingo"
DEFAULT_QWEN_MODEL = "qwen3.8-max"
DEFAULT_QWEN_BASE_URL = "https://maas.qianwenaiapi.com/compatible-mode/v1"


class ConfigError(ValueError):
    """A setting or local data directory cannot be used safely."""


@dataclass(frozen=True)
class Settings:
    port: int = DEFAULT_PORT
    data_dir: Path = DEFAULT_DATA_DIR
    db_path: Path | None = None
    log_level: str = "INFO"
    qwen_model: str = DEFAULT_QWEN_MODEL
    qwen_base_url: str = DEFAULT_QWEN_BASE_URL
    qwen_timeout_seconds: float = 30.0
    qwen_max_output_tokens: int = 800
    qwen_max_response_bytes: int = 1_000_000

    def __post_init__(self) -> None:
        if isinstance(self.port, bool) or not isinstance(self.port, int) or not 1 <= self.port <= 65535:
            raise ConfigError("端口必须是 1–65535 之间的整数。")
        if not isinstance(self.log_level, str) or self.log_level.upper() not in {"DEBUG", "INFO", "WARNING", "ERROR"}:
            raise ConfigError("日志级别必须是 DEBUG、INFO、WARNING 或 ERROR。")
        object.__setattr__(self, "log_level", self.log_level.upper())
        if not self.qwen_model or len(self.qwen_model) > 100:
            raise ConfigError("千问模型标识无效。")
        if not self.qwen_base_url.startswith("https://") or not self.qwen_base_url.rstrip("/").endswith("/compatible-mode/v1"):
            raise ConfigError("千问 API 地址必须是 HTTPS 的 compatible-mode/v1 地址。")
        if not 1 <= self.qwen_timeout_seconds <= 120:
            raise ConfigError("千问超时必须为 1–120 秒。")
        if not 1 <= self.qwen_max_output_tokens <= 4096:
            raise ConfigError("千问输出限制必须为 1–4096 token。")
        if not 1024 <= self.qwen_max_response_bytes <= 10_000_000:
            raise ConfigError("千问响应大小限制无效。")
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
    try:
        timeout = float(os.environ.get("SCENELINGO_QWEN_TIMEOUT", "30"))
        max_tokens = int(os.environ.get("SCENELINGO_QWEN_MAX_OUTPUT_TOKENS", "800"))
        max_bytes = int(os.environ.get("SCENELINGO_QWEN_MAX_RESPONSE_BYTES", "1000000"))
    except ValueError as exc:
        raise ConfigError("千问数值配置无效。") from exc
    return Settings(port=parsed_port, data_dir=resolved_dir, db_path=resolved_db,
                    log_level=raw_level.upper(),
                    qwen_model=os.environ.get("SCENELINGO_QWEN_MODEL", DEFAULT_QWEN_MODEL),
                    qwen_base_url=os.environ.get("SCENELINGO_QWEN_BASE_URL", DEFAULT_QWEN_BASE_URL),
                    qwen_timeout_seconds=timeout, qwen_max_output_tokens=max_tokens,
                    qwen_max_response_bytes=max_bytes)


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
