import { useEffect } from "react";
import { create } from "zustand";
import { BRUSH_MAX, BRUSH_MIN, DEFAULT_BRUSH, DEFAULT_SMOOTH } from "./drawing";

export type PenStyle = "pen" | "brush" | "calligraphy";
type Settings = { brush: number; smooth: number; stabilization: number; penStyle: PenStyle };
const KEY = "typecraft-pen-settings";
export function normalizePenSettings(value: Partial<Settings>): Settings {
  return {
    brush: Number.isFinite(value.brush) ? Math.max(BRUSH_MIN, Math.min(BRUSH_MAX, Number(value.brush))) : DEFAULT_BRUSH,
    smooth: Number.isFinite(value.smooth) ? Math.max(0, Math.min(1, Number(value.smooth))) : DEFAULT_SMOOTH,
    stabilization: Number.isFinite(value.stabilization) ? Math.max(0, Math.min(1, Number(value.stabilization))) : 0.5,
    penStyle: value.penStyle === "brush" || value.penStyle === "calligraphy" ? value.penStyle : "pen",
  };
}
const store = create<Settings & { update: (patch: Partial<Settings>) => void }>((set, get) => ({
  ...normalizePenSettings({}),
  update: (patch) => {
    const next = normalizePenSettings({ ...get(), ...patch });
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
    try { store.setState(normalizePenSettings(JSON.parse(localStorage.getItem(KEY) ?? "{}"))); } catch { /* Keep defaults. */ }
  }, []);
  return { ...settings, setBrush: (brush: number) => settings.update({ brush }), setSmooth: (smooth: number) => settings.update({ smooth }), setStabilization: (stabilization: number) => settings.update({ stabilization }), setPenStyle: (penStyle: PenStyle) => settings.update({ penStyle }) };
}