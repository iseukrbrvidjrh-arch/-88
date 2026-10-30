"""TASK-009 offline IPA and safe macOS TTS tests."""

from pathlib import Path
import threading

import pytest
from fastapi.testclient import TestClient

from app.core.errors import ApplicationError
from app.integrations.ipa_dictionary import LocalIpaDictionary
from app.integrations.macos_tts import MacOSTTS
from app.services.pronunciation import pronunciation
from app.services.speech import speak,speech_text,stop
from app.core.config import Settings
from app.main import create_app

IPA=Path(__file__).parents[1]/"app/data/ipa/en_US.txt"

class FakeProcess:
    def __init__(self,events): self.events=events; self.done=threading.Event(); self.terminated=False
    def poll(self): return 0 if self.done.is_set() else None
    def terminate(self): self.events.append("terminate"); self.terminated=True; self.done.set()
    def kill(self): self.events.append("kill"); self.done.set()
    def wait(self,timeout=None):
        if not self.done.wait(timeout):
            import subprocess; raise subprocess.TimeoutExpired("fake",timeout)
        return 0

def fake_tts(tmp_path):
    events=[]; processes=[]
    def run(argv,**kwargs):
        events.append(argv)
        if argv[0]=="say": Path(argv[argv.index("-o")+1]).write_bytes(b"aiff")
        if argv[0]=="afconvert": Path(argv[-1]).write_bytes(b"caf")
    def popen(argv,**kwargs):
        events.append(argv); process=FakeProcess(events); processes.append(process); return process
    tts=MacOSTTS(tmp_path,popen=popen,run=run); tts._voice="Samantha"; tts.available=lambda:True
    return tts,events,processes

def test_dictionary_counts_hash_and_general_american_hits():
    dictionary=LocalIpaDictionary(IPA)
    assert dictionary.statistics()==(125927,125927)
    assert dictionary.lookup("hello")[0].startswith("/hə")
    assert len(dictionary.lookup("record"))>=2
    assert dictionary.lookup("Mr.") and dictionary.lookup("U.S.")
    assert dictionary.lookup("definitely-not-a-real-word-xyz")==()

def test_possessive_fallback_and_missing_semantics():
    dictionary=LocalIpaDictionary(IPA)
    assert dictionary.lookup("hello's")==dictionary.lookup("hello")
    missing=pronunciation(dictionary,"zzzzunknown")
    assert missing["found"] is False and missing["display"]=="本地未收录" and missing["pronunciations"]==[]

def test_command_arguments_are_safe_and_never_shell_strings(tmp_path):
    tts,events,processes=fake_tts(tmp_path)
    speak(tts,'He said "hi"; $(touch /tmp/bad)',"sentence")
    say=events[0]
    assert say[:6]==["say","-v","Samantha","-o",say[4],"--"]
    assert say[-1]=='He said "hi"; $(touch /tmp/bad)'
    assert all(isinstance(event,list) for event in events)
    processes[0].done.set()
    with pytest.raises(ApplicationError) as caught: tts.speak("-v Evil")
    assert caught.value.code=="tts_text_invalid"

def test_new_play_stops_old_and_repeated_stop_is_safe(tmp_path):
    tts,events,processes=fake_tts(tmp_path)
    first=speak(tts,"hello","word"); second=speak(tts,"world","word")
    assert first["status"]==second["status"]=="playing" and processes[0].terminated
    assert stop(tts)=={"status":"stopped","was_playing":True}
    assert stop(tts)=={"status":"stopped","was_playing":False}

def test_temporary_files_cleaned_on_stop_and_failure(tmp_path):
    tts,_,_=fake_tts(tmp_path); speak(tts,"hello","word"); assert list(tmp_path.iterdir())
    tts.stop(); assert list(tmp_path.iterdir())==[]
    def failing(argv,**kwargs): raise OSError("injected")
    broken=MacOSTTS(tmp_path,run=failing); broken._voice="Samantha"; broken.available=lambda:True
    with pytest.raises(ApplicationError): broken.speak("hello")
    assert list(tmp_path.iterdir())==[]

def test_unavailable_voice_and_sentence_cleaning(tmp_path):
    tts=MacOSTTS(tmp_path); tts.available=lambda:False
    with pytest.raises(ApplicationError) as caught: tts.speak("hello")
    assert caught.value.code=="tts_unavailable"
    assert speech_text("[MUSIC] JOHN: Hello\nworld","sentence")=="Hello world"

def test_original_subtitle_token_coverage_is_measured():
    dictionary=LocalIpaDictionary(IPA); tokens=["i","don't","think","it's","well-known","go","hello","mr","smith's","trip"]
    covered=[token for token in tokens if dictionary.lookup(token)]
    assert len(covered)==10 and set(tokens)-set(covered)==set()

def test_no_network_client_in_ipa_or_tts_modules():
    sources=(Path(__file__).parents[1]/"app/integrations/ipa_dictionary.py").read_text()+ (Path(__file__).parents[1]/"app/integrations/macos_tts.py").read_text()
    assert "http" not in sources and "requests" not in sources and "urlopen" not in sources

def test_pronunciation_and_capabilities_api_are_local(tmp_path):
    app=create_app(Settings(data_dir=tmp_path/"data"))
    with TestClient(app,base_url="http://127.0.0.1:8765") as client:
        h={"Origin":"http://127.0.0.1:8765","X-SceneLingo-Token":client.app.state.token}
        hit=client.get("/api/v1/pronunciation?word=record",headers=h).json()
        assert hit["found"] and len(hit["pronunciations"])>=2 and hit["accent"]=="General American"
        miss=client.get("/api/v1/pronunciation?word=zzzzunknown",headers=h).json()
        assert miss["display"]=="本地未收录"
        capabilities=client.get("/api/v1/speech/capabilities",headers=h).json()
        assert capabilities["engine"]=="macOS say/afconvert/afplay"
