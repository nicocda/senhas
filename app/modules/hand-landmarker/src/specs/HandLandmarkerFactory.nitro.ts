import type { HybridObject } from 'react-native-nitro-modules';

import type { HandLandmarker } from './HandLandmarker.nitro';

/**
 * Where the body is, to place the hand relative to it (letters signed on the face).
 * - `face`: Face Detector (BlazeFace), 6 keypoints.
 * - `pose`: Pose Landmarker lite, its first 13 points (face and shoulders).
 */
export type BodyReferenceKind = 'none' | 'face' | 'pose';

export interface HandLandmarkerOptions {
  numHands: number;
  minHandDetectionConfidence: number;
  minHandPresenceConfidence: number;
  minTrackingConfidence: number;
  bodyReference: BodyReferenceKind;
}

// A factory because a HybridObject's constructor can't take arguments.
export interface HandLandmarkerFactory extends HybridObject<{ android: 'kotlin' }> {
  createHandLandmarker(options: HandLandmarkerOptions): HandLandmarker;
}
