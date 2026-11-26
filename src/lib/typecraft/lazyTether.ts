// Pure Lazy Mouse / Rubber Band (pull-string) stabilizer in em units (0..1000).
export type TetherPoint = { x: number; y: number; pressure: number };

export type LazyTetherState = {
  pen: TetherPoint;
  tip: TetherPoint;
  radius: number;
};

export function createLazyTether(x: number, y: number, pressure: number, radius: number): LazyTetherState {
  const r = Math.max(0, radius);
  const pt = { x, y, pressure };
  return { pen: pt, tip: { ...pt }, radius: r };
}

/**
 * Advances the Lazy "Rubber Band" tether when the stylus/mouse moves to `(x, y, pressure)`:
 * - Dead zone (`d <= radius`): `tip` remains stationary (`moved: false`).
 * - Tether pull (`d > radius`): `tip` is pulled along `u = (pen - tip) / d` by `(d - radius)`.
 */
export function stepLazyTether(
  state: LazyTetherState,
  x: number,
  y: number,
  pressure: number,
): { state: LazyTetherState; moved: boolean } {
  const pen: TetherPoint = { x, y, pressure };
  const dx = x - state.tip.x;
  const dy = y - state.tip.y;
  const d = Math.hypot(dx, dy);

  if (state.radius <= 0) {
    const moved = d > 1e-6;
    return {
      state: { pen, tip: { x, y, pressure }, radius: 0 },
      moved,
    };
  }

  if (d <= state.radius || d < 1e-9) {
    return {
      state: { pen, tip: state.tip, radius: state.radius },
      moved: false,
    };
  }

  const pull = d - state.radius;
  const ux = dx / d;
  const uy = dy / d;
  const t = Math.min(1, pull / d);
  const tip: TetherPoint = {
    x: state.tip.x + ux * pull,
    y: state.tip.y + uy * pull,
    pressure: state.tip.pressure + (pressure - state.tip.pressure) * t,
  };
  return {
    state: { pen, tip, radius: state.radius },
    moved: true,
  };
}
