// Font assembly: project glyphs → opentype.js Font → OTF (CFF) or TTF (glyf) binaries.
import { Font, Glyph, Path } from "opentype.js";
import type { Contour } from "./contours";
import { layoutGlyph, type GlyphParams } from "./layout";
import { resolveNames, type ResolvedNames } from "./naming";
import { buildNameTable, readSfnt, writeSfnt } from "./sfnt";
import { otfToTtf } from "./ttf";
import { UNITS_PER_EM } from "./trace";

export type Metrics = { ascender: number; capHeight: number; xHeight: number; descender: number };
/** Font details written to the OpenType name table (name IDs in comments), OS/2 and head tables. */
export type FontMeta = {
  familyName: string; // 1 / 16
  styleName: string; // 2 / 17
  weightClass: number; // OS/2 usWeightClass
  italic: boolean; // OS/2 fsSelection + head macStyle
  copyright: string; // 0
  trademark: string; // 7
  manufacturer: string; // 8
  designer: string; // 9
  description: string; // 10
  manufacturerURL: string; // 11
  designerURL: string; // 12
  license: string; // 13
  licenseURL: string; // 14
  sampleText: string; // 19
  version: string; // 5 + head.fontRevision
  postScriptName: string; // 6 — empty means automatic
  vendorId: string; // OS/2 achVendID
  embedding: "installable" | "editable" | "preview" | "restricted"; // OS/2 fsType
};

export const DEFAULT_META: FontMeta = {
  familyName: "My Handwriting",
  styleName: "Regular",
  weightClass: 400,
  italic: false,
  copyright: "",
  trademark: "",
  manufacturer: "",
  designer: "",
  description: "",
  manufacturerURL: "",
  designerURL: "",
  license: "",
  licenseURL: "",
  sampleText: "",
  version: "1.000",
  postScriptName: "",
  vendorId: "",
  embedding: "installable",
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
  const n = resolveNames(meta);
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
  // The name table, weight and style bits opentype.js writes are replaced in finalizeSfnt; these feed the CFF top dict and preview.
  return new Font({
    familyName: n.legacyFamily,
    styleName: n.legacySubfamily,
    fullName: n.fullName,
    postScriptName: n.postScriptName,
    unitsPerEm: UNITS_PER_EM,
    ascender: metrics.ascender,
    descender: -Math.abs(metrics.descender),
    designer: meta.designer.trim() || undefined,
    version: n.versionString,
    description: meta.description.trim() || "Made with TypeCraft",
    license: meta.license.trim() || undefined,
    copyright: meta.copyright.trim() || undefined,
    glyphs: otGlyphs,
    tables: { os2: { sxHeight: Math.round(metrics.xHeight), sCapHeight: Math.round(metrics.capHeight) } },
  } as ConstructorParameters<typeof Font>[0]);
}

/** Writes our name table and the style/version/embedding fields opentype.js doesn't expose, with fresh checksums. */
export function finalizeSfnt(buf: ArrayBuffer, n: ResolvedNames): ArrayBuffer {
  const sfnt = readSfnt(buf);
  sfnt.tables.delete("ltag");
  sfnt.tables.set("name", buildNameTable(n.records));
  const head = sfnt.tables.get("head");
  if (head) {
    const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
    dv.setInt32(4, Math.round(n.fontRevision * 65536)); // fontRevision (Fixed)
    dv.setUint16(44, n.macStyle);
  }
  const os2 = sfnt.tables.get("OS/2");
  if (os2) {
    const dv = new DataView(os2.buffer, os2.byteOffset, os2.byteLength);
    dv.setUint16(4, n.weightClass);
    dv.setUint16(8, n.fsType);
    for (let i = 0; i < 4; i++) dv.setUint8(58 + i, n.vendorId.charCodeAt(i));
    // Keep USE_TYPO_METRICS / WWS bits, replace the style-linking bits.
    dv.setUint16(62, (dv.getUint16(62) & ~0b1100001) | n.fsSelection);
  }
  return writeSfnt(sfnt);
}

export function buildOtf(glyphs: ExportGlyph[], meta: FontMeta, metrics: Metrics): ArrayBuffer {
  return finalizeSfnt(buildFont(glyphs, meta, metrics).toArrayBuffer(), resolveNames(meta));
}

export function buildTtf(glyphs: ExportGlyph[], meta: FontMeta, metrics: Metrics): ArrayBuffer {
  return otfToTtf(buildOtf(glyphs, meta, metrics), glyphs.map((g) => g.contours));
}

/** PostScript name (name ID 6): the custom one if valid, else ASCII-only "Family-Style". */
export function postScriptName(meta: FontMeta) {
  return resolveNames(meta).postScriptName;
}

export function fileBaseName(meta: FontMeta) {
  return postScriptName(meta);
}
