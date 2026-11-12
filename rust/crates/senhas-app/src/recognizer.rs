//! Detectar: each camera frame -> hands and face (`hand-pipeline`) -> letters
//! (`senhas-core`), with the same settings as the React Native screen
//! (`app/src/app/detect.tsx`): two hands, the face as reference, right hand dominant.

use std::time::Instant;

use hand_pipeline::backend::{self, BackendError};
use hand_pipeline::face::FaceDetector;
use hand_pipeline::hand::{self, HandLandmarker, Handedness};
use hand_pipeline::image::RgbImage;
use senhas_core::interpreter::{Interpreter, InterpreterOptions, InterpreterState};
use senhas_core::models::Models;
use senhas_core::types::{Hand, LiveFrame, RecordedHand};

/// Bundled in the library, like the React Native release (ADR 0011): models from
/// `rust/mediapipe/` (`scripts/fetch-mediapipe.ps1`) and `ml/` (`train.py`, `train_sequences.py`).
mod bundled {
    pub const HAND_DETECTOR: &[u8] = include_bytes!("../../../mediapipe/hand_detector.tflite");
    pub const HAND_LANDMARKS: &[u8] =
        include_bytes!("../../../mediapipe/hand_landmarks_detector.tflite");
    pub const FACE: &[u8] = include_bytes!("../../../mediapipe/blaze_face_short_range.tflite");
    pub const STATIC: &str = include_str!("../../../../ml/languages/aed/models/static/model.json");
    pub const TWO_HANDS: &str =
        include_str!("../../../../ml/languages/aed/models/level-4/model.json");
    pub const MOVEMENT: &str =
        include_str!("../../../../ml/languages/aed/models/movement/model.json");
}

/// Milliseconds spent on each step of the last frame.
#[derive(Debug, Clone, Copy, Default)]
pub struct Timings {
    pub hands: f32,
    pub face: f32,
    pub letters: f32,
}

pub struct Output {
    pub state: InterpreterState,
    /// Landmarks of each hand, normalized to the image (x, y).
    pub hands: Vec<[[f32; 2]; 21]>,
    pub timings: Timings,
}

/// The `MediaPipe` models. Built once per app run (loading takes a moment).
pub struct Detectors {
    hands: HandLandmarker,
    face: FaceDetector,
}

impl Detectors {
    pub fn load() -> Result<Self, BackendError> {
        Ok(Self {
            hands: HandLandmarker::new(
                backend::load_bytes(bundled::HAND_DETECTOR)?,
                backend::load_bytes(bundled::HAND_LANDMARKS)?,
                hand::Options::default(),
            ),
            face: FaceDetector::new(backend::load_bytes(bundled::FACE)?),
        })
    }
}

/// The letter models (`model.json` files trained in `ml/`).
pub fn letter_models() -> Result<Models, senhas_core::Error> {
    Models::from_json(bundled::STATIC, bundled::TWO_HANDS, bundled::MOVEMENT)
}

pub struct Recognizer<'m> {
    detectors: Detectors,
    interpreter: Interpreter<'m>,
    started: Instant,
}

impl<'m> Recognizer<'m> {
    #[must_use]
    pub fn new(detectors: Detectors, models: &'m Models) -> Self {
        let interpreter = Interpreter::new(models, Hand::Right, InterpreterOptions::default())
            .with_log(Box::new(|message| log::info!("{message}")));
        Self {
            detectors,
            interpreter,
            started: Instant::now(),
        }
    }

    /// One video frame (upright, as the camera sees it).
    pub fn push(&mut self, image: &RgbImage) -> Result<Output, BackendError> {
        let now = self.started.elapsed().as_secs_f64() * 1000.0;
        let step = Instant::now();
        let found = self.detectors.hands.detect_for_video(image)?;
        let hands_ms = step.elapsed().as_secs_f32() * 1000.0;

        let step = Instant::now();
        let body: Vec<f64> =
            self.detectors
                .face
                .detect(image, 1)?
                .first()
                .map_or_else(Vec::new, |face| {
                    face.keypoints
                        .iter()
                        .flat_map(|&(x, y)| [f64::from(x), f64::from(y), 0.0])
                        .collect()
                });
        let face_ms = step.elapsed().as_secs_f32() * 1000.0;

        let step = Instant::now();
        let recorded: Vec<RecordedHand> = found.iter().map(recorded_hand).collect();
        let frame = LiveFrame {
            hands: &recorded,
            body: &body,
            image_width: image.width as f64,
            image_height: image.height as f64,
        };
        let state = self.interpreter.push(&frame, now);
        let letters_ms = step.elapsed().as_secs_f32() * 1000.0;

        Ok(Output {
            state,
            hands: found
                .iter()
                .map(|hand| hand.landmarks.map(|[x, y, _]| [x, y]))
                .collect(),
            timings: Timings {
                hands: hands_ms,
                face: face_ms,
                letters: letters_ms,
            },
        })
    }

    /// The "Borrar" button.
    pub fn clear(&mut self) {
        self.interpreter.clear();
    }
}

/// `hand-pipeline`'s hand -> the recorded format the letter models were trained on
/// (what the Kotlin plugin hands to JS).
fn recorded_hand(hand: &hand::Hand) -> RecordedHand {
    let flat = |points: &[[f32; 3]; 21]| {
        points
            .iter()
            .flat_map(|p| p.map(f64::from))
            .collect::<Vec<_>>()
    };
    RecordedHand {
        handedness: match hand.handedness {
            Handedness::Left => Hand::Left,
            Handedness::Right => Hand::Right,
        },
        score: f64::from(hand.handedness_score),
        landmarks: flat(&hand.landmarks),
        world: flat(&hand.world),
    }
}
