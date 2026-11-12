//! Turns the stream of frames into text, same as `app/src/recognition/interpreter.ts`
//! (ADR 0012, Movement-Hold model): static letters are holds, movement letters are
//! compared with the DTW templates once the movement ends. Times in milliseconds.

use std::collections::HashSet;

use crate::classifier::Prediction;
use crate::features::two_hands;
use crate::models::{Models, classify_hand};
use crate::sequences::{frame_vector, index_extent};
use crate::types::{Hand, LiveFrame};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct InterpreterOptions {
    /// Below this confidence a frame doesn't vote for any letter.
    pub min_confidence: f64,
    /// How long the same letter has to be seen to be written.
    pub min_hold_ms: f64,
    /// A hold survives frames without a confident letter for this long.
    pub max_gap_ms: f64,
    /// Hysteresis on the fingertip's speed, in eye distances per second.
    pub movement_start_speed: f64,
    pub movement_stop_speed: f64,
    /// A movement ends after the hand stays under the stop speed this long.
    pub movement_stop_ms: f64,
    /// Letters written up to this long before a movement letter started are taken back.
    pub retract_ms: f64,
    /// A hold is the shape staying the same, even if the arm moves.
    pub hold_while_moving: bool,
}

impl Default for InterpreterOptions {
    fn default() -> Self {
        Self {
            min_confidence: 0.6,
            min_hold_ms: 350.0,
            max_gap_ms: 250.0,
            movement_start_speed: 3.0,
            movement_stop_speed: 1.5,
            movement_stop_ms: 150.0,
            retract_ms: 0.0,
            hold_while_moving: true,
        }
    }
}

