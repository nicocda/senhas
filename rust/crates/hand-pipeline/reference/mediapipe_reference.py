"""What MediaPipe (Python) gives on the public test images, for the Rust parity test.

Run with a Python that has `mediapipe` (not in ml/requirements.txt: only needed here):

    python -I mediapipe_reference.py <rust/mediapipe>

Reads <dir>/testdata/*.jpg (MediaPipe's own public test images, no people of ours),
writes each one decoded as <name>.ppm (so Rust reads the exact same pixels) and
<dir>/testdata/reference.json with, per image:

- "image": hands in IMAGE mode (the palm detector runs);
- "tracked": the same image fed twice in VIDEO mode, second frame: hands found from
  the previous frame's landmarks (tracking, no palm detector);
- "faces": the face detector's keypoints.

Same options as the app's plugin (HybridHandLandmarker.kt): 2 hands, 0.5 thresholds.
"""

import json
import sys
from pathlib import Path

import mediapipe as mp
import numpy as np
from mediapipe.tasks.python import BaseOptions
from mediapipe.tasks.python import vision


def hands_of(result):
    hands = []
    for i, landmarks in enumerate(result.hand_landmarks):
        category = result.handedness[i][0]
        hands.append(
            {
                "handedness": category.category_name,
                "score": category.score,
                "landmarks": [[p.x, p.y, p.z] for p in landmarks],
                "world": [[p.x, p.y, p.z] for p in result.hand_world_landmarks[i]],
            }
        )
    return hands


def landmarker(models: Path, mode):
    return vision.HandLandmarker.create_from_options(
        vision.HandLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(models / "hand_landmarker.task")),
            running_mode=mode,
            num_hands=2,
            min_hand_detection_confidence=0.5,
            min_hand_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )
    )


def write_ppm(path: Path, rgb: np.ndarray):
    height, width, _ = rgb.shape
    path.write_bytes(f"P6\n{width} {height}\n255\n".encode() + rgb.tobytes())


def main():
    root = Path(sys.argv[1])
    testdata = root / "testdata"
    face_detector = vision.FaceDetector.create_from_options(
        vision.FaceDetectorOptions(
            base_options=BaseOptions(model_asset_path=str(root / "blaze_face_short_range.tflite")),
            min_detection_confidence=0.5,
        )
    )
    reference = {}
    for path in sorted(testdata.glob("*.jpg")):
        image = mp.Image.create_from_file(str(path))
        rgb = np.ascontiguousarray(image.numpy_view()[:, :, :3])
        write_ppm(path.with_suffix(".ppm"), rgb)
        frame = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)

        with landmarker(root, vision.RunningMode.IMAGE) as still:
            single = hands_of(still.detect(frame))
        with landmarker(root, vision.RunningMode.VIDEO) as video:
            video.detect_for_video(frame, 0)
            tracked = hands_of(video.detect_for_video(frame, 33))
        faces = [
            [[k.x, k.y] for k in detection.keypoints]
            for detection in face_detector.detect(frame).detections
        ]
        reference[path.stem] = {
            "width": rgb.shape[1],
            "height": rgb.shape[0],
            "image": single,
            "tracked": tracked,
            "faces": faces,
        }
        print(f"{path.stem}: {len(single)} hands, {len(tracked)} tracked, {len(faces)} faces")
    (testdata / "reference.json").write_text(json.dumps(reference))


if __name__ == "__main__":
    main()
