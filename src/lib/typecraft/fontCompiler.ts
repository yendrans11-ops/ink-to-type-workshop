// Instant font compiler: drawn canvas shapes → 1000-unit OTF via opentype.js → live FontFace.
// Canvas space is y-down pixels with the baseline at y = 400 on a 500 px em, so one canvas pixel is
// two font units: the top edge lands on the 800-unit ascender and the bottom edge on the −200 descender.
// It skips tracing, so a letter shows up in the preview the moment its stroke ends.
import { Font, Glyph, Path } from "opentype.js";
import { applyAlternateToFontContours, variantTransformFor } from "./caltGenerator";
import { bboxOf, mapContours, reverseContour, signedArea, type Contour, type P } from "./contours";
import { DEFAULT_META, finalizeSfnt } from "./font";
import { buildGsub, type CaltRule } from "./gsub";
import { resolveNames } from "./naming";

export const UNITS_PER_EM = 1000;
export const CANVAS_EM = 500;
export const CANVAS_BASELINE = 400;
export const DEFAULT_SIDE_BEARING = 40;

/** One drawn character. Shapes are closed polygons and/or Bézier contours, both in canvas pixels. */
export type CanvasGlyph = {
  unicode: number;
  name?: string;
  polygons?: P[][];
  contours?: Contour[];
  /** Space left and right of the ink (font units). Defaults to 40. */
  lsb?: number;
  rsb?: number;
};

export type CompileOptions = { familyName?: string; canvasEm?: number; baseline?: number; spaceWidth?: number; calt?: boolean };

/** Canvas pixel (y-down) → font units (y-up, baseline 0). */
export function canvasToFont([x, y]: P, canvasEm = CANVAS_EM, baseline = CANVAS_BASELINE): P {
  const k = UNITS_PER_EM / canvasEm;
  return [x * k, (baseline - y) * k];
}

/** Font units → canvas pixels; the inverse of canvasToFont. */
export function fontToCanvas([x, y]: P, canvasEm = CANVAS_EM, baseline = CANVAS_BASELINE): P {
  const k = canvasEm / UNITS_PER_EM;
  return [x * k, baseline - y * k];
}

const polygonToContour = (poly: P[]): Contour => ({ start: poly[0]!, segs: [...poly.slice(1), poly[0]!].map((p) => ({ t: "L" as const, p })) });

/**
 * Font-unit outline and advance for one glyph. The ink is shifted so its left edge sits at `lsb`, and
 * advanceWidth = lsb + bounding-box width + rsb. Every shape is turned counter-clockwise so overlapping
 * pen strokes add up instead of punching holes.
 */
export function layoutCanvasGlyph(g: CanvasGlyph, canvasEm = CANVAS_EM, baseline = CANVAS_BASELINE) {
  const lsb = g.lsb ?? DEFAULT_SIDE_BEARING;
  const rsb = g.rsb ?? DEFAULT_SIDE_BEARING;
  const shapes = [...(g.contours ?? []), ...(g.polygons ?? []).filter((p) => p.length >= 3).map(polygonToContour)];
  const inFont = mapContours(shapes, (p) => canvasToFont(p, canvasEm, baseline)).map((c) => (signedArea(c) < 0 ? reverseContour(c) : c));
  const bb = bboxOf(inFont);
  if (!bb) return { contours: [] as Contour[], advanceWidth: Math.round(lsb + rsb), bbox: null };
  const dx = lsb - bb.xMin;
  return {
    contours: mapContours(inFont, ([x, y]): P => [x + dx, y]),
    advanceWidth: Math.max(0, Math.round(lsb + (bb.xMax - bb.xMin) + rsb)),
    bbox: { xMin: lsb, xMax: lsb + bb.xMax - bb.xMin, yMin: bb.yMin, yMax: bb.yMax },
  };
}

function toPath(contours: Contour[]) {
  const path = new Path();
  const r = Math.round;
  for (const c of contours) {
    path.moveTo(r(c.start[0]), r(c.start[1]));
    for (const s of c.segs) {
      if (s.t === "L") path.lineTo(r(s.p[0]), r(s.p[1]));
      else path.curveTo(r(s.c1[0]), r(s.c1[1]), r(s.c2[0]), r(s.c2[1]), r(s.p[0]), r(s.p[1]));
    }
    path.close();
  }
  return path;
}

