//! Where the `.tflite` models run. The pipeline only needs "tensor in, tensors out",
//! so the engine can change per platform (ADR 0013): tract (pure Rust) for now,
//! `LiteRT` where speed matters.

use std::path::Path;

pub type BackendError = Box<dyn std::error::Error + Send + Sync>;

/// A loaded model with one image input (NHWC, f32).
pub trait Model {
    /// Runs the model on `input` (`size` x `size` x 3); one flat vector per output.
    fn run(&self, input: Vec<f32>, size: usize) -> Result<Vec<Vec<f32>>, BackendError>;
}

/// Loads a `.tflite` file with the default engine.
pub fn load(path: &Path) -> Result<Box<dyn Model>, BackendError> {
    load_bytes(&std::fs::read(path)?)
}

/// Loads a `.tflite` model from memory (e.g. bundled in the app with `include_bytes!`).
pub fn load_bytes(bytes: &[u8]) -> Result<Box<dyn Model>, BackendError> {
    Ok(Box::new(tract_backend::TractModel::load(bytes)?))
}

mod tract_backend {
    use tract_tflite::prelude::*;

    use super::{BackendError, Model};

    pub struct TractModel {
        plan: std::sync::Arc<TypedSimplePlan>,
    }

    impl TractModel {
        pub fn load(mut bytes: &[u8]) -> Result<Self, BackendError> {
            let plan = tract_tflite::tflite()
                .model_for_read(&mut bytes)?
                .into_optimized()?
                .into_runnable()?;
            Ok(Self { plan })
        }
    }

    impl Model for TractModel {
        fn run(&self, input: Vec<f32>, size: usize) -> Result<Vec<Vec<f32>>, BackendError> {
            let tensor: Tensor =
                tract_ndarray::Array4::from_shape_vec((1, size, size, 3), input)?.into();
            let outputs = self.plan.run(tvec!(tensor.into()))?;
            outputs
                .iter()
                .map(|output| {
                    Ok(output
                        .to_plain_array_view::<f32>()?
                        .iter()
                        .copied()
                        .collect())
                })
                .collect()
        }
    }
}
