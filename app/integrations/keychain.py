"""macOS Keychain secret store. Secret values never leave this adapter."""

import subprocess

from app.core.errors import ApplicationError

SERVICE = "SceneLingo.Qwen"
ACCOUNT = "default"


class MacOSKeychain:
    def __init__(self, backend=None, status_runner=subprocess.run):
        self._backend = backend
        self._status_runner = status_runner

    def _keyring(self):
        if self._backend is not None:
            return self._backend
        try:
            import keyring
        except ImportError as exc:
            raise ApplicationError("keychain_unavailable", "macOS Keychain 组件不可用。", status_code=503) from exc
        return keyring

    def configured(self) -> bool:
        if self._backend is None:
            # Metadata-only lookup: omitting -w never retrieves password data and avoids an ACL prompt.
            result = self._status_runner(
                ["/usr/bin/security", "find-generic-password", "-a", ACCOUNT, "-s", SERVICE],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
            )
            return result.returncode == 0
        try:
            return bool(self._keyring().get_password(SERVICE, ACCOUNT))
        except Exception as exc:
            raise ApplicationError("keychain_access_denied", "macOS Keychain 未授权访问，请在系统提示中选择允许。", status_code=503) from exc

    def read(self) -> str:
        try:
            value = self._keyring().get_password(SERVICE, ACCOUNT)
        except Exception as exc:
            raise ApplicationError("keychain_access_denied", "macOS Keychain 未授权访问，请在系统提示中选择允许。", status_code=503) from exc
        if not value:
            raise ApplicationError("api_key_not_configured", "请先在设置中配置千问 API Key。", status_code=409)
        return value

    def write(self, value: str) -> None:
        if not value or len(value) > 500 or any(ch.isspace() for ch in value):
            raise ApplicationError("api_key_invalid", "API Key 格式无效。")
        try:
            self._keyring().set_password(SERVICE, ACCOUNT, value)
        except Exception as exc:
            raise ApplicationError("keychain_access_denied", "无法写入 macOS Keychain，请在系统提示中选择允许。", status_code=503) from exc

    def delete(self) -> None:
        try:
            self._keyring().delete_password(SERVICE, ACCOUNT)
        except Exception as exc:
            if exc.__class__.__name__ != "PasswordDeleteError":
                raise ApplicationError("keychain_unavailable", "无法访问 macOS Keychain。", status_code=503) from exc
