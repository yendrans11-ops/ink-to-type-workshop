// Project state. Persisted to IndexedDB (debounced) so work survives reloads; uploads stay in memory.
import { create } from "zustand";
import { persist, type PersistStorage } from "zustand/middleware";
import { del, get, set as idbSet } from "idb-keyval";
import type { Contour } from "./contours";
import { DEFAULT_CHARSETS, glyphNameFor } from "./charsets";
import { DEFAULT_META, type FontMeta, type Metrics } from "./font";
import { DEFAULT_PARAMS, type GlyphParams } from "./layout";
import type { Slot } from "./template";
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
};

export const DEFAULT_METRICS: Metrics = { ascender: 800, capHeight: 700, xHeight: 500, descender: -200 };
export const DEFAULT_PREPROCESS: Preprocess = { threshold: 150, denoise: 1, smoothing: 1, optimize: 0.2 };
export { DEFAULT_META };

type ProjectData = {
  charsetIds: string[];
  extraChars: string;
  ghost: boolean;
  glyphs: Record<string, GlyphRecord>;
  order: string[];
  metrics: Metrics;
  preprocess: Preprocess;
  meta: FontMeta;
  spaceWidth: number;
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
  select: (id: string | null) => void;
  setBatchMode: (b: boolean) => void;
  setBatchIds: (ids: string[]) => void;
  toggleBatchId: (id: string) => void;
  setTracing: (t: { done: number; total: number } | null) => void;
  clearGlyphs: () => void;
};

let pendingWrite: ReturnType<typeof setTimeout> | undefined;
const idbStorage: PersistStorage<ProjectData> = {
  getItem: async (name) => (await get(name)) ?? null,
  setItem: (name, value) => {
    clearTimeout(pendingWrite);
    pendingWrite = setTimeout(() => void idbSet(name, value), 700);
  },
  removeItem: (name) => del(name),
};

export const useProject = create<ProjectState>()(
  persist(
    (set) => ({
      charsetIds: DEFAULT_CHARSETS,
      extraChars: "",
      ghost: false,
      glyphs: {},
      order: [],
      metrics: DEFAULT_METRICS,
      preprocess: DEFAULT_PREPROCESS,
      meta: DEFAULT_META,
      spaceWidth: 280,
      hydrated: false,
      selectedId: null,
      batchMode: false,
      batchIds: [],
      tracing: null,

      setCharsets: (charsetIds) => set({ charsetIds }),
      setExtraChars: (extraChars) => set({ extraChars }),
      setGhost: (ghost) => set({ ghost }),
      ingestTiles: (tiles) =>
        set((s) => {
          const glyphs = { ...s.glyphs };
          for (const { slot, source } of tiles) {
            const prev = glyphs[slot.id];
            glyphs[slot.id] = prev
              ? { ...prev, source, traced: null }
              : {
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
      select: (selectedId) => set({ selectedId }),
      setBatchMode: (batchMode) => set((s) => ({ batchMode, batchIds: batchMode && s.selectedId ? [s.selectedId] : [] })),
      setBatchIds: (batchIds) => set({ batchIds }),
      toggleBatchId: (id) =>
        set((s) => ({ batchIds: s.batchIds.includes(id) ? s.batchIds.filter((x) => x !== id) : [...s.batchIds, id] })),
      setTracing: (tracing) => set({ tracing }),
      clearGlyphs: () => set({ glyphs: {}, order: [], selectedId: null, batchIds: [] }),
    }),
    {
      name: "typecraft-project",
      version: 1,
      storage: idbStorage,
      skipHydration: true,
      // Saved projects from before a font-detail field existed get its default instead of undefined.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ProjectData>;
        return { ...current, ...p, meta: { ...DEFAULT_META, ...p.meta } };
      },
      partialize: (s): ProjectData => ({
        charsetIds: s.charsetIds,
        extraChars: s.extraChars,
        ghost: s.ghost,
        glyphs: s.glyphs,
        order: s.order,
        metrics: s.metrics,
        preprocess: s.preprocess,
        meta: s.meta,
        spaceWidth: s.spaceWidth,
      }),
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
