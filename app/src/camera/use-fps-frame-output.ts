import { useMemo, useState } from 'react';
import { useFrameOutput } from 'react-native-vision-camera';
import { createSynchronizable, scheduleOnRN } from 'react-native-worklets';

const WINDOW_MS = 1000;

/**
 * Frame output that counts frames on the camera thread and reports
 * frames per second to React once per {@link WINDOW_MS}.
 */
export function useFpsFrameOutput() {
  const [fps, setFps] = useState(0);
  // Worklet closures are copied to the camera thread, so a plain variable would
  // reset on every frame. A Synchronizable keeps state across frames.
  const counter = useMemo(() => createSynchronizable({ frames: 0, windowStart: 0 }), []);

  const frameOutput = useFrameOutput({
    // 'native' (the default) isn't supported for analysis on every camera, e.g. the
    // emulator's. YUV_420_888 is guaranteed on Android and readable from the CPU.
    pixelFormat: 'yuv',
    onFrame(frame) {
      'worklet';
      const now = Date.now();
      const { frames, windowStart } = counter.getDirty();

      if (windowStart === 0) {
        counter.setBlocking({ frames: 0, windowStart: now });
      } else if (now - windowStart >= WINDOW_MS) {
        scheduleOnRN(setFps, Math.round(((frames + 1) * 1000) / (now - windowStart)));
        counter.setBlocking({ frames: 0, windowStart: now });
      } else {
        counter.setBlocking({ frames: frames + 1, windowStart });
      }

      frame.dispose();
    },
  });

  return { frameOutput, fps };
}
