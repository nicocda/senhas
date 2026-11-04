import { Canvas, Circle, Group, Path, Skia, type SkPath } from '@shopify/react-native-skia';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * The guide hand shown while recording (etapa 4.5): a "glove" drawn from a recorded
 * reference pose (ml/build_references.py), in the letter's color. Built from our
 * own data instead of the CAS illustration (all rights reserved, ADR 0005).
 */

export interface ReferencePose {
  hands: { handedness: 'left' | 'right'; points: number[][] }[];
  /** Face keypoints: eyes, nose, mouth, ears. Null if the take had no face. */
  face: number[][] | null;
  /** Image size the normalized points refer to. */
  image: [number, number];
}

export type Reference =
  | ({ kind: 'static' } & ReferencePose)
  | { kind: 'movement'; frames: ReferencePose[]; seconds: number };

const FINGERS = [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [9, 10, 11, 12],
  [13, 14, 15, 16],
  [17, 18, 19, 20],
];
const PALM = [0, 1, 5, 9, 13, 17];
const INDEX_TIP = 8;

interface Props {
  reference: Reference;
  color: string;
  size: number;
  /** Like the front camera preview: the person sees themselves. */
  mirrored?: boolean;
  /** Draw the head: only for letters signed on the face or body (else it takes room). */
  showFace?: boolean;
}

type Transform = (point: number[], image: [number, number]) => { x: number; y: number };

export function GuideHand({ reference, color, size, mirrored = true, showFace = false }: Props) {
  const poses = useMemo(
    () => (reference.kind === 'static' ? [reference] : reference.frames),
    [reference],
  );
  const [index, setIndex] = useState(0);

  // Movement letters loop through their frames at the recorded speed (+ a pause).
  useEffect(() => {
    if (reference.kind !== 'movement' || reference.frames.length < 2) {
      return;
    }
    const frameMs = Math.max(40, (reference.seconds * 1000) / reference.frames.length);
    const timer = setInterval(
      () => setIndex((current) => (current + 1) % (reference.frames.length + 8)),
      frameMs,
    );
    return () => clearInterval(timer);
  }, [reference]);

  // One framing for all the frames, so the hand moves inside a still picture.
  const transform = useMemo<Transform>(() => {
    const pixels = poses.flatMap((pose) => [
      ...pose.hands.flatMap((hand) =>
        hand.points.map(([x, y]) => [x * pose.image[0], y * pose.image[1]]),
      ),
      // The whole head, not just its keypoints, so its outline isn't cut off.
      ...(showFace && pose.face != null ? headBox(pose.face, pose.image) : []),
    ]);
    const xs = pixels.map(([x]) => x);
    const ys = pixels.map(([, y]) => y);
    const [minX, maxX, minY, maxY] = [
      Math.min(...xs),
      Math.max(...xs),
      Math.min(...ys),
      Math.max(...ys),
    ];
    const padding = 0.12 * size;
    const scale = (size - 2 * padding) / Math.max(maxX - minX, maxY - minY, 1);
    const offsetX = (size - (maxX - minX) * scale) / 2;
    const offsetY = (size - (maxY - minY) * scale) / 2;
    return ([x, y], image) => {
      const px = (x * image[0] - minX) * scale + offsetX;
      return {
        x: mirrored ? size - px : px,
        y: (y * image[1] - minY) * scale + offsetY,
      };
    };
  }, [poses, size, mirrored, showFace]);

  const pose = poses[Math.min(index, poses.length - 1)];
  const trail =
    reference.kind === 'movement'
      ? indexTrail(reference.frames, Math.min(index, poses.length - 1), transform)
      : null;

  return (
    <View style={[styles.card, { width: size, height: size }]}>
      <Canvas style={{ width: size, height: size }}>
        {showFace && pose.face != null && (
          <Face face={pose.face} image={pose.image} transform={transform} />
        )}
        {trail != null && (
          <Path
            path={trail}
            style="stroke"
            strokeWidth={3}
            color={color}
            opacity={0.45}
            strokeCap="round"
          />
        )}
        {pose.hands.map((hand) => (
          <Glove
            key={hand.handedness}
            points={hand.points}
            image={pose.image}
            transform={transform}
            color={color}
          />
        ))}
      </Canvas>
    </View>
  );
}

