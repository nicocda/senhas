//! SSD-style detectors (palm and face, both from the `BlazeFace` family): anchors,
//! decoding of the raw outputs, and weighted non-maximum suppression. Same as
//! `MediaPipe`'s `SsdAnchorsCalculator`, `TensorsToDetectionsCalculator` and
//! `NonMaxSuppressionCalculator` (WEIGHTED, intersection over union).

use crate::geometry::iou;
use crate::image::Padding;

#[derive(Debug, Clone, Copy)]
pub struct DetectorSpec {
    /// Square input, in pixels.
    pub input_size: usize,
    pub strides: &'static [usize],
    /// Numbers per anchor: 4 for the box, then x and y of each keypoint.
    pub coords: usize,
    pub keypoints: usize,
    pub min_score: f32,
    pub nms_threshold: f32,
}

/// `hand_detector.tflite` (palm detection, 2016 anchors).
pub const PALM: DetectorSpec = DetectorSpec {
    input_size: 192,
    strides: &[8, 16, 16, 16],
    coords: 18,
    keypoints: 7,
    min_score: 0.5,
    nms_threshold: 0.3,
};

/// `blaze_face_short_range.tflite` (896 anchors).
pub const FACE: DetectorSpec = DetectorSpec {
    input_size: 128,
    strides: &[8, 16, 16, 16],
    coords: 16,
    keypoints: 6,
    min_score: 0.5,
    nms_threshold: 0.3,
};

/// A detection, normalized to the image.
#[derive(Debug, Clone, PartialEq)]
pub struct Detection {
    pub score: f32,
    pub xmin: f32,
    pub ymin: f32,
    pub width: f32,
    pub height: f32,
    pub keypoints: Vec<(f32, f32)>,
}

impl Detection {
    fn bounds(&self) -> (f32, f32, f32, f32) {
        (self.xmin, self.ymin, self.width, self.height)
    }
}

/// Anchor centers, normalized. All anchors have size 1 (`fixed_anchor_size`): two
/// per cell and layer (aspect ratio 1 and the interpolated one), layers with the
/// same stride share their cells.
#[must_use]
pub fn anchors(spec: &DetectorSpec) -> Vec<(f32, f32)> {
    let mut anchors = Vec::new();
    let mut layer = 0;
    while layer < spec.strides.len() {
        let stride = spec.strides[layer];
        let mut per_cell = 0;
        while layer < spec.strides.len() && spec.strides[layer] == stride {
            per_cell += 2;
            layer += 1;
        }
        let cells = spec.input_size.div_ceil(stride);
        for y in 0..cells {
            for x in 0..cells {
                let center = (
                    (x as f32 + 0.5) / cells as f32,
                    (y as f32 + 0.5) / cells as f32,
                );
                anchors.extend(std::iter::repeat_n(center, per_cell));
            }
        }
    }
    anchors
}

/// Raw outputs (`boxes`: anchors x coords, `scores`: one logit per anchor) ->
/// detections over `min_score`, merged by weighted NMS, at most `max`, with the
/// letterbox removed.
#[must_use]
pub fn decode(
    spec: &DetectorSpec,
    anchors: &[(f32, f32)],
    boxes: &[f32],
    scores: &[f32],
    padding: Padding,
    max: usize,
) -> Vec<Detection> {
    let scale = spec.input_size as f32;
    let mut candidates = Vec::new();
    for (i, &(ax, ay)) in anchors.iter().enumerate() {
        let score = sigmoid(scores[i].clamp(-100.0, 100.0));
        if score < spec.min_score {
            continue;
        }
        let raw = &boxes[i * spec.coords..(i + 1) * spec.coords];
        let (x_center, y_center) = (raw[0] / scale + ax, raw[1] / scale + ay);
        let (width, height) = (raw[2] / scale, raw[3] / scale);
        let keypoints = (0..spec.keypoints)
            .map(|k| (raw[4 + k * 2] / scale + ax, raw[5 + k * 2] / scale + ay))
            .collect();
        candidates.push(Detection {
            score,
            xmin: x_center - width / 2.0,
            ymin: y_center - height / 2.0,
            width,
            height,
            keypoints,
        });
    }
    let mut detections = weighted_nms(candidates, spec.nms_threshold, max);
    for detection in &mut detections {
        remove_letterbox(detection, padding);
    }
    detections
}

fn sigmoid(x: f32) -> f32 {
    1.0 / (1.0 + (-x).exp())
}

/// Overlapping detections are averaged, weighted by their scores; the result keeps
/// the score of the best one.
fn weighted_nms(mut candidates: Vec<Detection>, threshold: f32, max: usize) -> Vec<Detection> {
    candidates.sort_by(|a, b| b.score.total_cmp(&a.score));
    let mut result = Vec::new();
    while !candidates.is_empty() && result.len() < max {
        let best = candidates[0].bounds();
        let (similar, rest): (Vec<_>, Vec<_>) = candidates
            .into_iter()
            .partition(|candidate| iou(best, candidate.bounds()) > threshold);
        candidates = rest;
        let total: f32 = similar.iter().map(|d| d.score).sum();
        let average = |value: &dyn Fn(&Detection) -> f32| {
            similar.iter().map(|d| d.score * value(d)).sum::<f32>() / total
        };
        let mut merged = similar[0].clone();
        merged.xmin = average(&|d| d.xmin);
        merged.ymin = average(&|d| d.ymin);
        let xmax = average(&|d| d.xmin + d.width);
        let ymax = average(&|d| d.ymin + d.height);
        merged.width = xmax - merged.xmin;
        merged.height = ymax - merged.ymin;
        for k in 0..merged.keypoints.len() {
            merged.keypoints[k] = (
                average(&|d| d.keypoints[k].0),
                average(&|d| d.keypoints[k].1),
            );
        }
        result.push(merged);
    }
    result
}

fn remove_letterbox(detection: &mut Detection, [left, top, right, bottom]: Padding) {
    let (sx, sy) = (1.0 - left - right, 1.0 - top - bottom);
    detection.xmin = (detection.xmin - left) / sx;
    detection.ymin = (detection.ymin - top) / sy;
    detection.width /= sx;
    detection.height /= sy;
    for point in &mut detection.keypoints {
        *point = ((point.0 - left) / sx, (point.1 - top) / sy);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anchor_counts_match_the_models() {
        assert_eq!(anchors(&PALM).len(), 2016);
        assert_eq!(anchors(&FACE).len(), 896);
    }
}