/// The fingertip's speed is measured over this window.
const SPEED_WINDOW_MS: f64 = 200.0;
/// Frames before the movement started that still belong to it (the speed lags).
const MOVEMENT_PAD_MS: f64 = 200.0;
/// Without the hand this long, it left: the hold and the movement end.
const RELEASE_MS: f64 = 400.0;
/// Longer than this, it isn't one letter: only its last part is compared.
const MAX_MOVEMENT_MS: f64 = 3000.0;
/// The trajectory must be at least this share as wide as the letter's typical one.
const MIN_MOVEMENT_COMPLETENESS: f64 = 0.6;
/// Not recognized live: CH barely moves (ADR 0010).
const EXCLUDED_MOVEMENTS: [&str; 1] = ["CH"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HoldKind {
    Static,
    TwoHands,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Hypothesis {
    pub letter: String,
    pub kind: HoldKind,
    /// 0..1: how much of `min_hold_ms` the hold already lasted.
    pub progress: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct InterpreterState {
    /// Letters written so far.
    pub text: Vec<String>,
    /// The letter being held, before it's written.
    pub hypothesis: Option<Hypothesis>,
    /// The hand is moving: a movement letter or a transition, decided when it ends.
    pub moving: bool,
}

struct Hold {
    letter: String,
    kind: HoldKind,
    start: f64,
    last: f64,
    written: bool,
}

struct Written {
    letter: String,
    /// When the hold that wrote it started.
    at: f64,
}

struct Movement {
    start: f64,
    slow_since: Option<f64>,
}

pub type Log = Box<dyn FnMut(&str)>;

pub struct Interpreter<'m> {
    models: &'m Models,
    dominant_hand: Hand,
    options: InterpreterOptions,
    log: Option<Log>,
    written: Vec<Written>,
    hold: Option<Hold>,
    /// Recent fingertip positions (frame vectors), for the speed and for DTW.
    trail: Vec<(f64, [f64; 7])>,
    movement: Option<Movement>,
    /// The hand left the image since the last letter: the same letter can follow.
    released: bool,
    /// The shape a movement letter ended in: not written as a static letter.
    end_shape: Option<String>,
    handless_since: Option<f64>,
}

impl<'m> Interpreter<'m> {
    #[must_use]
    pub fn new(models: &'m Models, dominant_hand: Hand, options: InterpreterOptions) -> Self {
        Self {
            models,
            dominant_hand,
            options,
            log: None,
            written: Vec::new(),
            hold: None,
            trail: Vec::new(),
            movement: None,
            released: true,
            end_shape: None,
            handless_since: None,
        }
    }

    #[must_use]
    pub fn with_log(mut self, log: Log) -> Self {
        self.log = Some(log);
        self
    }

    pub fn push(&mut self, frame: &LiveFrame, now: f64) -> InterpreterState {
        if frame.hands.is_empty() {
            // A frame or two without the hand is the tracker losing it (blur).
            let since = *self.handless_since.get_or_insert(now);
            if now - since >= RELEASE_MS {
                self.end_movement(since);
                self.hold = None;
                self.trail.clear();
                self.released = true;
                self.end_shape = None;
            }
            return self.state();
        }
        self.handless_since = None;

        let kind = if frame.hands.len() == 1 {
            self.track(frame, now);
            HoldKind::Static
        } else {
            // Two-handed letters have no movement here.
            self.movement = None;
            self.trail.clear();
            HoldKind::TwoHands
        };
        let prediction = self.classify(frame);
        self.update_hold(prediction, kind, now);
        self.state()
    }

    /// Clears the text, keeping what the hand is doing.
    pub fn clear(&mut self) {
        self.written.clear();
        self.released = true;
    }

    #[must_use]
    pub fn state(&self) -> InterpreterState {
        let hypothesis = self.hold.as_ref().and_then(|hold| {
            (!hold.written && self.end_shape.as_deref() != Some(hold.letter.as_str())).then(|| {
                Hypothesis {
                    letter: hold.letter.clone(),
                    kind: hold.kind,
                    progress: ((hold.last - hold.start) / self.options.min_hold_ms).min(1.0),
                }
            })
        });
        InterpreterState {
            text: self.written.iter().map(|w| w.letter.clone()).collect(),
            hypothesis,
            moving: self.movement.is_some(),
        }
    }

    fn classify(&self, frame: &LiveFrame) -> Option<Prediction> {
        if frame.hands.len() == 2 {
            let input = two_hands(
                frame.hands,
                frame.image_width,
                frame.image_height,
                self.dominant_hand,
            )?;
            return Some(self.models.two_hands.predict(&input));
        }
        classify_hand(
            &self.models.static_letters,
            &frame.hands[0],
            frame.body,
            frame.image_width,
            frame.image_height,
        )
    }

    fn update_hold(&mut self, prediction: Option<Prediction>, kind: HoldKind, now: f64) {
        let letter = prediction
            .filter(|p| f64::from(p.confidence) >= self.options.min_confidence)
            .map(|p| p.letter);
        if self
            .hold
            .as_ref()
            .is_some_and(|hold| now - hold.last > self.options.max_gap_ms)
        {
            self.hold = None;
        }
        let Some(letter) = letter else {
            return;
        };
        match &mut self.hold {
            Some(hold) if hold.letter == letter => hold.last = now,
            _ => {
                if self.end_shape.as_ref() != Some(&letter) {
                    self.end_shape = None;
                }
                self.hold = Some(Hold {
                    letter,
                    kind,
                    start: now,
                    last: now,
                    written: false,
                });
            }
        }

        let options = self.options;
        let moving = self.movement.is_some();
        let Some(current) = self.hold.as_mut() else {
            return;
        };
        if current.written
            || (moving && !options.hold_while_moving)
            || self.end_shape.as_ref() == Some(&current.letter)
            || current.last - current.start < options.min_hold_ms
        {
            return;
        }
        current.written = true;
        // The same letter right after itself is the same hold, split by a glitch.
        if !self.released
            && self
                .written
                .last()
                .is_some_and(|w| w.letter == current.letter)
        {
            return;
        }
        self.written.push(Written {
            letter: current.letter.clone(),
            at: current.start,
        });
        self.released = false;
    }

    /// Follows the fingertip's speed: starts and ends movements.
    fn track(&mut self, frame: &LiveFrame, now: f64) {
        let Some(vector) = frame_vector(
            &frame.hands[0],
            frame.body,
            frame.image_width,
            frame.image_height,
        ) else {
            // No face: no position to measure the movement against.
            return;
        };
        self.trail.push((now, vector));
        self.trail
            .retain(|(t, _)| now - t <= MAX_MOVEMENT_MS + MOVEMENT_PAD_MS);

        let Some(speed) = self.speed(now) else {
            return;
        };
        let options = self.options;
        let Some(movement) = self.movement.as_mut() else {
            if speed >= options.movement_start_speed {
                self.movement = Some(Movement {
                    start: now - SPEED_WINDOW_MS,
                    slow_since: None,
                });
            }
            return;
        };
        if speed >= options.movement_stop_speed {
            movement.slow_since = None;
        } else {
            let slow_since = *movement.slow_since.get_or_insert(now);
            if now - slow_since >= options.movement_stop_ms {
                self.end_movement(slow_since);
            }
        }
    }

    /// Fingertip speed over the last `SPEED_WINDOW_MS`, in eye distances per second.
    fn speed(&self, now: f64) -> Option<f64> {
        let first = self
            .trail
            .iter()
            .find(|(t, _)| now - t <= SPEED_WINDOW_MS)?;
        let last = self.trail.last()?;
        if last.0 - first.0 < SPEED_WINDOW_MS / 2.0 {
            return None;
        }
        let distance = (last.1[2] - first.1[2]).hypot(last.1[3] - first.1[3]);
        Some(distance / ((last.0 - first.0) / 1000.0))
    }

    /// The movement ended at `end`: was it a whole movement letter?
    fn end_movement(&mut self, end: f64) {
        let Some(movement) = self.movement.take() else {
            return;
        };
        let from = (movement.start - MOVEMENT_PAD_MS).max(end - MAX_MOVEMENT_MS);
        let points: Vec<[f64; 7]> = self
            .trail
            .iter()
            .filter(|(t, _)| *t >= from && *t <= end)
            .map(|(_, vector)| *vector)
            .collect();
        let recognizer = &self.models.movement;
        let excluded: HashSet<&str> = EXCLUDED_MOVEMENTS.into_iter().collect();
        let Some(nearest) = recognizer.nearest(&points, &excluded) else {
            return;
        };
        let extent = index_extent(&points);
        let threshold = recognizer.threshold_for(&nearest.label);
        let required = MIN_MOVEMENT_COMPLETENESS * recognizer.typical_extent(&nearest.label);
        let accepted = nearest.distance <= threshold && extent >= required;
        if let Some(log) = self.log.as_mut() {
            log(&format!(
                "Movimiento {} ms: {} {:.2} (umbral {threshold:.2}), amplitud {extent:.1} (mín. {required:.1}) → {}",
                (end - movement.start).round(),
                nearest.label,
                nearest.distance,
                if accepted {
                    &nearest.letter
                } else {
                    "transición"
                },
            ));
        }
        if !accepted {
            return;
        }
        // Letters written since the movement started were its first shape.
        while self
            .written
            .last()
            .is_some_and(|w| w.at >= from - self.options.retract_ms)
        {
            self.written.pop();
        }
        self.written.push(Written {
            letter: nearest.letter,
            at: movement.start,
        });
        self.released = false;
        // The shape the hand stops in belongs to the movement letter.
        self.end_shape = self.hold.as_ref().map(|hold| hold.letter.clone());
        if let Some(hold) = self.hold.as_mut() {
            hold.written = true;
        }
    }
}
