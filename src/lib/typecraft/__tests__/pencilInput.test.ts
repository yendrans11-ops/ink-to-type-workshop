import { describe, expect, it } from "vitest";
import { isSharpCorner, smoothPencilSample, stabilizePencilSample, type PencilSample } from "../pencilInput";

describe("Apple Pencil input", () => {
  it("higher stabilization reduces sideways jitter independently of outline smoothing", () => {
    const run = (amount: number) => {
      let previous: PencilSample = { x: 0.2, y: 0.5, pressure: 0.5, time: 0 };
      let error = 0;
      for (let i = 1; i <= 120; i++) {
        previous = stabilizePencilSample(previous, { x: 0.2 + i * 0.001, y: 0.5 + (i % 2 ? 0.004 : -0.004), pressure: 0.5, time: i * 1000 / 120 }, amount);
        if (i > 10) error += Math.abs(previous.y - 0.5);
      }
      return error;
    };
    expect(run(0.8)).toBeLessThan(run(0.25) * 0.6);
    expect(run(0.5)).toBeLessThan(run(0) * 0.5);
  });
  it("follows handwriting at the default stabilization without excessive lag", () => {
    let previous: PencilSample = { x: 0.2, y: 0.5, pressure: 0.5, time: 0 };
    for (let i = 1; i <= 120; i++) previous = stabilizePencilSample(previous, { x: 0.2 + i * 0.003, y: 0.5, pressure: 0.5, time: i * 1000 / 120 }, 0.5);
    expect(0.56 - previous.x).toBeLessThan(0.008);
  });
  it("stabilization pressure response is time-based and tolerates dropouts", () => {
    const run = (hz: number) => {
      let previous: PencilSample = { x: 0.5, y: 0.5, pressure: 0.2, time: 0 };
      for (let i = 1; i <= hz / 10; i++) previous = stabilizePencilSample(previous, { x: 0.5, y: 0.5, pressure: 0.8, time: i * 1000 / hz }, 0.5);
      return previous;
    };
    expect(run(60).pressure).toBeCloseTo(run(240).pressure, 8);
    const p = run(60);
    expect(stabilizePencilSample(p, { ...p, time: p.time + 10, pressure: 0 }, 0.5).pressure).toBe(p.pressure);
    expect(stabilizePencilSample(p, p, 0.5)).toBe(p);
    expect(stabilizePencilSample(p, { ...p, x: 0.8, time: p.time + 10 }, 0).x).toBe(0.8);
  });
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
  it("preserves sharp >65 degree corner apex coordinates without smoothing lag", () => {
    const prev2: PencilSample = { x: 0.2, y: 0.5, pressure: 0.5, time: 0 };
    const prev1: PencilSample = { x: 0.5, y: 0.5, pressure: 0.5, time: 16 };
    const cornerTurn: PencilSample = { x: 0.5, y: 0.2, pressure: 0.5, time: 24 };
    const gentleTurn: PencilSample = { x: 0.65, y: 0.48, pressure: 0.5, time: 24 };

    expect(isSharpCorner(prev2, prev1, cornerTurn)).toBe(true);
    expect(isSharpCorner(prev2, prev1, gentleTurn)).toBe(false);

    const stabilizedCorner = stabilizePencilSample(prev1, cornerTurn, 0.6, prev2);
    expect(stabilizedCorner.x).toBe(cornerTurn.x);
    expect(stabilizedCorner.y).toBe(cornerTurn.y);
  });
});