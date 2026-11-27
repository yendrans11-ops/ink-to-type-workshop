import JSZip from "jszip";
import { parse } from "opentype.js";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { bboxOf, signedArea } from "../contours";
import type { Stroke } from "../drawing";
import { compileFamilyPackage } from "../download";
import { DEFAULT_PARAMS } from "../layout";
import { emptyProject, newGlyphRecord, type ProjectData } from "../store";
import { buildTemplateLayout } from "../template";
import { TILE, traceTile } from "../trace";
import { generateWeightVariant, metaForWeight, strokesToWeightTile } from "../weights";

const sampleStrokes: Stroke[] = [
  {
    kind: "stroke",
    size: 70,
    smooth: 0.7,
    penStyle: "pen",
    pts: [
      0.3, 0.25, 0.5,
      0.3, 0.45, 0.5,
      0.3, 0.65, 0.5,
      0.3, 0.78, 0.5,
    ],
  },
];

describe("pressure-aware multi-weight generator", () => {
  beforeAll(async () => {
    const real = globalThis.process;
    vi.stubGlobal("process", { ...real, versions: { ...real.versions, node: undefined } });
    await import("esm-potrace-wasm");
    vi.stubGlobal("process", real);
  });

  it("scales stroke nib sizes and point pressures without mutating originals", () => {
    const light = generateWeightVariant(sampleStrokes, "light");
    const regular = generateWeightVariant(sampleStrokes, "regular");
    const bold = generateWeightVariant(sampleStrokes, "bold");

    expect(light[0]!.size).toBeCloseTo(70 * 0.65, 2);
    expect(light[0]!.pts[2]).toBeCloseTo(0.5 * 0.8, 4);
    expect(regular[0]!.size).toBe(70);
    expect(regular[0]!.pts[2]).toBe(0.5);
    expect(bold[0]!.size).toBeCloseTo(70 * 1.45, 2);
    expect(bold[0]!.pts[2]).toBeCloseTo(0.5 * 1.25, 4);
    expect(sampleStrokes[0]!.size).toBe(70);
  });

  it("produces 3 distinct raster ink areas and Potrace outline areas (Light < Regular < Bold)", async () => {
    const pre = { threshold: 150, denoise: 0, smoothing: 1, optimize: 0.2 };
    const inkCount = (tile: Uint8Array) => tile.reduce((acc, v) => acc + (v < 128 ? 1 : 0), 0);
    const contourArea = (cs: Awaited<ReturnType<typeof traceTile>>["contours"]) =>
      cs.reduce((acc, c) => acc + Math.abs(signedArea(c)), 0);
    const boxArea = (cs: Awaited<ReturnType<typeof traceTile>>["contours"]) => {
      const bb = bboxOf(cs);
      return bb ? (bb.xMax - bb.xMin) * (bb.yMax - bb.yMin) : 0;
    };

    const lightTile = strokesToWeightTile(sampleStrokes, "light", TILE);
    const regularTile = strokesToWeightTile(sampleStrokes, "regular", TILE);
    const boldTile = strokesToWeightTile(sampleStrokes, "bold", TILE);

    expect(inkCount(lightTile)).toBeLessThan(inkCount(regularTile));
    expect(inkCount(regularTile)).toBeLessThan(inkCount(boldTile));

    const [lightTraced, regularTraced, boldTraced] = await Promise.all([
      traceTile(lightTile, pre, { weight: 0, smoothing: null, optimize: null }),
      traceTile(regularTile, pre, { weight: 0, smoothing: null, optimize: null }),
      traceTile(boldTile, pre, { weight: 0, smoothing: null, optimize: null }),
    ]);

    expect(contourArea(lightTraced.contours)).toBeLessThan(contourArea(regularTraced.contours));
    expect(contourArea(regularTraced.contours)).toBeLessThan(contourArea(boldTraced.contours));
    expect(boxArea(lightTraced.contours)).toBeLessThan(boxArea(regularTraced.contours));
    expect(boxArea(regularTraced.contours)).toBeLessThan(boxArea(boldTraced.contours));
  });

  it("compiles a 3-weight ZIP family with SFNT usWeightClass 300/400/700 and shared family name", async () => {
    const slot = buildTemplateLayout(["latin-upper"], "").slots[0]!;
    const regTile = strokesToWeightTile(sampleStrokes, "regular", TILE);
    const { contours } = await traceTile(regTile, emptyProject().preprocess, { weight: 0, smoothing: null, optimize: null });
    const glyph = {
      ...newGlyphRecord(slot, regTile),
      strokes: sampleStrokes,
      traced: contours,
      params: { ...DEFAULT_PARAMS },
    };
    const base = emptyProject();
    const project: ProjectData = {
      ...base,
      charsetIds: ["latin-upper"],
      meta: { ...base.meta, familyName: "Kaveri Hand", designer: "Yendran" },
      order: [slot.id],
      glyphs: { [slot.id]: glyph },
    };

    const pkg = await compileFamilyPackage(project, "otf", true, true);
    expect(pkg.fileName).toBe("KaveriHand-Family-OTF.zip");
    expect(pkg.files.map((f) => f.fileName)).toEqual([
      "KaveriHand-Light.otf",
      "KaveriHand-Regular.otf",
      "KaveriHand-Bold.otf",
    ]);

    const zip = await JSZip.loadAsync(pkg.bytes);
    const expected = [
      { fileName: "KaveriHand-Light.otf", weightClass: 300, ps: "KaveriHand-Light", style: "Light" },
      { fileName: "KaveriHand-Regular.otf", weightClass: 400, ps: "KaveriHand-Regular", style: "Regular" },
      { fileName: "KaveriHand-Bold.otf", weightClass: 700, ps: "KaveriHand-Bold", style: "Bold" },
    ] as const;

    for (const item of expected) {
      const entry = zip.file(item.fileName);
      expect(entry).not.toBeNull();
      const buf = await entry!.async("arraybuffer");
      const font = parse(buf);
      const win = (font.names as unknown as { windows: Record<string, { en?: string } | undefined> }).windows;
      const os2 = font.tables["os2"] as unknown as { usWeightClass: number };
      const sharedFamily = win["preferredFamily"]?.en ?? win["fontFamily"]?.en;
      const subfamily = win["preferredSubfamily"]?.en ?? win["fontSubfamily"]?.en;

      expect(os2.usWeightClass).toBe(item.weightClass);
      expect(sharedFamily).toBe("Kaveri Hand");
      expect(subfamily).toBe(item.style);
      expect(win["postScriptName"]?.en).toBe(item.ps);
    }

    // Verify custom PostScript name override strips previous weight suffix cleanly
    const customMeta = { ...project.meta, postScriptName: "KaveriCustom-Regular" };
    expect(metaForWeight(customMeta, "light").postScriptName).toBe("KaveriCustom-Light");
    expect(metaForWeight(customMeta, "bold").postScriptName).toBe("KaveriCustom-Bold");
  });
});
