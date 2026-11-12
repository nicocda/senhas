//! Recorded data, same shape as `app/src/dataset/types.ts` and the session files
//! exported by the app (`app/src/dataset/export.ts`).

use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Hand {
    Left,
    Right,
}

impl Hand {
    #[must_use]
    pub fn opposite(self) -> Self {
        match self {
            Self::Left => Self::Right,
            Self::Right => Self::Left,
        }
    }

    /// -1 mirrors x so a left hand looks like a right one (ADR 0008).
    #[must_use]
    pub fn mirror(self) -> f64 {
        match self {
            Self::Left => -1.0,
            Self::Right => 1.0,
        }
    }
}

/// One hand in a frame. Coordinates are flat `[x0, y0, z0, x1, ...]`, 21 points.
#[derive(Debug, Clone, Deserialize)]
pub struct RecordedHand {
    pub handedness: Hand,
    /// Handedness confidence, 0..1.
    pub score: f64,
    /// Normalized to the upright image (0..1).
    pub landmarks: Vec<f64>,
    /// Meters, centered on the hand (`MediaPipe` world landmarks).
    pub world: Vec<f64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RecordedFrame {
    /// Milliseconds since the take started.
    pub t: f64,
    /// Empty when no hand was detected.
    pub hands: Vec<RecordedHand>,
    /// Body reference points, flat, normalized to the upright image. Face: 6 keypoints.
    pub body: Vec<f64>,
}

/// What the recognizer gets for every processed camera frame.
#[derive(Debug, Clone)]
pub struct LiveFrame<'a> {
    pub hands: &'a [RecordedHand],
    pub body: &'a [f64],
    pub image_width: f64,
    pub image_height: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Take {
    pub id: String,
    pub entry_id: String,
    pub round: u32,
    pub image_width: Option<f64>,
    pub image_height: Option<f64>,
    pub frames: Vec<RecordedFrame>,
}

impl Take {
    #[must_use]
    pub fn live_frame<'a>(&self, frame: &'a RecordedFrame) -> LiveFrame<'a> {
        LiveFrame {
            hands: &frame.hands,
            body: &frame.body,
            image_width: self.image_width.unwrap_or(0.0),
            image_height: self.image_height.unwrap_or(0.0),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub participant: String,
    pub dominant_hand: Hand,
}

/// A session file (`format: "senhas-session"`). Only the fields the recognizer uses.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionExport {
    pub format: String,
    pub format_version: u32,
    pub session: SessionInfo,
    pub takes: Vec<Take>,
}
