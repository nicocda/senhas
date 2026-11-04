"""Builds the guide hands shown while recording (etapa 4.5): for every catalog
entry, a reference pose taken from the recorded sessions.

    .venv\\Scripts\\python build_references.py

- Static letters: the steadiest take, and in it the frame closest to the take's
  typical shape (its median).
- Movement letters: the take where the hand was seen the most, trimmed to the
  movement and subsampled, so the app can animate it.
- Takes with the face are preferred, so the guide can show where the hand goes.

Only coordinates (21 points per hand, 6 face keypoints), never images. They come
from people's sessions, so the output stays out of git like the models:
ml/languages/<language>/models/references.json.
"""

import argparse
import json
import time

import numpy as np

from signs.catalog import LANGUAGES_DIR, load_catalog
from signs.features import POINT_FEATURES, normalize_hand
from signs.sessions import load_sessions

STEADY_DISTANCE = 0.35  # same as steadyMs in the app (dataset/features.ts)
MAX_MOVEMENT_FRAMES = 24


def xy(points: list[float]) -> list[list[float]]:
    """Flat [x, y, z, ...] normalized -> [[x, y], ...] rounded."""
    values = np.asarray(points, dtype=np.float32).reshape(-1, 3)[:, :2]
    return np.round(values, 4).tolist()


def frame_pose(frame: dict, take: dict) -> dict:
    hands = sorted(frame["hands"], key=lambda hand: hand["handedness"])
    return {
        "hands": [{"handedness": hand["handedness"], "points": xy(hand["landmarks"])} for hand in hands],
        "face": xy(frame["body"]) if frame.get("body") else None,
        # Normalized x and y are relative to this size (720x1280 isn't square).
        "image": [take.get("imageWidth") or 720, take.get("imageHeight") or 1280],
    }


def dominant_of(frame: dict, dominant_hand: str) -> dict | None:
    hands = frame["hands"]
    if len(hands) == 1:
        return hands[0]
    return next((hand for hand in hands if hand["handedness"] == dominant_hand), None)


def static_reference(candidates: list[tuple[dict, str]], hands: int) -> tuple[float, dict] | None:
    """(steady frames, pose) of the best frame among the takes."""
    best = None
    for take, dominant in candidates:
        frames = [f for f in take["frames"] if len(f["hands"]) == hands]
        shapes = []
        for frame in frames:
            hand = dominant_of(frame, dominant)
            shape = normalize_hand(hand["world"], dominant) if hand else None
            shapes.append(shape[:POINT_FEATURES] if shape is not None else None)
        valid = [(f, s) for f, s in zip(frames, shapes) if s is not None]
        if len(valid) < 3:
            continue
        stacked = np.stack([s for _, s in valid])
        median = np.median(stacked, axis=0)
        distances = np.linalg.norm(stacked - median, axis=1)
        steady = int((distances < STEADY_DISTANCE).sum())
        has_face = sum(1 for f, _ in valid if f.get("body")) >= len(valid) / 2
        score = steady + (1000 if has_face else 0)  # prefer takes with the face
        if best is None or score > best[0]:
            frame = valid[int(np.argmin(distances))][0]
            best = (score, frame_pose(frame, take))
    return best


def movement_reference(candidates: list[tuple[dict, str]]) -> dict | None:
    best = None
    for take, dominant in candidates:
        frames = [f for f in take["frames"] if len(f["hands"]) == 1 and f.get("body")]
        if len(frames) < 8:
            continue
        # Trim the still start and end, like the DTW sequences (5% .. 95% of the path).
        tips = np.array([[f["hands"][0]["landmarks"][24], f["hands"][0]["landmarks"][25]] for f in frames])
        path = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(tips, axis=0), axis=1))])
        start = int(np.searchsorted(path, path[-1] * 0.05))
        end = int(np.searchsorted(path, path[-1] * 0.95)) + 1
        moving = frames[start:end]
        if len(moving) < 4:
            continue
        indices = np.linspace(0, len(moving) - 1, min(MAX_MOVEMENT_FRAMES, len(moving))).round().astype(int)
        duration = (moving[-1]["t"] - moving[0]["t"]) / 1000
        if best is None or len(frames) > best[0]:
            best = (
                len(frames),
                {
                    "frames": [frame_pose(moving[i], take) for i in indices],
                    "seconds": round(duration, 2),
                },
            )
    return best[1] if best else None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--language", default="aed")
    args = parser.parse_args()

    catalog = load_catalog(args.language)
    sessions = load_sessions(LANGUAGES_DIR / args.language / "data")
    by_entry: dict[str, list[tuple[dict, str]]] = {}
    for session in sessions:
        for take in session["takes"]:
            by_entry.setdefault(take["entryId"], []).append((take, session["session"]["dominantHand"]))

    references = {}
    for entry in catalog.entries:
        candidates = by_entry.get(entry.id, [])
        if entry.movement:
            reference = movement_reference(candidates)
            if reference:
                references[entry.id] = {"kind": "movement", **reference}
        else:
            best = static_reference(candidates, entry.hands)
            if best:
                references[entry.id] = {"kind": "static", **best[1]}
        status = references.get(entry.id, {}).get("kind", "MISSING")
        print(f"{entry.id:3} {status}")

    out = LANGUAGES_DIR / args.language / "models" / "references.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {"language": args.language, "builtAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "references": references},
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(f"{len(references)}/{len(catalog.entries)} references: {out}")


if __name__ == "__main__":
    main()
