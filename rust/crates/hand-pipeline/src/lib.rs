//! `MediaPipe`'s hand and face models run from Rust (ADR 0013). `MediaPipe` has no
//! Rust SDK: this runs the same `.tflite` files and reimplements what `MediaPipe`
//! does between them (crop, anchors, NMS, regions, tracking).

pub mod backend;
pub mod detection;
pub mod face;
pub mod geometry;
pub mod hand;
pub mod image;
