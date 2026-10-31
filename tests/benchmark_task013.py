"""Repeatable local NFR-001 benchmark. Writes only to a temporary directory."""

from datetime import datetime,timezone
from pathlib import Path
import json
import platform
import statistics
import sys
import tempfile
from time import perf_counter

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.services.review import submit_review
from app.services.subtitle_import import import_subtitle
from app.services.vocabulary import add_word


def percentile(values,percent):
    ordered=sorted(values);index=max(0,min(len(ordered)-1,int(len(ordered)*percent)-1));return ordered[index]


def subtitle(cues=2000):
    blocks=[]
    for index in range(cues):
        start=index*2;end=start+1
        blocks.append(f"{index+1}\n{start//3600:02d}:{start//60%60:02d}:{start%60:02d},000 --> {end//3600:02d}:{end//60%60:02d}:{end%60:02d},000\nBright ideas remain useful number {index}")
    return "\n\n".join(blocks).encode()


def run():
    now=lambda:datetime(2026,10,30,12,tzinfo=timezone.utc)
    with tempfile.TemporaryDirectory(prefix="scenelingo-benchmark-") as raw:
        data_dir=Path(raw)/"data";settings=Settings(data_dir=data_dir)
        started=perf_counter()
        with TestClient(create_app(settings,clock=now),base_url="http://127.0.0.1:8765") as client:
            cold_start=perf_counter()-started;db=client.app.state.database
            payload=subtitle();started=perf_counter();result=import_subtitle(db,filename="benchmark.srt",data=payload,now=now);import_seconds=perf_counter()-started
            with db.connection() as conn: cue=conn.execute("SELECT id FROM cue ORDER BY sequence LIMIT 1").fetchone()[0]
            item=add_word(db,subtitle_id=result.subtitle.id,cue_id=cue,token_key="bright",now=now)["learning_item_id"]
            headers={"X-SceneLingo-Token":client.app.state.token}
            query=[]
            for _ in range(200):
                started=perf_counter();response=client.get("/api/v1/pronunciation?word=bright",headers=headers);query.append((perf_counter()-started)*1000);assert response.status_code==200
            saves=[]
            for index in range(100):
                started=perf_counter();submit_review(db,item_id=item,mode="spelling",user_input="bright",final_rating="good",attempt_token=f"bench-{index}",now=now);saves.append((perf_counter()-started)*1000)
        return {
            "machine":{"system":platform.system(),"release":platform.release(),"machine":platform.machine(),"python":platform.python_version()},
            "dataset":{"cue_count":2000,"bytes":len(payload)},
            "measurements":{"cold_start_seconds":round(cold_start,4),"import_seconds":round(import_seconds,4),
                "ipa_query_p95_ms":round(percentile(query,.95),3),"ipa_query_median_ms":round(statistics.median(query),3),
                "review_save_p95_ms":round(percentile(saves,.95),3),"review_save_median_ms":round(statistics.median(saves),3)},
            "targets":{"cold_start_seconds":5,"import_seconds":3,"ipa_query_p95_ms":200,"review_save_p95_ms":300},
        }


if __name__=="__main__": print(json.dumps(run(),ensure_ascii=False,indent=2))
