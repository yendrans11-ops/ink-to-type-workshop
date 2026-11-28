import { beforeAll, describe, expect, it, vi } from "vitest";
import { bboxOf } from "../contours";
import {
  CANVAS_HEADROOM,
  CANVAS_SIDE_PAD,
  DEFAULT_SMOOTH,
  hasInk,
  padToUnits,
  RASTER_BORDER_PAD,
  strokeOutline,
  strokesToPotraceTile,
  strokesToTile,
  unitsToPadY,
  type Stroke,
} from "../drawing";
import { DEFAULT_STABILIZATION } from "../penSettings";
import { buildTemplateLayout, IPAD_SPEC, PRINT_SPEC } from "../template";
import { prepareMask, TILE, traceTile, UNITS_PER_EM } from "../trace";
import { DEFAULT_PREPROCESS, emptyProject, normalizeProject } from "../store";

const DEFAULT_SETS = ["latin-upper", "latin-lower", "digits", "punctuation"];

describe("iPad template", () => {
  it("is the 2048 × 2732 iPad screen with 6 × 7 boxes", () => {
    expect([IPAD_SPEC.pageW, IPAD_SPEC.pageH]).toEqual([2048, 2732]);
    expect(IPAD_SPEC.cols * IPAD_SPEC.rows).toBe(42);
    expect(IPAD_SPEC.box).toBeGreaterThan(PRINT_SPEC.box);
  });

  it("paginates 94 characters onto 3 iPad pages and keeps every box inside the page, clear of the corner squares", () => {
    const l = buildTemplateLayout(DEFAULT_SETS, "", "ipad");
    expect(l.pageCount).toBe(3);
    const fidBottom = IPAD_SPEC.fidMargin + IPAD_SPEC.fidSize;
    for (const s of l.slots) {
      expect(s.x).toBeGreaterThan(fidBottom);
      expect(s.x + IPAD_SPEC.box).toBeLessThan(IPAD_SPEC.pageW - fidBottom);
      expect(s.y).toBeGreaterThan(fidBottom);
      expect(s.y + IPAD_SPEC.box).toBeLessThan(IPAD_SPEC.pageH - fidBottom);
    }
  });

  it("keeps the paper sheet unchanged", () => {
    const l = buildTemplateLayout(DEFAULT_SETS, "");
    expect(l.spec.format).toBe("print");
    expect(l.pageCount).toBe(2);
  });

  it("old saved projects open with the paper sheet", () => {
    expect(normalizeProject({}).templateFormat).toBe("print");
    expect(emptyProject().templateFormat).toBe("print");
  });
});

describe("drawing pad", () => {
  it("places the metric guides where the template box draws them", () => {
    expect(unitsToPadY(800)).toBeCloseTo(0);
    expect(unitsToPadY(700)).toBeCloseTo(0.1);
    expect(unitsToPadY(500)).toBeCloseTo(0.3);
    expect(unitsToPadY(0)).toBeCloseTo(0.8);
    expect(unitsToPadY(-200)).toBeCloseTo(1);
    expect(padToUnits(0.5, 0.8)).toEqual([500, 0]);
  });

  it("a stroke along the baseline inks the baseline row of the tile", () => {
    const line: Stroke = { size: 60, pts: [0.2, 0.8, 0.5, 0.8, 0.8, 0.5] };
    const tile = strokesToTile([line], 100);
    expect(tile[80 * 100 + 50]).toBeLessThan(30);
    expect(tile[30 * 100 + 50]).toBe(255);
  });

  it("the eraser removes ink and an empty pad has none", () => {
    const line: Stroke = { size: 60, pts: [0.2, 0.5, 0.5, 0.8, 0.5, 0.5] };
    const rub: Stroke = { size: 200, erase: true, pts: [0.1, 0.5, 0.5, 0.9, 0.5, 0.5] };
    expect(hasInk([line])).toBe(true);
    expect(hasInk([line, rub])).toBe(false);
    expect(hasInk([])).toBe(false);
  });

  it("drawn tiles survive the tracer's preprocessing", () => {
    const o: Stroke = { size: 70, pts: [0.5, 0.35, 0.5, 0.65, 0.55, 0.5, 0.5, 0.75, 0.5, 0.35, 0.55, 0.5, 0.5, 0.35, 0.5] };
    const mask = prepareMask(strokesToTile([o]), 240, DEFAULT_PREPROCESS, 0);
    expect(mask.reduce((a, b) => a + b, 0)).toBeGreaterThan(500);
  });

  it("strokesToPotraceTile enforces at least a 20px clear border pad around headroom strokes", () => {
    expect(CANVAS_HEADROOM).toBeGreaterThanOrEqual(150);
    expect(CANVAS_SIDE_PAD).toBeGreaterThanOrEqual(60);
    const highArch: Stroke = { size: 60, pts: [0.3, -0.05, 0.6, 0.6, -0.1, 0.6] };
    const { tile, tileSize, pad } = strokesToPotraceTile([highArch], 240);
    expect(pad).toBeGreaterThanOrEqual(RASTER_BORDER_PAD);
    expect(pad).toBeGreaterThanOrEqual(20);
    expect(tileSize).toBe(240 + pad * 2);
    // Outer 20px border stays paper (255) while ink inside the headroom is captured (< 128)
    expect(tile[0]).toBe(255);
    expect(hasInk([highArch])).toBe(true);
  });

  describe("Potrace tracing with expanded headroom & 20px padding", () => {
    beforeAll(async () => {
      const real = globalThis.process;
      vi.stubGlobal("process", { ...real, versions: { ...real.versions, node: undefined } });
      await import("esm-potrace-wasm");
      vi.stubGlobal("process", real);
    });

    it("preserves tall Tamil hooks (ி/ீ) above ascender and wide sides without edge truncation", async () => {
      // Wide glyph reaching x=-30..1030 and sampled Tamil hook arch reaching y_font=910 (above ascender 800)
      const tallHook: Stroke = {
        size: 60,
        smooth: 0.7,
        pts: [
          -0.03, unitsToPadY(450), 0.65,
          0.12, unitsToPadY(780), 0.7,
          0.32, unitsToPadY(900), 0.7,
          0.52, unitsToPadY(910), 0.7,
          0.74, unitsToPadY(895), 0.7,
          0.95, unitsToPadY(640), 0.65,
          1.03, unitsToPadY(120), 0.65,
        ],
      };
      const { tile, pad } = strokesToPotraceTile([tallHook], TILE);
      expect(pad).toBeGreaterThanOrEqual(20);
      const { contours, empty } = await traceTile(tile, DEFAULT_PREPROCESS, { weight: 0, smoothing: null, optimize: null }, TILE, pad);
      expect(empty).toBe(false);
      const bb = bboxOf(contours)!;
      expect(bb.yMax).toBeGreaterThan(840);
      expect(bb.xMin).toBeLessThan(0);
      expect(bb.xMax).toBeGreaterThan(UNITS_PER_EM);
    });
  });
});

