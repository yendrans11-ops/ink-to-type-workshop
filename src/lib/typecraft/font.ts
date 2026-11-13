// Font assembly: project glyphs → opentype.js Font → OTF (CFF) or TTF (glyf) binaries.
import { Font, Glyph, Path } from "opentype.js";
import { bboxOf, mapContours, type Contour, type P } from "./contours";
import { buildGpos } from "./gpos";
import { buildGsub, type LigatureRule } from "./gsub";
import { listSyllables, syllableKerning, type CpPair } from "./syllables";
import { layoutGlyph, type GlyphParams } from "./layout";
import { resolveNames, type ResolvedNames } from "./naming";
import { buildNameTable, readSfnt, writeSfnt } from "./sfnt";
import { isTamilConsonant, isTamilCp, isTamilSign, ligatureById, PULLI, type LigatureKind } from "./tamil";
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
/** components: the character sequence a ligature glyph replaces (it has no unicode of its own). */
export type ExportGlyph = {
  name: string;
  unicode?: number;
  advance: number;
  contours: Contour[];
  components?: number[];
  ligatureKind?: LigatureKind;
};
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

/** kerning: syllable gaps from the Studio, by codepoint (resolved to glyph ids when the font is written). */
export type CollectResult = { glyphs: ExportGlyph[]; skippedDuplicates: number[]; drawnCount: number; kerning: CpPair[] };

/** Gap kept between a consonant's top and an automatically placed pulli dot (font units). */
export const PULLI_GAP = 40;

/** Consonant + pulli as one outline: the dot centred over the consonant's ink, lifted clear of it. */
export function pulliComposite(cons: Contour[], pulli: Contour[], nudgeX = 0): Contour[] {
  const cb = bboxOf(cons);
  const pb = bboxOf(pulli);
  if (!cb || !pb) return [...cons, ...pulli];
  const dx = (cb.xMin + cb.xMax) / 2 - (pb.xMin + pb.xMax) / 2 + nudgeX;
  const dy = Math.max(0, cb.yMax + PULLI_GAP - pb.yMin);
  return [...cons, ...mapContours(pulli, ([x, y]): P => [x + dx, y + dy])];
}

/**
 * Builds the export glyph list: .notdef, space, then every drawn glyph with a unique codepoint. Drawn Tamil
 * syllables become unencoded ligature glyphs. For Tamil it also adds consonant+pulli composites (dot centred
 * over the consonant) and blank stand-ins for vowel signs that were only drawn inside syllables. `spacing` holds the
 * Studio's syllable gaps (font units, keyed by syllable text): pulli forms get it as extra width, the rest become kerning.
 */
export function collectExportGlyphs(sources: GlyphSource[], metrics: Metrics, spaceWidth: number, spacing: Record<string, number> = {}): CollectResult {
  const glyphs: ExportGlyph[] = [notdefGlyph(metrics), { name: "space", unicode: 0x20, advance: Math.round(spaceWidth), contours: [] }];
  const usedCp = new Set([0x20]);
  const usedNames = new Set([".notdef", "space"]);
  const uniqueName = (base: string) => {
    let name = base;
    for (let k = 1; usedNames.has(name); k++) name = `${base}.${k}`;
    usedNames.add(name);
    return name;
  };
  const skippedDuplicates: number[] = [];
  const pulliParams = new Map<number, GlyphParams>();
  for (const s of sources) {
    if (!s.traced?.length) continue;
    if (usedCp.has(s.unicode)) { skippedDuplicates.push(s.unicode); continue; }
    usedCp.add(s.unicode);
    const lig = ligatureById(s.unicode);
    const laid = layoutGlyph(s.traced, s.params, lig ? false : s.isMark);
    const g: ExportGlyph = lig
      ? { name: uniqueName(s.name), advance: laid.advance, contours: laid.contours, components: lig.seq, ligatureKind: lig.kind }
      : { name: uniqueName(s.name), unicode: s.unicode, advance: laid.advance, contours: laid.contours };
    if (s.unicode === PULLI) pulliParams.set(PULLI, s.params);
    glyphs.push(g);
  }
  const drawnCount = glyphs.length - 2;

  const encoded = new Map(glyphs.filter((g) => g.unicode !== undefined).map((g) => [g.unicode!, g]));
  const hasSequence = new Set(glyphs.filter((g) => g.components).map((g) => g.components!.join(",")));

  // A syllable can only be reached if every character in it maps to a glyph; signs drawn only inside syllables get a blank.
  for (const g of glyphs.slice()) {
    if (!g.components || g.components.some((c) => !encoded.has(c) && !isTamilSign(c))) continue;
    for (const c of g.components) {
      if (encoded.has(c)) continue;
      const blank: ExportGlyph = { name: uniqueName(`uni${c.toString(16).toUpperCase().padStart(4, "0")}`), unicode: c, advance: 0, contours: [] };
      encoded.set(c, blank);
      glyphs.push(blank);
    }
  }

  const pulli = encoded.get(PULLI);
  const pb = pulli?.contours.length ? bboxOf(pulli.contours) : null;
  if (pulli && pb) {
    const nudgeX = pulliParams.get(PULLI)?.offsetX ?? 0;
    for (const cons of [...encoded.values()]) {
      if (!isTamilConsonant(cons.unicode!) || !cons.contours.length || hasSequence.has(`${cons.unicode},${PULLI}`)) continue;
      const extra = Math.round(spacing[String.fromCodePoint(cons.unicode!, PULLI)] ?? 0);
      glyphs.push({
        name: uniqueName(`${cons.name}_uni0BCD`),
        advance: Math.max(0, cons.advance + extra),
        contours: pulliComposite(cons.contours, pulli.contours, nudgeX),
        components: [cons.unicode!, PULLI],
        ligatureKind: "syllable",
      });
    }
  }
  const drawn = new Set(sources.filter((s) => s.traced?.length && !skippedDuplicates.includes(s.unicode)).map((s) => s.unicode));
  return { glyphs, skippedDuplicates, drawnCount, kerning: syllableKerning(listSyllables(drawn), spacing) };
}

