//! Movement letters (level 3) with DTW, same as `app/src/recognition/sequences.ts`
//! and `ml/signs/sequences.py`.

use std::collections::{HashMap, HashSet};

use serde::Deserialize;

use crate::Error;
use crate::features::{hand_location, normalize_hand};
use crate::types::RecordedHand;

/// Bump with `ml/signs/sequences.py` `SEQUENCE_VERSION`.
pub const SEQUENCE_VERSION: u32 = 1;

#[derive(Debug, Clone, Deserialize)]
pub struct SequenceInfo {
    pub version: u32,
    pub length: usize,
    pub trim: f64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Template {
    pub label: String,
    pub letter: String,
    pub frames: Vec<Vec<f64>>,
}

/// `models/movement/model.json` written by `ml/train_sequences.py`.
#[derive(Debug, Clone, Deserialize)]
pub struct MovementModelFile {
    pub sequence: SequenceInfo,
    pub threshold: f64,
    #[serde(default)]
    pub thresholds: Option<HashMap<String, f64>>,
    pub templates: Vec<Template>,
}

/// Wrist and index relative to the eyes (4) + where the palm faces (3).
#[must_use]
pub fn frame_vector(
    hand: &RecordedHand,
    body: &[f64],
    width: f64,
    height: f64,
) -> Option<[f64; 7]> {
    let location = hand_location(&hand.landmarks, body, width, height, hand.handedness)?;
    let shape = normalize_hand(&hand.world, hand.handedness)?;
    let n = shape.len();
    Some([
        location[0],
        location[1],
        location[2],
        location[3],
        shape[n - 3],
        shape[n - 2],
        shape[n - 1],
    ])
}

/// First index where the cumulative path reaches `target` (numpy searchsorted, left).
fn search_sorted(path: &[f64], target: f64) -> usize {
    path.iter()
        .position(|&value| value >= target)
        .unwrap_or(path.len())
}

/// Frame vectors -> `length` x 7: trimmed to where the index fingertip actually
/// moves (from `trim` to 1 - `trim` of its path), resampled evenly in time.
#[must_use]
pub fn movement_sequence(points: &[[f64; 7]], length: usize, trim: f64) -> Option<Vec<[f64; 7]>> {
    if points.len() < 8 {
        return None;
    }
    let mut path = vec![0.0];
    for pair in points.windows(2) {
        let step = (pair[1][2] - pair[0][2]).hypot(pair[1][3] - pair[0][3]);
        path.push(path[path.len() - 1] + step);
    }
    let total = path[path.len() - 1];
    if total < 1e-6 {
        return None;
    }
    let start = search_sorted(&path, total * trim);
    let end = search_sorted(&path, total * (1.0 - trim)) + 1;
    let moving = &points[start..end.max(start + 2).min(points.len())];
    let last = moving.len() - 1;
    let result = (0..length)
        .map(|k| {
            let position = (k * last) as f64 / (length - 1) as f64;
            let low = position.floor() as usize;
            let high = (low + 1).min(last);
            let fraction = position - low as f64;
            std::array::from_fn(|c| moving[low][c] + (moving[high][c] - moving[low][c]) * fraction)
        })
        .collect();
    Some(result)
}

/// Classic DTW, normalized by both lengths (same as `dtw_distance` in Python).
#[must_use]
pub fn dtw_distance<A: AsRef<[f64]>, B: AsRef<[f64]>>(a: &[A], b: &[B]) -> f64 {
    let m = b.len();
    let mut previous = vec![f64::INFINITY; m + 1];
    previous[0] = 0.0;
    let mut current = vec![f64::INFINITY; m + 1];
    for row in a {
        let row = row.as_ref();
        current[0] = f64::INFINITY;
        for j in 1..=m {
            let sum: f64 = row
                .iter()
                .zip(b[j - 1].as_ref())
                .map(|(x, y)| (x - y) * (x - y))
                .sum();
            current[j] = sum.sqrt() + previous[j - 1].min(previous[j]).min(current[j - 1]);
        }
        std::mem::swap(&mut previous, &mut current);
    }
    previous[m] / (a.len() + m) as f64
}

/// Diagonal of the index fingertip's bounding box, in eye distances (columns 2-3).
/// A trembling hand keeps it small: the back-and-forth doesn't add up.
#[must_use]
pub fn index_extent<P: AsRef<[f64]>>(points: &[P]) -> f64 {
    if points.is_empty() {
        return 0.0;
    }
    let (mut min_x, mut min_y) = (f64::INFINITY, f64::INFINITY);
    let (mut max_x, mut max_y) = (f64::NEG_INFINITY, f64::NEG_INFINITY);
    for point in points {
        let point = point.as_ref();
        min_x = min_x.min(point[2]);
        max_x = max_x.max(point[2]);
        min_y = min_y.min(point[3]);
        max_y = max_y.max(point[3]);
    }
    (max_x - min_x).hypot(max_y - min_y)
}

fn median(mut values: Vec<f64>) -> f64 {
    values.sort_by(f64::total_cmp);
    let middle = values.len() / 2;
    if values.len() % 2 == 1 {
        values[middle]
    } else {
        f64::midpoint(values[middle - 1], values[middle])
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct MovementPrediction {
    pub label: String,
    pub letter: String,
    pub distance: f64,
}

pub struct MovementRecognizer {
    model: MovementModelFile,
    /// Median index extent of each letter's templates.
    typical_extents: HashMap<String, f64>,
}

impl MovementRecognizer {
    pub fn new(model: MovementModelFile) -> Result<Self, Error> {
        if model.sequence.version != SEQUENCE_VERSION {
            return Err(Error::Version(format!(
                "Movement model uses sequence v{}, the app v{SEQUENCE_VERSION}. Rebuild it.",
                model.sequence.version
            )));
        }
        let mut extents: HashMap<String, Vec<f64>> = HashMap::new();
        for template in &model.templates {
            extents
                .entry(template.label.clone())
                .or_default()
                .push(index_extent(&template.frames));
        }
        let typical_extents = extents
            .into_iter()
            .map(|(label, values)| (label, median(values)))
            .collect();
        Ok(Self {
            model,
            typical_extents,
        })
    }

    /// Farthest a sequence can be from this letter's closest template (ADR 0012).
    #[must_use]
    pub fn threshold_for(&self, label: &str) -> f64 {
        self.model
            .thresholds
            .as_ref()
            .and_then(|thresholds| thresholds.get(label).copied())
            .unwrap_or(self.model.threshold)
    }

    /// How wide this letter's movement usually is, in eye distances.
    #[must_use]
    pub fn typical_extent(&self, label: &str) -> f64 {
        self.typical_extents.get(label).copied().unwrap_or(0.0)
    }

    /// Closest template, however far (`None`: too few frames). `exclude`: labels left out.
    #[must_use]
    pub fn nearest(
        &self,
        points: &[[f64; 7]],
        exclude: &HashSet<&str>,
    ) -> Option<MovementPrediction> {
        let sequence =
            movement_sequence(points, self.model.sequence.length, self.model.sequence.trim)?;
        let mut best: Option<MovementPrediction> = None;
        for template in &self.model.templates {
            if exclude.contains(template.label.as_str()) {
                continue;
            }
            let distance = dtw_distance(&sequence, &template.frames);
            if best.as_ref().is_none_or(|b| distance < b.distance) {
                best = Some(MovementPrediction {
                    label: template.label.clone(),
                    letter: template.letter.clone(),
                    distance,
                });
            }
        }
        best
    }

    /// Closest template, only if it's under its letter's threshold.
    #[must_use]
    pub fn recognize(&self, points: &[[f64; 7]]) -> Option<MovementPrediction> {
        self.nearest(points, &HashSet::new())
            .filter(|best| best.distance <= self.threshold_for(&best.label))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dtw_ignores_speed() {
        let slow: Vec<[f64; 1]> = [0.0, 0.0, 1.0, 1.0, 2.0, 2.0].map(|v| [v]).to_vec();
        let fast: Vec<[f64; 1]> = [0.0, 1.0, 2.0].map(|v| [v]).to_vec();
        assert!(dtw_distance(&slow, &fast).abs() < 1e-12);
        let other: Vec<[f64; 1]> = [2.0, 1.0, 0.0].map(|v| [v]).to_vec();
        assert!(dtw_distance(&slow, &other) > 0.5);
    }

    #[test]
    fn resamples_to_length() {
        let points: Vec<[f64; 7]> = (0..10)
            .map(|i| [0.0, 0.0, f64::from(i), 0.0, 0.0, 0.0, 1.0])
            .collect();
        let sequence = movement_sequence(&points, 32, 0.0).unwrap();
        assert_eq!(sequence.len(), 32);
        assert!((sequence[31][2] - 9.0).abs() < 1e-12);
    }

    #[test]
    fn extent_is_bounding_box_diagonal() {
        let points = [
            [0.0, 0.0, 0.0, 0.0],
            [0.0, 0.0, 3.0, 4.0],
            [0.0, 0.0, 1.0, 1.0],
        ];
        assert!((index_extent(&points) - 5.0).abs() < 1e-12);
    }
}
