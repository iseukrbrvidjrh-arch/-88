"""Immutable in-memory cloud send plans and execution service."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal, ROUND_UP
import hashlib
import json
import secrets
import threading
from uuid import uuid4

from app.core.errors import ApplicationError
from app.repositories.ai import AiRepository
from app.repositories.database import transaction

PROMPT_VERSION = "task010-v1"
PLAN_TTL = timedelta(minutes=5)
KINDS = {"translation":"sentence_translation", "definition":"word_definition", "context_explanation":"context_explanation"}
INSTRUCTIONS = {
    "translation": "将下列英文准确翻译成简体中文，只返回译文。",
    "definition": "用简体中文解释下列英语词汇在给定语境中的含义，简洁并标明词性。",
    "context_explanation": "用简体中文解释目标表达在当前语境中的含义、语气和必要语法。",
}
# qwen3.8-max public list price checked 2026-10-30; CNY / 1M tokens.
PRICE_VERSION = "aliyun-qwen3.8-max-2026-10-30"
INPUT_PRICE = Decimal("12")
OUTPUT_PRICE = Decimal("36")


@dataclass(frozen=True)
class Plan:
    id: str; token_hash: str; kind: str; text: str; context: str
    target_language: str; model: str; messages_json: str
    content_hash: str; created_at: datetime; expires_at: datetime
    metadata_json: str = "{}"


class SendPlanService:
    def __init__(self, database, gateway, secrets_store, *, model, clock):
        self.database=database; self.gateway=gateway; self.secret_store=secrets_store
        self.model=model; self.clock=clock; self._plans={}; self._lock=threading.Lock()

    def _settings(self):
        with self.database.connection() as conn:
            repo=AiRepository(conn)
            return repo.setting("cloud.enabled") == "true", bool(repo.setting("cloud.consent_accepted_at")), repo.setting("cloud.model_id") or self.model

    def status(self):
        enabled, consent, model=self._settings()
        return {"key_status":"configured" if self.secret_store.configured() else "not_configured",
                "cloud_enabled":enabled,"consent_accepted":consent,"model":model}

    def configure(self, *, enabled=None, consent=None, model=None):
        now=self.clock().isoformat()
        if model is not None and (not model or len(model)>100 or any(ch.isspace() for ch in model)):
            raise ApplicationError("model_invalid","模型标识无效。")
        with self.database.connection() as conn, transaction(conn):
            repo=AiRepository(conn)
            if enabled is not None: repo.set_setting("cloud.enabled","true" if enabled else "false",now)
            if consent is True: repo.set_setting("cloud.consent_accepted_at",now,now)
            if consent is False: repo.set_setting("cloud.consent_accepted_at","",now)
            if model is not None: repo.set_setting("cloud.model_id",model,now)
        return self.status()

    def create(self, kind, text, context=""):
        if kind not in KINDS: raise ApplicationError("ai_kind_invalid","不支持的 AI 任务类型。")
        text=" ".join(text.split()); context=" ".join(context.split())
        if not text or len(text)>4000 or len(context)>4000: raise ApplicationError("ai_input_invalid","发送文本为空或过长。")
        user=text if not context else f"目标：{text}\n当前语境：{context}"
        messages=[{"role":"system","content":INSTRUCTIONS[kind]},{"role":"user","content":user}]
        return self.create_messages(kind,text,messages,context=context,history_count=0,attachments=[])

    def create_messages(self,kind,text,messages,*,context="",history_count=0,attachments=None,metadata=None):
        if kind!="chat" and kind not in KINDS: raise ApplicationError("ai_kind_invalid","不支持的 AI 任务类型。")
        enabled,consent,model=self._settings()
        if not enabled: raise ApplicationError("cloud_disabled","云端功能已关闭。",status_code=409)
        if not consent: raise ApplicationError("cloud_consent_required","请先阅读数据边界并同意云端发送。",status_code=409)
        if not self.secret_store.configured(): raise ApplicationError("api_key_not_configured","请先配置千问 API Key。",status_code=409)
        snapshot=json.dumps(messages,ensure_ascii=False,separators=(",",":"))
        now=self.clock(); token=secrets.token_urlsafe(32); pid=uuid4().hex
        digest=hashlib.sha256(snapshot.encode()).hexdigest()
        plan=Plan(pid,hashlib.sha256(token.encode()).hexdigest(),kind,text,context,"zh-CN",model,snapshot,digest,now,now+PLAN_TTL,
                  json.dumps(metadata or {},ensure_ascii=False,separators=(",",":")))
        with self._lock: self._plans[pid]=plan
        return {"plan_id":pid,"execution_token":token,"expires_at":plan.expires_at.isoformat(),"destination":"千问 API",
                "model":model,"history_count":history_count,"attachments":attachments or [],"actual_content":messages,"content_hash":digest,
                "estimated_cost_notice":"实际费用以供应商账单为准；成功后按 usage 或字符估算。"}

    def consume(self,plan_id,token):
        with self._lock: plan=self._plans.pop(plan_id,None)
        if plan is None: raise ApplicationError("send_plan_used_or_missing","发送计划不存在或已使用。",status_code=409)
        if not secrets.compare_digest(plan.token_hash,hashlib.sha256(token.encode()).hexdigest()):
            raise ApplicationError("send_plan_token_invalid","发送计划令牌无效。",status_code=409)
        if self.clock()>plan.expires_at: raise ApplicationError("send_plan_expired","发送计划已过期，请重新预览。",status_code=409)
        if hashlib.sha256(plan.messages_json.encode()).hexdigest()!=plan.content_hash:
            raise ApplicationError("send_plan_changed","发送计划已改变，请重新预览。",status_code=409)
        return plan,json.loads(plan.messages_json),json.loads(plan.metadata_json)

    def execute(self, plan_id, token):
        plan,messages,_=self.consume(plan_id,token)
        cache_key=self._cache_key(plan)
        with self.database.connection() as conn:
            cached=AiRepository(conn).cached(cache_key)
        if cached:
            return {"result":cached[0],"source":"local_cache","model":cached[1],"source_time":cached[2],"cost":None}
        key=self.secret_store.read(); request_id=uuid4().hex
        try:
            result=self.gateway.complete(api_key=key,model=plan.model,messages=messages)
        except ApplicationError:
            # The attempt is auditable, but no supplier usage is assumed when none was returned.
            now=self.clock().isoformat()
            with self.database.connection() as conn, transaction(conn):
                AiRepository(conn).add_cost((request_id,plan.kind,plan.model,None,None,None,
                    None,"CNY",PRICE_VERSION,"failed",now))
            raise
        now=self.clock().isoformat(); inp=result.input_tokens; out=result.output_tokens
        usage_source="api" if inp is not None and out is not None else "estimated_chars"
        if usage_source=="estimated_chars": inp=max(1,len(plan.messages_json)//4); out=max(1,len(result.text)//2)
        cost=((Decimal(inp)*INPUT_PRICE+Decimal(out)*OUTPUT_PRICE)/Decimal(1_000_000)).quantize(Decimal("0.000001"),rounding=ROUND_UP)
        with self.database.connection() as conn, transaction(conn):
            repo=AiRepository(conn)
            repo.cache((cache_key,KINDS[plan.kind],plan.text,self._context_hash(plan.context),plan.target_language,
                        result.text,result.model,PROMPT_VERSION,now,now))
            repo.add_cost((request_id,plan.kind,result.model,result.input_tokens,result.output_tokens,usage_source,
                           str(cost),"CNY",PRICE_VERSION,"success",now))
        return {"result":result.text,"source":"qwen_api","model":result.model,"source_time":now,
                "cost":{"request_id":request_id,"estimated_cost":str(cost),"currency":"CNY","usage_source":usage_source,"price_version":PRICE_VERSION}}

    def _context_hash(self, context): return hashlib.sha256(context.encode()).hexdigest() if context else ""
    def _cache_key(self, plan):
        material="\x1f".join((KINDS[plan.kind],plan.text.casefold(),self._context_hash(plan.context),plan.target_language,plan.model,PROMPT_VERSION))
        return hashlib.sha256(material.encode()).hexdigest()
