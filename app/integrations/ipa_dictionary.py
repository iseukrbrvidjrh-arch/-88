"""Read-only, offline General American IPA dictionary adapter."""

from pathlib import Path


class LocalIpaDictionary:
    SOURCE = "ipa-dict en_US"
    VERSION = "972cd67dd5f96bc5660e28070cde26e3928abcd7"
    ACCENT = "General American"

    def __init__(self, path: Path):
        self.path = path
        self._entries: dict[str, tuple[str, ...]] | None = None

    def _load(self) -> dict[str, tuple[str, ...]]:
        if self._entries is None:
            entries = {}
            with self.path.open(encoding="utf-8") as source:
                for line in source:
                    word, separator, value = line.rstrip("\n").partition("\t")
                    if separator and value:
                        entries[word.lower()] = tuple(part.strip() for part in value.split(",") if part.strip())
            self._entries = entries
        return self._entries

    def lookup(self, word: str) -> tuple[str, ...]:
        key = word.strip().replace("’", "'").lower()
        entries = self._load()
        result = entries.get(key, ())
        if not result and key.endswith("'s"):
            result = entries.get(key[:-2], ())
        return result

    def statistics(self) -> tuple[int, int]:
        entries = self._load()
        return len(entries), len(set(entries))
