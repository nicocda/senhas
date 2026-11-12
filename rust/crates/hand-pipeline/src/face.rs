//! Face detector (`BlazeFace` short range): the face is the reference to place the
//! hand relative to the body (ADR 0009). Keypoints, in order: right eye, left eye,
//! nose tip, mouth, right ear, left ear (of the person).

use std::path::Path;

use crate::backend::{self, BackendError, Model};
use crate::detection::{self, Detection, FACE};
use crate::image::{Border, RgbImage, crop_to_tensor};

/// The face model takes pixels as -1..1.
const RANGE: (f32, f32) = (-1.0, 1.0);

pub struct FaceDetector {
    model: Box<dyn Model>,
    anchors: Vec<(f32, f32)>,
}

impl FaceDetector {
    pub fn load(path: &Path) -> Result<Self, BackendError> {
        Ok(Self::new(backend::load(path)?))
    }

    #[must_use]
    pub fn new(model: Box<dyn Model>) -> Self {
        Self {
            model,
            anchors: detection::anchors(&FACE),
        }
    }

    /// Faces, best first.
    pub fn detect(&self, image: &RgbImage, max: usize) -> Result<Vec<Detection>, BackendError> {
        let (input, padding) =
            crop_to_tensor(image, None, FACE.input_size, RANGE, Border::Zero, true);
        let outputs = self.model.run(input, FACE.input_size)?;
        Ok(detection::decode(
            &FACE,
            &self.anchors,
            &outputs[0],
            &outputs[1],
            padding,
            max,
        ))
    }
}
