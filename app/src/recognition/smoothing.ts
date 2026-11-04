import type { Prediction } from './classifier';

/** ~0.7 s at the phone's ~15 FPS. */
const WINDOW = 10;
/** The letter must win this share of the window... */
const MIN_VOTES = 0.6;
/** ...with at least this average confidence. */
const MIN_CONFIDENCE = 0.6;

export interface SmoothedPrediction {
  letter: string;
  label: string;
  /** Average confidence of the frames that voted for it. */
  confidence: number;
}

/**
 * Frame-by-frame predictions flicker (a hand in transition looks like other
 * letters for a frame or two). This votes over the last frames and only answers
 * when one letter clearly wins; otherwise null ("not sure").
 */
export class PredictionSmoother {
  private recent: Prediction[] = [];

  push(prediction: Prediction): SmoothedPrediction | null {
    this.recent.push(prediction);
    if (this.recent.length > WINDOW) {
      this.recent.shift();
    }
    const votes = new Map<string, Prediction[]>();
    for (const item of this.recent) {
      votes.set(item.label, [...(votes.get(item.label) ?? []), item]);
    }
    let winner: Prediction[] = [];
    for (const group of votes.values()) {
      if (group.length > winner.length) {
        winner = group;
      }
    }
    const confidence = winner.reduce((sum, item) => sum + item.confidence, 0) / winner.length;
    if (winner.length < WINDOW * MIN_VOTES || confidence < MIN_CONFIDENCE) {
      return null;
    }
    return { letter: winner[0].letter, label: winner[0].label, confidence };
  }

  /** No hand: start over, so an old letter doesn't linger. */
  reset() {
    this.recent = [];
  }
}
