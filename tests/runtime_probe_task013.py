"""Actual-process loopback, cold-start and local-TTS probe using isolated data."""

import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from time import perf_counter,sleep
from urllib.error import URLError
from urllib.request import Request,urlopen

ROOT=Path(__file__).resolve().parents[1];PORT=18769;BASE=f"http://127.0.0.1:{PORT}"

def fetch(path,*,method="GET",body=None,headers=None):
    request=Request(BASE+path,method=method,data=body,headers=headers or {})
    with urlopen(request,timeout=5) as response:return response.read().decode(),response.status

def run():
    with tempfile.TemporaryDirectory(prefix="scenelingo-runtime-") as raw:
        command=[str(ROOT/".venv/bin/python"),"-m","app.main","--port",str(PORT),"--data-dir",str(Path(raw)/"data")]
        started=perf_counter();process=subprocess.Popen(command,cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            for _ in range(100):
                try:
                    health,status=fetch("/api/v1/health")
                    if status==200:break
                except (OSError,URLError):sleep(.05)
            else:raise RuntimeError("health endpoint did not become ready")
            cold=perf_counter()-started
            page,_=fetch("/");token=re.search(r'name="scenelingo-token" content="([^"]+)"',page).group(1)
            payload=json.dumps({"text":"benchmark","target":"word"}).encode();headers={"Origin":BASE,"X-SceneLingo-Token":token,"Content-Type":"application/json"}
            tts_started=perf_counter();speech,status=fetch("/api/v1/speech/play",method="POST",body=payload,headers=headers);tts_seconds=perf_counter()-tts_started
            if status!=200:raise RuntimeError(speech)
            fetch("/api/v1/speech/stop",method="POST",body=b"{}",headers=headers)
            listeners=subprocess.run(["lsof","-nP",f"-iTCP:{PORT}","-sTCP:LISTEN"],capture_output=True,text=True).stdout
            return {"cold_start_to_health_seconds":round(cold,4),"tts_request_seconds":round(tts_seconds,4),
                "listener_loopback_only":f"127.0.0.1:{PORT}" in listeners and f"*:{PORT}" not in listeners,
                "health":json.loads(health)["status"]}
        finally:
            process.terminate()
            try:process.wait(timeout=5)
            except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)

if __name__=="__main__":print(json.dumps(run(),ensure_ascii=False,indent=2))
