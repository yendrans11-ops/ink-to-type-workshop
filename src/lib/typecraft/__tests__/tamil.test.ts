import { describe, expect, it } from "vitest";
import { parse } from "opentype.js";
import { buildOtf, buildTtf, collectExportGlyphs, DEFAULT_META, PULLI_GAP, type GlyphSource, type Metrics } from "../font";
import { formatCodepoint, glyphNameFor, parseCodepointInput } from "../charsets";
import { bboxOf, type Contour } from "../contours";
import { DEFAULT_PARAMS } from "../layout";
import { buildTemplateLayout } from "../template";
import { ligatureByText, syllablesInText } from "../tamil";

const metrics: Metrics = { ascender: 800, capHeight: 700, xHeight: 500, descender: -200 };
const box = (x0: number, y0: number, x1: number, y1: number): Contour => ({
  start: [x0, y0],
  segs: [{ t: "L", p: [x1, y0] }, { t: "L", p: [x1, y1] }, { t: "L", p: [x0, y1] }, { t: "L", p: [x0, y0] }],
});
const src = (unicode: number, traced: Contour[], isMark = false): GlyphSource => ({ name: glyphNameFor(unicode), unicode, isMark, traced, params: DEFAULT_PARAMS });
const KU = ligatureByText("கு")!.id;
const KSSA = ligatureByText("க்ஷ")!.id;

type Lig = { ligGlyph: number; components: number[] };
type Gsub = {
  scripts: { tag: string; script: { defaultLangSys: { featureIndexes: number[] } } }[];
  features: { tag: string; feature: { lookupListIndexes: number[] } }[];
  lookups: { lookupType: number; subtables: { coverage: { glyphs: number[] }; ligatureSets: Lig[][] }[] }[];
};
/** All ligature rules reachable from a script + feature, as [first, ...rest] → ligature glyph. */
function rules(gsub: Gsub, script: string, feature: string) {
  const s = gsub.scripts.find((x) => x.tag === script)!;
  const out: { seq: number[]; glyph: number }[] = [];
  for (const fi of s.script.defaultLangSys.featureIndexes) {
    const f = gsub.features[fi]!;
    if (f.tag !== feature) continue;
    for (const li of f.feature.lookupListIndexes)
      for (const st of gsub.lookups[li]!.subtables)
        st.coverage.glyphs.forEach((first, i) => st.ligatureSets[i]!.forEach((l) => out.push({ seq: [first, ...l.components], glyph: l.ligGlyph })));
  }
  return out;
}

describe("Tamil syllables as characters", () => {
  it("keeps stable ids and readable codes for syllables", () => {
    expect(KU).toBe(0xf0000);
    expect(ligatureByText("ஸ்ரீ")!.id).toBe(0xf0027);
    expect(formatCodepoint(KU)).toBe("U+0B95 U+0BC1");
    expect(glyphNameFor(KU)).toBe("uni0B950BC1");
  });

  it("accepts a syllable or its code sequence when reassigning a glyph", () => {
    expect(parseCodepointInput("கு")).toBe(KU);
    expect(parseCodepointInput("U+0B95 U+0BC1")).toBe(KU);
    expect(parseCodepointInput("கா")).toBeNull(); // not a drawn-syllable shape
  });

  it("offers every consonant with ு and ூ plus டி டீ க்ஷ ஸ்ரீ on the template", () => {
    const labels = buildTemplateLayout(["tamil-syllables"], "").slots.map((s) => s.label);
    expect(labels).toHaveLength(40);
    expect(labels).toEqual(expect.arrayContaining(["கு", "கூ", "னு", "னூ", "டி", "டீ", "க்ஷ", "ஸ்ரீ"]));
  });

  it("lists which syllables in typed text are hand-drawn", () => {
    const uses = syllablesInText("குரு ஸ்ரீ கா", new Set([KU]));
    expect(uses.map((u) => [u.text, u.drawn])).toEqual([["கு", true], ["ரு", false], ["ஸ்ரீ", false]]);
  });
});

describe("Tamil shaping in exported fonts", () => {
  const sources = [
    src(0x0b95, [box(0, 0, 400, 500)]), // க
    src(0x0bb7, [box(0, 0, 450, 500)]), // ஷ
    src(0x0bc6, [box(0, 0, 200, 500)]), // ெ
    src(0x0bcd, [box(0, 0, 80, 80)], true), // ்
    src(KU, [box(0, -150, 500, 500)]), // கு drawn as one shape; ு itself never drawn
    src(KSSA, [box(0, 0, 700, 500)]),
  ];
  const { glyphs, drawnCount } = collectExportGlyphs(sources, metrics, 250);
  const gid = (name: string) => glyphs.findIndex((g) => g.name === name);

  it("exports a drawn syllable unencoded and adds a blank ு so கு can still be reached", () => {
    expect(drawnCount).toBe(6);
    const ku = glyphs[gid("uni0B950BC1")]!;
    expect(ku.unicode).toBeUndefined();
    expect(ku.components).toEqual([0x0b95, 0x0bc1]);
    const u = glyphs.find((g) => g.unicode === 0x0bc1)!;
    expect([u.advance, u.contours.length]).toEqual([0, 0]);
  });

  it("builds க் with the pulli centred above the consonant", () => {
    const k = glyphs[gid("uni0B95_uni0BCD")]!;
    expect(k.components).toEqual([0x0b95, 0x0bcd]);
    const dot = bboxOf(k.contours.slice(1))!;
    const cons = bboxOf(k.contours.slice(0, 1))!;
    expect((dot.xMin + dot.xMax) / 2).toBeCloseTo((cons.xMin + cons.xMax) / 2);
    expect(dot.yMin).toBeGreaterThanOrEqual(cons.yMax + PULLI_GAP);
    expect(k.advance).toBe(glyphs.find((g) => g.unicode === 0x0b95)!.advance);
  });

  for (const [kind, build] of [["OTF", buildOtf], ["TTF", buildTtf]] as const) {
    it(`${kind}: declares Tamil scripts and substitutes கு, க் and க்ஷ`, () => {
      const f = parse(build(glyphs, DEFAULT_META, metrics));
      const gsub = f.tables["gsub"] as unknown as Gsub;
      expect(gsub.scripts.map((s) => s.tag)).toEqual(["DFLT", "taml", "tml2"]);
      const cmap = (cp: number) => f.charToGlyphIndex(String.fromCodePoint(cp));
      for (const script of ["tml2", "taml"]) {
        expect(rules(gsub, script, "psts")).toEqual(
          expect.arrayContaining([
            { seq: [cmap(0x0b95), cmap(0x0bc1)], glyph: gid("uni0B950BC1") },
            { seq: [cmap(0x0b95), cmap(0x0bcd)], glyph: gid("uni0B95_uni0BCD") },
          ]),
        );
        expect(rules(gsub, script, "akhn")).toEqual([{ seq: [cmap(0x0b95), cmap(0x0bcd), cmap(0x0bb7)], glyph: gid("uni0B950BCD0BB7") }]);
      }
      expect(rules(gsub, "DFLT", "liga")).toHaveLength(4); // கு, க், ஷ், க்ஷ
    });
  }

  it("leaves Latin-only fonts without a GSUB table", () => {
    const latin = collectExportGlyphs([src(0x41, [box(0, 0, 400, 700)])], metrics, 250).glyphs;
    expect(parse(buildOtf(latin, DEFAULT_META, metrics)).tables["gsub"]).toBeUndefined();
  });
});
