/**
 * Movement letters (level 3) with DTW, same as ml/signs/sequences.py: a sequence of
 * hand positions is compared with the recorded templates, aligning them in time so
 * that speed doesn't matter. The closest template wins, if it's close enough.
 */

import { handLocation, normalizeHand } from '@/dataset/features';
import type { RecordedHand } from '@/dataset/types';

/** Bump with ml/signs/sequences.py SEQUENCE_VERSION. */
export const SEQUENCE_VERSION = 1;

export interface MovementModelFile {
  name: string;
  sequence: {
    version: number;
    length: number;
    trim: number;
    normalization: number;
    location: number;
  };
  threshold: number;
  templates: { label: string; letter: string; frames: number[][] }[];
}

/** Where the hand is (wrist and index relative to the eyes) and where the palm faces. */
export function frameVector(
  hand: RecordedHand,
  body: number[],
  imageWidth: number,
  imageHeight: number,
): number[] | null {
  const location = handLocation(hand.landmarks, body, imageWidth, imageHeight, hand.handedness);
  const shape = normalizeHand(hand.world, hand.handedness);
  if (location == null || shape == null) {
    return null;
  }
  return [...location, ...shape.slice(-3)];
}

function interpolate(values: number[], position: number): number {
  const low = Math.floor(position);
  const high = Math.min(low + 1, values.length - 1);
  return values[low] + (values[high] - values[low]) * (position - low);
}

/** First index where the cumulative path reaches `target` (numpy searchsorted, left). */
function searchSorted(path: number[], target: number): number {
  let index = 0;
  while (index < path.length && path[index] < target) {
    index++;
  }
  return index;
}

/**
 * Frame vectors -> `length` x 7: trimmed to where the index fingertip actually
 * moves (from `trim` to 1 - `trim` of its path), resampled evenly in time.
 */
export function movementSequence(
  points: number[][],
  length: number,
  trim: number,
): number[][] | null {
  if (points.length < 8) {
    return null;
  }
  const path = [0];
  for (let i = 1; i < points.length; i++) {
    path.push(
      path[i - 1] + Math.hypot(points[i][2] - points[i - 1][2], points[i][3] - points[i - 1][3]),
    );
  }
  const total = path[path.length - 1];
  if (total < 1e-6) {
    return null;
  }
  const start = searchSorted(path, total * trim);
  const end = searchSorted(path, total * (1 - trim)) + 1;
  const moving = points.slice(start, Math.max(end, start + 2));
  const columns = moving[0].length;
  const result: number[][] = [];
  for (let k = 0; k < length; k++) {
    const position = (k * (moving.length - 1)) / (length - 1);
    const row: number[] = [];
    for (let c = 0; c < columns; c++) {
      row.push(
        interpolate(
          moving.map((frame) => frame[c]),
          position,
        ),
      );
    }
    result.push(row);
  }
  return result;
}

/** Classic DTW, normalized by both lengths (same as dtw_distance in Python). */
export function dtwDistance(a: number[][], b: number[][]): number {
  const n = a.length;
  const m = b.length;
  let previous = new Float64Array(m + 1).fill(Infinity);
  previous[0] = 0;
  for (let i = 1; i <= n; i++) {
    const current = new Float64Array(m + 1).fill(Infinity);
    for (let j = 1; j <= m; j++) {
      let sum = 0;
      for (let c = 0; c < a[i - 1].length; c++) {
        sum += (a[i - 1][c] - b[j - 1][c]) ** 2;
      }
      current[j] = Math.sqrt(sum) + Math.min(previous[j - 1], previous[j], current[j - 1]);
    }
    previous = current;
  }
  return previous[m] / (n + m);
}

export interface MovementPrediction {
  label: string;
  letter: string;
  distance: number;
}

export class MovementRecognizer {
  readonly threshold: number;

  private readonly model: MovementModelFile;

  constructor(model: MovementModelFile) {
    this.model = model;
    this.threshold = model.threshold;
    if (model.sequence.version !== SEQUENCE_VERSION) {
      throw new Error(
        `Movement model uses sequence v${model.sequence.version}, the app v${SEQUENCE_VERSION}. Rebuild it.`,
      );
    }
  }

  /** Closest template to these frame vectors, however far (null: too few frames). */
  nearest(points: number[][]): MovementPrediction | null {
    const sequence = movementSequence(points, this.model.sequence.length, this.model.sequence.trim);
    if (sequence == null) {
      return null;
    }
    let best: MovementPrediction | null = null;
    for (const template of this.model.templates) {
      const distance = dtwDistance(sequence, template.frames);
      if (best == null || distance < best.distance) {
        best = { label: template.label, letter: template.letter, distance };
      }
    }
    return best;
  }

  /** Closest template, only if it's close enough (under the model's threshold). */
  recognize(points: number[][]): MovementPrediction | null {
    const best = this.nearest(points);
    return best != null && best.distance <= this.threshold ? best : null;
  }
}
