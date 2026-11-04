"""Trains the classifier of one catalog level and exports it for the app.

    .venv\\Scripts\\python train.py --language aed --level 1

Reads ml/languages/<language>/data/*.json (sessions exported by the app) and
writes ml/languages/<language>/models/level-<n>/{model.tflite, manifest.json},
plus metrics and the confusion matrix in ml/runs/<timestamp>/ (outside git).
"""

import argparse
import hashlib
import json
import time
from collections import Counter
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # no window: the plot only goes to a file
import matplotlib.pyplot as plt
import numpy as np
import tensorflow as tf
from ai_edge_litert.interpreter import Interpreter
from sklearn.metrics import ConfusionMatrixDisplay, accuracy_score, classification_report, confusion_matrix

from signs.catalog import LANGUAGES_DIR, load_catalog
from signs.features import LOCATION_VERSION, NORMALIZATION_VERSION
from signs.sessions import load_sessions, samples_from_sessions

ML_DIR = Path(__file__).resolve().parent


def build_model(features: int, classes: int) -> tf.keras.Model:
    """A small dense network: the hand's numbers in, one probability per class out."""
    model = tf.keras.Sequential(
        [
            tf.keras.Input(shape=(features,)),
            tf.keras.layers.Dense(128, activation="relu"),
            tf.keras.layers.Dropout(0.3),
            tf.keras.layers.Dense(64, activation="relu"),
            tf.keras.layers.Dropout(0.3),
            tf.keras.layers.Dense(classes, activation="softmax"),
        ]
    )
    model.compile(optimizer="adam", loss="sparse_categorical_crossentropy", metrics=["accuracy"])
    return model


def fit(x: np.ndarray, y: np.ndarray, classes: int, epochs: int, seed: int) -> tf.keras.Model:
    tf.keras.utils.set_random_seed(seed)
    # Keras takes the validation split from the end of the arrays: shuffle first.
    order = np.random.default_rng(seed).permutation(len(x))
    model = build_model(x.shape[1], classes)
    model.fit(
        x[order],
        y[order],
        epochs=epochs,
        batch_size=32,
        validation_split=0.15,
        callbacks=[tf.keras.callbacks.EarlyStopping(patience=15, restore_best_weights=True)],
        verbose=0,
    )
    return model


