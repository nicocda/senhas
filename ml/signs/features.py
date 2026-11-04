"""Turns the landmarks of one hand into the classifier's input.

The app (Hito 5) must apply exactly the same steps before running the model:
that's why the manifest records NORMALIZATION_VERSION.
"""

import numpy as np

# Bump on any change below: a model only works with the normalization it was trained with.
# v2: + palm normal (orientation, e.g. U vs V: palm towards the signer or the camera).
NORMALIZATION_VERSION = 2

POINTS = 21
WRIST = 0
INDEX_MCP = 5
MIDDLE_MCP = 9
PINKY_MCP = 17
POINT_FEATURES = POINTS * 3  # the 21 points; the palm normal comes after them
FEATURES = POINT_FEATURES + 3


# Hand location relative to the face (levels whose letters are signed on the face or
# body). Bump on any change below.
LOCATION_VERSION = 1
LOCATION_FEATURES = 4
INDEX_TIP = 8
# Face Detector keypoints (ADR 0009): 0 left eye, 1 right eye, 2 nose, 3 mouth, ...
FACE_KEYPOINTS = 6


def hand_location(
    landmarks: list[float], body: list[float], width: float, height: float, dominant_hand: str
) -> np.ndarray | None:
    """Wrist and index fingertip relative to the eyes -> 4 numbers.

    - Normalized coordinates times the image size, so x and y are both in pixels
      (the image is 720x1280: one unit of x is not one unit of y).
    - Origin: the midpoint between the eyes. Unit: the distance between the eyes,
      so being closer to the camera doesn't change the numbers.
    - Left-handed people: mirrored on x, like the hand.
    Null without a face (or a degenerate one).
    """
    if len(body) < FACE_KEYPOINTS * 3 or not width or not height:
        return None
    size = np.array([width, height], dtype=np.float32)
    face = np.asarray(body, dtype=np.float32).reshape(-1, 3)[:, :2] * size
    hand = np.asarray(landmarks, dtype=np.float32).reshape(POINTS, 3)[:, :2] * size
    eyes = (face[0] + face[1]) / 2
    unit = float(np.linalg.norm(face[0] - face[1]))
    if unit < 1:
        return None
    points = (hand[[WRIST, INDEX_TIP]] - eyes) / unit
    if dominant_hand == "left":
        points[:, 0] *= -1
    return points.reshape(LOCATION_FEATURES)


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
    - Plus the palm normal (unit vector, 3 numbers): which way the palm faces. The
      points already contain it, but spelled out a small network learns it with
      far fewer examples.
    """
    points = np.asarray(world, dtype=np.float32).reshape(POINTS, 3)
    points = points - points[WRIST]
    if dominant_hand == "left":
        points[:, 0] *= -1
    scale = float(np.linalg.norm(points[MIDDLE_MCP]))
    if scale < 1e-6:
        return None
    points = points / scale
    # Computed on the already mirrored points, which have the shape of a right hand:
    # "palm towards the camera" points the same way for right- and left-handed people.
    normal = np.cross(points[INDEX_MCP], points[PINKY_MCP])
    length = float(np.linalg.norm(normal))
    if length < 1e-6:
        return None
    return np.concatenate([points.reshape(POINT_FEATURES), normal / length]).astype(np.float32)
