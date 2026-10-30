"""The application's only cloud HTTP exit."""

from dataclasses import dataclass
import json
import socket
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import httpx

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

    def stream_complete(self, *, api_key: str, model: str, messages: list[dict[str, str]]):
        """Yield text deltas and one final usage event; closing the iterator closes HTTP."""
        payload={"model":model,"messages":messages,"max_tokens":self.max_output_tokens,"stream":True,
                 "stream_options":{"include_usage":True}}
        headers={"Authorization":f"Bearer {api_key}","Content-Type":"application/json","Accept":"text/event-stream"}
        try:
            with httpx.Client(timeout=self.timeout) as client:
                with client.stream("POST",self.endpoint,json=payload,headers=headers) as response:
                    if response.status_code==429:
                        raise ApplicationError("ai_rate_limited","千问请求受到限流，请稍后手动重试。",status_code=503)
                    if response.status_code in (401,403):
                        raise ApplicationError("ai_auth_failed","千问认证失败，请检查 Key 与服务地址。",status_code=502)
                    if response.status_code>=400:
                        raise ApplicationError("ai_upstream_error","千问服务暂时不可用。",status_code=502)
                    total=0; input_tokens=None; output_tokens=None; actual_model=model; finish_reason=None
                    for line in response.iter_lines():
                        if not line or not line.startswith("data:"): continue
                        data=line[5:].strip()
                        if data=="[DONE]": break
                        total+=len(data.encode())
                        if total>self.max_response_bytes:
                            raise ApplicationError("ai_response_too_large","千问响应超过安全限制。",status_code=502)
                        try: event=json.loads(data)
                        except json.JSONDecodeError:
                            raise ApplicationError("ai_invalid_response","千问流式响应无法解析。",status_code=502) from None
                        actual_model=event.get("model") or actual_model
                        usage=event.get("usage") or {}
                        input_tokens=usage.get("prompt_tokens",input_tokens)
                        output_tokens=usage.get("completion_tokens",output_tokens)
                        choices=event.get("choices") or []
                        if choices:
                            finish_reason=choices[0].get("finish_reason") or finish_reason
                            delta=(choices[0].get("delta") or {}).get("content")
                            if delta: yield {"type":"delta","text":delta}
                    if actual_model!=model:
                        raise ApplicationError("ai_model_mismatch","千问返回的模型与已确认模型不一致，结果未采用。",status_code=502)
                    yield {"type":"done","model":actual_model,"input_tokens":input_tokens,"output_tokens":output_tokens,
                           "finish_reason":finish_reason}
        except ApplicationError:
            raise
        except httpx.TimeoutException:
            raise ApplicationError("ai_timeout","千问请求超时，未自动重试。",status_code=504) from None
        except httpx.RequestError:
            raise ApplicationError("ai_offline","无法连接千问；本地功能仍可使用。",status_code=503) from None
