//! Hand landmarker: palm detector + landmarks model + tracking between frames,
//! as `MediaPipe` Tasks' `HandLandmarker` (VIDEO mode, the one the app uses).

use std::path::Path;

use crate::backend::{self, BackendError, Model};
use crate::detection::{self, Detection, PALM};
use crate::geometry::{
    LANDMARKS_TO_HAND, PALM_TO_HAND, Rect, iou, normalize_radians, rect_from_landmarks, transform,
};
use crate::image::{Border, RgbImage, crop_to_tensor};

const LANDMARKS_INPUT: usize = 224;
/// `TensorsToLandmarksCalculator` `normalize_z`.
const NORMALIZE_Z: f32 = 0.4;
/// Both hand models take pixels as 0..1.
const RANGE: (f32, f32) = (0.0, 1.0);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Handedness {
    Left,
    Right,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Hand {
    pub handedness: Handedness,
    /// Confidence of the handedness, 0.5..1.
    pub handedness_score: f32,
    /// Normalized to the image; z in the same scale as x.
    pub landmarks: [[f32; 3]; 21],
    /// Meters, centered on the hand.
    pub world: [[f32; 3]; 21],
    /// The region the landmarks were found in.
    pub rect: Rect,
}

#[derive(Debug, Clone, Copy)]
pub struct Options {
    pub num_hands: usize,
    pub min_presence: f32,
    /// Overlap with a tracked hand above which a new palm is the same hand.
    pub min_tracking: f32,
}

impl Default for Options {
    /// Same as the app's plugin (`app/modules/hand-landmarker/src/index.ts`).
    fn default() -> Self {
        Self {
            num_hands: 2,
            min_presence: 0.5,
            min_tracking: 0.5,
        }
    }
}

pub struct HandLandmarker {
    detector: Box<dyn Model>,
    landmarks: Box<dyn Model>,
    anchors: Vec<(f32, f32)>,
    options: Options,
    /// Regions for the next frame, from this frame's landmarks.
    tracked: Vec<Rect>,
}

impl HandLandmarker {
    /// `dir` has `hand_detector.tflite` and `hand_landmarks_detector.tflite` (the two
    /// files inside `hand_landmarker.task`).
    pub fn load(dir: &Path, options: Options) -> Result<Self, BackendError> {
        Ok(Self::new(
            backend::load(&dir.join("hand_detector.tflite"))?,
            backend::load(&dir.join("hand_landmarks_detector.tflite"))?,
            options,
        ))
    }

    #[must_use]
    pub fn new(detector: Box<dyn Model>, landmarks: Box<dyn Model>, options: Options) -> Self {
        Self {
            detector,
            landmarks,
            anchors: detection::anchors(&PALM),
            options,
            tracked: Vec::new(),
        }
    }

    /// A still image: always runs the palm detector, no tracking.
    pub fn detect(&mut self, image: &RgbImage) -> Result<Vec<Hand>, BackendError> {
        self.tracked.clear();
        let hands = self.detect_for_video(image)?;
        self.tracked.clear();
        Ok(hands)
    }

    /// A video frame: hands tracked from the previous frame, and the palm detector
    /// only while fewer than `num_hands` are tracked.
    pub fn detect_for_video(&mut self, image: &RgbImage) -> Result<Vec<Hand>, BackendError> {
        let mut rects = std::mem::take(&mut self.tracked);
        if rects.len() < self.options.num_hands {
            let (w, h) = (image.width as f32, image.height as f32);
            for palm in self.palms(image)? {
                let rect = transform(palm_rect(&palm, w, h), PALM_TO_HAND, w, h);
                // A palm over a tracked hand is that hand (HandAssociationCalculator).
                if rects
                    .iter()
                    .all(|tracked| rect_iou(tracked, &rect) <= self.options.min_tracking)
                {
                    rects.push(rect);
                }
            }
            rects.truncate(self.options.num_hands);
        }
        let mut hands = Vec::new();
        for rect in rects {
            if let Some(hand) = self.hand_in(image, rect)? {
                hands.push(hand);
            }
        }
        let hands = deduplicate(hands);
        let (w, h) = (image.width as f32, image.height as f32);
        self.tracked = hands
            .iter()
            .map(|hand| {
                transform(
                    rect_from_landmarks(&hand.landmarks, w, h),
                    LANDMARKS_TO_HAND,
                    w,
                    h,
                )
            })
            .collect();
        Ok(hands)
    }

    fn palms(&self, image: &RgbImage) -> Result<Vec<Detection>, BackendError> {
        let (input, padding) =
            crop_to_tensor(image, None, PALM.input_size, RANGE, Border::Zero, true);
        let outputs = self.detector.run(input, PALM.input_size)?;
        Ok(detection::decode(
            &PALM,
            &self.anchors,
            &outputs[0],
            &outputs[1],
            padding,
            self.options.num_hands,
        ))
    }

    /// Runs the landmarks model on one region. `None` if there is no hand in it.
    pub fn hand_in(&self, image: &RgbImage, rect: Rect) -> Result<Option<Hand>, BackendError> {
        let (input, _) = crop_to_tensor(
            image,
            Some(&rect),
            LANDMARKS_INPUT,
            RANGE,
            Border::Replicate,
            true,
        );
        let outputs = self.landmarks.run(input, LANDMARKS_INPUT)?;
        let (raw, presence, handedness, world) =
            (&outputs[0], outputs[1][0], outputs[2][0], &outputs[3]);
        if presence < self.options.min_presence {
            return Ok(None);
        }
        let size = LANDMARKS_INPUT as f32;
        let (sin, cos) = rect.rotation.sin_cos();
        let landmarks = std::array::from_fn(|i| {
            // Model pixels -> 0..1 of the region -> the image (LandmarkProjectionCalculator).
            let x = raw[i * 3] / size - 0.5;
            let y = raw[i * 3 + 1] / size - 0.5;
            let z = raw[i * 3 + 2] / size / NORMALIZE_Z;
            [
                (cos * x - sin * y) * rect.width + rect.x_center,
                (sin * x + cos * y) * rect.height + rect.y_center,
                z * rect.width,
            ]
        });
        let world = std::array::from_fn(|i| {
            let (x, y) = (world[i * 3], world[i * 3 + 1]);
            [cos * x - sin * y, sin * x + cos * y, world[i * 3 + 2]]
        });
        // Binary classifier: the output is the probability of index 0, "Right".
        let (handedness, handedness_score) = if handedness > 0.5 {
            (Handedness::Right, handedness)
        } else {
            (Handedness::Left, 1.0 - handedness)
        };
        Ok(Some(Hand {
            handedness,
            handedness_score,
            landmarks,
            world,
            rect,
        }))
    }
}

/// Target angle of the palm's wrist -> middle knuckle vector. `MediaPipe` Tasks sets
/// `rotation_vector_target_angle(90)` (`hand_detector_graph.cc`), a field in
/// *radians*: the palm region ends up ~27° off a vertical hand. The landmarks model
/// copes, but its output depends on it, so it's reproduced on purpose (parity with
/// the Kotlin plugin, ADR 0013). With pi / 2 the landmarks differ by up to 2%.
const PALM_TARGET_ANGLE: f32 = 90.0;

/// `DetectionsToRectsCalculator`: the palm's box, rotated by the wrist -> middle
/// finger knuckle vector (keypoints 0 and 2).
fn palm_rect(palm: &Detection, width: f32, height: f32) -> Rect {
    let px = |k: usize| (palm.keypoints[k].0 * width, palm.keypoints[k].1 * height);
    let ((x0, y0), (x1, y1)) = (px(0), px(2));
    Rect {
        x_center: palm.xmin + palm.width / 2.0,
        y_center: palm.ymin + palm.height / 2.0,
        width: palm.width,
        height: palm.height,
        rotation: normalize_radians(PALM_TARGET_ANGLE - (-(y1 - y0)).atan2(x1 - x0)),
    }
}

/// Overlap of two rects, ignoring their rotation (as `MediaPipe`'s association does).
fn rect_iou(a: &Rect, b: &Rect) -> f32 {
    let bounds = |r: &Rect| {
        (
            r.x_center - r.width / 2.0,
            r.y_center - r.height / 2.0,
            r.width,
            r.height,
        )
    };
    iou(bounds(a), bounds(b))
}

/// Two regions that found the same hand (`HandLandmarksDeduplicationCalculator`):
/// half of the landmarks close and overlapping boxes.
fn deduplicate(hands: Vec<Hand>) -> Vec<Hand> {
    let mut kept: Vec<Hand> = Vec::new();
    for hand in hands {
        if !kept.iter().any(|other| same_hand(other, &hand)) {
            kept.push(hand);
        }
    }
    kept
}

fn same_hand(a: &Hand, b: &Hand) -> bool {
    let baseline = |hand: &Hand| {
        let p = |i: usize| hand.landmarks[i];
        let d = |i: usize, j: usize| (p(i)[0] - p(j)[0]).hypot(p(i)[1] - p(j)[1]);
        (d(0, 5) + d(0, 17) + d(5, 17)) / 3.0
    };
    let threshold = 0.2 * baseline(a).max(baseline(b));
    let close = a
        .landmarks
        .iter()
        .zip(&b.landmarks)
        .filter(|(p, q)| (p[0] - q[0]).hypot(p[1] - q[1]) < threshold)
        .count();
    let bounds = |hand: &Hand| {
        let (min_x, max_x) = hand
            .landmarks
            .iter()
            .fold((f32::MAX, f32::MIN), |(lo, hi), p| {
                (lo.min(p[0]), hi.max(p[0]))
            });
        let (min_y, max_y) = hand
            .landmarks
            .iter()
            .fold((f32::MAX, f32::MIN), |(lo, hi), p| {
                (lo.min(p[1]), hi.max(p[1]))
            });
        (min_x, min_y, max_x - min_x, max_y - min_y)
    };
    close >= 10 && iou(bounds(a), bounds(b)) > 0.2
}
