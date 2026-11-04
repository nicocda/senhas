/**
 * Same normalization as ml/signs/features.py (ADR 0008): keep both in sync and
 * bump NORMALIZATION_VERSION in both when it changes.
 */

// v2: + palm normal (orientation, e.g. U vs V: palm towards the signer or the camera).
export const NORMALIZATION_VERSION = 2;

const POINTS = 21;
const INDEX_MCP = 5;
const MIDDLE_MCP = 9;
const PINKY_MCP = 17;
/** The 21 points; the palm normal comes after them. */
export const POINT_FEATURES = POINTS * 3;

/**
 * World landmarks (flat x, y, z in meters) -> 66 numbers: the 21 points with the
 * wrist at the origin, scaled by the wrist -> middle knuckle distance, mirrored on
 * x for left-handed people (rotation kept on purpose); then the palm normal, a unit
 * vector computed on the mirrored points. Null if the hand is degenerate.
 */
export function normalizeHand(world: number[], dominantHand: 'left' | 'right'): number[] | null {
  if (world.length !== POINT_FEATURES) {
    return null;
  }
  const [wx, wy, wz] = world;
  const mirror = dominantHand === 'left' ? -1 : 1;
  const dx = (world[MIDDLE_MCP * 3] - wx) * mirror;
  const dy = world[MIDDLE_MCP * 3 + 1] - wy;
  const dz = world[MIDDLE_MCP * 3 + 2] - wz;
  const scale = Math.hypot(dx, dy, dz);
  if (scale < 1e-6) {
    return null;
  }
  const points: number[] = [];
  for (let i = 0; i < POINTS; i++) {
    points.push(
      ((world[i * 3] - wx) * mirror) / scale,
      (world[i * 3 + 1] - wy) / scale,
      (world[i * 3 + 2] - wz) / scale,
    );
  }
  const [ax, ay, az] = points.slice(INDEX_MCP * 3, INDEX_MCP * 3 + 3);
  const [bx, by, bz] = points.slice(PINKY_MCP * 3, PINKY_MCP * 3 + 3);
  const normal = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
  const length = Math.hypot(...normal);
  if (length < 1e-6) {
    return null;
  }
  return [...points, ...normal.map((value) => value / length)];
}

/** Distance between the hand points only (the threshold was tuned on them). */
/** Same as hand_location in ml/signs/features.py. Bump in both on any change. */
export const LOCATION_VERSION = 1;
const INDEX_TIP = 8;
const FACE_KEYPOINTS = 6;

/**
 * Wrist and index fingertip relative to the midpoint between the eyes, in eye
 * distances (normalized coordinates times the image size, so x and y are both
 * pixels). Mirrored on x for left-handed people. Null without a face.
 */
export function handLocation(
  landmarks: number[],
  body: number[],
  imageWidth: number,
  imageHeight: number,
  dominantHand: 'left' | 'right',
): number[] | null {
  if (body.length < FACE_KEYPOINTS * 3 || imageWidth <= 0 || imageHeight <= 0) {
    return null;
  }
  const px = (values: number[], i: number) => [
    values[i * 3] * imageWidth,
    values[i * 3 + 1] * imageHeight,
  ];
  const [lx, ly] = px(body, 0);
  const [rx, ry] = px(body, 1);
  const eyes = [(lx + rx) / 2, (ly + ry) / 2];
  const unit = Math.hypot(lx - rx, ly - ry);
  if (unit < 1) {
    return null;
  }
  const mirror = dominantHand === 'left' ? -1 : 1;
  return [0, INDEX_TIP].flatMap((point) => {
    const [x, y] = px(landmarks, point);
    return [((x - eyes[0]) / unit) * mirror, (y - eyes[1]) / unit];
  });
}

/** Same as other_hand_position / two_hands in ml/signs/features.py. Bump in both. */
export const TWO_HANDS_VERSION = 1;

interface HandInput {
  handedness: 'left' | 'right';
  landmarks: number[];
  world: number[];
}

