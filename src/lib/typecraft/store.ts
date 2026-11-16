// Project state. Persisted to IndexedDB (debounced) so work survives reloads; uploads stay in memory.
import { create } from "zustand";
import { persist, type PersistStorage } from "zustand/middleware";
import { del, get, set as idbSet } from "idb-keyval";
import type { Contour } from "./contours";
import { DEFAULT_CHARSETS, glyphNameFor } from "./charsets";
import { DEFAULT_META, type FontMeta, type Metrics } from "./font";
import { DEFAULT_PARAMS, type GlyphParams } from "./layout";
import type { Stroke } from "./drawing";
import type { Slot, TemplateFormat } from "./template";
import type { Preprocess } from "./trace";
import type { GrayImage, Pt } from "./vision";

export type GlyphRecord = {
  id: string;
  name: string;
  unicode: number;
  templateCp: number;
  isMark: boolean;
  source: Uint8Array | null;
  traced: Contour[] | null;
  empty: boolean;
  params: GlyphParams;
  /** Pen strokes when the glyph was drawn in the app (Draw page); absent for scanned glyphs. */
  strokes?: Stroke[];
};

export function newGlyphRecord(slot: Slot, source: Uint8Array): GlyphRecord {
  return {
    id: slot.id,
    name: slot.name,
    unicode: slot.cp,
    templateCp: slot.cp,
    isMark: slot.isMark,
    source,
    traced: null,
    empty: false,
    params: { ...DEFAULT_PARAMS, ...(slot.isMark ? { lsb: 0, rsb: 20 } : null) },
  };
}

export const DEFAULT_METRICS: Metrics = { ascender: 800, capHeight: 700, xHeight: 500, descender: -200 };
export const DEFAULT_PREPROCESS: Preprocess = { threshold: 150, denoise: 1, smoothing: 1, optimize: 0.2 };
export { DEFAULT_META };

export type ProjectData = {
  /** Stable id of this font project in the gallery library (library.ts). */
  projectId: string;
  charsetIds: string[];
  extraChars: string;
  ghost: boolean;
  /** Which template page format uploads are read with (paper sheet or iPad drawing-app page). */
  templateFormat: TemplateFormat;
  glyphs: Record<string, GlyphRecord>;
  order: string[];
  metrics: Metrics;
  preprocess: Preprocess;
  meta: FontMeta;
  spaceWidth: number;
  /** Tamil syllable gaps in font units, keyed by syllable text ("கெ", "கா", "க்"); see syllables.ts. */
  syllableSpacing: Record<string, number>;
};

type ProjectState = ProjectData & {
  hydrated: boolean;
  selectedId: string | null;
  batchMode: boolean;
  batchIds: string[];
  tracing: { done: number; total: number } | null;
  setCharsets: (ids: string[]) => void;
  setExtraChars: (s: string) => void;
  setGhost: (b: boolean) => void;
  setTemplateFormat: (f: TemplateFormat) => void;
  /** Stores a glyph drawn on the Draw page: its rendered tile plus the strokes so it can be edited later. */
  drawGlyph: (slot: Slot, source: Uint8Array, strokes: Stroke[]) => void;
  ingestTiles: (tiles: { slot: Slot; source: Uint8Array }[]) => void;
  setTraced: (id: string, traced: Contour[], empty: boolean) => void;
  updateParams: (ids: string[], p: Partial<GlyphParams>) => void;
  resetParams: (ids: string[]) => void;
  setUnicode: (id: string, cp: number) => void;
  setIsMark: (id: string, isMark: boolean) => void;
  setMetrics: (m: Partial<Metrics>) => void;
  setPreprocess: (p: Partial<Preprocess>) => void;
  setMeta: (m: Partial<FontMeta>) => void;
  setSpaceWidth: (w: number) => void;
  /** Merges gaps; a value of 0 removes the entry. */
  setSyllableSpacing: (patch: Record<string, number>) => void;
  select: (id: string | null) => void;
  setBatchMode: (b: boolean) => void;
  setBatchIds: (ids: string[]) => void;
  toggleBatchId: (id: string) => void;
  setTracing: (t: { done: number; total: number } | null) => void;
  clearGlyphs: () => void;
  /** Replaces the open project (gallery switch / new / duplicate). */
  loadProject: (data: ProjectData) => void;
};

