import { createHandLandmarker } from 'hand-landmarker';
import { useEffect, useMemo, useState } from 'react';
import { useSharedValue } from 'react-native-reanimated';
import { useFrameOutput } from 'react-native-vision-camera';
import { createSynchronizable, scheduleOnRN } from 'react-native-worklets';

const STATS_WINDOW_MS = 1000;

export interface TrackingStats {
  /** Frames processed per second (frames are dropped while the model is busy). */
  fps: number;
  /** Average native time per frame copying it into a Bitmap. */
  conversionMs: number;
  /** Average native time per frame in MediaPipe. */
  inferenceMs: number;
}

/**
 * Runs MediaPipe Hand Landmarker on every camera frame.
 *
 * Landmarks go to a shared value so the overlay can redraw on the UI thread
 * without a React render; stats reach React only once per second.
 */
export function useHandTracking() {
  const landmarker = useMemo(() => createHandLandmarker(), []);
  useEffect(() => () => landmarker.dispose(), [landmarker]);

  /** Flat [x0, y0, x1, y1, ...] of the first hand, normalized to the upright image. Empty: no hand. */
  const landmarks = useSharedValue<number[]>([]);
  const imageSize = useSharedValue({ width: 0, height: 0 });
  const [stats, setStats] = useState<TrackingStats>({ fps: 0, conversionMs: 0, inferenceMs: 0 });

  // Worklet closures are copied to the camera thread, so a plain variable would
  // reset on every frame. A Synchronizable keeps state across frames.
  const window = useMemo(
    () => createSynchronizable({ frames: 0, conversionMs: 0, inferenceMs: 0, windowStart: 0 }),
    [],
  );

  const frameOutput = useFrameOutput({
    // MediaPipe only accepts RGBA, so the camera pipeline converts YUV for us.
    pixelFormat: 'rgb',
    onFrame(frame) {
      'worklet';
      try {
        const detection = landmarker.detect(frame);
        const hand = detection.hands[0];
        landmarks.value = hand ? hand.landmarks.flatMap((point) => [point.x, point.y]) : [];
        if (
          imageSize.value.width !== detection.imageWidth ||
          imageSize.value.height !== detection.imageHeight
        ) {
          imageSize.value = { width: detection.imageWidth, height: detection.imageHeight };
        }

        const now = Date.now();
        const current = window.getDirty();
        const frames = current.frames + 1;
        const conversionMs = current.conversionMs + detection.conversionMs;
        const inferenceMs = current.inferenceMs + detection.inferenceMs;
        if (current.windowStart === 0) {
          window.setBlocking({ frames: 0, conversionMs: 0, inferenceMs: 0, windowStart: now });
        } else if (now - current.windowStart >= STATS_WINDOW_MS) {
          scheduleOnRN(setStats, {
            fps: Math.round((frames * 1000) / (now - current.windowStart)),
            conversionMs: Math.round(conversionMs / frames),
            inferenceMs: Math.round(inferenceMs / frames),
          });
          window.setBlocking({ frames: 0, conversionMs: 0, inferenceMs: 0, windowStart: now });
        } else {
          window.setBlocking({
            frames,
            conversionMs,
            inferenceMs,
            windowStart: current.windowStart,
          });
        }
      } finally {
        frame.dispose();
      }
    },
  });

  return { frameOutput, landmarks, imageSize, stats };
}
