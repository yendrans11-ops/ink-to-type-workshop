import { beforeAll, describe, expect, it, vi } from "vitest";
import { parse } from "opentype.js";
import { layoutGlyph, DEFAULT_PARAMS } from "../layout";
import { buildOtf, buildTtf, collectExportGlyphs, type Metrics } from "../font";
import { applyHomography, detectFiducials, solveHomography } from "../vision";
import { bboxOf, parseSvgPath, signedArea, type Contour } from "../contours";
import { parseCodepointInput } from "../charsets";
import { buildTemplateLayout, CELLS_PER_PAGE, FIDUCIAL_CENTERS, FID_SIZE, PAGE_H, PAGE_W } from "../template";
import { traceTile, TILE } from "../trace";

const metrics: Metrics = { ascender: 800, capHeight: 700, xHeight: 500, descender: -200 };
const square = (x0: number, y0: number, x1: number, y1: number): Contour => ({
  start: [x0, y0],
  segs: [ { t: "L", p: [x1, y0] }, { t: "L", p: [x1, y1] }, { t: "L", p: [x0, y1] }, { t: "L", p: [x0, y0] } ],
});

describe("glyph spacing", () => {
  it("advance width = LSB + outline width + RSB, outline starts at LSB", () => {
    const g = layoutGlyph([square(300, 0, 600, 700)], { ...DEFAULT_PARAMS, lsb: 50, rsb: 70 }, false);
    expect(g.advance).toBe(50 + 300 + 70);
    expect(g.bbox!.xMin).toBeCloseTo(50);
  });
  it("X offset moves the outline without changing the advance width", () => {
    const g = layoutGlyph([square(0, 0, 300, 700)], { ...DEFAULT_PARAMS, lsb: 50, rsb: 50, offsetX: 20 }, false);
    expect(g.advance).toBe(400);
    expect(g.bbox!.xMin).toBeCloseTo(70);
  });
  it("scaling keeps a glyph that sits on the baseline on the baseline", () => {
    const g = layoutGlyph([square(0, 0, 300, 700)], { ...DEFAULT_PARAMS, scale: 0.5 }, false);
    expect(g.bbox!.yMin).toBeCloseTo(0);
    expect(g.bbox!.yMax).toBeCloseTo(350);
  });
  it("combining marks get zero advance and hang left of the origin", () => {
    const g = layoutGlyph([square(0, 600, 200, 800)], { ...DEFAULT_PARAMS, rsb: 30 }, true);
    expect(g.advance).toBe(0);
    expect(g.bbox!.xMax).toBeCloseTo(-30);
  });
});

describe("font export", () => {
  const sources = [
    { name: "A", unicode: 0x41, isMark: false, traced: [square(0, 0, 500, 700), { ...square(100, 100, 400, 600) }], params: { ...DEFAULT_PARAMS, lsb: 40, rsb: 60 } },
    { name: "uni0B85", unicode: 0x0b85, isMark: false, traced: [square(0, -100, 600, 500)], params: DEFAULT_PARAMS },
    { name: "B", unicode: 0x41, isMark: false, traced: [square(0, 0, 10, 10)], params: DEFAULT_PARAMS },
    { name: "C", unicode: 0x43, isMark: false, traced: [], params: DEFAULT_PARAMS },
  ];
  const meta = { familyName: "Test Hand", styleName: "Regular", designer: "Ada", version: "1.2", description: "", license: "" };
  const { glyphs, skippedDuplicates } = collectExportGlyphs(sources, metrics, 260);

  it("skips undrawn glyphs and duplicate codepoints", () => {
    expect(glyphs.map((g) => g.name)).toEqual([".notdef", "space", "A", "uni0B85"]);
    expect(skippedDuplicates).toEqual([0x41]);
  });

  it("writes a CFF OpenType font with metadata, cmap and advances", () => {
    const font = parse(buildOtf(glyphs, meta, metrics));
    expect(font.outlinesFormat).toBe("cff");
    expect(font.getEnglishName("fontFamily")).toBe("Test Hand");
    expect(font.getEnglishName("designer")).toBe("Ada");
    expect(font.getEnglishName("version")).toBe("Version 1.2");
    expect(font.charToGlyph("A").advanceWidth).toBe(40 + 500 + 60);
    expect(font.charToGlyph(" ").advanceWidth).toBe(260);
    expect(font.charToGlyph("அ").name).toBe("uni0B85");
  });

  it("writes a TrueType font whose outlines match the source", () => {
    const font = parse(buildTtf(glyphs, meta, metrics));
    expect(font.outlinesFormat).toBe("truetype");
    expect(font.numGlyphs).toBe(4);
    const a = font.charToGlyph("A");
    expect(a.advanceWidth).toBe(600);
    const bb = a.getPath(0, 0, 1000).getBoundingBox();
    expect(Math.round(bb.x1)).toBe(40);
    expect(Math.round(bb.x2)).toBe(540);
    expect(Math.round(-bb.y1)).toBe(700);
    expect(a.path.commands.filter((c) => c.type === "M")).toHaveLength(2);
  });
});

