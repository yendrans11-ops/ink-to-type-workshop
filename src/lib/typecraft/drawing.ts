// Apple Pencil / touch drawing: strokes live in a square pad that spans the whole em (ascender at the top edge,
// descender at the bottom), exactly like a template box, so a drawn glyph rasterises into the same tile the
// scanner produces and goes through the same Potrace tracing.
import { getStroke } from "perfect-freehand";
import { TILE, TILE_ASCENDER, UNITS_PER_EM } from "./trace";

/** One pen stroke. `pts` is flat [x, y, pressure, …] with x/y as 0–1 fractions of the pad; `size` is the nib width in font units. */
export type Stroke = { size: number; erase?: boolean; pts: number[]; smooth?: number; penStyle?: "pen" | "brush" | "calligraphy" };

/** Default smoothing (perfect-freehand streamline) for new strokes; 0 = raw, 1 = very smooth. */
export const DEFAULT_SMOOTH = 0.7;

/**
 * Smooth, pressure-tapered outline polygon (pad fractions) for a stroke drawn with smoothing.
 * Strokes saved before smoothing existed have no `smooth` and keep their original disc rendering.
 */
export function strokeOutline(st: Stroke, last = true): [number, number][] {
  const n = Math.floor(st.pts.length / 3);
  const pts: [number, number, number][] = [];
  for (let k = 0; k < n; k++) pts.push([st.pts[k * 3]! * 1000, st.pts[k * 3 + 1]! * 1000, st.pts[k * 3 + 2]!]);
  const sm = st.smooth ?? DEFAULT_SMOOTH;
  const calligraphy = st.penStyle === "calligraphy" && !st.erase;
  const brushPen = st.penStyle === "brush" && !st.erase;
  // A fixed 45-degree elliptical nib: map its narrow axis to a round nib, then map back.
  const c = Math.SQRT1_2;
  const input = calligraphy ? pts.map(([x, y, p]): [number, number, number] => [(x + y) * c, (y - x) * c / 0.22, p]) : pts;
  const out = getStroke(input, {
    size: (st.size * 1.6 / UNITS_PER_EM) * 1000,
    thinning: calligraphy ? 0 : brushPen ? 0.9 : 0.6,
    smoothing: 0.75,
    streamline: sm * 0.85,
    simulatePressure: false,
    last,
    start: { taper: brushPen ? st.size * 0.5 : 0 },
    end: { taper: brushPen ? st.size : 0 },
  });
  const polygon = out.map(([x = 0, y = 0]): [number, number] => calligraphy ? [(x - y * 0.22) * c / 1000, (x + y * 0.22) * c / 1000] : [x / 1000, y / 1000]);
  // Midpoint quadratic outline, shared by canvas, raster and font paths: no angular joins.
  const rounded: [number, number][] = [];
  for (let i = 0; i < polygon.length; i++) {
    const prev = polygon[(i + polygon.length - 1) % polygon.length], at = polygon[i], next = polygon[(i + 1) % polygon.length];
    if (!prev || !at || !next) continue;
    const start: [number, number] = [(prev[0] + at[0]) / 2, (prev[1] + at[1]) / 2];
    const end: [number, number] = [(at[0] + next[0]) / 2, (at[1] + next[1]) / 2];
    for (let j = 0; j < 6; j++) {
      const t = j / 6, u = 1 - t;
      rounded.push([u*u*start[0] + 2*u*t*at[0] + t*t*end[0], u*u*start[1] + 2*u*t*at[1] + t*t*end[1]]);
    }
  }
  return rounded;
}

/** Nonzero-winding scanline fill of a polygon into a coverage buffer (4 sub-rows for anti-aliasing). */
function fillPolygon(cov: Float32Array, size: number, poly: [number, number][], erase: boolean) {
  if (poly.length < 3) return;
  const SUB = 4;
  const row = new Float32Array(size);
  let minY = Infinity, maxY = -Infinity;
  for (const [, y] of poly) { minY = Math.min(minY, y * size); maxY = Math.max(maxY, y * size); }
  const y0 = Math.max(0, Math.floor(minY)), y1 = Math.min(size - 1, Math.ceil(maxY));
  for (let y = y0; y <= y1; y++) {
    row.fill(0);
    for (let s = 0; s < SUB; s++) {
      const sy = y + (s + 0.5) / SUB;
      const xs: { x: number; d: number }[] = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
        const ay = a[1] * size, by = b[1] * size;
        if ((ay <= sy) === (by <= sy)) continue;
        const t = (sy - ay) / (by - ay);
        xs.push({ x: (a[0] + (b[0] - a[0]) * t) * size, d: by > ay ? 1 : -1 });
      }
      xs.sort((p, q) => p.x - q.x);
      let w = 0;
      for (let i = 0; i < xs.length - 1; i++) {
        w += xs[i]!.d;
        if (!w) continue;
        const xa = Math.max(0, xs[i]!.x), xb = Math.min(size, xs[i + 1]!.x);
        for (let x = Math.floor(xa); x < xb; x++) row[x]! += (Math.min(x + 1, xb) - Math.max(x, xa)) / SUB;
      }
    }
    for (let x = 0; x < size; x++) {
      const a = Math.min(1, row[x]!);
      if (!a) continue;
      const i = y * size + x;
      cov[i] = erase ? cov[i]! * (1 - a) : Math.max(cov[i]!, a);
    }
  }
}

