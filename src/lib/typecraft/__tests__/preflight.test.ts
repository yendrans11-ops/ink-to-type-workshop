import { describe, expect, it } from "vitest";
import { runPreflight, type PreflightGlyph } from "../preflight";
import type { FontMeta, Metrics } from "../font";
import { DEFAULT_META, postScriptName } from "../font";

const metrics: Metrics = { ascender: 800, capHeight: 700, xHeight: 500, descender: -200 };
const meta: FontMeta = { ...DEFAULT_META, familyName: "My Hand", styleName: "Regular", designer: "Sathiyendran" };
const drawn = (id: string, unicode: number): PreflightGlyph => ({ id, unicode, traced: [{}] });
const ids = (r: ReturnType<typeof runPreflight>) => r.issues.map((i) => i.id);

describe("pre-export check", () => {
  it("passes a complete, uniquely mapped font with valid details", () => {
    const r = runPreflight({ glyphs: [drawn("a", 0x41), drawn("b", 0x42)], expected: [0x41, 0x42], meta, metrics });
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it("warns about chosen characters that have no drawn glyph, including blank cells", () => {
    const r = runPreflight({
      glyphs: [drawn("a", 0x41), { id: "b", unicode: 0x42, traced: [] }],
      expected: [0x41, 0x42, 0x43],
      meta,
      metrics,
    });
    const missing = r.issues.find((i) => i.id === "missing");
    expect(missing?.severity).toBe("warning");
    expect(missing?.codepoints).toEqual([0x42, 0x43]);
    expect(r.ok).toBe(true);
  });

  it("blocks export when two drawn glyphs share one Unicode codepoint", () => {
    const r = runPreflight({ glyphs: [drawn("a", 0x41), drawn("a2", 0x41)], expected: [0x41], meta, metrics });
    const dup = r.errors.find((i) => i.id === "duplicate-65");
    expect(dup?.glyphIds).toEqual(["a", "a2"]);
    expect(r.ok).toBe(false);
  });

  it("blocks export when nothing has been drawn", () => {
    const r = runPreflight({ glyphs: [{ id: "a", unicode: 0x41, traced: null }], expected: [0x41], meta, metrics });
    expect(r.errors.map((i) => i.id)).toContain("no-glyphs");
    expect(ids(r)).toContain("untraced");
  });

  it("blocks export with an empty font name or a non-numeric version", () => {
    const r = runPreflight({ glyphs: [drawn("a", 0x41)], expected: [], meta: { ...meta, familyName: "  ", version: "v1 beta" }, metrics });
    expect(r.errors.map((i) => i.id).sort()).toEqual(["family-empty", "version-format"]);
  });

  it("accepts versions like 1, 2.1 and 1.000 but rejects 1.0001", () => {
    for (const v of ["1", "2.1", "1.000"]) {
      expect(ids(runPreflight({ glyphs: [drawn("a", 0x41)], expected: [], meta: { ...meta, version: v }, metrics }))).not.toContain("version-format");
    }
    expect(ids(runPreflight({ glyphs: [drawn("a", 0x41)], expected: [], meta: { ...meta, version: "1.0001" }, metrics }))).toContain("version-format");
  });

  it("warns (not blocks) for a font name over 31 characters and an empty author", () => {
    const r = runPreflight({ glyphs: [drawn("a", 0x41)], expected: [], meta: { ...meta, familyName: "A".repeat(32), designer: "" }, metrics });
    expect(r.warnings.map((i) => i.id).sort()).toEqual(["designer-empty", "family-long"]);
    expect(r.ok).toBe(true);
  });

  it("blocks export when a name field contains a line break", () => {
    const r = runPreflight({ glyphs: [drawn("a", 0x41)], expected: [], meta: { ...meta, designer: "Sathi\nyendran" }, metrics });
    expect(r.errors.map((i) => i.id)).toEqual(["control-designer"]);
  });

  it("blocks export when guide lines are out of order", () => {
    const r = runPreflight({ glyphs: [drawn("a", 0x41)], expected: [], meta, metrics: { ...metrics, xHeight: 750 } });
    expect(r.errors.map((i) => i.id)).toEqual(["metrics-order"]);
  });

  it("keeps the internal font name ASCII-only for Tamil font names", () => {
    expect(postScriptName({ ...meta, familyName: "என் கையெழுத்து" })).toBe("TypeCraftHand-Regular");
    expect(postScriptName({ ...meta, familyName: "My Hand (v2)" })).toBe("MyHandv2-Regular");
  });

  it("blocks export with an invalid PostScript name or vendor ID", () => {
    const r = runPreflight({ glyphs: [drawn("a", 0x41)], expected: [], meta: { ...meta, postScriptName: "My Hand", vendorId: "TOOLONG" }, metrics });
    expect(r.errors.map((i) => i.id).sort()).toEqual(["postscript-invalid", "vendor-invalid"]);
  });

  it("warns when the style name and the Italic switch disagree", () => {
    const r = runPreflight({ glyphs: [drawn("a", 0x41)], expected: [], meta: { ...meta, styleName: "Italic", italic: false }, metrics });
    expect(r.warnings.map((i) => i.id)).toContain("italic-mismatch");
    expect(r.ok).toBe(true);
  });

  it("warns when a Bold style isn't weight 700", () => {
    const r = runPreflight({ glyphs: [drawn("a", 0x41)], expected: [], meta: { ...meta, styleName: "Bold", weightClass: 400 }, metrics });
    expect(r.warnings.map((i) => i.id)).toContain("weight-mismatch");
  });

  it("warns when a website field isn't an http(s) address", () => {
    const r = runPreflight({ glyphs: [drawn("a", 0x41)], expected: [], meta: { ...meta, designerURL: "my site" }, metrics });
    expect(r.warnings.map((i) => i.id)).toEqual(["url-designerURL"]);
  });
});
