"""One explicitly authorized TASK-010 live call followed by an offline cache check."""

from datetime import datetime
import json
from pathlib import Path
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import load_settings
from app.core.errors import ApplicationError
from app.integrations.keychain import MacOSKeychain
from app.integrations.qwen_gateway import QwenGateway
from app.repositories.ai import AiRepository
from app.repositories.database import Database
from app.repositories.migrations.runner import initialize_database
from app.services.ai_send_plan import SendPlanService


TEST_TEXT = "Although the rain had stopped, the old cinema still smelled faintly of wet stone and coffee."


def main() -> None:
    settings = load_settings()
    secret_store = MacOSKeychain()
    if not secret_store.configured():
        raise SystemExit("Keychain is not configured")
    with tempfile.TemporaryDirectory(prefix="scenelingo-task010-live-") as directory:
        database = Database(Path(directory) / "scenelingo.db")
        initialize_database(database)
        gateway = QwenGateway(settings.qwen_base_url, settings.qwen_timeout_seconds,
                              settings.qwen_max_output_tokens, settings.qwen_max_response_bytes)
        service = SendPlanService(database, gateway, secret_store,
                                  model=settings.qwen_model,
                                  clock=lambda: datetime.now().astimezone())
        service.configure(enabled=True, consent=True)
        preview = service.create("translation", TEST_TEXT)
        if preview["actual_content"][1]["content"] != TEST_TEXT:
            raise SystemExit("preview mismatch; request stopped")
        try:
            first = service.execute(preview["plan_id"], preview["execution_token"])
        except ApplicationError as exc:
            with database.connection() as connection:
                costs = AiRepository(connection).costs()
            print(json.dumps({
                "sent_text": TEST_TEXT,
                "destination": preview["destination"],
                "requested_model": preview["model"],
                "status": "failed",
                "error_code": exc.code,
                "message": exc.message,
                "cost_record_count": len(costs),
                "recorded_status": costs[0][9] if costs else None,
                "recorded_estimated_cost": costs[0][6] if costs else None,
            }, ensure_ascii=False, indent=2))
            return
        cached_preview = service.create("translation", TEST_TEXT)
        second = service.execute(cached_preview["plan_id"], cached_preview["execution_token"])
        with database.connection() as connection:
            costs = AiRepository(connection).costs()
            cache_count = connection.execute("SELECT count(*) FROM ai_cache").fetchone()[0]
        report = {
            "sent_text": TEST_TEXT,
            "destination": preview["destination"],
            "requested_model": preview["model"],
            "first_result": first,
            "second_source": second["source"],
            "cache_count": cache_count,
            "cost_record_count": len(costs),
            "recorded_usage": {
                "input_tokens": costs[0][3], "output_tokens": costs[0][4],
                "usage_source": costs[0][5], "estimated_cost": costs[0][6],
                "currency": costs[0][7], "price_version": costs[0][8],
                "status": costs[0][9],
            },
        }
        print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
