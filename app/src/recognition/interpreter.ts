/**
 * Turns the stream of frames into text (Hito 5), following the Movement-Hold
 * model of sign phonology: signing alternates holds (the hand still, in one shape)
 * and movements.
 *
 * - A static letter is a hold: the classifier says the same letter confidently
 *   for at least minHoldMs while the hand isn't moving.
 * - A movement letter (H, J, Z) is a movement compared with the templates (DTW)
 *   only once it has ended — looking at the past —, and only if it's (nearly)
 *   complete. Static letters committed while it started are taken back: they were
 *   its first shape.
 * - Anything else (a transition between letters, a trembling hand, a hand
 *   passing through a shape) is not written.
 *
 * Everything is measured in milliseconds, not frames: the phone runs at 8-19 FPS
 * depending on how many hands and whether the face is tracked.
 */

import type { LiveFrame } from '@/camera/use-hand-tracking';
import { twoHands } from '@/dataset/features';

import type { Classifier, Prediction } from './classifier';
import { classifyHand } from './models';
import { frameVector, indexExtent, type MovementRecognizer } from './sequences';

export const DEFAULT_OPTIONS = {
  /** Below this confidence a frame doesn't vote for any letter. */
  minConfidence: 0.6,
  /**
   * How long the same letter has to be seen to be written. Measured on the spelling
   * sessions: 150 ms writes the shapes the hand passes through, 500 ms loses the
   * short letters of fast spelling.
   */
  minHoldMs: 350,
  /** A hold survives frames without a confident letter for this long (blur, glitches). */
  maxGapMs: 250,
  /**
   * Hysteresis on the fingertip's speed, in eye distances per second. A held letter
   * stays under 1.5 in 90% of the frames; the movement letters peak over 5 in 90% of
   * the takes. Starting at one threshold and stopping at a lower one keeps a speed
   * that hovers around a single value from flickering between both states.
   */
  movementStartSpeed: 3,
  movementStopSpeed: 1.5,
  /** A movement ends after the hand stays under the stop speed this long. */
  movementStopMs: 150,
  /**
   * Letters written up to this long before a movement letter started are taken
   * back: they were its first shape (J starts as an I).
   */
  retractMs: 0,
  /**
   * A hold is the shape staying the same, even if the arm moves: spelling fast,
   * the hand drifts at 3-4 eye distances per second while holding a letter.
   */
  holdWhileMoving: true,
};

export type InterpreterOptions = typeof DEFAULT_OPTIONS;

/** The fingertip's speed is measured over this window. */
const SPEED_WINDOW_MS = 200;
/** Frames before the movement started that still belong to it (the speed lags). */
const MOVEMENT_PAD_MS = 200;
/** Without the hand this long, it left: the hold and the movement end. */
const RELEASE_MS = 400;
/** Longer than this, it isn't one letter: only its last part is compared. */
const MAX_MOVEMENT_MS = 3000;
/**
 * A movement letter needs (almost) its whole movement: the fingertip's trajectory
 * must be at least this share as wide as the letter's typical one (ADR 0010).
 */
const MIN_MOVEMENT_COMPLETENESS = 0.6;
/**
 * Not recognized live: CH barely moves (~1.7 eye distances, a small rotation), as
 * little as a trembling or settling hand (ADR 0010).
 */
const EXCLUDED_MOVEMENTS = new Set(['CH']);

export interface Hypothesis {
  letter: string;
  kind: 'static' | 'twoHands';
  /** 0..1: how much of minHoldMs the hold already lasted. */
  progress: number;
}

export interface InterpreterState {
  /** Letters written so far. */
  text: string[];
  /** The letter being held, before it's written. */
  hypothesis: Hypothesis | null;
  /** The hand is moving: a movement letter or a transition, decided when it ends. */
  moving: boolean;
}

interface Hold {
  letter: string;
  kind: Hypothesis['kind'];
  start: number;
  last: number;
  written: boolean;
}

