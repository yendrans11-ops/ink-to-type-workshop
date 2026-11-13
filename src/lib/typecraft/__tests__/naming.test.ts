import { describe, expect, it } from "vitest";
import { parse } from "opentype.js";
import { buildOtf, buildTtf, collectExportGlyphs, DEFAULT_META, type FontMeta, type Metrics } from "../font";
import { resolveNames, standardStyleName } from "../naming";
import { DEFAULT_PARAMS } from "../layout";

const meta: FontMeta = { ...DEFAULT_META, familyName: "My Hand", designer: "Ada" };
const value = (m: FontMeta, id: number) => resolveNames(m).records.find((r) => r.nameID === id)?.value;

describe("OpenType naming", () => {
  it("keeps Regular, Bold, Italic and Bold Italic in one legacy family", () => {
    const n = resolveNames({ ...meta, styleName: "Bold Italic", weightClass: 700, italic: true });
    expect([n.legacyFamily, n.legacySubfamily]).toEqual(["My Hand", "Bold Italic"]);
    expect(n.fsSelection).toBe(1 | 32);
    expect(n.macStyle).toBe(3);
    expect(value({ ...meta, styleName: "Bold Italic", weightClass: 700, italic: true }, 16)).toBeUndefined();
  });

  it("moves other weights into the legacy family name and writes typographic names 16/17", () => {
    const m = { ...meta, styleName: "Light Italic", weightClass: 300, italic: true };
    const n = resolveNames(m);
    expect([n.legacyFamily, n.legacySubfamily]).toEqual(["My Hand Light", "Italic"]);
    expect([value(m, 16), value(m, 17)]).toEqual(["My Hand", "Light Italic"]);
    expect(n.fsSelection).toBe(1);
  });

  it("marks plain Regular with the REGULAR fsSelection bit and weight 400", () => {
    const n = resolveNames(meta);
    expect(n.fsSelection).toBe(64);
    expect(n.weightClass).toBe(400);
  });

  it("names styles from weight and italic", () => {
    expect(standardStyleName(400, true)).toBe("Italic");
    expect(standardStyleName(600, false)).toBe("SemiBold");
    expect(standardStyleName(900, true)).toBe("Black Italic");
  });

  it("builds version, unique ID and PostScript name", () => {
    const n = resolveNames({ ...meta, version: "2.1", vendorId: "TCFT" });
    expect(n.versionString).toBe("Version 2.100");
    expect(n.postScriptName).toBe("MyHand-Regular");
    expect(n.uniqueId).toBe("2.100;TCFT;MyHand-Regular");
    expect(resolveNames({ ...meta, postScriptName: "MyHandPro-Rg" }).postScriptName).toBe("MyHandPro-Rg");
  });

  it("maps embedding choices to OS/2 fsType bits", () => {
    expect(resolveNames({ ...meta, embedding: "installable" }).fsType).toBe(0);
    expect(resolveNames({ ...meta, embedding: "restricted" }).fsType).toBe(2);
    expect(resolveNames({ ...meta, embedding: "preview" }).fsType).toBe(4);
    expect(resolveNames({ ...meta, embedding: "editable" }).fsType).toBe(8);
  });

  it("omits empty optional names instead of writing blanks", () => {
    const ids = resolveNames(meta).records.map((r) => r.nameID);
    expect(ids).not.toContain(0);
    expect(ids).not.toContain(7);
    expect(ids).toEqual(expect.arrayContaining([1, 2, 3, 4, 5, 6, 9]));
  });
});

describe("exported binaries carry the font details", () => {
  const metrics: Metrics = { ascender: 800, capHeight: 700, xHeight: 500, descender: -200 };
  const sq = { start: [0, 0] as [number, number], segs: [{ t: "L" as const, p: [400, 0] as [number, number] }, { t: "L" as const, p: [400, 700] as [number, number] }, { t: "L" as const, p: [0, 700] as [number, number] }, { t: "L" as const, p: [0, 0] as [number, number] }] };
  const { glyphs } = collectExportGlyphs([{ name: "A", unicode: 0x41, isMark: false, traced: [sq], params: DEFAULT_PARAMS }], metrics, 250);
  const m: FontMeta = { ...meta, familyName: "என் கை", postScriptName: "EnKai-SemiBoldItalic", styleName: "SemiBold Italic", weightClass: 600, italic: true, copyright: "© 2026 Ada", vendorId: "TCFT", embedding: "editable", version: "1.5" };

  for (const [kind, build] of [["OTF", buildOtf], ["TTF", buildTtf]] as const) {
    it(`${kind}: name table, OS/2 and head match the details`, () => {
      const f = parse(build(glyphs, m, metrics));
      const win = f.names.windows!;
      expect(win.fontFamily?.en).toBe("என் கை SemiBold");
      expect(win.fontSubfamily?.en).toBe("Italic");
      expect(win.preferredFamily?.en).toBe("என் கை");
      expect(win.preferredSubfamily?.en).toBe("SemiBold Italic");
      expect(win.postScriptName?.en).toBe("EnKai-SemiBoldItalic");
      expect(win.copyright?.en).toBe("© 2026 Ada");
      expect(f.tables.os2.usWeightClass).toBe(600);
      expect(f.tables.os2.fsType).toBe(8);
      expect(f.tables.os2.achVendID).toBe("TCFT");
      expect(f.tables.os2.fsSelection & 0b1100001).toBe(1);
      expect(f.tables.head.macStyle).toBe(2);
      expect(f.tables.head.fontRevision).toBe(1.5);
    });
  }
});
