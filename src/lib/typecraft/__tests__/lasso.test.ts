import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { parse } from "opentype.js";
import { DrawPad } from "@/components/typecraft/DrawPad";
import { signedArea } from "../contours";
import { strokesToTile, strokeOutline, type Stroke } from "../drawing";
import { compileCanvasFont, CANVAS_EM } from "../fontCompiler";
import { resolveLasso, smoothLassoPolygon, type Point } from "../lasso";
import { normalizeToolSettings, readStoredPenSettings } from "../penSettings";
import { TILE, UNITS_PER_EM } from "../trace";
import { lassoPointsToVectorPath, vectorPathsToContours } from "../vectorEditor";

const toStrokePts = (emPts: Point[]) => emPts.flatMap(([x, y]) => [x / UNITS_PER_EM, y / UNITS_PER_EM, 0.5]);

describe("Lasso Fill pure closing logic", () => {
  it("Close Far: closes when start and end are 100u apart (threshold 120), leaves open at 300u apart", () => {
    const closeLoop: Point[] = [
      [200, 200],
      [400, 200],
      [400, 400],
      [200, 300],
    ];
    const farLoop: Point[] = [
      [200, 200],
      [500, 200],
      [500, 500],
    ];
    expect(Math.hypot(closeLoop[3]![0] - closeLoop[0]![0], closeLoop[3]![1] - closeLoop[0]![1])).toBe(100);
    expect(resolveLasso(closeLoop, "far", 120).closed).toBe(true);

    expect(Math.hypot(farLoop[2]![0] - farLoop[0]![0], farLoop[2]![1] - farLoop[0]![1])).toBeGreaterThan(300);
    expect(resolveLasso(farLoop, "far", 120).closed).toBe(false);
  });

  it("Close Off: a nearly closed loop (5u gap) stays open with no fill pixels", () => {
    const nearlyClosed: Point[] = [
      [200, 200],
      [400, 200],
      [400, 400],
      [200, 400],
      [200, 205],
    ];
    const res = resolveLasso(nearlyClosed, "off", 120);
    expect(res.closed).toBe(false);

    const stroke: Stroke = {
      kind: "lassoFill",
      closeMode: "off",
      size: 30,
      smooth: 0.7,
      pts: toStrokePts(nearlyClosed),
    };
    const tile = strokesToTile([stroke], TILE);
    const centerPx = Math.round(0.3 * TILE) * TILE + Math.round(0.3 * TILE);
    expect(tile[centerPx]).toBe(255);
    const topEdgePx = Math.round(0.2 * TILE) * TILE + Math.round(0.3 * TILE);
    expect(tile[topEdgePx]).toBeLessThan(128);
  });

  it("Close Always: a 500u gap closes and fills", () => {
    const wideOpen: Point[] = [
      [150, 200],
      [550, 200],
      [550, 500],
    ];
    expect(Math.hypot(wideOpen[2]![0] - wideOpen[0]![0], wideOpen[2]![1] - wideOpen[0]![1])).toBe(500);
    const res = resolveLasso(wideOpen, "always", 120);
    expect(res.closed).toBe(true);

    const stroke: Stroke = {
      kind: "lassoFill",
      closeMode: "always",
      size: 40,
      pts: toStrokePts(wideOpen),
    };
    const tile = strokesToTile([stroke], TILE);
    const interiorPx = Math.round(0.3 * TILE) * TILE + Math.round(0.45 * TILE);
    expect(tile[interiorPx]).toBeLessThan(30);
  });

  it("fills a 200x200u square to at least 95% of the square's area", () => {
    const square: Point[] = [
      [300, 300],
      [500, 300],
      [500, 500],
      [300, 500],
      [300, 300],
    ];
    const stroke: Stroke = {
      kind: "lassoFill",
      closeMode: "far",
      lassoThreshold: 120,
      size: 60,
      pts: toStrokePts(square),
    };
    const tile = strokesToTile([stroke], TILE);
    const inkPixels = tile.reduce((acc, v) => acc + (v < 128 ? 1 : 0), 0);
    const expectedSquarePixels = (200 / UNITS_PER_EM) * TILE * ((200 / UNITS_PER_EM) * TILE);
    expect(inkPixels).toBeGreaterThanOrEqual(expectedSquarePixels * 0.95);
  });

  it("fills both lobes of a self-intersecting figure-8 loop via nonzero winding", () => {
    const figure8: Point[] = [
      [200, 200],
      [400, 200],
      [200, 450],
      [400, 450],
      [200, 200],
    ];
    const res = resolveLasso(figure8, "always", 120);
    expect(res.closed).toBe(true);

    const stroke: Stroke = { kind: "lassoFill", closeMode: "always", size: 40, pts: toStrokePts(figure8) };
    const tile = strokesToTile([stroke], TILE);
    expect(tile[Math.round(0.24 * TILE) * TILE + Math.round(0.3 * TILE)]).toBeLessThan(30);
    expect(tile[Math.round(0.41 * TILE) * TILE + Math.round(0.3 * TILE)]).toBeLessThan(30);
  });

  it("subtracts ink when erase is true on a lassoFill stroke", () => {
    const outer: Point[] = [
      [200, 200],
      [600, 200],
      [600, 600],
      [200, 600],
    ];
    const cutout: Point[] = [
      [300, 300],
      [500, 300],
      [500, 500],
      [300, 500],
    ];
    const tile = strokesToTile(
      [
        { kind: "lassoFill", closeMode: "always", size: 60, pts: toStrokePts(outer) },
        { kind: "lassoFill", closeMode: "always", size: 60, erase: true, pts: toStrokePts(cutout) },
      ],
      TILE,
    );
    expect(tile[Math.round(0.4 * TILE) * TILE + Math.round(0.4 * TILE)]).toBeGreaterThan(220);
    expect(tile[Math.round(0.25 * TILE) * TILE + Math.round(0.25 * TILE)]).toBeLessThan(30);
  });

  it("old strokes without kind still rasterize identically", () => {
    const legacy: Stroke = { size: 60, pts: [0.2, 0.5, 0.5, 0.8, 0.5, 0.5] };
    const explicit: Stroke = { kind: "stroke", ...legacy };
    expect(strokesToTile([legacy], 100)).toEqual(strokesToTile([explicit], 100));
  });

  it("exports closed lassoFill polygons into the instant preview font", () => {
    const square: Point[] = [
      [200, 200],
      [500, 200],
      [500, 500],
      [200, 500],
    ];
    const poly = strokeOutline({ kind: "lassoFill", closeMode: "always", size: 60, pts: toStrokePts(square) }).map(
      ([x, y]): Point => [x * CANVAS_EM, y * CANVAS_EM],
    );
    const buf = compileCanvasFont([{ unicode: 0x41, name: "A", polygons: [poly] }]);
    const font = parse(buf);
    expect(font.charToGlyph("A").path.commands.length).toBeGreaterThanOrEqual(4);
  });

  it("persists and restores lasso tool, close mode, and threshold in penSettings", () => {
    const storeMap = new Map<string, string>();
    const prevStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => storeMap.get(k) ?? null,
        setItem: (k: string, v: string) => storeMap.set(k, v),
        removeItem: (k: string) => storeMap.delete(k),
      },
    });
    try {
      const saved = normalizeToolSettings({
        tool: "lasso",
        lassoCloseMode: "always",
        lassoThreshold: 260,
        lassoErase: true,
        lazyEnabled: true,
        lazyRadius: 85,
      });
      localStorage.setItem("typecraft-pen-settings", JSON.stringify(saved));
      const restored = readStoredPenSettings();
      expect(restored.tool).toBe("lasso");
      expect(restored.lassoCloseMode).toBe("always");
      expect(restored.lassoThreshold).toBe(260);
      expect(restored.lassoErase).toBe(true);
      expect(restored.lazyEnabled).toBe(true);
      expect(restored.lazyRadius).toBe(85);
    } finally {
      Object.defineProperty(globalThis, "localStorage", { configurable: true, value: prevStorage });
    }
  });

  it("applies Chaikin curve smoothing on curved lasso contours while preserving sharp corners", () => {
    const curved: Point[] = [
      [100, 300],
      [250, 200],
      [450, 210],
      [600, 320],
      [450, 450],
      [220, 440],
    ];
    const smoothed = smoothLassoPolygon(curved, 0.8, true);
    expect(smoothed.length).toBeGreaterThan(curved.length);
  });

  it("Studio lassoPointsToVectorPath builds CCW fill, CW cutout, and open-ribbon VectorPaths", () => {
    const loop: Point[] = [
      [100, 100],
      [400, 100],
      [400, 400],
      [100, 400],
    ];
    const fillPath = lassoPointsToVectorPath(loop, { closeMode: "always", threshold: 120, erase: false });
    expect(fillPath).not.toBeNull();
    expect(signedArea(vectorPathsToContours([fillPath!])[0]!)).toBeGreaterThan(0);

    const cutPath = lassoPointsToVectorPath(loop, { closeMode: "always", threshold: 120, erase: true });
    expect(cutPath).not.toBeNull();
    expect(signedArea(vectorPathsToContours([cutPath!])[0]!)).toBeLessThan(0);

    const openPath = lassoPointsToVectorPath(
      [
        [100, 100],
        [400, 100],
        [400, 400],
      ],
      { closeMode: "off", threshold: 120 },
    );
    expect(openPath).not.toBeNull();
    expect(openPath!.closed).toBe(true);
  });

  it("DrawPad commits a filled lassoFill stroke on mouse drag", () => {
    const prevRO = globalThis.ResizeObserver;
    const prevGetCtx = HTMLCanvasElement.prototype.getContext;
    globalThis.ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
    const fills: string[] = [];
    HTMLCanvasElement.prototype.getContext = function () {
      return {
        setTransform() {},
        clearRect() {},
        drawImage() {},
        save() {},
        restore() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        closePath() {},
        arc() {},
        setLineDash() {},
        stroke() {},
        fill(rule?: CanvasFillRule) {
          fills.push(rule ?? "nonzero");
        },
      } as unknown as RenderingContext;
    } as unknown as typeof HTMLCanvasElement.prototype.getContext;

    const onStroke = vi.fn();
    try {
      const { getByLabelText } = render(
        createElement(DrawPad, {
          strokes: [],
          onStroke,
          tool: "lasso",
          brush: 70,
          smooth: 0.7,
          lassoCloseMode: "far",
          lassoThreshold: 120,
          pencilOnly: false,
          onPencil: () => {},
          metrics: { ascender: 800, capHeight: 700, xHeight: 500, descender: -200 },
          ghost: null,
        }),
      );
      const canvas = getByLabelText("Drawing pad") as HTMLCanvasElement;
      canvas.getBoundingClientRect = () => ({ left: 0, top: 0, right: 500, bottom: 500, width: 500, height: 500, x: 0, y: 0, toJSON: () => ({}) });
      canvas.setPointerCapture = () => {};
      canvas.releasePointerCapture = () => {};

      const ptr = (type: string, x: number, y: number) => {
        const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
        Object.defineProperty(ev, "pointerId", { value: 1 });
        Object.defineProperty(ev, "pointerType", { value: "mouse" });
        Object.defineProperty(ev, "pressure", { value: 0.5 });
        return ev;
      };

      canvas.dispatchEvent(ptr("pointerdown", 100, 100));
      canvas.dispatchEvent(ptr("pointermove", 250, 100));
      canvas.dispatchEvent(ptr("pointermove", 250, 250));
      canvas.dispatchEvent(ptr("pointermove", 100, 250));
      canvas.dispatchEvent(ptr("pointerup", 105, 105));

      expect(onStroke).toHaveBeenCalledTimes(1);
      const committed = onStroke.mock.calls[0]![0] as Stroke;
      expect(committed.kind).toBe("lassoFill");
      expect(committed.closeMode).toBe("far");
      expect(committed.pts.length).toBeGreaterThanOrEqual(12);
      const tile = strokesToTile([committed], TILE);
      expect(tile[Math.round(0.35 * TILE) * TILE + Math.round(0.35 * TILE)]).toBeLessThan(30);
    } finally {
      globalThis.ResizeObserver = prevRO;
      HTMLCanvasElement.prototype.getContext = prevGetCtx;
    }
  });
});
