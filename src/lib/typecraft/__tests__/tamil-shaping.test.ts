// Real Indic shaping, rather than opentype.js's Latin-oriented stringToGlyphs.
// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as hb from "harfbuzzjs";
import { buildOtf, buildTtf, collectExportGlyphs, DEFAULT_META, type GlyphSource } from "../font";
import { DEFAULT_PARAMS } from "../layout";
import { glyphNameFor } from "../charsets";
import { ligatureByText } from "../tamil";
import type { Contour } from "../contours";

const box: Contour = { start: [0, 0], segs: [{ t: "L", p: [300, 0] }, { t: "L", p: [300, 500] }, { t: "L", p: [0, 500] }, { t: "L", p: [0, 0] }] };
const source = (unicode: number): GlyphSource => ({ unicode, name: glyphNameFor(unicode), isMark: false, traced: [box], params: DEFAULT_PARAMS });
const metrics = { ascender: 800, capHeight: 700, xHeight: 500, descender: -200 };
const joined = ["கி", "கீ", "கு", "கூ"].map((s) => {
  const lig = ligatureByText(s);
  if (!lig) throw new Error(`Missing ${s} mapping`);
  return lig.id;
});
const { glyphs } = collectExportGlyphs([0x0b95, 0x0bbe, 0x0bbf, 0x0bc0, 0x0bc1, 0x0bc2, 0x0bc6, 0x0bc7, 0x0bc8, 0x0bd7, ...joined].map(source), metrics, 250);
const cases: [string, string[]][] = [
  ["க", ["uni0B95"]], ["கா", ["uni0B95", "uni0BBE"]],
  ["கி", ["uni0B950BBF"]], ["கீ", ["uni0B950BC0"]],
  ["கு", ["uni0B950BC1"]], ["கூ", ["uni0B950BC2"]],
  ["கெ", ["uni0BC6", "uni0B95"]], ["கே", ["uni0BC7", "uni0B95"]],
  ["கை", ["uni0BC8", "uni0B95"]], ["கொ", ["uni0BC6", "uni0B95", "uni0BBE"]],
  ["கோ", ["uni0BC7", "uni0B95", "uni0BBE"]], ["கௌ", ["uni0BC6", "uni0B95", "uni0BD7"]],
];
for (const [format, build] of [["OTF", buildOtf], ["TTF", buildTtf]] as const) {
  describe(`${format} Tamil க vowel series`, () => {
    const font = new hb.Font(new hb.Face(new hb.Blob(build(glyphs, DEFAULT_META, metrics))));
    for (const [text, expected] of cases) {
      it(`shapes ${text} into the correct joined or visual-order glyphs`, () => {
        const buffer = new hb.Buffer();
        buffer.addText(text);
        buffer.guessSegmentProperties();
        hb.shape(font, buffer);
        const ids = buffer.getGlyphInfos().map((g) => g.codepoint);
        expect(ids).not.toContain(0);
        expect(ids.map((id) => glyphs[id]?.name)).toEqual(expected);
        expect(buffer.getGlyphPositions().every((p) => p.xAdvance > 0)).toBe(true);
      });
    }
  });
}