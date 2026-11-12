//! Loads the models trained in `ml/` (same checks as `app/src/recognition/models.ts`).

use std::fs;
use std::path::Path;

use crate::Error;
use crate::classifier::{Classifier, ModelFile, Prediction};
use crate::features::{LOCATION_VERSION, TWO_HANDS_VERSION, hand_location, normalize_hand};
use crate::sequences::{MovementModelFile, MovementRecognizer};
use crate::types::RecordedHand;

/// The models the interpreter uses.
pub struct Models {
    /// Every static one-handed letter (levels 1 and 2).
    pub static_letters: Classifier,
    /// Two-handed letters (level 4).
    pub two_hands: Classifier,
    /// DTW templates for the movement letters (level 3).
    pub movement: MovementRecognizer,
}

impl Models {
    /// `dir`: a language's `models/` folder, e.g. `ml/languages/aed/models`.
    pub fn load(dir: &Path) -> Result<Self, Error> {
        Self::from_json(
            &fs::read_to_string(dir.join("static/model.json"))?,
            &fs::read_to_string(dir.join("level-4/model.json"))?,
            &fs::read_to_string(dir.join("movement/model.json"))?,
        )
    }

    /// From the JSON text, for apps that bundle the models inside the binary.
    pub fn from_json(
        static_json: &str,
        two_hands_json: &str,
        movement_json: &str,
    ) -> Result<Self, Error> {
        Ok(Self {
            static_letters: classifier(serde_json::from_str(static_json)?)?,
            two_hands: classifier(serde_json::from_str(two_hands_json)?)?,
            movement: MovementRecognizer::new(serde_json::from_str::<MovementModelFile>(
                movement_json,
            )?)?,
        })
    }
}

/// Checks the location and two-hands versions, then builds the classifier.
pub fn classifier(file: ModelFile) -> Result<Classifier, Error> {
    let normalization = &file.normalization;
    if let Some(location) = &normalization.location
        && location.version != LOCATION_VERSION
    {
        return Err(Error::Version(format!(
            "Model {} uses location v{}, the app v{LOCATION_VERSION}. Retrain it.",
            file.name, location.version
        )));
    }
    if let Some(two_hands) = &normalization.two_hands
        && two_hands.version != TWO_HANDS_VERSION
    {
        return Err(Error::Version(format!(
            "Model {} uses two hands v{}, the app v{TWO_HANDS_VERSION}. Retrain it.",
            file.name, two_hands.version
        )));
    }
    Classifier::new(file)
}

/// Prepares one hand exactly like training did (ADR 0008) and classifies it. The
/// hand `MediaPipe` reports is used as the dominant hand. `None` if the input can't be
/// built (e.g. the model needs the face and there's none).
#[must_use]
pub fn classify_hand(
    classifier: &Classifier,
    hand: &RecordedHand,
    body: &[f64],
    width: f64,
    height: f64,
) -> Option<Prediction> {
    let mut input = normalize_hand(&hand.world, hand.handedness)?;
    if classifier.uses_location {
        let location = hand_location(&hand.landmarks, body, width, height, hand.handedness)?;
        input.extend(location);
    }
    Some(classifier.predict(&input))
}
