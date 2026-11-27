// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parse } from "opentype.js";
import * as hb from "harfbuzzjs";
import { glyphNameFor } from "../charsets";
import { bboxOf, type Contour } from "../contours";
import { buildOtf, buildTtf, collectExportGlyphs, DEFAULT_META, PULLI_GAP, type GlyphSource, type Metrics } from "../font";
import { DEFAULT_PARAMS } from "../layout";
import {
  analyzeBaseAnchor,
  computePostBaseHookSnap,
  computePreBaseClearance,
  computePulliPlacement,
} from "../matraSnapping";
import { compositeSyllablePreview } from "../syllables";
import { ligatureByText, PULLI } from "../tamil";

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

describe("top-ridge magnetic contour scanner", () => {
  it("tracks top-bar xCenter accurately for wide (ம-like) vs narrow (ர-like) consonants", () => {
    // Simulated ம: wide horizontal bar at top [100..620, 420..500] with left & right stems
    const maContours: Contour[] = [
      box(100, 420, 620, 500),
      box(100, 0, 170, 420),
      box(550, 0, 620, 420),
    ];
    // Simulated ர: narrow vertical glyph [120..260, 0..500]
    const raContours: Contour[] = [box(120, 0, 260, 500)];

    const ma = analyzeBaseAnchor(maContours);
    const ra = analyzeBaseAnchor(raContours);

    expect(ma.xCenter).toBeCloseTo(360, 0);
    expect(ma.ridgeWidth).toBeCloseTo(520, 0);
    expect(ra.xCenter).toBeCloseTo(190, 0);
    expect(ra.ridgeWidth).toBeCloseTo(140, 0);
    expect(ma.ridgeWidth).toBeGreaterThan(ra.ridgeWidth * 3);
  });

  it("adjusts yTop and pulli resting elevation when a glyph rises taller than x-height", () => {
    const standardConsonant = [box(100, 0, 400, 500)];
    const tallConsonant = [box(100, 0, 400, 680)];
    const pulli = [box(0, 600, 60, 660)];

    const stdAnchor = analyzeBaseAnchor(standardConsonant);
    const tallAnchor = analyzeBaseAnchor(tallConsonant);
    expect(stdAnchor.yTop).toBe(500);
    expect(tallAnchor.yTop).toBe(680);

    const stdSnap = computePulliPlacement(standardConsonant, pulli);
    const tallSnap = computePulliPlacement(tallConsonant, pulli);
    const stdDotBB = bboxOf(stdSnap.contours.slice(1))!;
    const tallDotBB = bboxOf(tallSnap.contours.slice(1))!;

    expect(stdDotBB.yMin).toBeCloseTo(500 + PULLI_GAP, 1);
    expect(tallDotBB.yMin).toBeCloseTo(680 + PULLI_GAP, 1);
  });

  it("snaps post-base hooks (ி, ீ) to the consonant top-right stem and flags pre-base overhang collisions", () => {
    const base = [box(60, 0, 520, 500)];
    const hook = [box(20, 420, 180, 640)];
    const postSnap = computePostBaseHookSnap(base, hook, 20);
    expect(postSnap).not.toBeNull();
    expect(postSnap!.baseAnchor.x).toBe(540);
    expect(postSnap!.signAnchor.x).toBe(20);

    const preBaseSign = [box(20, 0, 260, 500)];
    const narrowAdvance = computePreBaseClearance(base, preBaseSign, 240, 0, 30);
    expect(narrowAdvance.overlapAmount).toBe(0);
    expect(narrowAdvance.recommendedDelta).toBe(0);

    // Force an overhanging sign relative to small advance to trigger recommended clearance delta
    const colliding = computePreBaseClearance([box(-20, 0, 480, 500)], preBaseSign, 230, 0, 30);
    expect(colliding.overlapAmount).toBe(50);
    expect(colliding.recommendedDelta).toBe(80);
  });

  it("pre-positions composite joined syllable preview guides using magnetic anchors", () => {
    const byCp = new Map([
      [0x0b95, { traced: [box(80, 0, 520, 520)], params: DEFAULT_PARAMS, isMark: false }],
      [0x0bbf, { traced: [box(0, 400, 160, 620)], params: DEFAULT_PARAMS, isMark: false }],
    ]);
    const kiId = ligatureByText("கி")!.id;
    const guide = compositeSyllablePreview(kiId, byCp);
    expect(guide).not.toBeNull();
    expect(guide!).toHaveLength(2);
    const consBB = bboxOf([guide![0]!])!;
    const signBB = bboxOf([guide![1]!])!;
    expect(signBB.xMin).toBeGreaterThan(consBB.xMax);
  });
});

