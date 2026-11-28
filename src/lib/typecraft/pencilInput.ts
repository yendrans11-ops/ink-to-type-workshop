/** Time-based Pencil filtering: identical response at Safari and tablet event rates. */
export type PencilSample = { x: number; y: number; pressure: number; time: number };

/** Cosine of 65 degrees: turn angles >= 65 deg (dot <= 0.4226) are treated as intentional sharp corners. */
export const CORNER_COS_THRESHOLD = Math.cos((65 * Math.PI) / 180);

/** Returns true when moving p2 -> p1 -> p0 creates a sharp direction change >= 65 degrees. */
export function isSharpCorner(
  prev2: { x: number; y: number },
  prev1: { x: number; y: number },
  current: { x: number; y: number },
  cosThreshold = CORNER_COS_THRESHOLD,
): boolean {
  const v1x = prev1.x - prev2.x;
  const v1y = prev1.y - prev2.y;
  const v2x = current.x - prev1.x;
  const v2y = current.y - prev1.y;
  const d1 = Math.hypot(v1x, v1y);
  const d2 = Math.hypot(v2x, v2y);
  if (d1 < 1e-4 || d2 < 1e-4) return false;
  const cosAngle = (v1x * v2x + v1y * v2y) / (d1 * d2);
  return cosAngle < cosThreshold;
}

/** Input stabilization is independent of the saved stroke's outline smoothing. Preserves >=65° sharp corners directly. */
export function stabilizePencilSample(
  previous: PencilSample | null,
  sample: PencilSample,
  stabilization: number,
  prev2: { x: number; y: number } | null = null,
): PencilSample {
  const filtered = smoothPencilSample(previous, sample, 0);
  if (!previous || filtered === previous) return filtered;
  if (prev2 && isSharpCorner(prev2, previous, sample)) {
    // Sharp corner detected: store the exact corner apex / turn point without lag or overshoot.
    return filtered;
  }
  const amount = Math.max(0, Math.min(1, stabilization));
  if (amount === 0) return filtered;
  const dt = Math.min(0.05, (sample.time - previous.time) / 1000);
  const speed = Math.hypot(sample.x - previous.x, sample.y - previous.y) / dt;
  // Bounded speed adaptation avoids interpreting jitter as a fast, intentional movement.
  const cutoff = 18 - 15 * amount + Math.min(speed, 2) * 12 * (1 - amount);
  const alpha = 1 - Math.exp(-2 * Math.PI * cutoff * dt);
  const pressureAlpha = 1 - Math.exp(-dt / (0.045 + amount * 0.035));
  const pressure = Number.isFinite(sample.pressure) && sample.pressure > 0 ? Math.min(1, sample.pressure) : previous.pressure;
  return {
    x: previous.x + (sample.x - previous.x) * alpha,
    y: previous.y + (sample.y - previous.y) * alpha,
    pressure: previous.pressure + (pressure - previous.pressure) * pressureAlpha,
    time: sample.time,
  };
}
export function smoothPencilSample(previous: PencilSample | null, sample: PencilSample, smoothing: number): PencilSample {
  const pressure = Number.isFinite(sample.pressure) && sample.pressure > 0
    ? Math.min(1, sample.pressure) : previous?.pressure ?? 0.5;
  if (!previous) return { ...sample, pressure };
  // Duplicate/out-of-order coalesced events must not add a second pressure step.
  if (sample.time <= previous.time) return previous;
  const dt = Math.min(0.05, (sample.time - previous.time) / 1000);
  const speed = Math.hypot(sample.x - previous.x, sample.y - previous.y) / dt;
  // Stabilise slow curves, but reduce lag during fast handwriting; smoothing=0 is raw geometry.
  const amount = Math.max(0, Math.min(1, smoothing));
  const cutoff = 12 - amount * 7 + speed * 24;
  const alpha = amount === 0 ? 1 : 1 - Math.exp(-2 * Math.PI * cutoff * dt);
  const pressureAlpha = 1 - Math.exp(-dt / 0.025);
  return {
    x: previous.x + (sample.x - previous.x) * alpha,
    y: previous.y + (sample.y - previous.y) * alpha,
    pressure: previous.pressure + (pressure - previous.pressure) * pressureAlpha,
    time: sample.time,
  };
}