def folds(groups: np.ndarray):
    """Frames of the same take are almost identical: splitting frames at random
    would put "the same" sample in train and test. So whole groups are held out:
    one person at a time if there are several, otherwise one round at a time."""
    for group in sorted(set(groups.tolist())):
        yield group, groups != group, groups == group


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--language", default="aed")
    parser.add_argument("--level", type=int, default=1)
    parser.add_argument("--epochs", type=int, default=200)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument(
        "--still",
        type=float,
        metavar="THRESHOLD",
        help="only frames where the hand is still (change per frame below THRESHOLD, e.g. 0.15)",
    )
    parser.add_argument("--no-location", action="store_true", help="hand shape only, even on face letters")
    parser.add_argument("--data-dir", type=Path, help="default: languages/<language>/data")
    parser.add_argument("--out-dir", type=Path, help="default: languages/<language>/models/level-<n>")
    args = parser.parse_args()

    catalog = load_catalog(args.language)
    entries = catalog.level(args.level)
    labels = [entry.id for entry in entries]
    data_dir = args.data_dir or LANGUAGES_DIR / args.language / "data"
    sessions = load_sessions(data_dir)
    # Letters signed on the face or body also need where the hand is (ADR 0009).
    with_location = not args.no_location and any(entry.location != "neutral" for entry in entries)
    samples = samples_from_sessions(sessions, entries, args.still, with_location)
    if not samples:
        raise SystemExit(f"No samples for level {args.level} in {data_dir}")

    x = np.stack([sample.features for sample in samples])
    y = np.array([labels.index(sample.entry_id) for sample in samples])
    participants = sorted({sample.participant for sample in samples})
    print(f"{len(sessions)} sessions, {len(participants)} people, {len(samples)} frames, {x.shape[1]} numbers per frame{' (with location)' if with_location else ''}")
    counts = Counter(sample.entry_id for sample in samples)
    print("Frames per class:", ", ".join(f"{label}={counts.get(label, 0)}" for label in labels))
    missing = [label for label in labels if counts.get(label, 0) == 0]
    if missing:
        raise SystemExit(f"Classes without samples: {missing}")

    if len(participants) >= 2:
        strategy = "leave-one-person-out"
        groups = np.array([sample.participant for sample in samples])
    else:
        strategy = "leave-one-round-out"
        groups = np.array([f"round {sample.round}" for sample in samples])
    print(f"Evaluation: {strategy}")

    all_true, all_pred, fold_scores = [], [], {}
    for name, train, test in folds(groups):
        model = fit(x[train], y[train], len(labels), args.epochs, args.seed)
        pred = model.predict(x[test], verbose=0).argmax(axis=1)
        fold_scores[name] = float(accuracy_score(y[test], pred))
        print(f"  test on {name}: {fold_scores[name]:.1%} ({test.sum()} frames)")
        all_true.extend(y[test].tolist())
        all_pred.extend(pred.tolist())
    accuracy = float(accuracy_score(all_true, all_pred))
    print(f"Accuracy on data the model never saw: {accuracy:.1%}")
    print(classification_report(all_true, all_pred, labels=range(len(labels)), target_names=labels, zero_division=0))

    matrix = confusion_matrix(all_true, all_pred, labels=range(len(labels)))
    # Recall: of the frames of each letter, how many the model got right.
    recall = {
        label: float(matrix[i, i] / matrix[i].sum()) if matrix[i].sum() else 0.0
        for i, label in enumerate(labels)
    }
    print("Most confused pairs (true -> predicted):")
    pairs = [
        (int(matrix[i, j]), labels[i], labels[j])
        for i in range(len(labels))
        for j in range(len(labels))
        if i != j and matrix[i, j] > 0
    ]
    for count, true, predicted in sorted(pairs, reverse=True)[:8]:
        expected = predicted in next(e for e in entries if e.id == true).confusable_with
        print(f"  {true} -> {predicted}: {count}{'  (marked confusableWith)' if expected else ''}")

    run_dir = ML_DIR / "runs" / time.strftime("%Y%m%d-%H%M%S")
    run_dir.mkdir(parents=True)
    ConfusionMatrixDisplay(matrix, display_labels=labels).plot(cmap="Blues", colorbar=False)
    plt.title(f"{args.language} level {args.level}: {strategy}, {accuracy:.1%}")
    plt.savefig(run_dir / "confusion.png", dpi=150, bbox_inches="tight")

    # Final model: trained on everything, it's the one the app gets.
    model = fit(x, y, len(labels), args.epochs, args.seed)
    tflite = tf.lite.TFLiteConverter.from_keras_model(model).convert()

    # The .tflite must answer like the Keras model it came from.
    interpreter = Interpreter(model_content=tflite)
    interpreter.allocate_tensors()
    input_index = interpreter.get_input_details()[0]["index"]
    output_index = interpreter.get_output_details()[0]["index"]
    keras_pred = model.predict(x, verbose=0).argmax(axis=1)
    agree = 0
    for i, features in enumerate(x):
        interpreter.set_tensor(input_index, features[np.newaxis])
        interpreter.invoke()
        agree += int(interpreter.get_tensor(output_index).argmax() == keras_pred[i])
    print(f".tflite agrees with Keras on {agree}/{len(x)} frames")

    out_dir = args.out_dir or LANGUAGES_DIR / args.language / "models" / f"level-{args.level}"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "model.tflite").write_bytes(tflite)
    manifest = {
        "language": args.language,
        "level": args.level,
        "catalogSchema": catalog.schema_version,
        "labels": labels,
        "letters": [entry.letter for entry in entries],
        "normalization": {
            "version": NORMALIZATION_VERSION,
            "input": "worldLandmarks + palmNormal",
            "location": {"version": LOCATION_VERSION, "relativeTo": "eyes"} if with_location else None,
            "features": int(x.shape[1]),
        },
        "model": {"file": "model.tflite", "sha256": hashlib.sha256(tflite).hexdigest(), "bytes": len(tflite)},
        "evaluation": {"strategy": strategy, "accuracy": accuracy, "folds": fold_scores, "recall": recall},
        "data": {
            "sessions": len(sessions),
            "people": len(participants),
            "frames": len(samples),
            "stillThreshold": args.still,
        },
        "trainedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }
    for directory in (out_dir, run_dir):
        write_json(directory / "manifest.json", manifest)
    write_capture_plan(args.language, args.level, recall, accuracy)
    print(f"Model: {out_dir}\nRun:   {run_dir}")


def write_json(path: Path, data: dict) -> None:
    # newline="\n": on Windows, text mode would write \r\n.
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")


# Letters the model gets wrong more often get more rounds in the next capture sessions.
EXTRA_ROUNDS = [(0.5, 2), (0.85, 1)]  # (recall below, extra rounds)


def write_capture_plan(language: str, level: int, recall: dict[str, float], accuracy: float) -> None:
    """ml/languages/<language>/capture-plan.json, read by the app's capture screen.
    Only per-letter numbers: no data about people."""
    path = LANGUAGES_DIR / language / "capture-plan.json"
    plan = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"schemaVersion": 1, "levels": {}}
    extra = {}
    for label, value in recall.items():
        rounds = next((rounds for below, rounds in EXTRA_ROUNDS if value < below), 0)
        if rounds:
            extra[label] = rounds
    plan["levels"][str(level)] = {
        "extraRounds": extra,
        "basedOn": {"accuracy": round(accuracy, 3), "trainedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z")},
    }
    write_json(path, plan)
    print("Extra rounds for the next sessions:", ", ".join(f"{k}+{v}" for k, v in extra.items()) or "none")


if __name__ == "__main__":
    main()
