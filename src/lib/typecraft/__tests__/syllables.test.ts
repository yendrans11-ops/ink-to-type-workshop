import { describe, expect, it } from "vitest";
import { parse } from "opentype.js";
import { buildOtf, buildTtf, collectExportGlyphs, DEFAULT_META, type GlyphSource, type Metrics } from "../font";
import { glyphNameFor } from "../charsets";
import type { Contour } from "../contours";
import { DEFAULT_PARAMS } from "../layout";
import { clampSpacing, listSyllables, syllableKerning } from "../syllables";
import { ligatureByText } from "../tamil";

const KA = 0x0b95, E = 0x0bc6, AA = 0x0bbe, U = 0x0bc1, PULLI = 0x0bcd;
const KU = ligatureByText("கு")!.id;
const metrics: Metrics = { ascender: 800, capHeight: 700, xHeight: 500, descender: -200 };
const box = (w: number): Contour => ({ start: [0, 0], segs: [{ t: "L", p: [w, 0] }, { t: "L", p: [w, 500] }, { t: "L", p: [0, 500] }, { t: "L", p: [0, 0] }] });
const src = (unicode: number, isMark = false): GlyphSource => ({ name: glyphNameFor(unicode), unicode, isMark, traced: [box(300)], params: DEFAULT_PARAMS });

describe("syllable spacing list", () => {
  const list = listSyllables(new Set([KA, E, AA, U, PULLI, KU]));
  const find = (key: string) => list.find((s) => s.key === key);

  it("gives கு its own width and puts கெ / கா gaps between the right glyphs", () => {
    expect(find("கு")).toMatchObject({ kind: "joined", ligatureId: KU });
    expect(find("கெ")).toMatchObject({ kind: "prebase", pair: [E, KA] }); // ெ is drawn first, so the gap follows it
    expect(find("கா")).toMatchObject({ kind: "postbase", pair: [KA, AA] });
    expect(find("க்")).toMatchObject({ kind: "pulli" });
  });

  it("does not offer a separate க + ு gap once கு is drawn", () => {
    expect(list.filter((s) => s.consonant === KA && s.sign === U)).toHaveLength(1);
    expect(listSyllables(new Set([KA, U])).find((s) => s.key === "கு")).toMatchObject({ kind: "postbase", pair: [KA, U] });
  });

  it("turns only non-zero gaps into pair adjustments, limited to ±400", () => {
    expect(syllableKerning(list, { "கெ": 60, "கா": 0, "க்": 30 })).toEqual([{ left: E, right: KA, value: 60 }]);
    expect([clampSpacing(900), clampSpacing(-900)]).toEqual([400, -400]);
  });
});

type PairSet = { secondGlyph: number; value1?: { xAdvance?: number } }[];
type Gpos = { scripts: { tag: string }[]; features: { tag: string }[]; lookups: { lookupType: number; subtables: { coverage: { glyphs: number[] }; pairSets: PairSet[] }[] }[] };

describe("syllable spacing in exported fonts", () => {
  const sources = [src(KA), src(E), src(AA), src(PULLI, true)];
  const spacing = { "கெ": 60, "கா": -30, "க்": 50 };
  const { glyphs, kerning } = collectExportGlyphs(sources, metrics, 250, spacing);

  it("widens க் by its extra width", () => {
    const ka = glyphs.find((g) => g.unicode === KA)!;
    const kaPulli = glyphs.find((g) => g.components?.join() === `${KA},${PULLI}`)!;
    expect(kaPulli.advance).toBe(ka.advance + 50);
  });

  for (const [kind, build] of [["OTF", buildOtf], ["TTF", buildTtf]] as const) {
    it(`${kind}: writes the கெ and கா gaps as kerning for Tamil`, () => {
      const f = parse(build(glyphs, DEFAULT_META, metrics, kerning));
      const gpos = f.tables["gpos"] as unknown as Gpos;
      expect(gpos.scripts.map((s) => s.tag)).toEqual(["DFLT", "taml", "tml2"]);
      expect(gpos.features.map((x) => x.tag)).toEqual(["kern"]);
      const gid = (cp: number) => f.charToGlyphIndex(String.fromCodePoint(cp));
      const st = gpos.lookups[0]!.subtables[0]!;
      const pairs = st.coverage.glyphs.flatMap((left, i) => st.pairSets[i]!.map((p) => [left, p.secondGlyph, p.value1?.xAdvance]));
      expect(pairs).toEqual(expect.arrayContaining([[gid(E), gid(KA), 60], [gid(KA), gid(AA), -30]]));
      expect(pairs).toHaveLength(2);
    });
  }

  it("leaves fonts without adjusted gaps free of kerning", () => {
    const plain = collectExportGlyphs(sources, metrics, 250);
    expect(parse(buildOtf(plain.glyphs, DEFAULT_META, metrics, plain.kerning)).tables["gpos"]).toBeUndefined();
  });
});
