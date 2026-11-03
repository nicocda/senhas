import type { HybridObject } from 'react-native-nitro-modules';
import type { Frame } from 'react-native-vision-camera';

/** A point of the hand, normalized to the upright (rotated) image: x and y in 0..1. */
export interface Landmark {
  x: number;
  y: number;
  /** Depth relative to the wrist; smaller is closer to the camera. */
  z: number;
}

/** From the signer's perspective, as reported by MediaPipe for an unmirrored image. */
export type Handedness = 'left' | 'right';

export interface DetectedHand {
  /** The 21 landmarks in MediaPipe order: 0 wrist, 1-4 thumb, 5-8 index, ... 17-20 pinky. */
  landmarks: Landmark[];
  handedness: Handedness;
  /** Handedness confidence, 0..1. */
  score: number;
}

export interface HandDetection {
  hands: DetectedHand[];
  /** Size of the upright image the landmarks are normalized to. */
  imageWidth: number;
  imageHeight: number;
  /** Native time spent copying the frame into a Bitmap for MediaPipe, in milliseconds. */
  conversionMs: number;
  /** Native time spent in MediaPipe, in milliseconds. */
  inferenceMs: number;
}

export interface HandLandmarker extends HybridObject<{ android: 'kotlin' }> {
  /**
   * Runs the model synchronously on a frame from a `pixelFormat: 'rgb'` frame output.
   * Call it inside `onFrame`, before `frame.dispose()`.
   */
  detect(frame: Frame): HandDetection;
}
