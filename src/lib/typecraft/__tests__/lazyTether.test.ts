import { describe, expect, it } from "vitest";
import { createLazyTether, stepLazyTether } from "../lazyTether";

describe("Lazy Rubber Band stabilizer", () => {
  it("keeps P_tip stationary inside the dead zone (d <= radius)", () => {
    const s0 = createLazyTether(100, 200, 0.5, 40);
    const r1 = stepLazyTether(s0, 120, 210, 0.8);
    expect(r1.moved).toBe(false);
    expect(r1.state.tip).toEqual({ x: 100, y: 200, pressure: 0.5 });
    expect(r1.state.pen).toEqual({ x: 120, y: 210, pressure: 0.8 });

    // Exactly on the boundary d === radius stays stationary
    const r2 = stepLazyTether(r1.state, 140, 200, 0.9);
    expect(r2.moved).toBe(false);
    expect(r2.state.tip).toEqual({ x: 100, y: 200, pressure: 0.5 });
  });

  it("pulls P_tip along unit vector u by (d - radius) when d > radius", () => {
    const s0 = createLazyTether(100, 100, 0.4, 50);
    // Move 80u right and 60u down -> d = 100, pull = 50, u = (0.8, 0.6)
    const r1 = stepLazyTether(s0, 180, 160, 0.9);
    expect(r1.moved).toBe(true);
    expect(r1.state.tip.x).toBeCloseTo(140, 6);
    expect(r1.state.tip.y).toBeCloseTo(130, 6);
    // Distance from pen (180, 160) to new tip (140, 130) equals radius (50)
    expect(Math.hypot(r1.state.pen.x - r1.state.tip.x, r1.state.pen.y - r1.state.tip.y)).toBeCloseTo(50, 6);
  });

  it("passes raw coordinates straight through when radius <= 0", () => {
    const s0 = createLazyTether(10, 20, 0.5, 0);
    const r1 = stepLazyTether(s0, 15, 25, 0.7);
    expect(r1.moved).toBe(true);
    expect(r1.state.tip).toEqual({ x: 15, y: 25, pressure: 0.7 });
  });
});
