"""Reads the session files exported by the app (app/src/dataset/export.ts)."""

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .catalog import Entry
from .features import normalize_hand

FORMAT = "senhas-session"
SUPPORTED_FORMAT_VERSIONS = {1, 2}


@dataclass(frozen=True)
class Sample:
    """One frame with the hand, ready for the classifier."""

    features: np.ndarray
    entry_id: str
    participant: str
    session_id: str
    take_id: str
    round: int


def load_sessions(data_dir: Path) -> list[dict]:
    sessions = []
    seen: set[str] = set()
    for path in sorted(data_dir.glob("*.json")):
        raw = json.loads(path.read_text(encoding="utf-8"))
        if raw.get("format") != FORMAT or raw.get("formatVersion") not in SUPPORTED_FORMAT_VERSIONS:
            raise ValueError(f"{path.name}: not a supported session export")
        session_id = raw["session"]["id"]
        if session_id in seen:
            print(f"  {path.name}: session {session_id[:8]} already loaded, skipped")
            continue
        seen.add(session_id)
        sessions.append(raw)
    return sessions


def samples_from_sessions(sessions: list[dict], entries: list[Entry]) -> list[Sample]:
    """Every frame where the expected number of hands was detected becomes a sample."""
    by_id = {entry.id: entry for entry in entries}
    samples = []
    for session in sessions:
        info = session["session"]
        for take in session["takes"]:
            entry = by_id.get(take["entryId"])
            if entry is None:
                continue  # another level
            for frame in take["frames"]:
                hands = frame["hands"]
                if len(hands) != entry.hands or entry.hands != 1:
                    continue  # level 1 only for now: exactly one hand
                features = normalize_hand(hands[0]["world"], info["dominantHand"])
                if features is None:
                    continue
                samples.append(
                    Sample(
                        features=features,
                        entry_id=entry.id,
                        participant=info["participant"],
                        session_id=info["id"],
                        take_id=take["id"],
                        round=take["round"],
                    )
                )
    return samples
