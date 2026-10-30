"""Safe macOS local TTS process adapter; never invokes a shell."""

from pathlib import Path
import shutil
import subprocess
import threading
from uuid import uuid4

from app.core.errors import ApplicationError


class MacOSTTS:
    def __init__(self, temporary_dir: Path, *, popen=subprocess.Popen, run=subprocess.run):
        self.temporary_dir = temporary_dir
        self._popen = popen
        self._run = run
        self._lock = threading.Lock()
        self._process = None
        self._files: tuple[Path, ...] = ()
        self._voice: str | None = None

    def _english_voice(self) -> str | None:
        if self._voice:
            return self._voice
        try:
            result = self._run(["say", "-v", "?"], check=True, capture_output=True, text=True)
            candidates = [line.split()[0] for line in result.stdout.splitlines()
                          if len(line.split()) >= 2 and line.split()[1].startswith("en_")]
            if candidates:
                self._voice = "Samantha" if "Samantha" in candidates else candidates[0]
        except (OSError, subprocess.SubprocessError, AttributeError):
            return None
        return self._voice

    def available(self) -> bool:
        return all(shutil.which(command) for command in ("say", "afconvert", "afplay")) and self._english_voice() is not None

    def _cleanup(self) -> None:
        for path in self._files:
            path.unlink(missing_ok=True)
        self._files = ()

    def stop(self) -> bool:
        with self._lock:
            active = self._process is not None and self._process.poll() is None
            if active:
                self._process.terminate()
                try: self._process.wait(timeout=2)
                except subprocess.TimeoutExpired: self._process.kill(); self._process.wait(timeout=2)
            self._process = None
            self._cleanup()
            return active

    def speak(self, text: str) -> str:
        if not self.available():
            raise ApplicationError("tts_unavailable", "本机英语语音不可用。", status_code=503)
        if not text or len(text) > 1000 or text.startswith("-") or "\x00" in text:
            raise ApplicationError("tts_text_invalid", "朗读文本无效或过长。", status_code=422)
        self.stop()
        with self._lock:
            self.temporary_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
            stem = uuid4().hex
            aiff = self.temporary_dir / f"{stem}.aiff"
            caf = self.temporary_dir / f"{stem}.caf"
            self._files = (aiff, caf)
            try:
                self._run(["say", "-v", self._voice, "-o", str(aiff), "--", text], check=True,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                self._run(["afconvert", "-f", "caff", "-d", "LEI16", str(aiff), str(caf)], check=True,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                aiff.unlink(missing_ok=True)
                self._process = self._popen(["afplay", str(caf)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                process = self._process
                def finish():
                    process.wait()
                    with self._lock:
                        if self._process is process:
                            self._process = None
                            self._cleanup()
                threading.Thread(target=finish, daemon=True).start()
            except (OSError, subprocess.SubprocessError) as exc:
                self._cleanup()
                raise ApplicationError("tts_synthesis_failed", "本地语音合成或播放失败。", status_code=503) from exc
            return stem
