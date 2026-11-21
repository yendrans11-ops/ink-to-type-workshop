import { describe, it, expect } from "vitest";
import { normalizePenSettings } from "../penSettings";
import { useFullExport } from "../useFullExport";
import { compactStroke, strokeOutline, strokesToTile, type Stroke } from "../drawing";

describe("drawing finish settings", () => {
  it("keeps the previous 115-unit nib and brush style when restoring settings", () => {
    expect(normalizePenSettings({ brush: 115, smooth: 0.8, penStyle: "brush" })).toEqual({ brush: 115, smooth: 0.8, penStyle: "brush" });
  });
  it("full exports are free during build testing, without claiming a purchase", () => {
    expect(useFullExport()).toEqual({ full: true, checkoutReady: false });
  });
  const pts = Array.from({ length: 50 }, (_, i) => [0.2 + i * 0.012, 0.5, 0.2 + i * 0.012]).flat();
  const pen: Stroke = { size: 100, smooth: 0.7, pts };
  it("brush pen produces a different pressure-tapered outline from the round pen", () => {
    const brush = compactStroke({ ...pen, penStyle: "brush" });
    expect(brush.penStyle).toBe("brush");
    expect(strokeOutline(brush)).not.toEqual(strokeOutline(pen));
    expect(strokesToTile([brush]).some(v => v < 128)).toBe(true);
  });
  it("calligraphy uses a fixed diagonal broad nib rather than a round pen", () => {
    const calligraphy: Stroke = { ...pen, penStyle: "calligraphy" };
    expect(strokeOutline(calligraphy)).not.toEqual(strokeOutline(pen));
    const dot = strokeOutline({ size: 100, smooth: 0.7, pts: [0.5, 0.5, 0.5], penStyle: "calligraphy" });
    const along = dot.map(([x,y]) => x+y), across = dot.map(([x,y]) => y-x);
    expect((Math.max(...along)-Math.min(...along))/(Math.max(...across)-Math.min(...across))).toBeGreaterThan(3);
  });
});