describe("unicode reassignment input", () => {
  it.each([["A", 0x41], ["அ", 0x0b85], ["U+0B95", 0x0b95], ["0x41", 0x41], ["◌ா", 0x0bbe], ["AB", null], ["", null]])(
    "%s → %s",
    (input, expected) => expect(parseCodepointInput(input)).toBe(expected),
  );
});

describe("template + perspective", () => {
  it("paginates at the per-page cell limit", () => {
    const l = buildTemplateLayout(["latin-upper", "latin-lower", "digits", "punctuation"], "");
    expect(l.slots).toHaveLength(94);
    expect(l.pageCount).toBe(Math.ceil(94 / CELLS_PER_PAGE));
  });

  it("homography maps the four reference points exactly", () => {
    const dst = [ { x: 30, y: 40 }, { x: 900, y: 20 }, { x: 60, y: 1200 }, { x: 950, y: 1150 } ];
    const H = solveHomography(FIDUCIAL_CENTERS, dst);
    FIDUCIAL_CENTERS.forEach((p, i) => {
      const q = applyHomography(H, p.x, p.y);
      expect(q.x).toBeCloseTo(dst[i].x, 6);
      expect(q.y).toBeCloseTo(dst[i].y, 6);
    });
  });

  it("finds corner squares in a synthetic scan", () => {
    const w = 850, h = 1100, data = new Uint8Array(w * h).fill(250);
    const sc = w / PAGE_W, fs = FID_SIZE * sc;
    for (const c of FIDUCIAL_CENTERS)
      for (let y = Math.round(c.y * sc - fs / 2); y < c.y * sc + fs / 2; y++)
        for (let x = Math.round(c.x * sc - fs / 2); x < c.x * sc + fs / 2; x++) data[y * w + x] = 10;
    // a handwriting-like stroke that must not be picked
    for (let y = 300; y < 340; y++) for (let x = 200; x < 206; x++) data[y * w + x] = 10;
    const r = detectFiducials({ data, width: w, height: h });
    expect(r.found).toEqual([true, true, true, true]);
    r.corners.forEach((p, i) => {
      expect(Math.abs(p.x - FIDUCIAL_CENTERS[i].x * sc)).toBeLessThan(2);
      expect(Math.abs(p.y - FIDUCIAL_CENTERS[i].y * sc)).toBeLessThan(2);
    });
    expect(PAGE_H).toBeGreaterThan(0);
  });
});

describe("svg path parsing", () => {
  it("handles relative moves after closepath", () => {
    const cs = parseSvgPath("M10 10 l10 0 0 10 -10 0z m5 2 l1 0 0 1z");
    expect(cs).toHaveLength(2);
    expect(cs[1].start).toEqual([15, 12]);
    expect(signedArea(cs[0])).toBeGreaterThan(0);
  });
});

describe("potrace vectorization", () => {
  beforeAll(async () => {
    // The wasm bundle takes a Node-only code path when it sees process.versions.node; load it as the browser does.
    const real = globalThis.process;
    vi.stubGlobal("process", { ...real, versions: { ...real.versions, node: undefined } });
    await import("esm-potrace-wasm");
    vi.stubGlobal("process", real);
  });
  it("traces an ink ring into an outer contour and a counter in font units", async () => {
    const src = new Uint8Array(TILE * TILE).fill(255);
    for (let y = 40; y < 192; y++)
      for (let x = 60; x < 180; x++) {
        const hole = x >= 90 && x < 150 && y >= 70 && y < 162;
        if (!hole) src[y * TILE + x] = 0;
      }
    const { contours, empty } = await traceTile(src, { threshold: 128, denoise: 0, smoothing: 1, optimize: 0.2 }, { weight: 0, smoothing: null, optimize: null });
    expect(empty).toBe(false);
    expect(contours).toHaveLength(2);
    const bb = bboxOf(contours)!;
    // Ink bottom at tile row 192 = baseline (0.8 × 240) → y ≈ 0; top at row 40 → (192-40)/240*1000 ≈ 633
    expect(bb.yMin).toBeCloseTo(0, -1);
    expect(bb.yMax).toBeCloseTo(633, -1);
    expect(bb.xMin).toBeCloseTo(250, -1);
    expect(signedArea(contours[0]) * signedArea(contours[1])).toBeLessThan(0);
  });
});

describe("rotation", () => {
  it("rotating 90° swaps a bar's width and height while staying spaced by its bearings", () => {
    const g = layoutGlyph([square(0, 0, 400, 100)], { ...DEFAULT_PARAMS, rotation: 90, lsb: 10, rsb: 10 }, false);
    expect(g.bbox!.xMax - g.bbox!.xMin).toBeCloseTo(100);
    expect(g.bbox!.yMax - g.bbox!.yMin).toBeCloseTo(400);
    expect(g.advance).toBe(120);
  });
});
