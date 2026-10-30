"""Explicit local speech use cases and sentence cleaning."""

import re
from app.integrations.macos_tts import MacOSTTS

_BRACKETED = re.compile(r"\[[^\]]*\]")
_SPEAKER = re.compile(r"^\s*[A-Z][A-Z ]{1,19}:\s*")

def speech_text(text: str, target: str) -> str:
    if target == "word": return text.strip()
    if target != "sentence": return ""
    return " ".join(_SPEAKER.sub("", _BRACKETED.sub("", line)).strip() for line in text.splitlines() if _SPEAKER.sub("", _BRACKETED.sub("", line)).strip())

def speak(tts: MacOSTTS, text: str, target: str):
    prepared = speech_text(text, target)
    playback_id = tts.speak(prepared)
    return {"playback_id": playback_id, "status": "playing", "character_count": len(prepared)}

def stop(tts: MacOSTTS):
    return {"status": "stopped", "was_playing": tts.stop()}
