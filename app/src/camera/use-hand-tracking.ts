import { type BodyReferenceKind, createHandLandmarker, type DetectedHand } from 'hand-landmarker';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSharedValue } from 'react-native-reanimated';
import { useFrameOutput } from 'react-native-vision-camera';
import { createSynchronizable, scheduleOnRN } from 'react-native-worklets';

import type { RecordedFrame, RecordedHand, RecordedTake } from '@/dataset/types';

const STATS_WINDOW_MS = 1000;

export interface TrackingStats {
  /** Frames processed per second (frames are dropped while the model is busy). */
  fps: number;
  /** Average native time per frame copying it into a Bitmap. */
  conversionMs: number;
  /** Average native time per frame in MediaPipe's hand model. */
  inferenceMs: number;
  /** Average native time per frame in the body reference model (0 if disabled). */
  bodyMs: number;
}

const EMPTY_STATS: TrackingStats = { fps: 0, conversionMs: 0, inferenceMs: 0, bodyMs: 0 };

export interface HandTrackingOptions {
  numHands?: 1 | 2;
  /** Face or upper-body points, to place the hand relative to the body (etapa 4.3). */
  bodyReference?: BodyReferenceKind;
}

/**
 * Runs MediaPipe Hand Landmarker on every camera frame.
 *
 * Landmarks go to a shared value so the overlay can redraw on the UI thread
 * without a React render; stats reach React only once per second.
 */
export function useHandTracking({
  numHands = 1,
  bodyReference = 'none',
}: HandTrackingOptions = {}) {
  // MediaPipe can't change its options on a live landmarker, so a new value creates
  // a new one; the effect below disposes the old one.
  const landmarker = useMemo(
    () => createHandLandmarker({ numHands, bodyReference }),
    [numHands, bodyReference],
  );
  useEffect(() => () => landmarker.dispose(), [landmarker]);

  /**
   * Flat [x0, y0, x1, y1, ...] of every detected hand, 21 points each, normalized
   * to the upright image. Empty: no hand.
   */
  const landmarks = useSharedValue<number[]>([]);
  /** Flat [x0, y0, ...] of the body reference points. Empty: disabled or not found. */
  const body = useSharedValue<number[]>([]);
  const imageSize = useSharedValue({ width: 0, height: 0 });
  const [stats, setStats] = useState<TrackingStats>(EMPTY_STATS);

  // Worklet closures are copied to the camera thread, so a plain variable would
  // reset on every frame. A Synchronizable keeps state across frames.
  const window = useMemo(
    () => createSynchronizable({ ...EMPTY_STATS, frames: 0, windowStart: 0 }),
    [],
  );

  // Recording: the worklet checks `recording` on the camera thread, and the frames
  // are collected on the JS thread. Frames already in flight when recording stops
  // are dropped by the JS-side check.
  const recording = useSharedValue(false);
  const take = useRef<{ startedAt: number; frames: RecordedFrame[] } | null>(null);

  const appendFrame = useCallback(
    (timestamp: number, hands: RecordedHand[], bodyPoints: number[]) => {
      const current = take.current;
      if (current != null) {
        current.frames.push({ t: timestamp - current.startedAt, hands, body: bodyPoints });
      }
    },
    [],
  );

  // Stable identities: screens use these in effect dependencies (timers).
  const startRecording = useCallback(() => {
    take.current = { startedAt: Date.now(), frames: [] };
    // set() instead of `.value =`: the React Compiler can't tell a shared value is mutable.
    recording.set(true);
  }, [recording]);

  /**
   * Stops recording and returns the take: its frames, and the size of the upright
   * image the normalized landmarks refer to (needed to undo the aspect ratio).
   */
  const stopRecording = useCallback((): RecordedTake => {
    recording.set(false);
    const frames = take.current?.frames ?? [];
    take.current = null;
    const { width, height } = imageSize.get();
    return { frames, imageWidth: width, imageHeight: height };
  }, [recording, imageSize]);

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
        body.value = detection.body.flatMap((point) => [point.x, point.y]);
        if (
          imageSize.value.width !== detection.imageWidth ||
          imageSize.value.height !== detection.imageHeight
        ) {
          imageSize.value = { width: detection.imageWidth, height: detection.imageHeight };
        }

        const now = Date.now();
        if (recording.value) {
          scheduleOnRN(
            appendFrame,
            now,
            detection.hands.map(toRecordedHand),
            detection.body.flatMap((point) => [round(point.x), round(point.y), round(point.z)]),
          );
        }

        const current = window.getDirty();
        const next = {
          frames: current.frames + 1,
          conversionMs: current.conversionMs + detection.conversionMs,
          inferenceMs: current.inferenceMs + detection.inferenceMs,
          bodyMs: current.bodyMs + detection.bodyMs,
          fps: 0,
          windowStart: current.windowStart,
        };
        if (current.windowStart === 0) {
          window.setBlocking({ ...EMPTY_STATS, frames: 0, windowStart: now });
        } else if (now - current.windowStart >= STATS_WINDOW_MS) {
          scheduleOnRN(setStats, {
            fps: Math.round((next.frames * 1000) / (now - current.windowStart)),
            conversionMs: Math.round(next.conversionMs / next.frames),
            inferenceMs: Math.round(next.inferenceMs / next.frames),
            bodyMs: Math.round(next.bodyMs / next.frames),
          });
          window.setBlocking({ ...EMPTY_STATS, frames: 0, windowStart: now });
        } else {
          window.setBlocking(next);
        }
      } finally {
        frame.dispose();
      }
    },
  });

  return { frameOutput, landmarks, body, imageSize, stats, startRecording, stopRecording };
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