export const BRUSH_MIN = 20;
export const BRUSH_MAX = 160;
export const DEFAULT_BRUSH = 70;

/** Distance from the pad's top edge (0–1) of a vertical metric given in font units. */
export const unitsToPadY = (units: number) => (TILE_ASCENDER - units) / UNITS_PER_EM;
/** Pad fraction → font units (baseline 0, x from the pad's left edge). */
export const padToUnits = (fx: number, fy: number): [number, number] => [fx * UNITS_PER_EM, TILE_ASCENDER - fy * UNITS_PER_EM];

/** Nib width in font units for a pen pressure (0–1). Mouse and finger report 0.5, which gives the nominal size. */
export const nibWidth = (size: number, pressure: number) => size * (0.4 + 1.2 * Math.max(0, Math.min(1, pressure)));

/** Pixels around the tile edge that tracing ignores (matches clearBorder in prepareMask). */
export const SAFE_MARGIN = 0.045;

/**
 * Renders strokes into a grayscale tile (255 = paper, 0 = ink) by stamping anti-aliased discs along each segment.
 * Pure so it behaves identically in tests, workers and every browser.
 */
export function strokesToTile(strokes: Stroke[], size = TILE): Uint8Array {
  const cov = new Float32Array(size * size);
  for (const st of strokes) {
    if (st.smooth !== undefined) { fillPolygon(cov, size, strokeOutline(st), !!st.erase); continue; }
    const p = st.pts;
    const n = Math.floor(p.length / 3);
    if (!n) continue;
    const stamp = (cx: number, cy: number, r: number) => {
      const x0 = Math.max(0, Math.floor(cx - r - 1)), x1 = Math.min(size - 1, Math.ceil(cx + r + 1));
      const y0 = Math.max(0, Math.floor(cy - r - 1)), y1 = Math.min(size - 1, Math.ceil(cy + r + 1));
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          const a = Math.max(0, Math.min(1, r + 0.5 - d));
          if (!a) continue;
          const i = y * size + x;
          cov[i] = st.erase ? cov[i]! * (1 - a) : Math.max(cov[i]!, a);
        }
    };
    const rad = (pr: number) => Math.max(0.6, (nibWidth(st.size, pr) / UNITS_PER_EM) * size * 0.5);
    let px = p[0]! * size, py = p[1]! * size, pr = rad(p[2]!);
    stamp(px, py, pr);
    for (let k = 1; k < n; k++) {
      const x = p[k * 3]! * size, y = p[k * 3 + 1]! * size, r = rad(p[k * 3 + 2]!);
      const steps = Math.max(1, Math.ceil(Math.hypot(x - px, y - py) / 0.5));
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        stamp(px + (x - px) * t, py + (y - py) * t, pr + (r - pr) * t);
      }
      px = x; py = y; pr = r;
    }
  }
  const out = new Uint8Array(size * size);
  for (let i = 0; i < out.length; i++) out[i] = 255 - Math.round(cov[i]! * 255);
  return out;
}

/** True when the strokes leave any ink once erasing is applied. */
export function hasInk(strokes: Stroke[]): boolean {
  if (!strokes.some((s) => !s.erase && s.pts.length)) return false;
  return strokesToTile(strokes, 96).some((v) => v < 128);
}

/** Rounds stroke points so saved projects stay small (≈0.1 font unit precision). */
export function compactStroke(s: Stroke): Stroke {
  return { ...s, pts: s.pts.map((v) => Math.round(v * 10000) / 10000) };
}

/** Paints strokes onto a canvas of `px` CSS pixels square (already scaled for device pixel ratio). */
export function paintStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], px: number, ink: string) {
  for (const st of strokes) paintStroke(ctx, st, px, ink);
}

export function paintStroke(ctx: CanvasRenderingContext2D, st: Stroke, px: number, ink: string, from = 0, last = true) {
  const p = st.pts;
  const n = Math.floor(p.length / 3);
  if (!n) return;
  if (st.smooth !== undefined) {
    const poly = strokeOutline(st, last);
    if (poly.length < 3) return;
    ctx.save();
    ctx.globalCompositeOperation = st.erase ? "destination-out" : "source-over";
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.moveTo(poly[0]![0] * px, poly[0]![1] * px);
    for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i]![0] * px, poly[i]![1] * px);
    ctx.closePath();
    ctx.fill("nonzero");
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.globalCompositeOperation = st.erase ? "destination-out" : "source-over";
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const w = (pr: number) => (nibWidth(st.size, pr) / UNITS_PER_EM) * px;
  if (n === 1 || from === 0) {
    ctx.beginPath();
    ctx.arc(p[0]! * px, p[1]! * px, w(p[2]!) / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let k = Math.max(1, from); k < n; k++) {
    ctx.beginPath();
    ctx.lineWidth = w((p[k * 3 - 1]! + p[k * 3 + 2]!) / 2);
    ctx.moveTo(p[k * 3 - 3]! * px, p[k * 3 - 2]! * px);
    ctx.lineTo(p[k * 3]! * px, p[k * 3 + 1]! * px);
    ctx.stroke();
  }
  ctx.restore();
}
