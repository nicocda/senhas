import { NitroModules } from 'react-native-nitro-modules';

import type { HandLandmarker } from './specs/HandLandmarker.nitro';
import type {
  HandLandmarkerFactory,
  HandLandmarkerOptions,
} from './specs/HandLandmarkerFactory.nitro';

export type {
  DetectedHand,
  HandDetection,
  HandLandmarker,
  Handedness,
  Landmark,
} from './specs/HandLandmarker.nitro';
export type { BodyReferenceKind, HandLandmarkerOptions } from './specs/HandLandmarkerFactory.nitro';

const DEFAULT_OPTIONS: HandLandmarkerOptions = {
  // Two hands cost almost twice as much: the landmarks model runs once per hand,
  // and in VIDEO mode palm detection only stops once numHands hands are tracked.
  // Opt into 2 for two-handed signs.
  numHands: 1,
  minHandDetectionConfidence: 0.5,
  minHandPresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
  // Off by default: it's an extra model per frame. Letters signed on the face need it.
  bodyReference: 'none',
};

const factory = NitroModules.createHybridObject<HandLandmarkerFactory>('HandLandmarkerFactory');

export function createHandLandmarker(options: Partial<HandLandmarkerOptions> = {}): HandLandmarker {
  return factory.createHandLandmarker({ ...DEFAULT_OPTIONS, ...options });
}

/** Bones of the hand as pairs of landmark indices (MediaPipe `HAND_CONNECTIONS`). */
export const HAND_CONNECTIONS: readonly (readonly [number, number])[] = [
  // Palm
  [0, 1],
  [0, 5],
  [5, 9],
  [9, 13],
  [13, 17],
  [0, 17],
  // Thumb
  [1, 2],
  [2, 3],
  [3, 4],
  // Index
  [5, 6],
  [6, 7],
  [7, 8],
  // Middle
  [9, 10],
  [10, 11],
  [11, 12],
  // Ring
  [13, 14],
  [14, 15],
  [15, 16],
  // Pinky
  [17, 18],
  [18, 19],
  [19, 20],
];
