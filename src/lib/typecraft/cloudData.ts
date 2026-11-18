// The JSON saved to a user's account: the project with pen strokes per character, without raster scan tiles.
import { strokesToTile, type Stroke } from "./drawing";
import { normalizeProject, type GlyphRecord, type ProjectData } from "./store";

export const CLOUD_DATA_VERSION = 1;

export type CloudGlyph = Omit<GlyphRecord, "source">;
export type CloudProjectData = { v: typeof CLOUD_DATA_VERSION; project: Omit<ProjectData, "glyphs"> & { glyphs: Record<string, CloudGlyph> } };

const round = (n: number) => Math.round(n * 10000) / 10000;
const compact = (s: Stroke): Stroke => ({ ...s, pts: s.pts.map(round) });

export function toCloudData(p: ProjectData): CloudProjectData {
  const glyphs: Record<string, CloudGlyph> = {};
  for (const id of p.order) {
    const g = p.glyphs[id];
    if (!g) continue;
    const { source: _tile, ...rest } = g;
    glyphs[id] = rest.strokes ? { ...rest, strokes: rest.strokes.map(compact) } : rest;
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
    glyphs[id] = { ...g, source: g.strokes?.length ? strokesToTile(g.strokes) : null, traced: g.traced ?? null };
  }
  const order = (src.order ?? []).filter((id) => glyphs[id]);
  return normalizeProject({ ...src, glyphs, order });
}

export const drawnGlyphCount = (p: ProjectData) => p.order.filter((id) => p.glyphs[id]?.traced?.length && !p.glyphs[id]?.empty).length;
