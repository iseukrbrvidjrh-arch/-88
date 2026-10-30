"""Offline IPA lookup use case."""

from app.integrations.ipa_dictionary import LocalIpaDictionary


def pronunciation(dictionary: LocalIpaDictionary, word: str):
    values = dictionary.lookup(word)
    if not values:
        return {"word": word, "found": False, "display": "本地未收录", "pronunciations": [],
                "source": dictionary.SOURCE, "version": dictionary.VERSION, "accent": dictionary.ACCENT}
    return {"word": word, "found": True, "display": values[0], "pronunciations": list(values),
            "source": dictionary.SOURCE, "version": dictionary.VERSION, "accent": dictionary.ACCENT}
