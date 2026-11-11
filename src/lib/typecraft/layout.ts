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

export type LaidOutGlyph = { contours: Contour[]; advance: number; bbox: BBox | null };

/**
 * Non-mark glyphs: outline xMin sits at lsb + offsetX and advance = lsb + width + rsb.
 * Marks: zero advance, outline hangs left of the origin with xMax at offsetX − rsb.
 */
export function layoutGlyph(traced: Contour[], p: GlyphParams, isMark: boolean): LaidOutGlyph {
  const bb = bboxOf(traced);
  if (!bb) return { contours: [], advance: isMark ? 0 : Math.round(p.lsb + p.rsb), bbox: null };
  const cx = (bb.xMin + bb.xMax) / 2;
  const cy = (bb.yMin + bb.yMax) / 2;
  const s = p.scale;
  const rad = (-p.rotation * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const ry = cy * s;
  const transformed = mapContours(traced, ([x, y]): P => {
    const X = cx + (x - cx) * s;
    const Y = y * s;
    const dx = X - cx, dy = Y - ry;
    return [cx + dx * cos - dy * sin, ry + dx * sin + dy * cos + p.offsetY];
  });
  const b2 = bboxOf(transformed)!;
  const width = b2.xMax - b2.xMin;
  const shift = isMark ? p.offsetX - p.rsb - b2.xMax : p.lsb + p.offsetX - b2.xMin;
  const contours = mapContours(transformed, ([x, y]): P => [x + shift, y]);
  return {
    contours,
    advance: isMark ? 0 : Math.max(0, Math.round(p.lsb + width + p.rsb)),
    bbox: { xMin: b2.xMin + shift, xMax: b2.xMax + shift, yMin: b2.yMin, yMax: b2.yMax },
  };
}
