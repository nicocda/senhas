"""Reads a language catalog (ml/languages/<code>/letters.json, ADR 0006)."""

import json
from dataclasses import dataclass
from pathlib import Path

SUPPORTED_SCHEMA_VERSION = 1
LANGUAGES_DIR = Path(__file__).resolve().parent.parent / "languages"


@dataclass(frozen=True)
class Entry:
    """One class of the model: a letter, or one variant of a letter (V1, V2)."""

    id: str
    letter: str
    level: int
    hands: int
    movement: bool
    location: str
    same_handshape_as: str | None
    confusable_with: tuple[str, ...]


@dataclass(frozen=True)
class Catalog:
    code: str
    schema_version: int
    entries: tuple[Entry, ...]

    def level(self, level: int) -> list[Entry]:
        return [entry for entry in self.entries if entry.level == level]


def load_catalog(code: str) -> Catalog:
    path = LANGUAGES_DIR / code / "letters.json"
    raw = json.loads(path.read_text(encoding="utf-8"))
    if raw["schemaVersion"] != SUPPORTED_SCHEMA_VERSION:
        raise ValueError(
            f"{path}: schemaVersion {raw['schemaVersion']} is not supported "
            f"(expected {SUPPORTED_SCHEMA_VERSION})"
        )
    entries = tuple(
        Entry(
            id=item["id"],
            letter=item.get("letter", item["id"]),
            level=item["level"],
            hands=item["hands"],
            movement=item["movement"],
            location=item["location"],
            same_handshape_as=item.get("sameHandshapeAs"),
            confusable_with=tuple(item.get("confusableWith", [])),
        )
        for item in raw["letters"]
    )
    return Catalog(code=raw["language"]["code"], schema_version=raw["schemaVersion"], entries=entries)
