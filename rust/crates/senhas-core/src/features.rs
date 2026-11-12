//! Same normalization as `app/src/dataset/features.ts` and `ml/signs/features.py`
//! (ADR 0008): bump the versions in all three on any change.
//!
//! Only what recognition needs; the capture-only helpers (`indexTravel`, `steadyMs`)
//! stay in the React Native app.

use crate::types::{Hand, RecordedHand};

/// v2: + palm normal (orientation, e.g. U vs V).
pub const NORMALIZATION_VERSION: u32 = 2;
pub const LOCATION_VERSION: u32 = 1;
pub const TWO_HANDS_VERSION: u32 = 1;

const POINTS: usize = 21;
const INDEX_MCP: usize = 5;
const MIDDLE_MCP: usize = 9;
const PINKY_MCP: usize = 17;
const INDEX_TIP: usize = 8;
const FACE_KEYPOINTS: usize = 6;
/// The 21 points; the palm normal comes after them.
pub const POINT_FEATURES: usize = POINTS * 3;

fn hypot3(x: f64, y: f64, z: f64) -> f64 {
    (x * x + y * y + z * z).sqrt()
}

/// World landmarks (flat x, y, z in meters) -> 66 numbers: the 21 points with the
/// wrist at the origin, scaled by the wrist -> middle knuckle distance, mirrored on
/// x for left hands (rotation kept on purpose); then the palm normal, a unit vector
/// computed on the mirrored points. `None` if the hand is degenerate.
#[must_use]
pub fn normalize_hand(world: &[f64], hand: Hand) -> Option<Vec<f64>> {
    if world.len() != POINT_FEATURES {
        return None;
    }
    let (wx, wy, wz) = (world[0], world[1], world[2]);
    let mirror = hand.mirror();
    let scale = hypot3(
        (world[MIDDLE_MCP * 3] - wx) * mirror,
        world[MIDDLE_MCP * 3 + 1] - wy,
        world[MIDDLE_MCP * 3 + 2] - wz,
    );
    if scale < 1e-6 {
        return None;
    }
    let mut features = Vec::with_capacity(POINT_FEATURES + 3);
    for i in 0..POINTS {
        features.push((world[i * 3] - wx) * mirror / scale);
        features.push((world[i * 3 + 1] - wy) / scale);
        features.push((world[i * 3 + 2] - wz) / scale);
    }
    let a = &features[INDEX_MCP * 3..INDEX_MCP * 3 + 3];
    let b = &features[PINKY_MCP * 3..PINKY_MCP * 3 + 3];
    let normal = [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ];
    let length = hypot3(normal[0], normal[1], normal[2]);
    if length < 1e-6 {
        return None;
    }
    features.extend(normal.map(|value| value / length));
    Some(features)
}

/// Point `i` of flat normalized coordinates, in pixels.
fn pixel(values: &[f64], i: usize, width: f64, height: f64) -> (f64, f64) {
    (values[i * 3] * width, values[i * 3 + 1] * height)
}

/// Wrist and index fingertip relative to the midpoint between the eyes, in eye
/// distances (pixels on both axes). Mirrored on x for left hands. `None` without a face.
#[must_use]
pub fn hand_location(
    landmarks: &[f64],
    body: &[f64],
    width: f64,
    height: f64,
    hand: Hand,
) -> Option<[f64; 4]> {
    if body.len() < FACE_KEYPOINTS * 3 || width <= 0.0 || height <= 0.0 {
        return None;
    }
    let (lx, ly) = pixel(body, 0, width, height);
    let (rx, ry) = pixel(body, 1, width, height);
    let eyes = (f64::midpoint(lx, rx), f64::midpoint(ly, ry));
    let unit = (lx - rx).hypot(ly - ry);
    if unit < 1.0 {
        return None;
    }
    Some(relative_points(landmarks, eyes, unit, width, height, hand))
}

