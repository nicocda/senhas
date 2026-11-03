import { Canvas, Path, Points, Skia, vec } from '@shopify/react-native-skia';
import { HAND_CONNECTIONS } from 'hand-landmarker';
import { StyleSheet } from 'react-native';
import { type SharedValue, useDerivedValue, useSharedValue } from 'react-native-reanimated';

interface HandSkeletonProps {
  /** Flat [x0, y0, x1, y1, ...] normalized to the upright camera image. */
  landmarks: SharedValue<number[]>;
  imageSize: SharedValue<{ width: number; height: number }>;
  /** The front camera preview is mirrored, but the frames MediaPipe sees are not. */
  mirrored: boolean;
}

/**
 * Draws the hand over a `resizeMode="cover"` camera preview. Everything runs on
 * the UI thread from shared values: no React render per frame.
 */
export function HandSkeleton({ landmarks, imageSize, mirrored }: HandSkeletonProps) {
  const canvasSize = useSharedValue({ width: 0, height: 0 });

  const points = useDerivedValue(() => {
    const flat = landmarks.value;
    const { width: viewWidth, height: viewHeight } = canvasSize.value;
    const { width: imageWidth, height: imageHeight } = imageSize.value;
    if (flat.length === 0 || viewWidth === 0 || imageWidth === 0) {
      return [];
    }

    // "cover" scales the image to fill the view and crops the overflow, centered.
    const scale = Math.max(viewWidth / imageWidth, viewHeight / imageHeight);
    const offsetX = (viewWidth - imageWidth * scale) / 2;
    const offsetY = (viewHeight - imageHeight * scale) / 2;

    const result = [];
    for (let i = 0; i < flat.length; i += 2) {
      const x = mirrored ? 1 - flat[i] : flat[i];
      result.push(
        vec(x * imageWidth * scale + offsetX, flat[i + 1] * imageHeight * scale + offsetY),
      );
    }
    return result;
  });

  const bones = useDerivedValue(() => {
    // Skia 2.x paths are immutable: build them with a PathBuilder.
    const builder = Skia.PathBuilder.Make();
    const p = points.value;
    if (p.length === 21) {
      for (const [from, to] of HAND_CONNECTIONS) {
        builder.moveTo(p[from].x, p[from].y);
        builder.lineTo(p[to].x, p[to].y);
      }
    }
    return builder.detach();
  });

  return (
    <Canvas style={StyleSheet.absoluteFill} onSize={canvasSize} pointerEvents="none">
      <Path path={bones} style="stroke" strokeWidth={3} color="#00E676" />
      <Points points={points} mode="points" strokeWidth={10} strokeCap="round" color="#FF1744" />
    </Canvas>
  );
}
