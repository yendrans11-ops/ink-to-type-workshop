import { beforeAll, describe, expect, it, vi } from "vitest";
import { bboxOf } from "../contours";
import {
  CANVAS_HEADROOM,
  CANVAS_SIDE_PAD,
  hasInk,
  padToUnits,
  RASTER_BORDER_PAD,
  strokesToPotraceTile,
  strokesToTile,
  unitsToPadY,
  type Stroke,
} from "../drawing";
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
