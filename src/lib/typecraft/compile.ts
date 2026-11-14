// Turns any saved project (open or from the gallery library) into font bytes and a pre-export check.
import { buildOtf, buildTtf, collectExportGlyphs, fileBaseName } from "./font";
import { runPreflight } from "./preflight";
import type { GlyphRecord, ProjectData } from "./store";
import { buildTemplateLayout } from "./template";

export type FontKind = "ttf" | "otf";

const sourcesOf = (p: ProjectData) => p.order.map((id) => p.glyphs[id]).filter((g): g is GlyphRecord => !!g);

export function compileProject(p: ProjectData) {
  const r = collectExportGlyphs(sourcesOf(p), p.metrics, p.spaceWidth, p.syllableSpacing);
  return {
    ...r,
    build: (kind: FontKind) => (kind === "ttf" ? buildTtf : buildOtf)(r.glyphs, p.meta, p.metrics, r.kerning),
    fileName: (kind: FontKind) => `${fileBaseName(p.meta)}.${kind}`,
  };
}

export function preflightProject(p: ProjectData) {
  return runPreflight({
    glyphs: sourcesOf(p),
    expected: buildTemplateLayout(p.charsetIds, p.extraChars).slots.map((s) => s.cp),
    meta: p.meta,
    metrics: p.metrics,
  });
}
