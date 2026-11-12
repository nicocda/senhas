//! Rotated regions of the image, as `MediaPipe`'s `NormalizedRect` and the
//! calculators that move them around (`RectTransformationCalculator`,
//! `DetectionsToRectsCalculator`, `HandLandmarksToRectCalculator`).

use std::f32::consts::PI;

/// A rotated rectangle, normalized to the image (0..1 on both axes).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x_center: f32,
    pub y_center: f32,
    pub width: f32,
    pub height: f32,
    /// Radians, clockwise on the image (y points down).
    pub rotation: f32,
}

/// Wraps an angle to [-π, π).
#[must_use]
pub fn normalize_radians(angle: f32) -> f32 {
    angle - 2.0 * PI * ((angle + PI) / (2.0 * PI)).floor()
}

/// The rotation that makes the vector `from` -> `to` (in pixels) point up.
#[must_use]
pub fn rotation_to_vertical(from: (f32, f32), to: (f32, f32)) -> f32 {
    normalize_radians(PI * 0.5 - (-(to.1 - from.1)).atan2(to.0 - from.0))
}

/// `RectTransformationCalculator` options.
#[derive(Debug, Clone, Copy)]
pub struct Transform {
    pub scale: f32,
    pub shift_y: f32,
}

/// Palm detection -> region for the landmarks model.
pub const PALM_TO_HAND: Transform = Transform {
    scale: 2.6,
    shift_y: -0.5,
};
/// Landmarks -> region for the next frame (tracking).
pub const LANDMARKS_TO_HAND: Transform = Transform {
    scale: 2.0,
    shift_y: -0.1,
};

/// Shifts the rect along its own (rotated) vertical axis, makes it square on its
/// longer side, in pixels, and scales it. `width`, `height`: the image size.
#[must_use]
pub fn transform(rect: Rect, transform: Transform, width: f32, height: f32) -> Rect {
    let mut result = rect;
    if rect.rotation == 0.0 {
        result.y_center += rect.height * transform.shift_y;
    } else {
        let (sin, cos) = rect.rotation.sin_cos();
        let shift = height * rect.height * transform.shift_y;
        result.x_center += -shift * sin / width;
        result.y_center += shift * cos / height;
    }
    let long_side = (rect.width * width).max(rect.height * height);
    result.width = long_side / width * transform.scale;
    result.height = long_side / height * transform.scale;
    result
}

/// Next frame's hand region from this frame's landmarks (normalized, 21 points).
#[must_use]
pub fn rect_from_landmarks(landmarks: &[[f32; 3]; 21], width: f32, height: f32) -> Rect {
    // The base of the hand: wrist, and the knuckles of the index, middle and ring fingers.
    const WRIST: usize = 0;
    const INDEX_MCP: usize = 5;
    const MIDDLE_MCP: usize = 9;
    const RING_MCP: usize = 13;
    let px = |i: usize| (landmarks[i][0] * width, landmarks[i][1] * height);
    let (x0, y0) = px(WRIST);
    let x1 = f32::midpoint(
        f32::midpoint(px(INDEX_MCP).0, px(RING_MCP).0),
        px(MIDDLE_MCP).0,
    );
    let y1 = f32::midpoint(
        f32::midpoint(px(INDEX_MCP).1, px(RING_MCP).1),
        px(MIDDLE_MCP).1,
    );
    let rotation = rotation_to_vertical((x0, y0), (x1, y1));

    // Bounding box of the palm and finger bases, aligned with the hand's rotation.
    let points = partial_landmarks(landmarks);
    let (min_x, max_x, min_y, max_y) = bounds(points.iter().map(|p| (p[0], p[1])));
    let center = (f32::midpoint(max_x, min_x), f32::midpoint(max_y, min_y));
    let reverse = normalize_radians(-rotation);
    let (sin, cos) = reverse.sin_cos();
    let projected = points.iter().map(|p| {
        let x = (p[0] - center.0) * width;
        let y = (p[1] - center.1) * height;
        (x * cos - y * sin, x * sin + y * cos)
    });
    let (min_x, max_x, min_y, max_y) = bounds(projected);
    let projected_center = (f32::midpoint(max_x, min_x), f32::midpoint(max_y, min_y));
    let (sin, cos) = rotation.sin_cos();
    let x_center = projected_center.0 * cos - projected_center.1 * sin + width * center.0;
    let y_center = projected_center.0 * sin + projected_center.1 * cos + height * center.1;
    Rect {
        x_center: x_center / width,
        y_center: y_center / height,
        width: (max_x - min_x) / width,
        height: (max_y - min_y) / height,
        rotation,
    }
}

/// The landmarks `MediaPipe` uses for the region: wrist, thumb base and the two
/// lower joints of each finger (the fingertips move too much).
fn partial_landmarks(landmarks: &[[f32; 3]; 21]) -> Vec<[f32; 3]> {
    [0, 1, 2, 3, 5, 6, 9, 10, 13, 14, 17, 18]
        .into_iter()
        .map(|i| landmarks[i])
        .collect()
}

fn bounds(points: impl Iterator<Item = (f32, f32)>) -> (f32, f32, f32, f32) {
    points.fold(
        (f32::MAX, f32::MIN, f32::MAX, f32::MIN),
        |(min_x, max_x, min_y, max_y), (x, y)| {
            (min_x.min(x), max_x.max(x), min_y.min(y), max_y.max(y))
        },
    )
}

/// Intersection over union of two axis-aligned boxes `(xmin, ymin, width, height)`.
#[must_use]
pub fn iou(a: (f32, f32, f32, f32), b: (f32, f32, f32, f32)) -> f32 {
    let left = a.0.max(b.0);
    let top = a.1.max(b.1);
    let right = (a.0 + a.2).min(b.0 + b.2);
    let bottom = (a.1 + a.3).min(b.1 + b.3);
    if right <= left || bottom <= top {
        return 0.0;
    }
    let intersection = (right - left) * (bottom - top);
    intersection / (a.2 * a.3 + b.2 * b.3 - intersection)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upward_vector_needs_no_rotation() {
        assert!(rotation_to_vertical((0.0, 10.0), (0.0, 0.0)).abs() < 1e-6);
        // Pointing right: rotate a quarter turn.
        assert!((rotation_to_vertical((0.0, 0.0), (10.0, 0.0)) - PI / 2.0).abs() < 1e-6);
    }

    #[test]
    fn normalize_wraps() {
        assert!((normalize_radians(3.0 * PI) + PI).abs() < 1e-5);
        assert!((normalize_radians(0.5) - 0.5).abs() < 1e-6);
    }

    #[test]
    fn transform_squares_and_scales() {
        let rect = Rect {
            x_center: 0.5,
            y_center: 0.5,
            width: 0.1,
            height: 0.2,
            rotation: 0.0,
        };
        let out = transform(rect, PALM_TO_HAND, 200.0, 100.0);
        // Long side 20 px -> 52 px: 0.26 of the width, 0.52 of the height.
        assert!((out.width - 0.26).abs() < 1e-6 && (out.height - 0.52).abs() < 1e-6);
        assert!((out.y_center - 0.4).abs() < 1e-6);
    }
}
