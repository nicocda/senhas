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


def still_mask(features: list[np.ndarray], threshold: float) -> list[bool]:
    """True for the frames where the hand is (almost) still.

    The change of a frame is the distance to its neighbours in normalized hand
    units (1 = wrist -> middle knuckle). A still hand trembles ~0.03-0.1 per frame;
    a hand changing shape moves 0.3-1. Static letters should only learn the still
    part: the start of a take is the transition from the previous letter, and a
    hand that never stops is someone searching for the shape.
    """
    if len(features) < 2:
        return [False] * len(features)
    steps = [float(np.linalg.norm(features[i] - features[i - 1])) for i in range(1, len(features))]
    mask = []
    for i in range(len(features)):
        around = [steps[j] for j in (i - 1, i) if 0 <= j < len(steps)]
        mask.append(max(around) < threshold)
    return mask


def samples_from_sessions(
    sessions: list[dict], entries: list[Entry], still_threshold: float | None = None
) -> list[Sample]:
    """Every frame where the expected number of hands was detected becomes a sample.
    With `still_threshold`, only the frames where the hand is still (see still_mask)."""
    by_id = {entry.id: entry for entry in entries}
    samples = []
    for session in sessions:
        info = session["session"]
        for take in session["takes"]:
            entry = by_id.get(take["entryId"])
            if entry is None:
                continue  # another level
            features = []
            for frame in take["frames"]:
                hands = frame["hands"]
                if len(hands) != entry.hands or entry.hands != 1:
                    continue  # level 1 only for now: exactly one hand
                vector = normalize_hand(hands[0]["world"], info["dominantHand"])
                if vector is not None:
                    features.append(vector)
            keep = still_mask(features, still_threshold) if still_threshold else [True] * len(features)
            samples.extend(
                Sample(
                    features=vector,
                    entry_id=entry.id,
                    participant=info["participant"],
                    session_id=info["id"],
                    take_id=take["id"],
                    round=take["round"],
                )
                for vector, kept in zip(features, keep)
                if kept
            )
    return samples
