// Which characters a download may contain: free accounts get a starter set, the one-time upgrade unlocks everything.
import type { GlyphRecord, ProjectData } from "./store";

export const UPGRADE_PRICE_LABEL = "$9";

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** Codepoints included in a free download: A–M and a–m. */
export const FREE_EXPORT_CPS: ReadonlySet<number> = new Set([...range(0x41, 0x4d), ...range(0x61, 0x6d)]);
export const FREE_EXPORT_LABEL = "A–M and a–m";

export const isFreeCp = (cp: number) => FREE_EXPORT_CPS.has(cp);

const isDrawnGlyph = (g: GlyphRecord | undefined): g is GlyphRecord => !!g?.traced?.length && !g.empty;

export type ExportSplit = {
  /** The project to compile: everything when unlocked, otherwise only the free characters. */
  project: ProjectData;
  included: GlyphRecord[];
  /** Drawn characters left out of a free download. */
  locked: GlyphRecord[];
};

export function splitForExport(p: ProjectData, fullAccess: boolean): ExportSplit {
  const drawn = p.order.map((id) => p.glyphs[id]).filter(isDrawnGlyph);
  if (fullAccess) return { project: p, included: drawn, locked: [] };
  const included = drawn.filter((g) => isFreeCp(g.unicode));
  const locked = drawn.filter((g) => !isFreeCp(g.unicode));
  const keep = new Set(included.map((g) => g.id));
  return { project: { ...p, order: p.order.filter((id) => keep.has(id)) }, included, locked };
}
