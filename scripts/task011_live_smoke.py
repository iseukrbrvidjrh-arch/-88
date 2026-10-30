"""Exactly two explicitly authorized TASK-011 live requests in an isolated database."""

from datetime import datetime
import json
from pathlib import Path
import sys
import tempfile

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))

from app.core.config import load_settings
from app.integrations.keychain import MacOSKeychain
from app.integrations.qwen_gateway import QwenGateway
from app.repositories.database import Database
from app.repositories.migrations.runner import initialize_database
from app.services.ai_send_plan import SendPlanService
from app.services.chat import ChatService

FIRST='In the original sentence “Mira had packed the lantern before the path disappeared into fog,” explain why the past perfect is used.'
SECOND='Now create one new sentence using the same tense contrast.'

def collect(events):
    text='';done=None;errors=[]
    for event in events:
        if event['event']=='delta':text+=event['data']['text']
        elif event['event']=='done':done=event['data']
        else:errors.append(event['data'])
    if errors or done is None: raise RuntimeError(json.dumps(errors,ensure_ascii=False))
    return text,done

def main():
    settings=load_settings(); secrets=MacOSKeychain()
    if settings.qwen_model!='qwen3.8-max': raise SystemExit('unexpected model')
    if settings.qwen_max_output_tokens>800: raise SystemExit('output limit exceeds authorization')
    with tempfile.TemporaryDirectory(prefix='scenelingo-task011-live-') as directory:
        database=Database(Path(directory)/'scenelingo.db');initialize_database(database)
        gateway=QwenGateway(settings.qwen_base_url,settings.qwen_timeout_seconds,settings.qwen_max_output_tokens,settings.qwen_max_response_bytes)
        plans=SendPlanService(database,gateway,secrets,model=settings.qwen_model,clock=lambda:datetime.now().astimezone())
        chat=ChatService(database,plans,gateway,secrets,lambda:datetime.now().astimezone())
        plans.configure(enabled=True,consent=True)
        conversation=chat.create_conversation('TASK-011 original two-turn acceptance')
        first_plan=chat.create_plan(conversation['id'],text=FIRST,template='grammar',history_count=0)
        assert first_plan['history_count']==0 and first_plan['attachments']==[]
        assert first_plan['actual_content'][-1]=={'role':'user','content':FIRST}
        first_text,first_done=collect(chat.stream(first_plan['plan_id'],first_plan['execution_token']))
        second_plan=chat.create_plan(conversation['id'],text=SECOND,template='rewrite',history_count=2)
        assert second_plan['history_count']==2 and second_plan['attachments']==[]
        assert second_plan['history'][0]['content']==FIRST
        assert second_plan['history'][1]['content']==first_text
        assert second_plan['actual_content'][-1]=={'role':'user','content':SECOND}
        second_text,second_done=collect(chat.stream(second_plan['plan_id'],second_plan['execution_token']))
        with database.connection() as conn:
            messages=conn.execute('SELECT role,status,content FROM ai_message ORDER BY sequence').fetchall()
            costs=conn.execute('SELECT input_tokens,output_tokens,usage_source,estimated_cost,currency,status FROM cost_record ORDER BY id').fetchall()
            contexts=conn.execute('SELECT ref_type,text_snapshot FROM ai_message_context ORDER BY id').fetchall()
            cache_count=conn.execute('SELECT count(*) FROM ai_cache').fetchone()[0]
        print(json.dumps({
            'model':settings.qwen_model,'base_url':settings.qwen_base_url,'cloud_request_count':2,
            'first':{'sent':FIRST,'response':first_text,'done':first_done},
            'second':{'sent':SECOND,'history_count':second_plan['history_count'],'history':second_plan['history'],'response':second_text,'done':second_done},
            'database':{'message_count':len(messages),'message_states':[[r[0],r[1]] for r in messages],
                        'context_types':[r[0] for r in contexts],'cost_records':[list(r) for r in costs],'ai_cache_count':cache_count}
        },ensure_ascii=False,indent=2))

if __name__=='__main__':main()
