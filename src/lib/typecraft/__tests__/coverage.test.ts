import { describe, it, expect } from "vitest";
import { summarizeCoverage } from "../coverage";
describe("summarizeCoverage", () => {
  it("counts only traced, non-empty glyphs as done", () => {
    const [s] = summarizeCoverage(["digits"], [{ unicode: 0x30, traced: true, empty: false }, { unicode: 0x31, traced: true, empty: true }]);
    expect(s?.done).toBe(1);
    expect(s?.missing.length).toBe(9);
  });
});
