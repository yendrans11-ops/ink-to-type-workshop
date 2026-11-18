// Gallery library: every font project saved side by side in IndexedDB. The open project lives in the main store
// ("typecraft-project"); its library copy is refreshed whenever the gallery opens or you switch away from it.
import { del, get, set } from "idb-keyval";
import { emptyProject, flushProjectWrite, newProjectId, normalizeProject, projectSnapshot, useProject, useUploads, type ProjectData } from "./store";

export type LibraryEntry = { id: string; familyName: string; styleName: string; glyphCount: number; updatedAt: number };

const INDEX_KEY = "typecraft-library";
const snapKey = (id: string) => `typecraft-lib:${id}`;

const drawnCount = (p: ProjectData) => Object.values(p.glyphs).filter((g) => g.traced?.length && !g.empty).length;

export function entryFor(p: ProjectData, updatedAt = Date.now()): LibraryEntry {
  return { id: p.projectId, familyName: p.meta.familyName, styleName: p.meta.styleName, glyphCount: drawnCount(p), updatedAt };
}

/** Newest first. */
export async function listLibrary(): Promise<LibraryEntry[]> {
  const list = ((await get(INDEX_KEY)) as LibraryEntry[] | undefined) ?? [];
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadSnapshot(id: string): Promise<ProjectData | null> {
  const raw = (await get(snapKey(id))) as Partial<ProjectData> | undefined;
  return raw ? normalizeProject({ ...raw, projectId: id }) : null;
}

export async function saveSnapshot(p: ProjectData): Promise<void> {
  await set(snapKey(p.projectId), projectSnapshot(p));
  const list = ((await get(INDEX_KEY)) as LibraryEntry[] | undefined) ?? [];
  await set(INDEX_KEY, [...list.filter((e) => e.id !== p.projectId), entryFor(p)]);
}

export async function deleteSnapshot(id: string): Promise<void> {
  if (id === useProject.getState().projectId) throw new Error("Open another project before deleting this one");
  await del(snapKey(id));
  const list = ((await get(INDEX_KEY)) as LibraryEntry[] | undefined) ?? [];
  await set(INDEX_KEY, list.filter((e) => e.id !== id));
}

/** Stores the open project in the library (skips an untouched blank project so it doesn't clutter the gallery). */
export async function saveCurrent(): Promise<void> {
  const cur = projectSnapshot(useProject.getState());
  const list = ((await get(INDEX_KEY)) as LibraryEntry[] | undefined) ?? [];
  if (!cur.order.length && !list.some((e) => e.id === cur.projectId)) return;
  await saveSnapshot(cur);
}

async function open(p: ProjectData) {
  useUploads.getState().clear();
  useProject.getState().loadProject(p);
  await flushProjectWrite();
}

export async function switchProject(id: string): Promise<void> {
  if (id === useProject.getState().projectId) return;
  const next = await loadSnapshot(id);
  if (!next) throw new Error("That project could not be found");
  await saveCurrent();
  await open(next);
}

/** Saves the open project, then opens a copy of it under a new id. */
export async function duplicateCurrent(): Promise<ProjectData> {
  await saveCurrent();
  const cur = projectSnapshot(useProject.getState());
  const copy: ProjectData = { ...cur, projectId: newProjectId(), meta: { ...cur.meta, familyName: `${cur.meta.familyName} Copy`.slice(0, 60) } };
  await saveSnapshot(copy);
  await open(copy);
  return copy;
}

/** Saves the open project, then starts an empty one. */
export async function startBlankProject(): Promise<ProjectData> {
  await saveCurrent();
  const blank = emptyProject();
  await open(blank);
  return blank;
}

/** Saves the open project, then opens one that came from elsewhere (e.g. the user's account), keeping a local copy. */
export async function openProjectData(p: ProjectData): Promise<void> {
  if (p.projectId !== useProject.getState().projectId) await saveCurrent();
  await saveSnapshot(p);
  await open(p);
}
