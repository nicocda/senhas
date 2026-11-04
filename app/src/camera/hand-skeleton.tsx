import { Canvas, Path, Points, Skia, type SkPoint, vec } from '@shopify/react-native-skia';
import { HAND_CONNECTIONS } from 'hand-landmarker';
import { StyleSheet, View } from 'react-native';
import { type SharedValue, useDerivedValue, useSharedValue } from 'react-native-reanimated';

const POINTS_PER_HAND = 21;

interface Size {
  width: number;
  height: number;
}

interface HandSkeletonProps {
  /** Flat [x0, y0, x1, y1, ...] of every hand, 21 points each, normalized to the upright camera image. */
  landmarks: SharedValue<number[]>;
  /** Flat [x0, y0, ...] body reference points (face or upper body), same coordinates. */
  body?: SharedValue<number[]>;
  imageSize: SharedValue<Size>;
  /** The front camera preview is mirrored, but the frames MediaPipe sees are not. */
  mirrored: boolean;
}

/** Normalized image coordinates -> view coordinates for a `resizeMode="cover"` preview. */
function project(flat: number[], view: Size, image: Size, mirrored: boolean): SkPoint[] {
  'worklet';
  if (flat.length === 0 || view.width === 0 || image.width === 0) {
    return [];
  }
  // "cover" scales the image to fill the view and crops the overflow, centered.
  const scale = Math.max(view.width / image.width, view.height / image.height);
  const offsetX = (view.width - image.width * scale) / 2;
  const offsetY = (view.height - image.height * scale) / 2;
  const result = [];
  for (let i = 0; i < flat.length; i += 2) {
    const x = mirrored ? 1 - flat[i] : flat[i];
    result.push(
      vec(x * image.width * scale + offsetX, flat[i + 1] * image.height * scale + offsetY),
    );
  }
  return result;
}

/**
 * Draws the hands (and the body reference, if any) over a `resizeMode="cover"`
 * camera preview. Everything runs on the UI thread from shared values: no React
 * render per frame.
 */
export function HandSkeleton({ landmarks, body, imageSize, mirrored }: HandSkeletonProps) {
  const canvasSize = useSharedValue({ width: 0, height: 0 });

  const points = useDerivedValue(() =>
    project(landmarks.value, canvasSize.value, imageSize.value, mirrored),
  );
  const bodyPoints = useDerivedValue(() =>
    project(body?.value ?? [], canvasSize.value, imageSize.value, mirrored),
  );

  const bones = useDerivedValue(() => {
    // Skia 2.x paths are immutable: build them with a PathBuilder.
    const builder = Skia.PathBuilder.Make();
    const p = points.value;
    for (let hand = 0; hand + POINTS_PER_HAND <= p.length; hand += POINTS_PER_HAND) {
      for (const [from, to] of HAND_CONNECTIONS) {
        builder.moveTo(p[hand + from].x, p[hand + from].y);
        builder.lineTo(p[hand + to].x, p[hand + to].y);
      }
    }
    return builder.detach();
  });

  return (
    // Canvas `onSize` measures the view on every frame, which logs warnings while
    // the screen animates out. The wrapper's onLayout only fires when the size changes.
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={({ nativeEvent: { layout } }) => {
        // set(): the React Compiler can't tell a shared value is mutable.
        canvasSize.set({ width: layout.width, height: layout.height });
      }}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Path path={bones} style="stroke" strokeWidth={3} color="#00E676" />
        <Points points={points} mode="points" strokeWidth={10} strokeCap="round" color="#FF1744" />
        <Points
          points={bodyPoints}
          mode="points"
          strokeWidth={14}
          strokeCap="round"
          color="#40C4FF"
        />
      </Canvas>
    </View>
  );
}
