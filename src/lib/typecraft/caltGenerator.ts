// Micro-variant generator for OpenType Contextual Alternates (calt):
// Synthesizes subtle organic alternates (.alt1, .alt2) from a single drawn glyph so consecutive repeated letters vary naturally.
import { bboxOf, mapContours, type Contour, type P } from "./contours";
import { padToUnits, strokesToTile, unitsToPadY, type Stroke } from "./drawing";
import type { GlyphRecord } from "./store";
import { TILE_ASCENDER, UNITS_PER_EM } from "./trace";

export type CaltGlyphRecord = GlyphRecord & {
  /** Base Unicode codepoint this unencoded alternate substitutes for. */
  altOf: number;
  /** Alternate index (1 for .alt1, 2 for .alt2). */
  altIndex: number;
};

type VariantTransform = {
  shearRad: number;
  scaleX: number;
  scaleY: number;
  shiftX: number;
  shiftY: number;
};

/** Deterministic micro-transform per codepoint and alternate slot (1 or 2). */
export function variantTransformFor(unicode: number, altIndex: number): VariantTransform {
  const sign = unicode % 2 === 0 ? 1 : -1;
  if (altIndex === 1) {
    // Alternate 1 (.alt1): subtle slant jitter (±1.2° shear) and +1% vertical scale.
    const deg = 1.2 * sign;
    return {
      shearRad: (deg * Math.PI) / 180,
      scaleX: 1,
      scaleY: 1.01,
      shiftX: 0,
      shiftY: 0,
    };
  }
  // Alternate 2 (.alt2): subtle baseline nudge (-8 to +10 font units) and ±1.5% horizontal tracking/scale tweak.
  const nudgePool = [-8, -5, 6, 10, -6, 8];
  const shiftY = nudgePool[Math.abs(unicode) % nudgePool.length]!;
  const trackSign = ((unicode >> 1) & 1) === 0 ? 1 : -1;
  return {
    shearRad: 0,
    scaleX: 1 + 0.015 * trackSign,
    scaleY: 1,
    shiftX: Math.round(4 * trackSign),
    shiftY,
  };
}

function applyVariantToFontPoint(p: P, pivotX: number, t: VariantTransform): P {
  const dx = p[0] - pivotX;
  const dy = p[1];
  const sx = dx * t.scaleX + dy * Math.tan(t.shearRad);
  const sy = dy * t.scaleY;
  return [pivotX + sx + t.shiftX, sy + t.shiftY];
}

function transformStrokes(strokes: Stroke[], pivotX: number, t: VariantTransform): Stroke[] {
  return strokes.map((st) => {
    const pts = [...st.pts];
    for (let k = 0; k + 2 < pts.length; k += 3) {
      const fontPt = padToUnits(pts[k]!, pts[k + 1]!);
      const next = applyVariantToFontPoint(fontPt, pivotX, t);
      pts[k] = next[0] / UNITS_PER_EM;
      pts[k + 1] = unitsToPadY(next[1]);
    }
    return { ...st, pts };
  });
}

function estimatePivotX(glyph: GlyphRecord): number {
  if (glyph.traced?.length) {
    const bb = bboxOf(glyph.traced);
    if (bb) return (bb.xMin + bb.xMax) / 2;
  }
  if (glyph.strokes?.length) {
    let minX = Infinity;
    let maxX = -Infinity;
    for (const s of glyph.strokes) {
      for (let k = 0; k + 2 < s.pts.length; k += 3) {
        const x = s.pts[k]! * UNITS_PER_EM;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
    }
    if (minX < Infinity) return (minX + maxX) / 2;
  }
  return UNITS_PER_EM / 2;
}

/**
 * Generates `count` (default 2: `.alt1`, `.alt2`) unencoded micro-variant glyphs for `glyph`.
 * When `strokes` are present, transforms the stroke points directly in addition to any traced Bézier contours.
 */
export function createGlyphAlternates(glyph: GlyphRecord, count = 2): CaltGlyphRecord[] {
  if (glyph.empty || (!glyph.traced?.length && !glyph.strokes?.length)) return [];
  const pivotX = estimatePivotX(glyph);
  const out: CaltGlyphRecord[] = [];
  const { strokes: _ignoredStrokes, ...baseRest } = glyph;
  for (let idx = 1; idx <= count; idx++) {
    const tf = variantTransformFor(glyph.unicode, idx);
    const nextStrokes = glyph.strokes?.length ? transformStrokes(glyph.strokes, pivotX, tf) : undefined;
    const nextTraced: Contour[] | null = glyph.traced?.length
      ? mapContours(glyph.traced, (p) => applyVariantToFontPoint(p, pivotX, tf))
      : null;
    const nextSource = nextStrokes ? strokesToTile(nextStrokes) : glyph.source;
    const widthFactor = tf.scaleX;
    const nextParams = {
      ...glyph.params,
      lsb: Math.round(glyph.params.lsb * widthFactor),
      rsb: Math.round(glyph.params.rsb * widthFactor),
    };
    out.push({
      ...baseRest,
      id: `${glyph.id}.alt${idx}`,
      name: `${glyph.name}.alt${idx}`,
      unicode: glyph.unicode,
      source: nextSource,
      traced: nextTraced,
      ...(nextStrokes ? { strokes: nextStrokes } : {}),
      params: nextParams,
      altOf: glyph.unicode,
      altIndex: idx,
    });
  }
  return out;
}

/** Applies the subtle micro-variant transform directly to a canvas polygon array (for fontCompiler instant preview). */
export function transformPolygonForAlternate(poly: P[], pivotX: number, unicode: number, altIndex: number): P[] {
  const tf = variantTransformFor(unicode, altIndex);
  return poly.map((p) => applyVariantToFontPoint(p, pivotX, tf));
}

export function applyAlternateToFontContours(contours: Contour[], unicode: number, altIndex: number): Contour[] {
  const bb = bboxOf(contours);
  const pivotX = bb ? (bb.xMin + bb.xMax) / 2 : UNITS_PER_EM / 2;
  const tf = variantTransformFor(unicode, altIndex);
  return mapContours(contours, (p) => applyVariantToFontPoint(p, pivotX, tf));
}

export { TILE_ASCENDER };