/**
 * Wrist and index fingertip of the other hand relative to the dominant wrist, in
 * units of the dominant hand's size (wrist -> middle knuckle), in pixels. Mirrored
 * on x for left-handed people. Null if degenerate.
 */
export function otherHandPosition(
  dominant: number[],
  other: number[],
  imageWidth: number,
  imageHeight: number,
  dominantHand: 'left' | 'right',
): number[] | null {
  if (imageWidth <= 0 || imageHeight <= 0) {
    return null;
  }
  const px = (values: number[], i: number) => [
    values[i * 3] * imageWidth,
    values[i * 3 + 1] * imageHeight,
  ];
  const [wx, wy] = px(dominant, 0);
  const [mx, my] = px(dominant, MIDDLE_MCP);
  const unit = Math.hypot(mx - wx, my - wy);
  if (unit < 1) {
    return null;
  }
  const mirror = dominantHand === 'left' ? -1 : 1;
  return [0, INDEX_TIP].flatMap((point) => {
    const [x, y] = px(other, point);
    return [((x - wx) / unit) * mirror, (y - wy) / unit];
  });
}

/**
 * Both hands -> dominant hand shape (66) + other hand shape (66) + other hand
 * position (4). Which is which comes from MediaPipe's handedness; the other hand is
 * normalized as the opposite hand, so it also looks like a right hand.
 */
export function twoHands(
  hands: HandInput[],
  imageWidth: number,
  imageHeight: number,
  dominantHand: 'left' | 'right',
): number[] | null {
  if (hands.length !== 2) {
    return null;
  }
  const otherSide = dominantHand === 'right' ? 'left' : 'right';
  const dominant = hands.find((hand) => hand.handedness === dominantHand);
  const other = hands.find((hand) => hand.handedness === otherSide);
  if (dominant == null || other == null) {
    return null;
  }
  const shapeA = normalizeHand(dominant.world, dominantHand);
  const shapeB = normalizeHand(other.world, otherSide);
  const position = otherHandPosition(
    dominant.landmarks,
    other.landmarks,
    imageWidth,
    imageHeight,
    dominantHand,
  );
  if (shapeA == null || shapeB == null || position == null) {
    return null;
  }
  return [...shapeA, ...shapeB, ...position];
}

/**
 * Path length of the index fingertip over a take, in eye distances, from the
 * handLocation of each frame (its last two numbers). How much a movement letter
 * actually moved. Null without at least two frames with the face.
 */
export function indexTravel(locations: number[][]): number | null {
  if (locations.length < 2) {
    return null;
  }
  let total = 0;
  for (let i = 1; i < locations.length; i++) {
    total += Math.hypot(
      locations[i][2] - locations[i - 1][2],
      locations[i][3] - locations[i - 1][3],
    );
  }
  return total;
}

function distance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < POINT_FEATURES; i++) {
    sum += (a[i] - b[i]) ** 2;
  }
  return Math.sqrt(sum);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * How far a frame can be from the take's typical shape (its per-coordinate median)
 * and still count as "that shape", in normalized hand units. Chosen with the first
 * real session (P-BCD2): steady takes sit at 0.1-0.35, hesitant ones at 0.8-3.7.
 */
export const STEADY_DISTANCE = 0.35;

/**
 * Milliseconds the hand spent close to the take's typical shape. Robust to a noisy
 * frame, unlike counting consecutive still frames. Low means the person was
 * searching for the letter (or changed it mid-take).
 */
export function steadyMs(frames: { t: number; features: number[] }[]): number {
  if (frames.length < 3) {
    return 0;
  }
  const typical = frames[0].features.map((_, i) =>
    median(frames.map((frame) => frame.features[i])),
  );
  const frameMs = (frames[frames.length - 1].t - frames[0].t) / (frames.length - 1);
  const steady = frames.filter((frame) => distance(frame.features, typical) < STEADY_DISTANCE);
  return steady.length * frameMs;
}
