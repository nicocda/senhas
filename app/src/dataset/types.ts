/** One hand in a recorded frame. Coordinates are flat [x0, y0, z0, x1, y1, z1, ...], 21 points. */
export interface RecordedHand {
  handedness: 'left' | 'right';
  /** Handedness confidence, 0..1. */
  score: number;
  /** Normalized to the upright image (0..1). */
  landmarks: number[];
  /** Meters, centered on the hand (MediaPipe world landmarks). */
  world: number[];
}

export interface RecordedFrame {
  /** Milliseconds since the take started. */
  t: number;
  /** Empty when no hand was detected in this frame. */
  hands: RecordedHand[];
}
