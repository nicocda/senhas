"""Builds the movement-letter recognizer (level 3) for the app: DTW templates.

    .venv\\Scripts\\python train_sequences.py

DTW + nearest neighbour has nothing to fit: the "model" is the recorded sequences
themselves (templates) plus a distance threshold, beyond which the app answers
"not sure" instead of forcing a letter. Writes
ml/languages/<language>/models/movement/model.json.
"""

import argparse
import json
import time
from collections import defaultdict

import numpy as np

from signs.catalog import LANGUAGES_DIR, load_catalog
from signs.features import LOCATION_VERSION, NORMALIZATION_VERSION
from signs.sequences import LENGTH, SEQUENCE_VERSION, TRIM, nearest, take_sequence
from signs.sessions import load_sessions

# The threshold is this many times the largest distance of a correct match.
THRESHOLD_MARGIN = 1.25


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--language", default="aed")
    args = parser.parse_args()

    catalog = load_catalog(args.language)
    entries = [e for e in catalog.entries if e.movement and e.hands == 1]
    ids = {e.id for e in entries}
    sessions = load_sessions(LANGUAGES_DIR / args.language / "data")

    by_session: dict[str, list[tuple[str, np.ndarray]]] = defaultdict(list)
    for session in sessions:
        for take in session["takes"]:
            if take["entryId"] in ids:
                sequence = take_sequence(take, session["session"]["dominantHand"])
                if sequence is not None:
                    by_session[session["session"]["id"]].append((take["entryId"], sequence))
    templates = [item for items in by_session.values() for item in items]
    if not templates:
        raise SystemExit("No movement takes")
    print(f"{len(templates)} sequences from {len(by_session)} sessions")

    # Evaluation: each session against the others, and each take against all the rest.
    correct_distances, total, right = [], 0, 0
    if len(by_session) >= 2:
        for test, items in by_session.items():
            others = [t for key, values in by_session.items() if key != test for t in values]
            for label, sequence in items:
                predicted, distance = nearest(sequence, others)
                total += 1
                right += predicted == label
        print(f"Across sessions: {right}/{total} = {right / total:.0%}")
    loo_right = 0
    correct_by_label: dict[str, list[float]] = defaultdict(list)
    for i, (label, sequence) in enumerate(templates):
        predicted, distance = nearest(sequence, templates[:i] + templates[i + 1 :])
        if predicted == label:
            loo_right += 1
            correct_distances.append(distance)
            correct_by_label[label].append(distance)
    print(f"Leaving one take out: {loo_right}/{len(templates)} = {loo_right / len(templates):.0%}")
    threshold = max(correct_distances) * THRESHOLD_MARGIN
    print(f"Distance threshold: {threshold:.2f} (largest correct match {max(correct_distances):.2f})")
    # One threshold per letter, with the same rule: a single global one is set by the
    # most variable letter (Z) and lets through transitions that look like J
    # (ADR 0012). A letter without correct matches keeps the global one.
    thresholds = {
        label: round(max(correct_by_label[label]) * THRESHOLD_MARGIN, 4) if correct_by_label[label] else round(threshold, 4)
        for label in sorted({label for label, _ in templates})
    }
    print("Per letter: " + ", ".join(f"{label} {value:.2f}" for label, value in thresholds.items()))

    letters = {e.id: e.letter for e in entries}
    out_dir = LANGUAGES_DIR / args.language / "models" / "movement"
    out_dir.mkdir(parents=True, exist_ok=True)
    model = {
        "language": args.language,
        "name": "movement",
        "method": "dtw-nearest-neighbour",
        "sequence": {
            "version": SEQUENCE_VERSION,
            "length": LENGTH,
            "trim": TRIM,
            "normalization": NORMALIZATION_VERSION,
            "location": LOCATION_VERSION,
        },
        "threshold": round(threshold, 4),
        "thresholds": thresholds,
        "evaluation": {
            "acrossSessions": right / total if total else None,
            "leaveOneTakeOut": loo_right / len(templates),
        },
        "trainedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "templates": [
            {"label": label, "letter": letters[label], "frames": np.round(sequence, 5).tolist()}
            for label, sequence in templates
        ],
    }
    path = out_dir / "model.json"
    path.write_text(json.dumps(model, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    print(f"Model: {path}")


if __name__ == "__main__":
    main()
