//! Vote over the last frames, same as `app/src/recognition/smoothing.ts`.

use std::collections::VecDeque;

use crate::classifier::Prediction;

/// ~0.7 s at the phone's ~15 FPS.
const WINDOW: usize = 10;
/// The letter must win this share of the window...
const MIN_VOTES: f64 = 0.6;
/// ...with at least this average confidence.
const MIN_CONFIDENCE: f64 = 0.6;

#[derive(Debug, Clone, PartialEq)]
pub struct SmoothedPrediction {
    pub letter: String,
    pub label: String,
    /// Average confidence of the frames that voted for it.
    pub confidence: f64,
}

/// Only answers when one letter clearly wins the last frames; otherwise `None`.
#[derive(Default)]
pub struct PredictionSmoother {
    recent: VecDeque<Prediction>,
}

impl PredictionSmoother {
    pub fn push(&mut self, prediction: Prediction) -> Option<SmoothedPrediction> {
        self.recent.push_back(prediction);
        if self.recent.len() > WINDOW {
            self.recent.pop_front();
        }
        // Groups in order of first appearance; on a tie the first group wins, as in TS.
        let mut groups: Vec<(&str, Vec<&Prediction>)> = Vec::new();
        for item in &self.recent {
            match groups.iter_mut().find(|(label, _)| *label == item.label) {
                Some((_, group)) => group.push(item),
                None => groups.push((&item.label, vec![item])),
            }
        }
        let mut winner: &[&Prediction] = &[];
        for (_, group) in &groups {
            if group.len() > winner.len() {
                winner = group;
            }
        }
        let confidence = winner
            .iter()
            .map(|item| f64::from(item.confidence))
            .sum::<f64>()
            / winner.len() as f64;
        if (winner.len() as f64) < WINDOW as f64 * MIN_VOTES || confidence < MIN_CONFIDENCE {
            return None;
        }
        Some(SmoothedPrediction {
            letter: winner[0].letter.clone(),
            label: winner[0].label.clone(),
            confidence,
        })
    }

    /// No hand: start over, so an old letter doesn't linger.
    pub fn reset(&mut self) {
        self.recent.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prediction(letter: &str, confidence: f32) -> Prediction {
        Prediction {
            label: letter.into(),
            letter: letter.into(),
            confidence,
        }
    }

    #[test]
    fn needs_six_of_ten_confident_votes() {
        let mut smoother = PredictionSmoother::default();
        for _ in 0..5 {
            assert!(smoother.push(prediction("A", 0.9)).is_none());
        }
        assert_eq!(smoother.push(prediction("A", 0.9)).unwrap().letter, "A");
        smoother.reset();
        for _ in 0..10 {
            assert!(smoother.push(prediction("B", 0.5)).is_none());
        }
    }
}