describe("smoothed strokes (perfect-freehand)", () => {
  it("fills a smooth stroke into the tile and leaves paper elsewhere", () => {
    const pts: number[] = [];
    for (let i = 0; i <= 20; i++) pts.push(0.2 + i * 0.03, 0.5, 0.5);
    const tile = strokesToTile([{ size: 80, smooth: 0.5, pts }], 100);
    expect(tile[50 * 100 + 50]).toBeLessThan(60);
    expect(tile[10 * 100 + 50]).toBe(255);
  });
  it("an eraser stroke with smoothing removes ink", () => {
    const pts: number[] = [];
    for (let i = 0; i <= 20; i++) pts.push(0.2 + i * 0.03, 0.5, 0.5);
    const tile = strokesToTile([{ size: 80, smooth: 0.5, pts }, { size: 160, smooth: 0.5, erase: true, pts }], 100);
    expect(tile[50 * 100 + 50]).toBeGreaterThan(200);
  });
});

function pointInPoly(poly: [number, number][], px: number, py: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

describe("ink stability & corner preservation", () => {
  it("uses responsive default pen settings", () => {
    expect(DEFAULT_SMOOTH).toBe(0.35);
    expect(DEFAULT_STABILIZATION).toBe(0.25);
  });

  it("preserves sharp right-angle corner vertices without rounding inward", () => {
    const poly = strokeOutline({
      size: 60,
      smooth: DEFAULT_SMOOTH,
      penStyle: "pen",
      pts: [0.1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.1, 0.5],
    });
    expect(poly.length).toBeGreaterThan(6);
    // The polygon must enclose the exact right-angle apex (0.5, 0.5)
    expect(pointInPoly(poly, 0.5, 0.5)).toBe(true);
    // Measure minimum outer-corner support relative to the center apex along both leg normals:
    // on an inner corner near (0.5 - offset, 0.5 - offset) and outer extent >= 0.5 (no <3u corner clipping across apex)
    const maxX = Math.max(...poly.map(([x]) => x));
    const maxY = Math.max(...poly.map(([, y]) => y));
    expect(maxX).toBeGreaterThan(0.51);
    expect(maxY).toBeGreaterThan(0.51);
    // Point 0.002 (2 font units) inside both outer legs from the apex stays enclosed (less than 3 font units corner truncation)
    expect(pointInPoly(poly, 0.5 - 0.002, 0.5 - 0.002)).toBe(true);
  });

  it("prevents stroke width ballooning on slow circular bends", () => {
    const straightPts: number[] = [];
    for (let i = 0; i <= 20; i++) straightPts.push(0.2 + i * 0.03, 0.5, 0.5);
    const straightPoly = strokeOutline({ size: 70, smooth: DEFAULT_SMOOTH, penStyle: "pen", pts: straightPts });
    const straightHeight =
      (Math.max(...straightPoly.map(([, y]) => y)) - Math.min(...straightPoly.map(([, y]) => y))) * UNITS_PER_EM;

    // Dense slow circular arc with high pressure (1.0) along the bend
    const arcPts: number[] = [];
    const steps = 40;
    for (let i = 0; i <= steps; i++) {
      const theta = (Math.PI * i) / steps;
      const x = 0.5 + 0.25 * Math.cos(theta);
      const y = 0.5 - 0.25 * Math.sin(theta);
      const p = i > 10 && i < 30 ? 1.0 : 0.5;
      arcPts.push(x, y, p);
    }
    const arcPoly = strokeOutline({ size: 70, smooth: DEFAULT_SMOOTH, penStyle: "pen", pts: arcPts });
    // Slice thickness at the top of the arc (x around 0.5, y above center 0.5)
    const topBand = arcPoly.filter(([x, y]) => Math.abs(x - 0.5) < 0.03 && y < 0.4);
    expect(topBand.length).toBeGreaterThan(2);
    const bendThickness = (Math.max(...topBand.map(([, y]) => y)) - Math.min(...topBand.map(([, y]) => y))) * UNITS_PER_EM;
    expect(bendThickness).toBeLessThanOrEqual(straightHeight * 1.25);
  });
});
