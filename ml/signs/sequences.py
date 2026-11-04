"""Movement letters (level 3): a take is a sequence, compared with Dynamic Time Warping.

DTW finds the best alignment between two sequences that may go at different
speeds (one person signs a Z faster than another, or slower than last time), and
returns how far apart they are along that alignment. A new sequence gets the
letter of the closest recorded one (nearest neighbour). It needs no training and
works with very few examples, which is our situation.
"""

import numpy as np

from .features import hand_location, normalize_hand

# Bump on any change to how a sequence is built.
SEQUENCE_VERSION = 1
# Frames per sequence after resampling: DTW is O(n*m), and speed doesn't matter.
LENGTH = 32
# Trim the still start and end: keep from 5% to 95% of the fingertip's path.
TRIM = 0.05


def frame_vector(hand: dict, body: list[float], width: float, height: float, dominant_hand: str) -> np.ndarray | None:
    """Where the hand is (wrist and index fingertip relative to the eyes, 4 numbers)
    and where the palm faces (3): what changes in a movement letter."""
    location = hand_location(hand["landmarks"], body, width, height, dominant_hand)
    shape = normalize_hand(hand["world"], dominant_hand)
    if location is None or shape is None:
        return None
    return np.concatenate([location, shape[-3:]]).astype(np.float32)


def take_sequence(take: dict, dominant_hand: str) -> np.ndarray | None:
    """One take -> LENGTH x 7: frames with one hand and the face, trimmed to the
    movement, resampled to a fixed length. Null if too little was seen."""
    points = []
    for frame in take["frames"]:
        if len(frame["hands"]) != 1:
            continue
        vector = frame_vector(
            frame["hands"][0], frame.get("body", []), take.get("imageWidth"), take.get("imageHeight"), dominant_hand
        )
        if vector is not None:
            points.append(vector)
    return movement_sequence(points)


def movement_sequence(points: list[np.ndarray]) -> np.ndarray | None:
    if len(points) < 8:
        return None
    sequence = np.stack(points)
    # Path of the index fingertip (columns 2-3): keep the part where it actually moves.
    steps = np.linalg.norm(np.diff(sequence[:, 2:4], axis=0), axis=1)
    path = np.concatenate([[0.0], np.cumsum(steps)])
    if path[-1] < 1e-6:
        return None
    start = int(np.searchsorted(path, path[-1] * TRIM))
    end = int(np.searchsorted(path, path[-1] * (1 - TRIM))) + 1
    moving = sequence[start : max(end, start + 2)]
    # Resample to LENGTH frames, evenly spaced in time.
    positions = np.linspace(0, len(moving) - 1, LENGTH)
    return np.stack([np.interp(positions, np.arange(len(moving)), moving[:, i]) for i in range(moving.shape[1])], axis=1).astype(np.float32)


def dtw_distance(a: np.ndarray, b: np.ndarray) -> float:
    """Classic DTW: cost[i][j] = distance(a_i, b_j) + min(match, insertion, deletion).
    Normalized by the sequences' lengths."""
    n, m = len(a), len(b)
    distances = np.linalg.norm(a[:, None, :] - b[None, :, :], axis=2)
    cost = np.full((n + 1, m + 1), np.inf)
    cost[0, 0] = 0.0
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            cost[i, j] = distances[i - 1, j - 1] + min(cost[i - 1, j - 1], cost[i - 1, j], cost[i, j - 1])
    return float(cost[n, m] / (n + m))


def nearest(sequence: np.ndarray, templates: list[tuple[str, np.ndarray]]) -> tuple[str, float]:
    """Label and DTW distance of the closest template."""
    best_label, best_distance = "", float("inf")
    for label, template in templates:
        distance = dtw_distance(sequence, template)
        if distance < best_distance:
            best_label, best_distance = label, distance
    return best_label, best_distance
