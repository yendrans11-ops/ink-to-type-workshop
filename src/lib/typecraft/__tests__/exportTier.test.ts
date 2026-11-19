import { describe, expect, it } from "vitest";
import { emptyProject, type GlyphRecord, type ProjectData } from "../store";
import { isFreeCp, splitForExport } from "../exportTier";
import { DEFAULT_PARAMS } from "../layout";

const glyph = (cp: number): GlyphRecord => ({
  id: `g-${cp.toString(16)}`, name: `g${cp}`, unicode: cp, templateCp: cp, isMark: false, source: null,
  traced: [[[0, 0], [100, 0], [100, 100]]] as unknown as GlyphRecord["traced"], empty: false, params: { ...DEFAULT_PARAMS },
});
const projectWith = (text: string): ProjectData => {
  const gs = [...text].map((c) => glyph(c.codePointAt(0)!));
  return { ...emptyProject(), glyphs: Object.fromEntries(gs.map((g) => [g.id, g])), order: gs.map((g) => g.id) };
};

describe("free export = A–M and a–m", () => {
  it("includes A, M, a and m", () => {
    for (const c of "AMam") expect(isFreeCp(c.codePointAt(0)!)).toBe(true);
  });
  it("excludes N, n, Z, digits and punctuation", () => {
    for (const c of "NnZz09!?") expect(isFreeCp(c.codePointAt(0)!)).toBe(false);
  });
  it("a free download keeps only the free letters and lists the rest as locked", () => {
    const s = splitForExport(projectWith("ABNnm7!"), false);
    expect(s.included.map((g) => String.fromCodePoint(g.unicode)).join("")).toBe("ABm");
    expect(s.locked.map((g) => String.fromCodePoint(g.unicode)).join("")).toBe("Nn7!");
    expect(s.project.order).toHaveLength(3);
  });
  it("the upgrade exports every drawn character", () => {
    const s = splitForExport(projectWith("ABNnm7!"), true);
    expect(s.included).toHaveLength(7);
    expect(s.locked).toHaveLength(0);
  });
});
