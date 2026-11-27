// Pressure-aware multi-weight font family generator (Light 300, Regular 400, Bold 700).
import { strokesToPotraceTile, strokesToTile, type Stroke } from "./drawing";
import type { FontMeta } from "./font";
import { autoPostScriptName, standardStyleName } from "./naming";
import type { GlyphRecord, ProjectData } from "./store";
import { TILE, traceTile } from "./trace";

export type FontWeightVariant = "light" | "regular" | "bold";

export const FONT_WEIGHT_VARIANTS: readonly FontWeightVariant[] = ["light", "regular", "bold"];

export const WEIGHT_SPECS: Record<
  FontWeightVariant,
  {
    label: string;
    styleName: string;
    weightClass: number;
    nibScale: number;
    pressureScale: number;
    morphologyPx: number;
  }
> = {
  light: { label: "Light", styleName: "Light", weightClass: 300, nibScale: 0.65, pressureScale: 0.8, morphologyPx: -1 },
  regular: { label: "Regular", styleName: "Regular", weightClass: 400, nibScale: 1.0, pressureScale: 1.0, morphologyPx: 0 },
  bold: { label: "Bold", styleName: "Bold", weightClass: 700, nibScale: 1.45, pressureScale: 1.25, morphologyPx: 2 },
};

/**
 * Scales stroke nib sizes and point pressures to synthesize a Light, Regular, or Bold variant
 * from a single drawing session without mutating the original strokes.
 */
export function generateWeightVariant(strokes: Stroke[], weight: FontWeightVariant): Stroke[] {
  const { nibScale, pressureScale } = WEIGHT_SPECS[weight];
  if (nibScale === 1 && pressureScale === 1) {
    return strokes.map((s) => ({ ...s, pts: [...s.pts] }));
  }
  return strokes.map((s) => {
    const pts = [...s.pts];
    for (let k = 2; k < pts.length; k += 3) {
      pts[k] = Math.max(0.01, Math.min(1, pts[k]! * pressureScale));
    }
    return {
      ...s,
      size: Math.max(1, Math.round(s.size * nibScale * 100) / 100),
      pts,
    };
  });
}

/** Rasterizes weight-adjusted strokes directly into an em-tile (useful for previews and testing). */
export function strokesToWeightTile(strokes: Stroke[], weight: FontWeightVariant, size = TILE): Uint8Array {
  return strokesToTile(generateWeightVariant(strokes, weight), size);
}

/** Produces OpenType metadata for a specific weight while keeping the shared Family Name identical. */
export function metaForWeight(meta: FontMeta, weight: FontWeightVariant): FontMeta {
  const spec = WEIGHT_SPECS[weight];
  const family = meta.familyName.trim() || "TypeCraft Hand";
  const styleName = meta.italic ? standardStyleName(spec.weightClass, true) : spec.styleName;
  const customPs = meta.postScriptName.trim();
  let postScriptName = "";
  if (customPs) {
    const base = customPs.replace(/-(Thin|ExtraLight|Light|Regular|Medium|SemiBold|Bold|ExtraBold|Black)(Italic)?$/i, "");
    const suffix = styleName.replace(/[^A-Za-z0-9]+/g, "") || spec.styleName;
    postScriptName = `${base}-${suffix}`.slice(0, 63);
  } else {
    postScriptName = autoPostScriptName(family, styleName);
  }
  return {
    ...meta,
    weightClass: spec.weightClass,
    styleName,
    postScriptName,
  };
}

async function glyphForWeight(g: GlyphRecord, weight: FontWeightVariant, project: ProjectData): Promise<GlyphRecord> {
  if (weight === "regular") {
    if (g.traced?.length || !g.strokes?.length) return g;
    const { tile: paddedTile, pad } = strokesToPotraceTile(g.strokes, TILE);
    const { contours, empty } = await traceTile(paddedTile, project.preprocess, {
      weight: g.params.weight,
      smoothing: g.params.smoothing,
      optimize: g.params.optimize,
    }, TILE, pad);
    return { ...g, source: strokesToTile(g.strokes), traced: contours, empty };
  }

  const spec = WEIGHT_SPECS[weight];
  if (g.strokes?.length && !g.vectorEdited) {
    const adjusted = generateWeightVariant(g.strokes, weight);
    const { tile: paddedTile, pad } = strokesToPotraceTile(adjusted, TILE);
    const { contours, empty } = await traceTile(paddedTile, project.preprocess, {
      weight: g.params.weight,
      smoothing: g.params.smoothing,
      optimize: g.params.optimize,
    }, TILE, pad);
    return { ...g, strokes: adjusted, source: strokesToTile(adjusted), traced: contours, empty };
  }

  // Fallback for scanned or vector-only glyphs: raster morphology if a source tile exists.
  if (g.source && !g.vectorEdited) {
    const { contours, empty } = await traceTile(g.source, project.preprocess, {
      weight: g.params.weight + spec.morphologyPx,
      smoothing: g.params.smoothing,
      optimize: g.params.optimize,
    });
    return { ...g, traced: contours, empty };
  }

  return g;
}

/** Builds a complete ProjectData copy whose strokes, traced contours, and SFNT metadata match `weight`. */
export async function buildWeightProject(project: ProjectData, weight: FontWeightVariant): Promise<ProjectData> {
  const weightedMeta = metaForWeight(project.meta, weight);
  if (weight === "regular") {
    const missingTrace = project.order.some((id) => {
      const g = project.glyphs[id];
      return g && !g.traced?.length && g.strokes?.length;
    });
    if (!missingTrace) return { ...project, meta: weightedMeta };
  }

  const glyphs: Record<string, GlyphRecord> = { ...project.glyphs };
  for (const id of project.order) {
    const g = glyphs[id];
    if (!g) continue;
    glyphs[id] = await glyphForWeight(g, weight, project);
  }
  return { ...project, glyphs, meta: weightedMeta };
}
