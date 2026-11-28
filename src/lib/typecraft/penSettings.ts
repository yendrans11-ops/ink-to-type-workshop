import { useEffect } from "react";
import { create } from "zustand";
import { BRUSH_MAX, BRUSH_MIN, DEFAULT_BRUSH, DEFAULT_SMOOTH } from "./drawing";
import { DEFAULT_LASSO_THRESHOLD, LASSO_THRESHOLD_MAX, LASSO_THRESHOLD_MIN, type CloseMode } from "./lasso";

export type PenStyle = "pen" | "brush" | "calligraphy";
export type ActiveDrawTool = "pen" | "eraser" | "lasso";

export const LAZY_RADIUS_MIN = 10;
export const LAZY_RADIUS_MAX = 150;
export const DEFAULT_LAZY_RADIUS = 45;

type PenSettings = { brush: number; smooth: number; stabilization: number; penStyle: PenStyle };
type ToolSettings = {
  tool: ActiveDrawTool;
  lassoCloseMode: CloseMode;
  lassoThreshold: number;
  lassoErase: boolean;
  lazyEnabled: boolean;
  lazyRadius: number;
};
export type AllPenSettings = PenSettings & ToolSettings;

const KEY = "typecraft-pen-settings";

export const DEFAULT_STABILIZATION = 0.25;

export function normalizePenSettings(value: Partial<PenSettings>): PenSettings {
  return {
    brush: Number.isFinite(value.brush) ? Math.max(BRUSH_MIN, Math.min(BRUSH_MAX, Number(value.brush))) : DEFAULT_BRUSH,
    smooth: Number.isFinite(value.smooth) ? Math.max(0, Math.min(1, Number(value.smooth))) : DEFAULT_SMOOTH,
    stabilization: Number.isFinite(value.stabilization) ? Math.max(0, Math.min(1, Number(value.stabilization))) : DEFAULT_STABILIZATION,
    penStyle: value.penStyle === "brush" || value.penStyle === "calligraphy" ? value.penStyle : "pen",
  };
}

export function normalizeToolSettings(value: Partial<ToolSettings>): ToolSettings {
  const tool: ActiveDrawTool = value.tool === "eraser" || value.tool === "lasso" ? value.tool : "pen";
  const lassoCloseMode: CloseMode =
    value.lassoCloseMode === "far" || value.lassoCloseMode === "off" ? value.lassoCloseMode : "always";
  const lassoThreshold = Number.isFinite(value.lassoThreshold)
    ? Math.max(LASSO_THRESHOLD_MIN, Math.min(LASSO_THRESHOLD_MAX, Math.round(Number(value.lassoThreshold))))
    : DEFAULT_LASSO_THRESHOLD;
  const lazyRadius = Number.isFinite(value.lazyRadius)
    ? Math.max(LAZY_RADIUS_MIN, Math.min(LAZY_RADIUS_MAX, Math.round(Number(value.lazyRadius))))
    : DEFAULT_LAZY_RADIUS;
  return {
    tool,
    lassoCloseMode,
    lassoThreshold,
    lassoErase: Boolean(value.lassoErase),
    lazyEnabled: Boolean(value.lazyEnabled),
    lazyRadius,
  };
}

export function readStoredPenSettings(): AllPenSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<AllPenSettings>;
    return { ...normalizePenSettings(parsed), ...normalizeToolSettings(parsed) };
  } catch {
    return { ...normalizePenSettings({}), ...normalizeToolSettings({}) };
  }
}

const store = create<AllPenSettings & { update: (patch: Partial<AllPenSettings>) => void }>((set, get) => ({
  ...normalizePenSettings({}),
  ...normalizeToolSettings({}),
  update: (patch) => {
    const merged = { ...get(), ...patch };
    const next: AllPenSettings = { ...normalizePenSettings(merged), ...normalizeToolSettings(merged) };
    set(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* Drawing still works without storage. */ }
  },
}));

let loaded = false;

export function usePenSettings() {
  const settings = store();
  useEffect(() => {
    if (loaded) return;
    loaded = true;
    store.setState(readStoredPenSettings());
  }, []);
  return {
    ...settings,
    setTool: (tool: ActiveDrawTool) => settings.update({ tool }),
    setBrush: (brush: number) => settings.update({ brush }),
    setSmooth: (smooth: number) => settings.update({ smooth }),
    setStabilization: (stabilization: number) => settings.update({ stabilization }),
    setPenStyle: (penStyle: PenStyle) => settings.update({ penStyle }),
    setLassoCloseMode: (lassoCloseMode: CloseMode) => settings.update({ lassoCloseMode }),
    setLassoThreshold: (lassoThreshold: number) => settings.update({ lassoThreshold }),
    setLassoErase: (lassoErase: boolean) => settings.update({ lassoErase }),
    setLazyEnabled: (lazyEnabled: boolean) => settings.update({ lazyEnabled }),
    setLazyRadius: (lazyRadius: number) => settings.update({ lazyRadius }),
  };
}
