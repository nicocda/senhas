/**
 * Recognizes every letter in real time by picking the right model for each moment:
 * - two hands -> the two-handed classifier (level 4);
 * - one hand that traveled enough in the last seconds -> DTW against the movement
 *   templates (level 3); a match is shown for a while, ahead of static letters;
 * - otherwise -> the static classifier (levels 1 and 2), smoothed by voting.
 */

import type { LiveFrame } from '@/camera/use-hand-tracking';
import { twoHands } from '@/dataset/features';
import { debugLog } from '@/debug/debug-log';

import type { Classifier } from './classifier';
import { classifyHand } from './models';
import { frameVector, type MovementRecognizer } from './sequences';
import { PredictionSmoother } from './smoothing';

/** How far back a movement is looked for (the takes were 3 s). */
const MOVEMENT_WINDOW_MS = 2500;
/**
 * Minimum fingertip path in the window, in eye distances, to try DTW. Movement
 * letters traveled 5-25 in the recorded takes; a held letter trembles far less.
 */
const MIN_MOVEMENT_TRAVEL = 3;
/** DTW costs ~32x32 per template: run it a few times per second, not every frame. */
const MOVEMENT_CHECK_MS = 300;
/** How long a recognized movement letter stays on screen. */
const MOVEMENT_HOLD_MS = 1500;

export interface LiveResult {
  letter: string;
  label: string;
  kind: 'static' | 'movement' | 'twoHands';
  /** 0..1: the classifier's confidence; for movement, how far under the threshold. */
  confidence: number;
}

export class LiveRecognizer {
  private readonly staticSmoother = new PredictionSmoother();
  private readonly twoHandsSmoother = new PredictionSmoother();
  private recent: { t: number; vector: number[] }[] = [];
  private lastMovementCheck = 0;
  private heldMovement: { result: LiveResult; until: number } | null = null;

  private readonly staticClassifier: Classifier;
  private readonly twoHandsClassifier: Classifier;
  private readonly movement: MovementRecognizer;
  /** For two hands there's no per-hand answer: assume the most common. */
  private readonly dominantHand: 'left' | 'right';

  constructor(
    staticClassifier: Classifier,
    twoHandsClassifier: Classifier,
    movement: MovementRecognizer,
    dominantHand: 'left' | 'right' = 'right',
  ) {
    this.staticClassifier = staticClassifier;
    this.twoHandsClassifier = twoHandsClassifier;
    this.movement = movement;
    this.dominantHand = dominantHand;
  }

  push(frame: LiveFrame, now: number): LiveResult | null {
    if (frame.hands.length === 2) {
      this.reset(['static', 'movement']);
      const input = twoHands(frame.hands, frame.imageWidth, frame.imageHeight, this.dominantHand);
      if (input == null) {
        return null;
      }
      const smoothed = this.twoHandsSmoother.push(this.twoHandsClassifier.predict(input));
      return smoothed && { ...smoothed, kind: 'twoHands' };
    }
    this.reset(['twoHands']);
    if (frame.hands.length === 0) {
      this.reset(['static', 'movement']);
      return null;
    }

    const hand = frame.hands[0];
    const vector = frameVector(hand, frame.body, frame.imageWidth, frame.imageHeight);
    if (vector != null) {
      this.recent.push({ t: now, vector });
      this.recent = this.recent.filter((item) => now - item.t <= MOVEMENT_WINDOW_MS);
    }

    if (this.heldMovement != null && now < this.heldMovement.until) {
      return this.heldMovement.result;
    }
    this.heldMovement = null;

    const travel = this.travel();
    if (now - this.lastMovementCheck >= MOVEMENT_CHECK_MS && travel >= MIN_MOVEMENT_TRAVEL) {
      this.lastMovementCheck = now;
      const nearest = this.movement.nearest(this.recent.map((item) => item.vector));
      const match = nearest != null && nearest.distance <= this.movement.threshold ? nearest : null;
      // Debug panel: why a movement letter was (or wasn't) recognized.
      debugLog(
        nearest == null
          ? `DTW: pocos cuadros, recorrido ${travel.toFixed(1)}`
          : `DTW: ${nearest.label} ${nearest.distance.toFixed(2)} (umbral ${this.movement.threshold.toFixed(2)}), recorrido ${travel.toFixed(1)}`,
        match == null ? 'warn' : 'info',
      );
      if (match != null) {
        const result: LiveResult = {
          letter: match.letter,
          label: match.label,
          kind: 'movement',
          confidence: 1 - match.distance / this.movement.threshold,
        };
        this.heldMovement = { result, until: now + MOVEMENT_HOLD_MS };
        // Start fresh: the same movement shouldn't match again right away.
        this.recent = [];
        this.staticSmoother.reset();
        return result;
      }
    }

    const prediction = classifyHand(
      this.staticClassifier,
      hand,
      frame.body,
      frame.imageWidth,
      frame.imageHeight,
    );
    if (prediction == null) {
      this.staticSmoother.reset();
      return null;
    }
    const smoothed = this.staticSmoother.push(prediction);
    return smoothed && { ...smoothed, kind: 'static' };
  }

  /** Fingertip path over the window (vector columns 2-3: index relative to the eyes). */
  private travel(): number {
    let total = 0;
    for (let i = 1; i < this.recent.length; i++) {
      const [a, b] = [this.recent[i - 1].vector, this.recent[i].vector];
      total += Math.hypot(b[2] - a[2], b[3] - a[3]);
    }
    return total;
  }

  private reset(parts: ('static' | 'movement' | 'twoHands')[]) {
    if (parts.includes('static')) {
      this.staticSmoother.reset();
    }
    if (parts.includes('movement')) {
      this.recent = [];
      this.heldMovement = null;
    }
    if (parts.includes('twoHands')) {
      this.twoHandsSmoother.reset();
    }
  }
}
