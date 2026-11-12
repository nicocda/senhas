//! The senhas app, 100% Rust (ADR 0013): Slint for the UI, the NDK for the
//! camera, `hand-pipeline` for `MediaPipe`'s models and `senhas-core` for the letters.

slint::include_modules!();

#[cfg(target_os = "android")]
mod android;
#[cfg(target_os = "android")]
mod camera;
#[cfg(target_os = "android")]
mod permission;
pub mod recognizer;

/// The frame for the UI; `mirror` for the front camera, like a selfie. The image
/// itself stays as the camera sees it: that one goes to the models.
#[must_use]
pub fn display_buffer(
    image: &hand_pipeline::image::RgbImage,
    mirror: bool,
) -> slint::SharedPixelBuffer<slint::Rgb8Pixel> {
    let mut buffer =
        slint::SharedPixelBuffer::<slint::Rgb8Pixel>::new(image.width as u32, image.height as u32);
    let pixels = buffer.make_mut_bytes();
    if !mirror {
        pixels.copy_from_slice(&image.data);
        return buffer;
    }
    let row = image.width * 3;
    for (out, input) in pixels
        .chunks_exact_mut(row)
        .zip(image.data.chunks_exact(row))
    {
        let (out, _) = out.as_chunks_mut::<3>();
        let (input, _) = input.as_chunks::<3>();
        for (dst, src) in out.iter_mut().zip(input.iter().rev()) {
            *dst = *src;
        }
    }
    buffer
}

/// `MediaPipe`'s hand connections: the bones drawn over the preview.
const BONES: [(usize, usize); 21] = [
    (0, 1),
    (1, 2),
    (2, 3),
    (3, 4),
    (0, 5),
    (5, 6),
    (6, 7),
    (7, 8),
    (5, 9),
    (9, 10),
    (10, 11),
    (11, 12),
    (9, 13),
    (13, 14),
    (14, 15),
    (15, 16),
    (13, 17),
    (17, 18),
    (18, 19),
    (19, 20),
    (0, 17),
];

/// The bones as an SVG path in image pixels (mirrored like the preview).
#[must_use]
pub fn skeleton_path(hands: &[[[f32; 2]; 21]], width: f32, height: f32, mirror: bool) -> String {
    use std::fmt::Write;

    let mut path = String::new();
    for hand in hands {
        let point = |i: usize| {
            let x = if mirror { 1.0 - hand[i][0] } else { hand[i][0] };
            (x * width, hand[i][1] * height)
        };
        for (a, b) in BONES {
            let ((x0, y0), (x1, y1)) = (point(a), point(b));
            let _ = write!(path, "M {x0:.1} {y0:.1} L {x1:.1} {y1:.1} ");
        }
    }
    path
}
