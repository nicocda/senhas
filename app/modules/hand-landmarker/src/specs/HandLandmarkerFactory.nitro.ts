import type { HybridObject } from 'react-native-nitro-modules';

import type { HandLandmarker } from './HandLandmarker.nitro';

export interface HandLandmarkerOptions {
  numHands: number;
  minHandDetectionConfidence: number;
  minHandPresenceConfidence: number;
  minTrackingConfidence: number;
}

// A factory because a HybridObject's constructor can't take arguments.
export interface HandLandmarkerFactory extends HybridObject<{ android: 'kotlin' }> {
  createHandLandmarker(options: HandLandmarkerOptions): HandLandmarker;
}
