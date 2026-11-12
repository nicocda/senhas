//! Parity with `MediaPipe` (Python) on its public test images (ADR 0013, fase 8.2).
//!
//! Needs `rust/mediapipe/` with the models and `testdata/` made by
//! `reference/mediapipe_reference.py`; without them the test is skipped.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use hand_pipeline::face::FaceDetector;
use hand_pipeline::hand::{Hand, HandLandmarker, Handedness, Options};
use hand_pipeline::image::RgbImage;

/// Normalized image coordinates (0..1): 0.001 is 0.7 px on a 720-px image. Measured
/// (2026-11-12): 0.00006 still, 0.0002 tracked; the rest is tract vs XNNPACK rounding.
const MAX_LANDMARK_DIFF: f32 = 0.001;
/// Meters: 0.5 mm. Measured: 0.00004 still, 0.0001 tracked.
const MAX_WORLD_DIFF: f32 = 0.0005;
/// Measured: 0.0007.
const MAX_FACE_DIFF: f32 = 0.002;

#[derive(Deserialize)]
struct RefHand {
    handedness: String,
    score: f32,
    landmarks: Vec<[f32; 3]>,
    world: Vec<[f32; 3]>,
}

#[derive(Deserialize)]
struct RefImage {
    image: Vec<RefHand>,
    tracked: Vec<RefHand>,
    faces: Vec<Vec<[f32; 2]>>,
}

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../mediapipe")
}

#[derive(Default)]
struct Worst {
    landmarks: f32,
    world: f32,
    score: f32,
}

/// Each reference hand with the Rust hand closest to it (by wrist position).
fn compare(name: &str, got: &[Hand], want: &[RefHand], worst: &mut Worst) {
    assert_eq!(got.len(), want.len(), "{name}: number of hands");
    for reference in want {
        let hand = got
            .iter()
            .min_by(|a, b| {
                let d = |h: &Hand| (h.landmarks[0][0] - reference.landmarks[0][0]).abs();
                d(a).total_cmp(&d(b))
            })
            .unwrap();
        let expected = if reference.handedness == "Left" {
            Handedness::Left
        } else {
            Handedness::Right
        };
        assert_eq!(hand.handedness, expected, "{name}: handedness");
        worst.score = worst
            .score
            .max((hand.handedness_score - reference.score).abs());
        for (a, b) in hand.landmarks.iter().zip(&reference.landmarks) {
            worst.landmarks = worst
                .landmarks
                .max((a[0] - b[0]).abs())
                .max((a[1] - b[1]).abs());
        }
        for (a, b) in hand.world.iter().zip(&reference.world) {
            for c in 0..3 {
                worst.world = worst.world.max((a[c] - b[c]).abs());
            }
        }
    }
}

#[test]
fn same_hands_and_faces_as_mediapipe() {
    let reference_path = root().join("testdata/reference.json");
    let Ok(reference) = std::fs::read_to_string(&reference_path) else {
        eprintln!("Skipped: no {}", reference_path.display());
        return;
    };
    let reference: BTreeMap<String, RefImage> = serde_json::from_str(&reference).unwrap();
    let mut landmarker = HandLandmarker::load(&root(), Options::default()).unwrap();
    let faces = FaceDetector::load(&root().join("blaze_face_short_range.tflite")).unwrap();

    let (mut still, mut tracked, mut face_diff) = (Worst::default(), Worst::default(), 0f32);
    for (name, expected) in &reference {
        let image = RgbImage::read_ppm(&root().join(format!("testdata/{name}.ppm"))).unwrap();

        compare(
            name,
            &landmarker.detect(&image).unwrap(),
            &expected.image,
            &mut still,
        );

        landmarker.detect_for_video(&image).unwrap();
        let second = landmarker.detect_for_video(&image).unwrap();
        compare(
            &format!("{name} (tracked)"),
            &second,
            &expected.tracked,
            &mut tracked,
        );
        landmarker.detect(&image).unwrap();

        let found = faces.detect(&image, 1).unwrap();
        assert_eq!(found.len(), expected.faces.len().min(1), "{name}: faces");
        if let (Some(face), Some(want)) = (found.first(), expected.faces.first()) {
            for (a, b) in face.keypoints.iter().zip(want) {
                face_diff = face_diff.max((a.0 - b[0]).abs()).max((a.1 - b[1]).abs());
            }
        }
    }
    eprintln!(
        "still: landmarks {:.5}, world {:.5} m, handedness score {:.4}",
        still.landmarks, still.world, still.score
    );
    eprintln!(
        "tracked: landmarks {:.5}, world {:.5} m, handedness score {:.4}",
        tracked.landmarks, tracked.world, tracked.score
    );
    eprintln!("faces: keypoints {face_diff:.5}");
    for worst in [&still, &tracked] {
        assert!(
            worst.landmarks <= MAX_LANDMARK_DIFF,
            "landmarks differ by {}",
            worst.landmarks
        );
        assert!(
            worst.world <= MAX_WORLD_DIFF,
            "world landmarks differ by {}",
            worst.world
        );
    }
    assert!(
        face_diff <= MAX_FACE_DIFF,
        "face keypoints differ by {face_diff}"
    );
}
