import { describe, expect, it } from "vitest";
import { parse } from "opentype.js";
import { canvasToFont, compileCanvasFont, layoutCanvasGlyph } from "../fontCompiler";

describe("fontCompiler", () => {
  it("puts canvas y=400 on the baseline of a 1000-unit em", () => {
    expect(canvasToFont([0, 400])).toEqual([0, 0]);
    expect(canvasToFont([100, 0])).toEqual([200, 800]);
    expect(canvasToFont([0, 500])).toEqual([0, -200]);
  });

  it("advanceWidth is left bearing + ink width + right bearing", () => {
    const g = layoutCanvasGlyph({ unicode: 0x49, polygons: [[[200, 50], [250, 50], [250, 400], [200, 400]]] });
    // 50 px wide = 100 units, plus the default 40 on each side
    expect(g.advanceWidth).toBe(180);
    expect(g.bbox).toEqual({ xMin: 40, xMax: 140, yMin: 0, yMax: 700 });
  });

  it("compiles a font opentype.js can read back with the drawn letter mapped", () => {
    const buf = compileCanvasFont([{ unicode: 0x49, lsb: 10, rsb: 10, polygons: [[[200, 50], [250, 50], [250, 400], [200, 400]]] }]);
    const f = parse(buf);
    expect(f.unitsPerEm).toBe(1000);
    const g = f.charToGlyph("I");
    expect(g.advanceWidth).toBe(120);
    const bb = g.getBoundingBox();
    expect([bb.x1, bb.y1, bb.x2, bb.y2]).toEqual([10, 0, 110, 700]);
  });
});