interface Written {
  letter: string;
  /** When the hold that wrote it started. */
  at: number;
}

export class Interpreter {
  private written: Written[] = [];
  private hold: Hold | null = null;
  /** Recent fingertip positions (frame vectors), for the speed and for DTW. */
  private trail: { t: number; vector: number[] }[] = [];
  private movement: { start: number; slowSince: number | null } | null = null;
  /** The hand left the image since the last letter: the same letter can follow. */
  private released = true;
  /** The shape a movement letter ended in: not written as a static letter. */
  private endShape: string | null = null;
  /** Since when no hand is seen. */
  private handlessSince: number | null = null;

  private readonly staticClassifier: Classifier;
  private readonly twoHandsClassifier: Classifier;
  private readonly movementRecognizer: MovementRecognizer;
  private readonly dominantHand: 'left' | 'right';
  private readonly log: (message: string) => void;
  private readonly options: InterpreterOptions;

  constructor(
    staticClassifier: Classifier,
    twoHandsClassifier: Classifier,
    movementRecognizer: MovementRecognizer,
    dominantHand: 'left' | 'right' = 'right',
    log: (message: string) => void = () => {},
    options: Partial<InterpreterOptions> = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.staticClassifier = staticClassifier;
    this.twoHandsClassifier = twoHandsClassifier;
    this.movementRecognizer = movementRecognizer;
    this.dominantHand = dominantHand;
    this.log = log;
  }

  push(frame: LiveFrame, now: number): InterpreterState {
    if (frame.hands.length === 0) {
      // A frame or two without the hand is the tracker losing it (blur), not the
      // hand leaving: only after RELEASE_MS does what was going on end.
      this.handlessSince ??= now;
      if (now - this.handlessSince >= RELEASE_MS) {
        this.endMovement(this.handlessSince);
        this.hold = null;
        this.trail = [];
        this.released = true;
        this.endShape = null;
      }
      return this.state();
    }
    this.handlessSince = null;

    if (frame.hands.length === 1) {
      this.track(frame, now);
    } else {
      // Two-handed letters have no movement here: drop any one-handed movement.
      this.movement = null;
      this.trail = [];
    }

    const prediction = this.classify(frame);
    this.updateHold(prediction, frame.hands.length === 2 ? 'twoHands' : 'static', now);
    return this.state();
  }

  /** Clears the text (e.g. a "delete" button), keeping what the hand is doing. */
  clear() {
    this.written = [];
    this.released = true;
  }

  private state(): InterpreterState {
    const hold = this.hold;
    return {
      text: this.written.map((item) => item.letter),
      hypothesis:
        hold == null || hold.written || hold.letter === this.endShape
          ? null
          : {
              letter: hold.letter,
              kind: hold.kind,
              progress: Math.min(1, (hold.last - hold.start) / this.options.minHoldMs),
            },
      moving: this.movement != null,
    };
  }

  private classify(frame: LiveFrame): Prediction | null {
    if (frame.hands.length === 2) {
      const input = twoHands(frame.hands, frame.imageWidth, frame.imageHeight, this.dominantHand);
      return input == null ? null : this.twoHandsClassifier.predict(input);
    }
    return classifyHand(
      this.staticClassifier,
      frame.hands[0],
      frame.body,
      frame.imageWidth,
      frame.imageHeight,
    );
  }

  private updateHold(prediction: Prediction | null, kind: Hold['kind'], now: number) {
    const letter =
      prediction != null && prediction.confidence >= this.options.minConfidence
        ? prediction.letter
        : null;
    const hold = this.hold;
    if (hold != null && now - hold.last > this.options.maxGapMs) {
      this.hold = null;
    }
    if (letter == null) {
      return;
    }
    if (this.hold != null && this.hold.letter === letter) {
      this.hold.last = now;
    } else {
      this.hold = { letter, kind, start: now, last: now, written: false };
      if (letter !== this.endShape) {
        this.endShape = null;
      }
    }

    const current = this.hold;
    if (
      current.written ||
      (this.movement != null && !this.options.holdWhileMoving) ||
      current.letter === this.endShape ||
      current.last - current.start < this.options.minHoldMs
    ) {
      return;
    }
    current.written = true;
    // The same letter right after itself is the same hold, split by a glitch;
    // a real double letter (LL, RR) needs a sign we don't detect yet.
    if (this.written.at(-1)?.letter === current.letter && !this.released) {
      return;
    }
    this.written.push({ letter: current.letter, at: current.start });
    this.released = false;
  }