export const newProjectId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** A fresh, empty project with default character sets, metrics and font details. */
export function emptyProject(): ProjectData {
  return {
    projectId: newProjectId(),
    charsetIds: DEFAULT_CHARSETS,
    extraChars: "",
    ghost: false,
    templateFormat: "print",
    glyphs: {},
    order: [],
    metrics: DEFAULT_METRICS,
    preprocess: DEFAULT_PREPROCESS,
    meta: DEFAULT_META,
    spaceWidth: 280,
    syllableSpacing: {},
  };
}

/** The saved part of the open project. */
export function projectSnapshot(s: ProjectData): ProjectData {
  return {
    projectId: s.projectId,
    charsetIds: s.charsetIds,
    extraChars: s.extraChars,
    ghost: s.ghost,
    templateFormat: s.templateFormat,
    glyphs: s.glyphs,
    order: s.order,
    metrics: s.metrics,
    preprocess: s.preprocess,
    meta: s.meta,
    spaceWidth: s.spaceWidth,
    syllableSpacing: s.syllableSpacing,
  };
}

/** Fills fields that older saved projects don't have yet. */
export function normalizeProject(p: Partial<ProjectData>): ProjectData {
  const base = emptyProject();
  return { ...base, ...p, projectId: p.projectId ?? base.projectId, meta: { ...DEFAULT_META, ...p.meta }, syllableSpacing: p.syllableSpacing ?? {}, templateFormat: p.templateFormat ?? "print" };
}

let pendingWrite: ReturnType<typeof setTimeout> | undefined;
let pendingValue: { name: string; value: unknown } | null = null;
const idbStorage: PersistStorage<ProjectData> = {
  getItem: async (name) => (await get(name)) ?? null,
  setItem: (name, value) => {
    clearTimeout(pendingWrite);
    pendingValue = { name, value };
    pendingWrite = setTimeout(() => void flushProjectWrite(), 700);
  },
  removeItem: (name) => del(name),
};

/** Writes the open project now instead of after the edit debounce (used before switching projects). */
export async function flushProjectWrite(): Promise<void> {
  clearTimeout(pendingWrite);
  const p = pendingValue;
  pendingValue = null;
  if (p) await idbSet(p.name, p.value);
}

