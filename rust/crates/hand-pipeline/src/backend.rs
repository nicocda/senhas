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
    Ok(Box::new(tract_backend::TractModel::load(path)?))
}

mod tract_backend {
    use std::path::Path;

    use tract_tflite::prelude::*;

    use super::{BackendError, Model};

    pub struct TractModel {
        plan: std::sync::Arc<TypedSimplePlan>,
    }

    impl TractModel {
        pub fn load(path: &Path) -> Result<Self, BackendError> {
            let plan = tract_tflite::tflite()
                .model_for_path(path)?
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