  /** Follows the fingertip's speed: starts and ends movements. */
  private track(frame: LiveFrame, now: number) {
    const vector = frameVector(frame.hands[0], frame.body, frame.imageWidth, frame.imageHeight);
    if (vector == null) {
      // No face: no position to measure the movement against.
      return;
    }
    this.trail.push({ t: now, vector });
    this.trail = this.trail.filter((item) => now - item.t <= MAX_MOVEMENT_MS + MOVEMENT_PAD_MS);

    const speed = this.speed(now);
    if (speed == null) {
      return;
    }
    if (this.movement == null) {
      if (speed >= this.options.movementStartSpeed) {
        this.movement = { start: now - SPEED_WINDOW_MS, slowSince: null };
      }
      return;
    }
    if (speed >= this.options.movementStopSpeed) {
      this.movement.slowSince = null;
    } else {
      this.movement.slowSince ??= now;
      if (now - this.movement.slowSince >= this.options.movementStopMs) {
        this.endMovement(this.movement.slowSince);
      }
    }
  }

  /** Fingertip speed over the last SPEED_WINDOW_MS, in eye distances per second. */
  private speed(now: number): number | null {
    const first = this.trail.find((item) => now - item.t <= SPEED_WINDOW_MS);
    const last = this.trail.at(-1);
    if (first == null || last == null || last.t - first.t < SPEED_WINDOW_MS / 2) {
      return null;
    }
    const distance = Math.hypot(last.vector[2] - first.vector[2], last.vector[3] - first.vector[3]);
    return distance / ((last.t - first.t) / 1000);
  }

  /** The movement ended at `end`: was it a whole movement letter? */
  private endMovement(end: number) {
    const movement = this.movement;
    this.movement = null;
    if (movement == null) {
      return;
    }
    const from = Math.max(movement.start - MOVEMENT_PAD_MS, end - MAX_MOVEMENT_MS);
    const points = this.trail
      .filter((item) => item.t >= from && item.t <= end)
      .map((item) => item.vector);
    const nearest = this.movementRecognizer.nearest(points, EXCLUDED_MOVEMENTS);
    if (nearest == null) {
      return;
    }
    const extent = indexExtent(points);
    const required =
      MIN_MOVEMENT_COMPLETENESS * this.movementRecognizer.typicalExtent(nearest.label);
    const accepted =
      nearest.distance <= this.movementRecognizer.thresholdFor(nearest.label) && extent >= required;
    this.log(
      `Movimiento ${Math.round(end - movement.start)} ms: ${nearest.label} ${nearest.distance.toFixed(2)} ` +
        `(umbral ${this.movementRecognizer.thresholdFor(nearest.label).toFixed(2)}), amplitud ${extent.toFixed(1)} ` +
        `(mín. ${required.toFixed(1)}) → ${accepted ? nearest.letter : 'transición'}`,
    );
    if (!accepted) {
      return;
    }
    // Letters written since the movement started were its first shape.
    while ((this.written.at(-1)?.at ?? -Infinity) >= from - this.options.retractMs) {
      this.written.pop();
    }
    this.written.push({ letter: nearest.letter, at: movement.start });
    this.released = false;
    // The shape the hand stops in belongs to the movement letter.
    this.endShape = this.hold?.letter ?? null;
    if (this.hold != null) {
      this.hold.written = true;
    }
  }
}
