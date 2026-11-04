/**
 * Runs the letter classifiers trained by ml/train.py, in plain TypeScript.
 *
 * The networks are tiny (66 or 70 numbers in, 128 and 64 neurons, one output per
 * letter: ~17k multiplications), so the app doesn't need a native ML runtime for
 * them. A dense layer is just: output = activation(input · weights + bias).
 */

import { NORMALIZATION_VERSION } from '@/dataset/features';

interface DenseLayer {
  activation: 'relu' | 'softmax' | 'linear';
  /** weights[i][j]: from input i to neuron j. */
  weights: number[][];
  bias: number[];
}

export interface ModelFile {
  language: string;
  /** level-1, level-2, static... */
  name: string;
  level: string;
  labels: string[];
  letters: string[];
  normalization: {
    version: number;
    location: { version: number; relativeTo: string } | null;
    /** Two-handed models (level 4): both hands' shapes + their relative position. */
    twoHands?: { version: number } | null;
    features: number;
  };
  layers: DenseLayer[];
}

export interface Prediction {
  /** Catalog entry id (V1, V2...). */
  label: string;
  /** What to show (V for V1 and V2). */
  letter: string;
  /** Probability the network gives to that letter, 0..1. */
  confidence: number;
}

interface Layer {
  activation: DenseLayer['activation'];
  inputs: number;
  outputs: number;
  /** Row-major: weights[i * outputs + j]. Typed arrays: contiguous and fast. */
  weights: Float32Array;
  bias: Float32Array;
}

export class Classifier {
  readonly labels: string[];
  readonly letters: string[];
  readonly inputSize: number;
  readonly usesLocation: boolean;
  private readonly layers: Layer[];

  constructor(model: ModelFile) {
    // A model only works with the normalization it was trained with (ADR 0008).
    if (model.normalization.version !== NORMALIZATION_VERSION) {
      throw new Error(
        `Model ${model.name} uses normalization v${model.normalization.version}, the app v${NORMALIZATION_VERSION}. Retrain it.`,
      );
    }
    this.labels = model.labels;
    this.letters = model.letters;
    this.inputSize = model.normalization.features;
    this.usesLocation = model.normalization.location != null;
    this.layers = model.layers.map((layer) => ({
      activation: layer.activation,
      inputs: layer.weights.length,
      outputs: layer.bias.length,
      weights: Float32Array.from(layer.weights.flat()),
      bias: Float32Array.from(layer.bias),
    }));
  }

  /** The network's output: one probability per letter (they add up to 1). */
  probabilities(input: number[]): number[] {
    if (input.length !== this.inputSize) {
      throw new Error(`Expected ${this.inputSize} numbers, got ${input.length}.`);
    }
    let values: ArrayLike<number> = input;
    for (const layer of this.layers) {
      const output = new Float32Array(layer.outputs);
      for (let j = 0; j < layer.outputs; j++) {
        let sum = layer.bias[j];
        for (let i = 0; i < layer.inputs; i++) {
          sum += values[i] * layer.weights[i * layer.outputs + j];
        }
        output[j] = sum;
      }
      values = activate(output, layer.activation);
    }
    return Array.from(values);
  }

  predict(input: number[]): Prediction {
    const probabilities = this.probabilities(input);
    let best = 0;
    for (let i = 1; i < probabilities.length; i++) {
      if (probabilities[i] > probabilities[best]) {
        best = i;
      }
    }
    return {
      label: this.labels[best],
      letter: this.letters[best],
      confidence: probabilities[best],
    };
  }
}

function activate(values: Float32Array, activation: DenseLayer['activation']): Float32Array {
  if (activation === 'relu') {
    return values.map((value) => Math.max(0, value));
  }
  if (activation === 'softmax') {
    // Subtracting the max doesn't change the result and avoids overflow in exp().
    const max = Math.max(...values);
    const exps = values.map((value) => Math.exp(value - max));
    const total = exps.reduce((sum, value) => sum + value, 0);
    return exps.map((value) => value / total);
  }
  return values;
}
