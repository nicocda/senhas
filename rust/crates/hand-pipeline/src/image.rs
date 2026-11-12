//! An RGB image in memory, and the crop that turns a rotated region of it into a
//! model's input tensor, the same way `MediaPipe`'s `ImageToTensorCalculator` does
//! on the CPU (`OpenCV` `warpPerspective`, bilinear, fixed point).

use std::path::Path;

use crate::geometry::Rect;

/// 8-bit RGB, row by row, no padding.
#[derive(Debug, Clone)]
pub struct RgbImage {
    pub width: usize,
    pub height: usize,
    pub data: Vec<u8>,
}

impl RgbImage {
    /// Binary PPM (`P6`, maxval 255): what the parity reference writes.
    pub fn read_ppm(path: &Path) -> std::io::Result<Self> {
        let bytes = std::fs::read(path)?;
        let invalid = || std::io::Error::new(std::io::ErrorKind::InvalidData, "not a P6 PPM");
        let mut fields = Vec::new();
        let mut position = 0;
        while fields.len() < 4 {
            while bytes
                .get(position)
                .ok_or_else(invalid)?
                .is_ascii_whitespace()
            {
                position += 1;
            }
            let start = position;
            while !bytes
                .get(position)
                .ok_or_else(invalid)?
                .is_ascii_whitespace()
            {
                position += 1;
            }
            fields.push(String::from_utf8_lossy(&bytes[start..position]).into_owned());
        }
        let number = |i: usize| fields[i].parse::<usize>().map_err(|_| invalid());
        if fields[0] != "P6" || number(3)? != 255 {
            return Err(invalid());
        }
        let (width, height) = (number(1)?, number(2)?);
        let data = bytes
            .get(position + 1..position + 1 + width * height * 3)
            .ok_or_else(invalid)?
            .to_vec();
        Ok(Self {
            width,
            height,
            data,
        })
    }
}

/// What happens to the pixels outside the image.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Border {
    /// Black (the palm and face detectors).
    Zero,
    /// The nearest edge pixel (`MediaPipe`'s default, the hand landmarks model).
    Replicate,
}

/// Letterbox added to keep the aspect ratio, as fractions of the tensor:
/// left, top, right, bottom.
pub type Padding = [f32; 4];

/// Fixed-point precision of `OpenCV`'s bilinear interpolation: 1/32 of a pixel.
const INTER_BITS: i32 = 5;
const INTER_TAB_SIZE: i32 = 1 << INTER_BITS;

/// Crops `rect` (normalized, rotated) to a `size` x `size` RGB tensor with values
/// mapped from 0..255 to `range`. With `keep_aspect_ratio` the region is first
/// padded to a square, and the padding is returned (to remove it from the outputs).
#[must_use]
pub fn crop_to_tensor(
    image: &RgbImage,
    rect: Option<&Rect>,
    size: usize,
    range: (f32, f32),
    border: Border,
    keep_aspect_ratio: bool,
) -> (Vec<f32>, Padding) {
    let (w, h) = (image.width as f32, image.height as f32);
    // GetRoi: the rect in pixels (no rect: the whole image).
    let (cx, cy, mut rw, mut rh, rotation) = match rect {
        Some(r) => (
            r.x_center * w,
            r.y_center * h,
            r.width * w,
            r.height * h,
            r.rotation,
        ),
        None => (w / 2.0, h / 2.0, w, h, 0.0),
    };
    // PadRoi, for a square tensor.
    let mut padding = [0.0; 4];
    if keep_aspect_ratio {
        let roi_aspect = rh / rw;
        if roi_aspect < 1.0 {
            let vertical = (1.0 - roi_aspect) / 2.0;
            rh = rw;
            padding = [0.0, vertical, 0.0, vertical];
        } else {
            let horizontal = (1.0 - 1.0 / roi_aspect) / 2.0;
            rw = rh;
            padding = [horizontal, 0.0, horizontal, 0.0];
        }
    }

    // cv::RotatedRect::points: top-left, top-right and bottom-left corners.
    let (sin, cos) = rotation.sin_cos();
    let (a, b) = (f64::from(sin * 0.5), f64::from(cos * 0.5));
    let (cx, cy, rw, rh) = (f64::from(cx), f64::from(cy), f64::from(rw), f64::from(rh));
    let top_left = (cx + a * rh - b * rw, cy - b * rh - a * rw);
    let bottom_left = (cx - a * rh - b * rw, cy + b * rh - a * rw);
    let top_right = (2.0 * cx - bottom_left.0, 2.0 * cy - bottom_left.1);
    let n = size as f64;
    let du = (
        (top_right.0 - top_left.0) / n,
        (top_right.1 - top_left.1) / n,
    );
    let dv = (
        (bottom_left.0 - top_left.0) / n,
        (bottom_left.1 - top_left.1) / n,
    );

    let scale = (range.1 - range.0) / 255.0;
    let mut tensor = Vec::with_capacity(size * size * 3);
    for v in 0..size {
        for u in 0..size {
            let (u, v) = (u as f64, v as f64);
            let sx = top_left.0 + u * du.0 + v * dv.0;
            let sy = top_left.1 + u * du.1 + v * dv.1;
            let pixel = sample(image, sx, sy, border);
            tensor.extend(pixel.map(|value| f32::from(value) * scale + range.0));
        }
    }
    (tensor, padding)
}

/// `OpenCV` bilinear on 8-bit pixels: the position rounded to 1/32 of a pixel,
/// weights in 1/1024ths, the result rounded back to 8 bits.
fn sample(image: &RgbImage, x: f64, y: f64, border: Border) -> [u8; 3] {
    let fixed_x = (x * f64::from(INTER_TAB_SIZE)).round() as i32;
    let fixed_y = (y * f64::from(INTER_TAB_SIZE)).round() as i32;
    let (x0, y0) = (fixed_x >> INTER_BITS, fixed_y >> INTER_BITS);
    let (ix, iy) = (
        fixed_x & (INTER_TAB_SIZE - 1),
        fixed_y & (INTER_TAB_SIZE - 1),
    );
    let weights = [
        (INTER_TAB_SIZE - ix) * (INTER_TAB_SIZE - iy),
        ix * (INTER_TAB_SIZE - iy),
        (INTER_TAB_SIZE - ix) * iy,
        ix * iy,
    ];
    let neighbours = [(x0, y0), (x0 + 1, y0), (x0, y0 + 1), (x0 + 1, y0 + 1)];
    let mut result = [0u8; 3];
    for (channel, out) in result.iter_mut().enumerate() {
        let mut sum = 0i32;
        for (&(px, py), weight) in neighbours.iter().zip(weights) {
            sum += weight * i32::from(pixel(image, px, py, border, channel));
        }
        // Weights add up to 1024 = 2^15 / 32: the same rounding as OpenCV's 2^15 scale.
        *out = ((sum * 32 + (1 << 14)) >> 15).clamp(0, 255) as u8;
    }
    result
}

fn pixel(image: &RgbImage, x: i32, y: i32, border: Border, channel: usize) -> u8 {
    let (width, height) = (image.width as i32, image.height as i32);
    let (x, y) = match border {
        Border::Zero if x < 0 || y < 0 || x >= width || y >= height => return 0,
        Border::Zero => (x, y),
        Border::Replicate => (x.clamp(0, width - 1), y.clamp(0, height - 1)),
    };
    image.data[(y as usize * image.width + x as usize) * 3 + channel]
}
