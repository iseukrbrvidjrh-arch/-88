"""Local browser-only V0.2 mock server; never contacts Qwen."""

from pathlib import Path
import os

from app.core.config import Settings
from app.core.errors import ApplicationError
from app.main import create_app


class Secrets:
    def configured(self): return True
    def read(self): return "test-only-key"
    def write(self, _value): return None
    def delete(self): return None


class Gateway:
    def __init__(self): self.calls = 0
    def stream_complete(self, **_kwargs):
        self.calls += 1
        if self.calls == 4:
            raise ApplicationError("ai_timeout", "模拟超时，未自动重试。", status_code=504)
        text = "第一轮：注意时态和语境。" if self.calls == 1 else "继续追问：这个表达在口语中很自然。"
        yield {"type": "delta", "text": text}
        yield {"type": "done", "model": "qwen3.8-max", "input_tokens": 20,
               "output_tokens": 10, "finish_reason": "length" if self.calls == 3 else "stop"}


app = create_app(
    Settings(port=18774, data_dir=Path(os.environ["SCENELINGO_V02_MOCK_DATA"])),
    secret_store=Secrets(), qwen_gateway=Gateway(),
)