fn relative_points(
    landmarks: &[f64],
    origin: (f64, f64),
    unit: f64,
    width: f64,
    height: f64,
    hand: Hand,
) -> [f64; 4] {
    let mirror = hand.mirror();
    let (x0, y0) = pixel(landmarks, 0, width, height);
    let (x1, y1) = pixel(landmarks, INDEX_TIP, width, height);
    [
        (x0 - origin.0) / unit * mirror,
        (y0 - origin.1) / unit,
        (x1 - origin.0) / unit * mirror,
        (y1 - origin.1) / unit,
    ]
}

/// Wrist and index fingertip of the other hand relative to the dominant wrist, in
/// units of the dominant hand's size (wrist -> middle knuckle), in pixels.
#[must_use]
pub fn other_hand_position(
    dominant: &[f64],
    other: &[f64],
    width: f64,
    height: f64,
    hand: Hand,
) -> Option<[f64; 4]> {
    if width <= 0.0 || height <= 0.0 {
        return None;
    }
    let (wx, wy) = pixel(dominant, 0, width, height);
    let (mx, my) = pixel(dominant, MIDDLE_MCP, width, height);
    let unit = (mx - wx).hypot(my - wy);
    if unit < 1.0 {
        return None;
    }
    Some(relative_points(other, (wx, wy), unit, width, height, hand))
}

/// Both hands -> dominant shape (66) + other shape (66) + other position (4).
#[must_use]
pub fn two_hands(
    hands: &[RecordedHand],
    width: f64,
    height: f64,
    dominant_hand: Hand,
) -> Option<Vec<f64>> {
    if hands.len() != 2 {
        return None;
    }
    let other_side = dominant_hand.opposite();
    let dominant = hands.iter().find(|h| h.handedness == dominant_hand)?;
    let other = hands.iter().find(|h| h.handedness == other_side)?;
    let mut input = normalize_hand(&dominant.world, dominant_hand)?;
    let shape_b = normalize_hand(&other.world, other_side)?;
    let position = other_hand_position(
        &dominant.landmarks,
        &other.landmarks,
        width,
        height,
        dominant_hand,
    )?;
    input.extend(shape_b);
    input.extend(position);
    Some(input)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A right hand: wrist at the origin, middle knuckle 1 up, index and pinky knuckles apart.
    fn sample_world() -> Vec<f64> {
        let mut world = vec![0.0; POINT_FEATURES];
        world[MIDDLE_MCP * 3 + 1] = 0.08;
        world[INDEX_MCP * 3] = -0.02;
        world[INDEX_MCP * 3 + 1] = 0.08;
        world[PINKY_MCP * 3] = 0.03;
        world[PINKY_MCP * 3 + 1] = 0.07;
        world
    }

    #[test]
    fn normalize_scales_by_hand_size_and_adds_palm_normal() {
        let features = normalize_hand(&sample_world(), Hand::Right).unwrap();
        assert_eq!(features.len(), 66);
        assert!((features[MIDDLE_MCP * 3 + 1] - 1.0).abs() < 1e-12);
        let normal = &features[63..];
        assert!((hypot3(normal[0], normal[1], normal[2]) - 1.0).abs() < 1e-12);
    }

    #[test]
    fn left_hand_mirrors_x() {
        let mut left = sample_world();
        for i in 0..POINTS {
            left[i * 3] = -left[i * 3];
        }
        let a = normalize_hand(&sample_world(), Hand::Right).unwrap();
        let b = normalize_hand(&left, Hand::Left).unwrap();
        for (x, y) in a.iter().zip(&b) {
            assert!((x - y).abs() < 1e-12);
        }
    }

    #[test]
    fn degenerate_hand_is_none() {
        assert!(normalize_hand(&vec![0.0; POINT_FEATURES], Hand::Right).is_none());
        assert!(normalize_hand(&[0.0; 3], Hand::Right).is_none());
    }
}
