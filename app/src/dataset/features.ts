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
