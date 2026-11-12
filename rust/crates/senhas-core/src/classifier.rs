//! Letter classifiers trained by `ml/train.py`, same as `app/src/recognition/classifier.ts`.
//!
//! A dense layer is `output = activation(input · weights + bias)`. Weights and
//! intermediate values are `f32` and sums are `f64`, exactly like the `TypeScript`
//! version (`Float32Array` storage, JS number arithmetic): both give the same bits.

use serde::Deserialize;

use crate::Error;
use crate::features::NORMALIZATION_VERSION;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Activation {
    Relu,
    Softmax,
    Linear,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DenseLayerFile {
    pub activation: Activation,
    /// `weights[i][j]`: from input i to neuron j.
    pub weights: Vec<Vec<f32>>,
    pub bias: Vec<f32>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct VersionRef {
    pub version: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Normalization {
    pub version: u32,
    pub location: Option<VersionRef>,
    #[serde(default)]
    pub two_hands: Option<VersionRef>,
    pub features: usize,
}

/// `model.json` written by `ml/train.py`.
#[derive(Debug, Clone, Deserialize)]
pub struct ModelFile {
    pub name: String,
    pub labels: Vec<String>,
    pub letters: Vec<String>,
    pub normalization: Normalization,
    pub layers: Vec<DenseLayerFile>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Prediction {
    /// Catalog entry id (V1, V2...).
    pub label: String,
    /// What to show (V for V1 and V2).
    pub letter: String,
    /// Probability of that letter, 0..1.
    pub confidence: f32,
}

struct Layer {
    activation: Activation,
    inputs: usize,
    outputs: usize,
    /// Row-major: `weights[i * outputs + j]`.
    weights: Vec<f32>,
    bias: Vec<f32>,
}

pub struct Classifier {
    pub labels: Vec<String>,
    pub letters: Vec<String>,
    pub input_size: usize,
    pub uses_location: bool,
    layers: Vec<Layer>,
}

impl Classifier {
    pub fn new(model: ModelFile) -> Result<Self, Error> {
        // A model only works with the normalization it was trained with (ADR 0008).
        if model.normalization.version != NORMALIZATION_VERSION {
            return Err(Error::Version(format!(
                "Model {} uses normalization v{}, the app v{NORMALIZATION_VERSION}. Retrain it.",
                model.name, model.normalization.version
            )));
        }
        let layers = model
            .layers
            .into_iter()
            .map(|layer| Layer {
                activation: layer.activation,
                inputs: layer.weights.len(),
                outputs: layer.bias.len(),
                weights: layer.weights.into_iter().flatten().collect(),
                bias: layer.bias,
            })
            .collect();
        Ok(Self {
            labels: model.labels,
            letters: model.letters,
            input_size: model.normalization.features,
            uses_location: model.normalization.location.is_some(),
            layers,
        })
    }

    /// One probability per letter (they add up to 1).
    #[must_use]
    pub fn probabilities(&self, input: &[f64]) -> Vec<f32> {
        assert_eq!(input.len(), self.input_size, "wrong input size");
        let mut values: Vec<f64> = input.to_vec();
        for layer in &self.layers {
            // Row by row (input i), so the weights are read in memory order. Each
            // neuron's sum still adds bias, then i = 0, 1, 2...: the same bits as TS.
            let mut sums: Vec<f64> = layer.bias.iter().map(|b| f64::from(*b)).collect();
            for (value, row) in values
                .iter()
                .take(layer.inputs)
                .zip(layer.weights.chunks_exact(layer.outputs))
            {
                for (sum, weight) in sums.iter_mut().zip(row) {
                    *sum += value * f64::from(*weight);
                }
            }
            let mut output: Vec<f32> = sums.into_iter().map(|sum| sum as f32).collect();
            activate(&mut output, layer.activation);
            values = output.into_iter().map(f64::from).collect();
        }
        values.into_iter().map(|value| value as f32).collect()
    }

    #[must_use]
    pub fn predict(&self, input: &[f64]) -> Prediction {
        let probabilities = self.probabilities(input);
        let mut best = 0;
        for i in 1..probabilities.len() {
            if probabilities[i] > probabilities[best] {
                best = i;
            }
        }
        Prediction {
            label: self.labels[best].clone(),
            letter: self.letters[best].clone(),
            confidence: probabilities[best],
        }
    }
}

fn activate(values: &mut [f32], activation: Activation) {
    match activation {
        Activation::Relu => values.iter_mut().for_each(|v| *v = v.max(0.0)),
        Activation::Softmax => {
            // Subtracting the max doesn't change the result and avoids overflow in exp().
            let max = values.iter().copied().fold(f32::NEG_INFINITY, f32::max);
            for value in values.iter_mut() {
                *value = (f64::from(*value) - f64::from(max)).exp() as f32;
            }
            let total: f64 = values.iter().map(|v| f64::from(*v)).sum();
            for value in values.iter_mut() {
                *value = (f64::from(*value) / total) as f32;
            }
        }
        Activation::Linear => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tiny() -> Classifier {
        let json = r#"{
            "name": "tiny", "labels": ["A", "B"], "letters": ["A", "B"],
            "normalization": {"version": 2, "location": null, "features": 2},
            "layers": [
                {"activation": "relu", "weights": [[1, -1], [0, 2]], "bias": [0, 0]},
                {"activation": "softmax", "weights": [[1, 0], [0, 1]], "bias": [0, 0]}
            ]
        }"#;
        Classifier::new(serde_json::from_str(json).unwrap()).unwrap()
    }

    #[test]
    fn dense_layers_and_softmax() {
        // relu([1, -1 + 2*2]) = [1, 3]; softmax -> B wins with e^3 / (e + e^3).
        let prediction = tiny().predict(&[1.0, 2.0]);
        assert_eq!(prediction.label, "B");
        let expected = (3f64.exp() / (1f64.exp() + 3f64.exp())) as f32;
        assert!((prediction.confidence - expected).abs() < 1e-6);
    }

    #[test]
    fn rejects_other_normalization() {
        let json = r#"{"name": "old", "labels": [], "letters": [],
            "normalization": {"version": 1, "location": null, "features": 63}, "layers": []}"#;
        assert!(Classifier::new(serde_json::from_str(json).unwrap()).is_err());
    }
}
