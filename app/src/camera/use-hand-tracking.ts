import { createHandLandmarker, type DetectedHand } from 'hand-landmarker';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSharedValue } from 'react-native-reanimated';
import { useFrameOutput } from 'react-native-vision-camera';
import { createSynchronizable, scheduleOnRN } from 'react-native-worklets';

import type { RecordedFrame, RecordedHand } from '@/dataset/types';

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
export function useHandTracking({ numHands = 1 }: { numHands?: 1 | 2 } = {}) {
  // MediaPipe can't change numHands on a live landmarker, so a new value creates a
  // new one; the effect below disposes the old one.
  const landmarker = useMemo(() => createHandLandmarker({ numHands }), [numHands]);
  useEffect(() => () => landmarker.dispose(), [landmarker]);

  /**
   * Flat [x0, y0, x1, y1, ...] of every detected hand, 21 points each, normalized
   * to the upright image. Empty: no hand.
   */
  const landmarks = useSharedValue<number[]>([]);
  const imageSize = useSharedValue({ width: 0, height: 0 });
  const [stats, setStats] = useState<TrackingStats>({ fps: 0, conversionMs: 0, inferenceMs: 0 });

  // Worklet closures are copied to the camera thread, so a plain variable would
  // reset on every frame. A Synchronizable keeps state across frames.
  const window = useMemo(
    () => createSynchronizable({ frames: 0, conversionMs: 0, inferenceMs: 0, windowStart: 0 }),
    [],
  );

  // Recording: the worklet checks `recording` on the camera thread, and the frames
  // are collected on the JS thread. Frames already in flight when recording stops
  // are dropped by the JS-side check.
  const recording = useSharedValue(false);
  const take = useRef<{ startedAt: number; frames: RecordedFrame[] } | null>(null);

  const appendFrame = useCallback((timestamp: number, hands: RecordedHand[]) => {
    const current = take.current;
    if (current != null) {
      current.frames.push({ t: timestamp - current.startedAt, hands });
    }
  }, []);

  // Stable identities: screens use these in effect dependencies (timers).
  const startRecording = useCallback(() => {
    take.current = { startedAt: Date.now(), frames: [] };
    // set() instead of `.value =`: the React Compiler can't tell a shared value is mutable.
    recording.set(true);
  }, [recording]);

  /** Stops recording and returns the frames of the take. */
  const stopRecording = useCallback((): RecordedFrame[] => {
    recording.set(false);
    const frames = take.current?.frames ?? [];
    take.current = null;
    return frames;
  }, [recording]);

  const frameOutput = useFrameOutput({
    // MediaPipe only accepts RGBA, so the camera pipeline converts YUV for us.
    pixelFormat: 'rgb',
    onFrame(frame) {
      'worklet';
      try {
        const detection = landmarker.detect(frame);
        landmarks.value = detection.hands.flatMap((hand) =>
          hand.landmarks.flatMap((point) => [point.x, point.y]),
        );
        if (
          imageSize.value.width !== detection.imageWidth ||
          imageSize.value.height !== detection.imageHeight
        ) {
          imageSize.value = { width: detection.imageWidth, height: detection.imageHeight };
        }

        const now = Date.now();
        if (recording.value) {
          scheduleOnRN(appendFrame, now, detection.hands.map(toRecordedHand));
        }

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

  return { frameOutput, landmarks, imageSize, stats, startRecording, stopRecording };
}

/** 5 decimals: well below a pixel in normalized coordinates, and 0.01 mm in world ones. */
function round(value: number): number {
  'worklet';
  return Math.round(value * 1e5) / 1e5;
}

function toRecordedHand(hand: DetectedHand): RecordedHand {
  'worklet';
  return {
    handedness: hand.handedness,
    score: round(hand.score),
    landmarks: hand.landmarks.flatMap((point) => [round(point.x), round(point.y), round(point.z)]),
    world: hand.worldLandmarks.flatMap((point) => [round(point.x), round(point.y), round(point.z)]),
  };
}
