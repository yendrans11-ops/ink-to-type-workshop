// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parse } from "opentype.js";
import * as hb from "harfbuzzjs";
import { createGlyphAlternates } from "../caltGenerator";
import { buildOtf, buildTtf, collectExportGlyphs, DEFAULT_META, type GlyphSource, type Metrics } from "../font";
import { compileCanvasFont } from "../fontCompiler";
import { DEFAULT_PARAMS } from "../layout";
import type { GlyphRecord } from "../store";
import type { Contour } from "../contours";
import type { Stroke } from "../drawing";

const metrics: Metrics = { ascender: 800, capHeight: 700, xHeight: 500, descender: -200 };
const box = (x0: number, y0: number, x1: number, y1: number): Contour => ({
  start: [x0, y0],
  segs: [
    { t: "L", p: [x1, y0] },
    { t: "L", p: [x1, y1] },
    { t: "L", p: [x0, y1] },
    { t: "L", p: [x0, y0] },
  ],
});

const shapeText = (fontBytes: ArrayBuffer, text: string, features?: hb.Feature[]) => {
  const font = new hb.Font(new hb.Face(new hb.Blob(fontBytes)));
  const buffer = new hb.Buffer();
  buffer.addText(text);
  buffer.guessSegmentProperties();
  hb.shape(font, buffer, features);
  return buffer.getGlyphInfos().map((g) => g.codepoint);
};

describe("calt micro-variant generator", () => {
  it("creates 2 distinct unencoded alternates while transforming drawn strokes and contours without mutation", () => {
    const stroke: Stroke = {
      size: 60,
      smooth: 0.7,
      penStyle: "pen",
      pts: [0.3, 0.4, 0.6, 0.5, 0.4, 0.7, 0.5, 0.7, 0.6],
    };
    const base: GlyphRecord = {
      id: "o",
      name: "o",
      unicode: 0x6f,
      templateCp: 0x6f,
      isMark: false,
      source: null,
      traced: [box(100, 0, 400, 500)],
      empty: false,
      params: { ...DEFAULT_PARAMS },
      strokes: [stroke],
    };
    const snapPts = [...stroke.pts];
    const alts = createGlyphAlternates(base, 2);

    expect(alts).toHaveLength(2);
    expect(alts.map((a) => a.name)).toEqual(["o.alt1", "o.alt2"]);
    expect(alts.every((a) => a.altOf === 0x6f)).toBe(true);
    // Original stroke wasn't mutated
    expect(base.strokes![0]!.pts).toEqual(snapPts);
    // Alt 1 has slant shear & +1% vertical height; Alt 2 has baseline nudge & horizontal tweak
    expect(alts[0]!.strokes![0]!.pts).not.toEqual(snapPts);
    expect(alts[1]!.strokes![0]!.pts).not.toEqual(snapPts);
    expect(alts[0]!.traced![0]!.segs[1]!.p[1]).toBeCloseTo(505, 1);
    expect(alts[1]!.traced![0]!.start[1]).not.toBe(0);
  });
});

describe("OpenType calt GSUB table and shaping", () => {
  const sources: GlyphSource[] = [
    { name: "o", unicode: 0x6f, isMark: false, traced: [box(80, 0, 420, 500)], params: DEFAULT_PARAMS },
    { name: "l", unicode: 0x6c, isMark: false, traced: [box(80, 0, 240, 700)], params: DEFAULT_PARAMS },
    { name: "k", unicode: 0x6b, isMark: false, traced: [box(80, 0, 380, 700)], params: DEFAULT_PARAMS },
    { name: "e", unicode: 0x65, isMark: false, traced: [box(80, 0, 390, 500)], params: DEFAULT_PARAMS },
    { name: "t", unicode: 0x74, isMark: false, traced: [box(80, 0, 320, 620)], params: DEFAULT_PARAMS },
    { name: "r", unicode: 0x72, isMark: false, traced: [box(80, 0, 300, 500)], params: DEFAULT_PARAMS },
    { name: "uni0B95", unicode: 0x0b95, isMark: false, traced: [box(80, 0, 420, 500)], params: DEFAULT_PARAMS },
  ];

  const { glyphs } = collectExportGlyphs(sources, metrics, 250, {}, { calt: true });
  const gidOf = (name: string) => glyphs.findIndex((g) => g.name === name);

  it("keeps .alt1 and .alt2 unencoded while exporting valid LookupType 6 calt across DFLT, latn, taml, tml2", () => {
    const otf = buildOtf(glyphs, DEFAULT_META, metrics);
    const f = parse(otf);
    const gsub = f.tables["gsub"] as unknown as {
      scripts: { tag: string }[];
      features: { tag: string; feature: { lookupListIndexes: number[] } }[];
      lookups: { lookupType: number }[];
    };
    expect(gsub.scripts.map((s) => s.tag)).toEqual(["DFLT", "latn", "taml", "tml2"]);
    const caltFeat = gsub.features.find((feat) => feat.tag === "calt");
    expect(caltFeat).toBeDefined();
    const caltLookup = gsub.lookups[caltFeat!.feature.lookupListIndexes[0]!]!;
    expect([5, 6]).toContain(caltLookup.lookupType);
    // Alternates must not collide with Unicode mappings in cmap
    expect(f.glyphs.get(gidOf("o.alt1")).unicodes).toEqual([]);
    expect(f.glyphs.get(gidOf("o.alt2")).unicodes).toEqual([]);
  });

  for (const [label, build] of [["OTF", buildOtf], ["TTF", buildTtf]] as const) {
    it(`${label}: shapes "ooo" into [o, o.alt1, o.alt2] and rotates repeated letters in words`, () => {
      const bytes = build(glyphs, DEFAULT_META, metrics);
      expect(shapeText(bytes, "ooo")).toEqual([gidOf("o"), gidOf("o.alt1"), gidOf("o.alt2")]);
      expect(shapeText(bytes, "oooo")).toEqual([gidOf("o"), gidOf("o.alt1"), gidOf("o.alt2"), gidOf("o")]);
      expect(shapeText(bytes, "look")).toEqual([gidOf("l"), gidOf("o"), gidOf("o.alt1"), gidOf("k")]);
      expect(shapeText(bytes, "letter")).toEqual([
        gidOf("l"),
        gidOf("e"),
        gidOf("t"),
        gidOf("t.alt1"),
        gidOf("e"),
        gidOf("r"),
      ]);
      expect(shapeText(bytes, "ககக")).toEqual([
        gidOf("uni0B95"),
        gidOf("uni0B95.alt1"),
        gidOf("uni0B95.alt2"),
      ]);
      // Toggling calt off falls back to identical base glyphs
      expect(shapeText(bytes, "ooo", [new hb.Feature("calt", 0)])).toEqual([gidOf("o"), gidOf("o"), gidOf("o")]);
    });
  }

  it("includes calt GSUB in instant fontCompiler sandbox builds", () => {
    const buf = compileCanvasFont([
      {
        unicode: 0x6f,
        name: "o",
        polygons: [
          [
            [100, 150],
            [250, 150],
            [250, 400],
            [100, 400],
          ],
        ],
      },
    ]);
    const f = parse(buf);
    const ids = shapeText(buf, "ooo");
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(f.glyphs.get(ids[1]!).name).toBe("o.alt1");
    expect(f.glyphs.get(ids[2]!).name).toBe("o.alt2");
  });
});
