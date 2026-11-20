// The JSON saved to a user's account: the project with pen strokes per character, without raster scan tiles.
import { strokesToTile, type Stroke } from "./drawing";
import { normalizeProject, type GlyphRecord, type ProjectData } from "./store";

export const CLOUD_DATA_VERSION = 1;

export type CloudGlyph = Omit<GlyphRecord, "source"> & { scanRle?: number[] };
export type CloudProjectData = { v: typeof CLOUD_DATA_VERSION; project: Omit<ProjectData, "glyphs"> & { glyphs: Record<string, CloudGlyph> } };

const round = (n: number) => Math.round(n * 10000) / 10000;
const compact = (s: Stroke): Stroke => ({ ...s, pts: s.pts.map(round) });
const encodeTile = (tile: Uint8Array): number[] => {
  const out: number[] = [];
  for (let i = 0; i < tile.length;) {
    const value = tile[i];
    if (value === undefined) break;
    let count = 1;
    while (i + count < tile.length && tile[i + count] === value) count++;
    out.push(value, count); i += count;
  }
  return out;
};
const decodeTile = (rle: number[]): Uint8Array => {
  const tile = new Uint8Array(240 * 240);
  let at = 0;
  if (rle.length % 2) throw new Error("The saved scan is invalid");
  for (let i = 0; i < rle.length; i += 2) {
    const value = rle[i], count = rle[i + 1];
    if (value === undefined || count === undefined || !Number.isInteger(value) || value < 0 || value > 255 || !Number.isInteger(count) || count <= 0 || at + count > tile.length) throw new Error("The saved scan is invalid");
    tile.fill(value, at, at + count); at += count;
  }
  if (at !== tile.length) throw new Error("The saved scan is incomplete");
  return tile;
};

export function toCloudData(p: ProjectData): CloudProjectData {
  const glyphs: Record<string, CloudGlyph> = {};
  for (const id of p.order) {
    const g = p.glyphs[id];
    if (!g) continue;
    const { source: _tile, ...rest } = g;
    glyphs[id] = rest.strokes?.length ? { ...rest, strokes: rest.strokes.map(compact) } : { ...rest, ...(g.source ? { scanRle: encodeTile(g.source) } : {}) };
  }
  return { v: CLOUD_DATA_VERSION, project: { ...p, glyphs } };
}

/** Rebuilds an editable project; drawn characters get their tile back from the strokes so they can be retraced. */
export function fromCloudData(raw: unknown): ProjectData {
  const d = raw as Partial<CloudProjectData> | null;
  if (!d || d.v !== CLOUD_DATA_VERSION || !d.project || typeof d.project !== "object") throw new Error("This saved font is in an unknown format");
  const src = d.project;
  const glyphs: Record<string, GlyphRecord> = {};
  for (const [id, g] of Object.entries(src.glyphs ?? {})) {
    if (!g || !Number.isInteger(g.unicode) || (g.strokes && (!Array.isArray(g.strokes) || g.strokes.some((s) => !Array.isArray(s.pts) || s.pts.length % 3 !== 0 || s.pts.some((n) => !Number.isFinite(n)))))) throw new Error("The saved drawing is invalid");
    const { scanRle, ...record } = g;
    glyphs[id] = { ...record, source: g.strokes?.length ? strokesToTile(g.strokes) : scanRle ? decodeTile(scanRle) : null, traced: g.traced ?? null };
  }
  const order = (src.order ?? []).filter((id) => glyphs[id]);
  return normalizeProject({ ...src, glyphs, order });
}

export const drawnGlyphCount = (p: ProjectData) => p.order.filter((id) => p.glyphs[id]?.traced?.length && !p.glyphs[id]?.empty).length;
