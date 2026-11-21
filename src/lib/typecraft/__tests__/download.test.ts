import { describe, expect, it } from "vitest";
import { parse } from "opentype.js";
import { compileDownload } from "../download";
import { useFullExport } from "../useFullExport";
import { emptyProject, type GlyphRecord } from "../store";
import { DEFAULT_PARAMS } from "../layout";
const glyph = (unicode: number): GlyphRecord => ({ id: `${unicode}`, name: `uni${unicode.toString(16)}`, unicode, templateCp: unicode, isMark: false, source: null, empty: false, params: DEFAULT_PARAMS, traced: [{ start: [0, 0], segs: [{ t: "L", p: [200, 0] }, { t: "L", p: [200, 500] }, { t: "L", p: [0, 500] }] }] });
const glyphs = [glyph(65), glyph(78), glyph(0x0b95)];
const project = { ...emptyProject(), charsetIds: [], meta: { ...emptyProject().meta, designer: "Test" }, order: glyphs.map((g) => g.id), glyphs: Object.fromEntries(glyphs.map((g) => [g.id, g])) };
describe("shared download rules", () => {
  it("testing access downloads the full A, N and Tamil set without payment", () => {
    const f = parse(compileDownload(project, useFullExport().full, "otf").bytes);
    for (const ch of ["A", "N", "க"]) expect(f.charToGlyphIndex(ch)).toBeGreaterThan(0);
  });
  for (const kind of ["otf", "ttf"] as const) {
    it(`${kind} free downloads contain A, not N or Tamil`, () => {
      const f = parse(compileDownload(project, false, kind).bytes);
      expect(f.charToGlyphIndex("A")).toBeGreaterThan(0);
      expect(f.charToGlyphIndex("N")).toBe(0);
      expect(f.charToGlyphIndex("க")).toBe(0);
    });
    it(`${kind} full downloads include Tamil`, () => {
      expect(parse(compileDownload(project, true, kind).bytes).charToGlyphIndex("க")).toBeGreaterThan(0);
    });
  }
  it("invalid metadata blocks even an acknowledged download", () => {
    expect(() => compileDownload({ ...project, meta: { ...project.meta, familyName: "" } }, false, "otf", true)).toThrow("Font name is empty");
  });
  it("warnings require explicit acknowledgement", () => {
    const p = { ...project, meta: { ...project.meta, designer: "" } };
    expect(() => compileDownload(p, false, "otf")).toThrow("Confirm the font warnings");
    expect(compileDownload(p, false, "otf", true).bytes.byteLength).toBeGreaterThan(0);
  });
});