/** Path the index fingertip has drawn so far: shows where a movement goes. */
function indexTrail(frames: ReferencePose[], upTo: number, transform: Transform): SkPath {
  const builder = Skia.PathBuilder.Make();
  frames.slice(0, upTo + 1).forEach((frame, i) => {
    const { x, y } = transform(frame.hands[0].points[INDEX_TIP], frame.image);
    if (i === 0) {
      builder.moveTo(x, y);
    } else {
      builder.lineTo(x, y);
    }
  });
  return builder.detach();
}

function Glove({
  points,
  image,
  transform,
  color,
}: {
  points: number[][];
  image: [number, number];
  transform: Transform;
  color: string;
}) {
  const p = points.map((point) => transform(point, image));
  // Finger thickness follows the hand's size on screen (wrist -> middle knuckle).
  const thickness = Math.max(6, 0.2 * Math.hypot(p[9].x - p[0].x, p[9].y - p[0].y));

  const palm = Skia.PathBuilder.Make();
  PALM.forEach((i, k) => (k === 0 ? palm.moveTo(p[i].x, p[i].y) : palm.lineTo(p[i].x, p[i].y)));
  palm.close();
  const palmPath = palm.detach();

  const fingers = Skia.PathBuilder.Make();
  for (const finger of FINGERS) {
    // Each finger starts at the palm (its knuckle) and goes to the tip.
    fingers.moveTo(p[finger[0]].x, p[finger[0]].y);
    for (const i of finger.slice(1)) {
      fingers.lineTo(p[i].x, p[i].y);
    }
  }
  fingers.moveTo(p[0].x, p[0].y).lineTo(p[1].x, p[1].y);
  const fingersPath = fingers.detach();

  return (
    <Group>
      {/* Outline: the same shapes, a bit wider and dark, drawn underneath. */}
      <Path
        path={palmPath}
        style="stroke"
        strokeWidth={thickness + 4}
        strokeJoin="round"
        color="#00000055"
      />
      <Path
        path={fingersPath}
        style="stroke"
        strokeWidth={thickness + 4}
        strokeCap="round"
        strokeJoin="round"
        color="#00000055"
      />
      <Path path={palmPath} color={color} />
      <Path
        path={palmPath}
        style="stroke"
        strokeWidth={thickness}
        strokeJoin="round"
        color={color}
      />
      <Path
        path={fingersPath}
        style="stroke"
        strokeWidth={thickness}
        strokeCap="round"
        strokeJoin="round"
        color={color}
      />
    </Group>
  );
}

const HEAD_RADIUS = 1.6; // in eye distances

/** Head center and radius in pixels, from the eyes and the mouth. */
function head(face: number[][], image: [number, number]) {
  const [leftEye, rightEye, , mouth] = face.map(([x, y]) => ({ x: x * image[0], y: y * image[1] }));
  const eyeDistance = Math.hypot(leftEye.x - rightEye.x, leftEye.y - rightEye.y);
  return {
    x: (leftEye.x + rightEye.x) / 2,
    y: (leftEye.y + rightEye.y + 2 * mouth.y) / 4,
    r: eyeDistance * HEAD_RADIUS,
  };
}

/** The head's bounding box corners, for framing. */
function headBox(face: number[][], image: [number, number]): number[][] {
  const { x, y, r } = head(face, image);
  return [
    [x - r, y - r],
    [x + r, y + r],
  ];
}

/** A simple head (from the face keypoints) so the guide shows where the hand goes. */
function Face({
  face,
  image,
  transform,
}: {
  face: number[][];
  image: [number, number];
  transform: Transform;
}) {
  const [leftEye, rightEye, nose, mouth] = face.slice(0, 4).map((point) => transform(point, image));
  const eyeDistance = Math.hypot(leftEye.x - rightEye.x, leftEye.y - rightEye.y);
  const center = { x: (leftEye.x + rightEye.x) / 2, y: (leftEye.y + rightEye.y + 2 * mouth.y) / 4 };
  return (
    <Group>
      <Circle
        cx={center.x}
        cy={center.y}
        r={eyeDistance * HEAD_RADIUS}
        style="stroke"
        strokeWidth={2}
        color="#9AA5B1"
      />
      <Circle cx={leftEye.x} cy={leftEye.y} r={3} color="#6B7280" />
      <Circle cx={rightEye.x} cy={rightEye.y} r={3} color="#6B7280" />
      <Circle cx={nose.x} cy={nose.y} r={2} color="#9AA5B1" />
      <Circle cx={mouth.x} cy={mouth.y} r={3} color="#6B7280" />
    </Group>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    borderRadius: 16,
    overflow: 'hidden',
  },
});