/** Compiles drawn glyphs into OTF bytes (with a .notdef box, space, and optional calt alternates). Later duplicates of a codepoint are ignored. */
export function compileCanvasFont(glyphs: CanvasGlyph[], opts: CompileOptions = {}): ArrayBuffer {
  const { familyName = "Canvas Preview", canvasEm = CANVAS_EM, baseline = CANVAS_BASELINE, spaceWidth = 260, calt = true } = opts;
  const notdef = new Path();
  notdef.moveTo(50, 0); notdef.lineTo(450, 0); notdef.lineTo(450, 700); notdef.lineTo(50, 700); notdef.close();
  const list: Glyph[] = [
    new Glyph({ name: ".notdef", advanceWidth: 500, path: notdef }),
    new Glyph({ name: "space", unicode: 0x20, unicodes: [0x20], advanceWidth: spaceWidth, path: new Path() }),
  ];
  const used = new Set([0x20]);
  const caltPending: { baseIdx: number; baseName: string; unicode: number; contours: Contour[]; lsb: number; rsb: number; width: number }[] = [];
  for (const g of glyphs) {
    if (used.has(g.unicode)) continue;
    const laid = layoutCanvasGlyph(g, canvasEm, baseline);
    if (!laid.contours.length) continue;
    used.add(g.unicode);
    const baseName = g.name ?? `uni${g.unicode.toString(16).toUpperCase().padStart(4, "0")}`;
    const baseIdx = list.length;
    list.push(new Glyph({ name: baseName, unicode: g.unicode, unicodes: [g.unicode], advanceWidth: laid.advanceWidth, path: toPath(laid.contours) }));
    if (calt && laid.bbox) {
      caltPending.push({
        baseIdx,
        baseName,
        unicode: g.unicode,
        contours: laid.contours,
        lsb: g.lsb ?? DEFAULT_SIDE_BEARING,
        rsb: g.rsb ?? DEFAULT_SIDE_BEARING,
        width: laid.bbox.xMax - laid.bbox.xMin,
      });
    }
  }
  const caltRules: CaltRule[] = [];
  if (calt && caltPending.length) {
    for (const item of caltPending) {
      const alt1Idx = list.length;
      const alt1Contours = applyAlternateToFontContours(item.contours, item.unicode, 1);
      const tf1 = variantTransformFor(item.unicode, 1);
      list.push(new Glyph({
        name: `${item.baseName}.alt1`,
        advanceWidth: Math.max(0, Math.round((item.lsb + item.width + item.rsb) * tf1.scaleX)),
        path: toPath(alt1Contours),
      }));
      const alt2Idx = list.length;
      const alt2Contours = applyAlternateToFontContours(item.contours, item.unicode, 2);
      const tf2 = variantTransformFor(item.unicode, 2);
      list.push(new Glyph({
        name: `${item.baseName}.alt2`,
        advanceWidth: Math.max(0, Math.round((item.lsb + item.width + item.rsb) * tf2.scaleX)),
        path: toPath(alt2Contours),
      }));
      caltRules.push({ base: item.baseIdx, alt1: alt1Idx, alt2: alt2Idx });
    }
  }
  const font = new Font({
    familyName,
    styleName: "Regular",
    unitsPerEm: UNITS_PER_EM,
    ascender: baseline * (UNITS_PER_EM / canvasEm),
    descender: -(canvasEm - baseline) * (UNITS_PER_EM / canvasEm),
    glyphs: list,
  } as ConstructorParameters<typeof Font>[0]);
  const gsub = caltRules.length ? buildGsub({ conjuncts: [], syllables: [], calt: caltRules }) : null;
  // opentype.js leaves name records blank; write real ones so every browser accepts the font.
  return finalizeSfnt(font.toArrayBuffer(), resolveNames({ ...DEFAULT_META, familyName }), gsub);
}

const loaded = new Map<string, FontFace>();

/**
 * Registers the font bytes in document.fonts under `family`, replacing the previous face with that name,
 * so any element styled with `font-family: family` redraws with the new letters.
 */
export async function loadCanvasFont(buffer: ArrayBuffer, family: string): Promise<FontFace> {
  const face = new FontFace(family, buffer);
  await face.load();
  const old = loaded.get(family);
  document.fonts.add(face);
  if (old) document.fonts.delete(old);
  loaded.set(family, face);
  return face;
}
