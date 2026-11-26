// Applies per-glyph adjustments (transform + side bearings) to a traced outline.
import { bboxOf, mapContours, type BBox, type Contour, type P } from "./contours";

export type GlyphParams = {
  scale: number; // uniform scale, pivot at the glyph's horizontal centre on the baseline
  rotation: number; // degrees, positive = clockwise
  offsetX: number; // shifts the outline inside its advance box (font units)
  offsetY: number; // vertical shift relative to the baseline (font units)
  lsb: number; // left side bearing (font units)
  rsb: number; // right side bearing (font units)
  weight: number; // stroke weight in tile px (raster morphology before tracing)
  smoothing: number | null; // per-glyph corner smoothing override
  optimize: number | null; // per-glyph curve optimisation override
};

export const DEFAULT_PARAMS: GlyphParams = {
  scale: 1,
  rotation: 0,
  offsetX: 0,
  offsetY: 0,
  lsb: 40,
  rsb: 40,
  weight: 0,
  smoothing: null,
  optimize: null,
};

/** Affine matrix [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f (canvas order). */
export type Affine = [number, number, number, number, number, number];
export type LaidOutGlyph = { contours: Contour[]; advance: number; bbox: BBox | null; matrix: Affine };

const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];
const apply = (m: Affine) => ([x, y]: P): P => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export function invertAffine(m: Affine): Affine {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-9) return IDENTITY;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/**
 * Converts edited font-space contours (matching `laid.contours`) back into raw `traced` contours
 * and a minimal bearing patch so untouched points stay locked in place after `layoutGlyph`.
 */
export function unlayoutContours(
  edited: Contour[],
  p: GlyphParams,
  isMark: boolean,
  laid: LaidOutGlyph,
): { traced: Contour[]; paramsPatch?: Partial<GlyphParams> } {
  const newBB = bboxOf(edited);
  if (!newBB) return { traced: [] };
  if (!laid.bbox) {
    return {
      traced: edited,
      paramsPatch: isMark
        ? { scale: 1, rotation: 0, offsetX: 0, offsetY: 0, rsb: Math.round(-newBB.xMax) }
        : { scale: 1, rotation: 0, offsetX: 0, offsetY: 0, lsb: Math.round(newBB.xMin) },
    };
  }
  const traced = mapContours(edited, apply(invertAffine(laid.matrix)));
  if (isMark) {
    const deltaXMax = newBB.xMax - laid.bbox.xMax;
    return Math.abs(deltaXMax) >= 0.5
      ? { traced, paramsPatch: { rsb: Math.round(p.rsb - deltaXMax) } }
      : { traced };
  }
  const deltaXMin = newBB.xMin - laid.bbox.xMin;
  return Math.abs(deltaXMin) >= 0.5
    ? { traced, paramsPatch: { lsb: Math.round(p.lsb + deltaXMin) } }
    : { traced };
}

/**
 * Scale pivots on the glyph centre at the baseline (so baseline-sitting glyphs stay put), rotation pivots
 * on the scaled bbox centre. Non-mark glyphs: outline xMin sits at lsb + offsetX and
 * advance = lsb + width + rsb. Marks: zero advance, outline hangs left of the origin with xMax at offsetX − rsb.
 */
export function layoutGlyph(traced: Contour[], p: GlyphParams, isMark: boolean): LaidOutGlyph {
  const bb = bboxOf(traced);
  if (!bb) return { contours: [], advance: isMark ? 0 : Math.round(p.lsb + p.rsb), bbox: null, matrix: IDENTITY };
  const cx = (bb.xMin + bb.xMax) / 2;
  const cy = (bb.yMin + bb.yMax) / 2;
  const s = p.scale;
  const rad = (-p.rotation * Math.PI) / 180;
  const a = s * Math.cos(rad), b = s * Math.sin(rad), c = -b, d = a;
  const m: Affine = [a, b, c, d, cx - a * cx - c * cy, cy * s - b * cx - d * cy + p.offsetY];
  const transformed = mapContours(traced, apply(m));
  const b2 = bboxOf(transformed)!;
  const width = b2.xMax - b2.xMin;
  const shift = isMark ? p.offsetX - p.rsb - b2.xMax : p.lsb + p.offsetX - b2.xMin;
  const matrix: Affine = [a, b, c, d, m[4] + shift, m[5]];
  return {
    contours: mapContours(transformed, ([x, y]): P => [x + shift, y]),
    advance: isMark ? 0 : Math.max(0, Math.round(p.lsb + width + p.rsb)),
    bbox: { xMin: b2.xMin + shift, xMax: b2.xMax + shift, yMin: b2.yMin, yMax: b2.yMax },
    matrix,
  };
}
