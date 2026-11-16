import { describe, expect, it } from "vitest";
import { hasInk, padToUnits, strokesToTile, unitsToPadY, type Stroke } from "../drawing";
import { buildTemplateLayout, IPAD_SPEC, PRINT_SPEC } from "../template";
import { prepareMask } from "../trace";
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
});
