"""Turns the landmarks of one hand into the classifier's input.

The app (Hito 5) must apply exactly the same steps before running the model:
that's why the manifest records NORMALIZATION_VERSION.
"""

import numpy as np

# Bump on any change below: a model only works with the normalization it was trained with.
NORMALIZATION_VERSION = 1

POINTS = 21
WRIST = 0
MIDDLE_MCP = 9
FEATURES = POINTS * 3


def normalize_hand(world: list[float], dominant_hand: str) -> np.ndarray | None:
    """World landmarks (flat x, y, z in meters) -> 63 numbers.

    - World landmarks, not the normalized ones: they are in meters on all three
      axes (the normalized x and y depend on the image's aspect ratio), and the
      app already rotates them upright, so the hand's orientation relative to the
      screen survives. M, N and P are told apart by pointing down.
    - Translation: the wrist becomes the origin.
    - Scale: divided by the wrist -> middle knuckle distance, so a big and a small
      hand doing the same letter look the same.
    - Left-handed people: mirrored on x, so every sample looks like a right hand.
    - No rotation normalization, on purpose (see above).
    """
    points = np.asarray(world, dtype=np.float32).reshape(POINTS, 3)
    points = points - points[WRIST]
    if dominant_hand == "left":
        points[:, 0] *= -1
    scale = float(np.linalg.norm(points[MIDDLE_MCP]))
    if scale < 1e-6:
        return None
    return (points / scale).reshape(FEATURES)
