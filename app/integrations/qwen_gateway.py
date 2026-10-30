"""The application's only cloud HTTP exit."""

from dataclasses import dataclass
import json
import socket
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from app.core.errors import ApplicationError


@dataclass(frozen=True)
class GatewayResult:
    text: str
    model: str
    input_tokens: int | None
    output_tokens: int | None


class QwenGateway:
    def __init__(self, base_url: str, timeout: float, max_output_tokens: int,
                 max_response_bytes: int, opener=urlopen):
        self.endpoint = base_url.rstrip("/") + "/chat/completions"
        self.timeout = timeout
        self.max_output_tokens = max_output_tokens
        self.max_response_bytes = max_response_bytes
        self._opener = opener

    def complete(self, *, api_key: str, model: str, messages: list[dict[str, str]]) -> GatewayResult:
        payload = json.dumps({"model": model, "messages": messages,
                              "max_tokens": self.max_output_tokens,
                              "stream": False}, ensure_ascii=False).encode()
        request = Request(self.endpoint, data=payload, method="POST", headers={
            "Authorization": f"Bearer {api_key}", "Content-Type": "application/json",
            "Accept": "application/json",
        })
        try:
            with self._opener(request, timeout=self.timeout) as response:
                raw = response.read(self.max_response_bytes + 1)
                if len(raw) > self.max_response_bytes:
                    raise ApplicationError("ai_response_too_large", "千问响应超过安全限制。", status_code=502)
        except HTTPError as exc:
            if exc.code == 429:
                raise ApplicationError("ai_rate_limited", "千问请求受到限流，请稍后手动重试。", status_code=503) from None
            if exc.code in (400, 403) and "content" in str(exc.reason).lower():
                raise ApplicationError("ai_content_rejected", "千问拒绝了本次内容。", status_code=502) from None
            if exc.code in (401, 403):
                raise ApplicationError("ai_auth_failed", "千问认证失败，请检查 Key 与区域。", status_code=502) from None
            raise ApplicationError("ai_upstream_error", "千问服务暂时不可用。", status_code=502) from None
        except (TimeoutError, socket.timeout):
            raise ApplicationError("ai_timeout", "千问请求超时，未自动重试。", status_code=504) from None
        except (URLError, OSError):
            raise ApplicationError("ai_offline", "无法连接千问；本地功能仍可使用。", status_code=503) from None
        try:
            body = json.loads(raw)
            text = body["choices"][0]["message"]["content"]
            actual_model = body.get("model") or model
            usage = body.get("usage") or {}
            if not isinstance(text, str) or not text.strip() or not isinstance(actual_model, str):
                raise ValueError
            if actual_model != model:
                raise ApplicationError("ai_model_mismatch", "千问返回的模型与已确认模型不一致，结果未采用。", status_code=502)
            inp = usage.get("prompt_tokens")
            out = usage.get("completion_tokens")
            if inp is not None and (not isinstance(inp, int) or inp < 0): raise ValueError
            if out is not None and (not isinstance(out, int) or out < 0): raise ValueError
            return GatewayResult(text.strip(), actual_model, inp, out)
        except ApplicationError:
            raise
        except (KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError):
            raise ApplicationError("ai_invalid_response", "千问返回格式异常。", status_code=502) from None