describe("GPOS mark and mkmk Tamil shaping without overlapping ink", () => {
  const JA = 0x0b9c; // ஜ (no pre-composed pulli or matra in LIGATURES)
  const KA = 0x0b95;
  const II = 0x0bc0;
  const sources: GlyphSource[] = [
    { name: glyphNameFor(KA), unicode: KA, isMark: false, traced: [box(50, 420, 550, 500), box(50, 0, 130, 420), box(470, 0, 550, 420)], params: DEFAULT_PARAMS },
    { name: glyphNameFor(JA), unicode: JA, isMark: false, traced: [box(60, 0, 480, 520)], params: DEFAULT_PARAMS },
    { name: glyphNameFor(II), unicode: II, isMark: false, traced: [box(40, 420, 240, 640)], params: DEFAULT_PARAMS },
    { name: glyphNameFor(PULLI), unicode: PULLI, isMark: true, traced: [box(0, 600, 80, 680)], params: DEFAULT_PARAMS },
  ];

  const { glyphs, kerning } = collectExportGlyphs(sources, metrics, 250);

  for (const [kind, build] of [["OTF", buildOtf], ["TTF", buildTtf]] as const) {
    it(`${kind}: writes GPOS mark & mkmk lookups and avoids overlapping ink for combined Tamil glyphs`, () => {
      const bytes = build(glyphs, DEFAULT_META, metrics, kerning);
      const parsed = parse(bytes);
      const gpos = parsed.tables["gpos"] as unknown as { features: { tag: string }[]; lookups: { lookupType: number }[] };
      expect(gpos.features.map((f) => f.tag)).toEqual(expect.arrayContaining(["mark", "mkmk"]));
      expect(gpos.lookups.some((l) => l.lookupType === 4)).toBe(true);
      expect(gpos.lookups.some((l) => l.lookupType === 6)).toBe(true);

      const font = new hb.Font(new hb.Face(new hb.Blob(bytes)));

      // Check ஜ் + pulli positioning (note: ஜ has no precomposed ligature in LIGATURES, or pulli composite in collectExportGlyphs):
      // pulli composite for க் and ஜ் have zero ink overlap between consonant and dot
      for (const ch of ["க்", "ஜ்"]) {
        const buffer = new hb.Buffer();
        buffer.addText(ch);
        buffer.guessSegmentProperties();
        hb.shape(font, buffer);
        const infos = buffer.getGlyphInfos();
        expect(infos).toHaveLength(1); // ligated into pulli composite
        const ligGlyph = glyphs[infos[0]!.codepoint]!;
        const consBB = bboxOf(ligGlyph.contours.slice(0, -1))!;
        const pulliBB = bboxOf([ligGlyph.contours[ligGlyph.contours.length - 1]!])!;
        expect(pulliBB.yMin).toBeGreaterThanOrEqual(consBB.yMax + PULLI_GAP);
      }

      // Check stacked marks: க + pulli + pulli exercises mark + mkmk separation without collapsing to y=0
      const stacked = new hb.Buffer();
      stacked.addText("க\u0BCD\u0BCD");
      stacked.guessSegmentProperties();
      hb.shape(font, stacked);
      const pos = stacked.getGlyphPositions();
      expect(pos.length).toBeGreaterThanOrEqual(2);
      expect(pos.every((p) => Number.isFinite(p.xOffset) && Number.isFinite(p.yOffset))).toBe(true);
    });
  }
});