export const useProject = create<ProjectState>()(
  persist(
    (set) => ({
      ...emptyProject(),
      hydrated: false,
      selectedId: null,
      batchMode: false,
      batchIds: [],
      tracing: null,

      setCharsets: (charsetIds) => set({ charsetIds }),
      setExtraChars: (extraChars) => set({ extraChars }),
      setGhost: (ghost) => set({ ghost }),
      setTemplateFormat: (templateFormat) => set({ templateFormat }),
      drawGlyph: (slot, source, strokes) =>
        set((s) => {
          const prev = s.glyphs[slot.id];
          const rec = prev ? { ...prev, source, strokes } : { ...newGlyphRecord(slot, source), strokes };
          return { glyphs: { ...s.glyphs, [slot.id]: rec }, order: prev ? s.order : [...s.order, slot.id] };
        }),
      ingestTiles: (tiles) =>
        set((s) => {
          const glyphs = { ...s.glyphs };
          for (const { slot, source } of tiles) {
            const prev = glyphs[slot.id];
            if (prev) {
              const { strokes: _drawn, ...rest } = prev; // a scan replaces in-app drawing
              glyphs[slot.id] = { ...rest, source, traced: null };
            } else glyphs[slot.id] = newGlyphRecord(slot, source);
          }
          const incoming = tiles.map((t) => t.slot.id);
          const order = [...s.order.filter((id) => !incoming.includes(id)), ...incoming];
          const firstDrawn = s.selectedId && glyphs[s.selectedId] ? s.selectedId : incoming[0] ?? null;
          return { glyphs, order, selectedId: firstDrawn };
        }),
      setTraced: (id, traced, empty) =>
        set((s) => (s.glyphs[id] ? { glyphs: { ...s.glyphs, [id]: { ...s.glyphs[id], traced, empty } } } : s)),
      updateParams: (ids, p) =>
        set((s) => {
          const glyphs = { ...s.glyphs };
          for (const id of ids) if (glyphs[id]) glyphs[id] = { ...glyphs[id], params: { ...glyphs[id].params, ...p } };
          return { glyphs };
        }),
      resetParams: (ids) =>
        set((s) => {
          const glyphs = { ...s.glyphs };
          for (const id of ids) if (glyphs[id]) glyphs[id] = { ...glyphs[id], params: { ...DEFAULT_PARAMS } };
          return { glyphs };
        }),
      setUnicode: (id, cp) =>
        set((s) => {
          const g = s.glyphs[id];
          return g ? { glyphs: { ...s.glyphs, [id]: { ...g, unicode: cp, name: glyphNameFor(cp) } } } : s;
        }),
      setIsMark: (id, isMark) =>
        set((s) => {
          const g = s.glyphs[id];
          return g ? { glyphs: { ...s.glyphs, [id]: { ...g, isMark } } } : s;
        }),
      setMetrics: (m) => set((s) => ({ metrics: { ...s.metrics, ...m } })),
      setPreprocess: (p) => set((s) => ({ preprocess: { ...s.preprocess, ...p } })),
      setMeta: (m) => set((s) => ({ meta: { ...s.meta, ...m } })),
      setSpaceWidth: (spaceWidth) => set({ spaceWidth }),
      setSyllableSpacing: (patch) =>
        set((s) => {
          const next = { ...s.syllableSpacing };
          for (const [k, v] of Object.entries(patch)) {
            const r = Math.round(v);
            if (r) next[k] = r;
            else delete next[k];
          }
          return { syllableSpacing: next };
        }),
      select: (selectedId) => set({ selectedId }),
      setBatchMode: (batchMode) => set((s) => ({ batchMode, batchIds: batchMode && s.selectedId ? [s.selectedId] : [] })),
      setBatchIds: (batchIds) => set({ batchIds }),
      toggleBatchId: (id) =>
        set((s) => ({ batchIds: s.batchIds.includes(id) ? s.batchIds.filter((x) => x !== id) : [...s.batchIds, id] })),
      setTracing: (tracing) => set({ tracing }),
      clearGlyphs: () => set({ glyphs: {}, order: [], selectedId: null, batchIds: [] }),
      loadProject: (data) => set({ ...normalizeProject(data), selectedId: null, batchMode: false, batchIds: [], tracing: null }),
    }),
    {
      name: "typecraft-project",
      version: 1,
      storage: idbStorage,
      skipHydration: true,
      // Saved projects from before a font-detail field existed get its default instead of undefined.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ProjectData>;
        return { ...current, ...normalizeProject(p) };
      },
      partialize: (s): ProjectData => projectSnapshot(s),
    },
  ),
);

/** Ids a parameter edit applies to: the batch selection in batch mode, else the selected glyph. */
export function targetIds(s: Pick<ProjectState, "batchMode" | "batchIds" | "selectedId">): string[] {
  if (s.batchMode && s.batchIds.length) return s.batchIds;
  return s.selectedId ? [s.selectedId] : [];
}

export type UploadPage = {
  id: string;
  fileName: string;
  preview: string;
  width: number;
  height: number;
  gray: GrayImage;
  corners: Pt[];
  found: boolean[];
  page: number;
};

type UploadState = {
  pages: UploadPage[];
  addPages: (p: UploadPage[]) => void;
  updatePage: (id: string, p: Partial<UploadPage>) => void;
  removePage: (id: string) => void;
  clear: () => void;
};

export const useUploads = create<UploadState>()((set) => ({
  pages: [],
  addPages: (p) => set((s) => ({ pages: [...s.pages, ...p] })),
  updatePage: (id, p) => set((s) => ({ pages: s.pages.map((x) => (x.id === id ? { ...x, ...p } : x)) })),
  removePage: (id) => set((s) => ({ pages: s.pages.filter((x) => x.id !== id) })),
  clear: () => set({ pages: [] }),
}));