/** GPOS pair adjustments for the syllable gaps whose glyphs are both in the font. */
export function buildKerningGpos(glyphs: ExportGlyph[], kerning: CpPair[]): Uint8Array | null {
  const gid = new Map<number, number>();
  glyphs.forEach((g, i) => g.unicode !== undefined && gid.set(g.unicode, i));
  const pairs = kerning.flatMap((k) => {
    const left = gid.get(k.left), right = gid.get(k.right);
    return left === undefined || right === undefined ? [] : [{ left, right, value: k.value }];
  });
  return buildGpos(pairs);
}

/** GSUB with Tamil script tags and ligature rules, or null when the font has no Tamil at all. */
export function buildTamilGsub(glyphs: ExportGlyph[]): Uint8Array | null {
  if (!glyphs.some((g) => (g.unicode !== undefined && isTamilCp(g.unicode)) || g.components)) return null;
  const gid = new Map<number, number>();
  glyphs.forEach((g, i) => g.unicode !== undefined && gid.set(g.unicode, i));
  const conjuncts: LigatureRule[] = [];
  const syllables: LigatureRule[] = [];
  glyphs.forEach((g, i) => {
    if (!g.components) return;
    const ids = g.components.map((c) => gid.get(c));
    if (ids.some((id) => id === undefined)) return;
    (g.ligatureKind === "conjunct" ? conjuncts : syllables).push({ components: ids as number[], glyph: i });
  });
  return buildGsub({ conjuncts, syllables });
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
export function finalizeSfnt(buf: ArrayBuffer, n: ResolvedNames, gsub: Uint8Array | null = null, gpos: Uint8Array | null = null): ArrayBuffer {
  const sfnt = readSfnt(buf);
  sfnt.tables.delete("ltag");
  if (gsub) sfnt.tables.set("GSUB", gsub);
  if (gpos) sfnt.tables.set("GPOS", gpos);
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

export function buildOtf(glyphs: ExportGlyph[], meta: FontMeta, metrics: Metrics, kerning: CpPair[] = []): ArrayBuffer {
  const raw = buildFont(glyphs, meta, metrics).toArrayBuffer();
  return finalizeSfnt(raw, resolveNames(meta), buildTamilGsub(glyphs), buildKerningGpos(glyphs, kerning));
}

export function buildTtf(glyphs: ExportGlyph[], meta: FontMeta, metrics: Metrics, kerning: CpPair[] = []): ArrayBuffer {
  return otfToTtf(buildOtf(glyphs, meta, metrics, kerning), glyphs.map((g) => g.contours));
}

/** PostScript name (name ID 6): the custom one if valid, else ASCII-only "Family-Style". */
export function postScriptName(meta: FontMeta) {
  return resolveNames(meta).postScriptName;
}

export function fileBaseName(meta: FontMeta) {
  return postScriptName(meta);
}
