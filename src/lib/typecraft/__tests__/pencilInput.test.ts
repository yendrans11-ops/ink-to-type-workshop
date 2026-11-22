import { describe, expect, it } from "vitest";
import { smoothPencilSample, type PencilSample } from "../pencilInput";

describe("Apple Pencil input", () => {
  it("reduces alternating sideways jitter on a slow line", () => {
    let previous: PencilSample | null = null;
    let filteredError = 0;
    let rawError = 0;
    for (let i = 0; i < 120; i++) {
      const y = 0.5 + (i % 2 ? 0.002 : -0.002);
      previous = smoothPencilSample(previous, { x: 0.2 + i * 0.001, y, pressure: 0.5, time: i * 1000 / 120 }, 0.7);
      if (i > 10) { filteredError += Math.abs(previous.y - 0.5); rawError += Math.abs(y - 0.5); }
    }
    expect(filteredError).toBeLessThan(rawError * 0.5);
  });
  it("has the same pressure response at 60 and 240 samples per second", () => {
    const run = (hz: number) => {
      let p: PencilSample = { x: 0.5, y: 0.5, pressure: 0.2, time: 0 };
      for (let i = 1; i <= hz / 10; i++) p = smoothPencilSample(p, { x: 0.5, y: 0.5, pressure: 0.8, time: i * 1000 / hz }, 0.7);
      return p.pressure;
    };
    expect(run(60)).toBeCloseTo(run(240), 8);
  });
  it("ignores zero pressure dropouts and repeated coalesced events", () => {
    const p = { x: 0.2, y: 0.4, pressure: 0.8, time: 10 };
    expect(smoothPencilSample(p, { ...p, pressure: 0, time: 20 }, 0.7).pressure).toBe(0.8);
    expect(smoothPencilSample(p, { ...p, pressure: 0.1 }, 0.7)).toBe(p);
  });
  it("keeps raw geometry when smoothing is disabled and follows fast movement", () => {
    const p = { x: 0.2, y: 0.4, pressure: 0.5, time: 0 };
    const next = { ...p, x: 0.3, time: 8 };
    expect(smoothPencilSample(p, next, 0).x).toBe(0.3);
    expect(smoothPencilSample(p, next, 0.7).x).toBeGreaterThan(0.29);
  });
});