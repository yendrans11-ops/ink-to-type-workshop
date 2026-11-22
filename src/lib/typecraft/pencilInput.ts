/** Time-based Pencil filtering: identical response at Safari and tablet event rates. */
export type PencilSample = { x: number; y: number; pressure: number; time: number };

/** Input stabilization is independent of the saved stroke's outline smoothing. */
export function stabilizePencilSample(previous: PencilSample | null, sample: PencilSample, stabilization: number): PencilSample {
  const filtered = smoothPencilSample(previous, sample, 0);
  if (!previous || filtered === previous) return filtered;
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