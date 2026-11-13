// Font assembly: project glyphs → opentype.js Font → OTF (CFF) or TTF (glyf) binaries.
import { Font, Glyph, Path } from "opentype.js";
import type { Contour } from "./contours";
import { layoutGlyph, type GlyphParams } from "./layout";
import { otfToTtf } from "./ttf";
import { UNITS_PER_EM } from "./trace";

export type Metrics = { ascender: number; capHeight: number; xHeight: number; descender: number };
export type FontMeta = {
  familyName: string;
  styleName: string;
  designer: string;
  version: string;
  description: string;
  license: string;
};
export type ExportGlyph = { name: string; unicode?: number; advance: number; contours: Contour[] };
export type GlyphSource = {
  name: string;
  unicode: number;
  isMark: boolean;
  traced: Contour[] | null;
  params: GlyphParams;
};

const rect = (x0: number, y0: number, x1: number, y1: number, ccw: boolean): Contour =>
  ccw
    ? { start: [x0, y0], segs: [{ t: "L", p: [x1, y0] }, { t: "L", p: [x1, y1] }, { t: "L", p: [x0, y1] }, { t: "L", p: [x0, y0] }] }
    : { start: [x0, y0], segs: [{ t: "L", p: [x0, y1] }, { t: "L", p: [x1, y1] }, { t: "L", p: [x1, y0] }, { t: "L", p: [x0, y0] }] };

export function notdefGlyph(m: Metrics): ExportGlyph {
  return { name: ".notdef", advance: 500, contours: [rect(50, 0, 450, m.capHeight, true), rect(100, 50, 400, m.capHeight - 50, false)] };
}

export type CollectResult = { glyphs: ExportGlyph[]; skippedDuplicates: number[]; drawnCount: number };

/** Builds the export glyph list: .notdef, space, then every drawn glyph with a unique codepoint. */
export function collectExportGlyphs(sources: GlyphSource[], metrics: Metrics, spaceWidth: number): CollectResult {
  const glyphs: ExportGlyph[] = [notdefGlyph(metrics), { name: "space", unicode: 0x20, advance: Math.round(spaceWidth), contours: [] }];
  const usedCp = new Set([0x20]);
  const usedNames = new Set([".notdef", "space"]);
  const skippedDuplicates: number[] = [];
  for (const s of sources) {
    if (!s.traced?.length) continue;
    if (usedCp.has(s.unicode)) { skippedDuplicates.push(s.unicode); continue; }
    usedCp.add(s.unicode);
    let name = s.name;
    for (let k = 1; usedNames.has(name); k++) name = `${s.name}.${k}`;
    usedNames.add(name);
    const laid = layoutGlyph(s.traced, s.params, s.isMark);
    glyphs.push({ name, unicode: s.unicode, advance: laid.advance, contours: laid.contours });
  }
  return { glyphs, skippedDuplicates, drawnCount: glyphs.length - 2 };
}

function toOpentypePath(contours: Contour[]): Path {
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

export function buildFont(glyphs: ExportGlyph[], meta: FontMeta, metrics: Metrics): Font {
  const otGlyphs = glyphs.map(
    (g) =>
      new Glyph({
        name: g.name,
        unicode: g.unicode,
        unicodes: g.unicode !== undefined ? [g.unicode] : [],
        advanceWidth: g.advance,
        path: toOpentypePath(g.contours),
      }),
  );
  const familyName = meta.familyName.trim() || "TypeCraft Hand";
  const styleName = meta.styleName.trim() || "Regular";
  return new Font({
    familyName,
    styleName,
    postScriptName: postScriptName(meta),
    unitsPerEm: UNITS_PER_EM,
    ascender: metrics.ascender,
    descender: -Math.abs(metrics.descender),
    designer: meta.designer.trim() || undefined,
    version: `Version ${meta.version.trim() || "1.000"}`,
    description: meta.description.trim() || "Made with TypeCraft",
    license: meta.license.trim() || undefined,
    manufacturer: "TypeCraft",
    glyphs: otGlyphs,
    tables: { os2: { sxHeight: Math.round(metrics.xHeight), sCapHeight: Math.round(metrics.capHeight) } },
  } as ConstructorParameters<typeof Font>[0]);
}

export function buildOtf(glyphs: ExportGlyph[], meta: FontMeta, metrics: Metrics): ArrayBuffer {
  return buildFont(glyphs, meta, metrics).toArrayBuffer();
}

export function buildTtf(glyphs: ExportGlyph[], meta: FontMeta, metrics: Metrics): ArrayBuffer {
  return otfToTtf(buildOtf(glyphs, meta, metrics), glyphs.map((g) => g.contours));
}

/** ASCII-only "Family-Style" name; non-Latin font names fall back so the PostScript name stays valid. */
export function postScriptName(meta: FontMeta) {
  const family = meta.familyName.replace(/[^A-Za-z0-9]+/g, "") || "TypeCraftHand";
  const style = meta.styleName.replace(/[^A-Za-z0-9]+/g, "") || "Regular";
  return `${family}-${style}`.slice(0, 63);
}

export function fileBaseName(meta: FontMeta) {
  return postScriptName(meta);
}
