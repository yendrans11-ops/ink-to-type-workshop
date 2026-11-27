import { useEffect, useMemo, useState } from "react";
import { buildOtf, collectExportGlyphs, type ExportGlyph } from "./font";
import { projectSnapshot, useProject, type GlyphRecord } from "./store";
import { buildWeightProject, metaForWeight, type FontWeightVariant } from "./weights";

let faceCounter = 0;

export type CompiledFont = { family: string; glyphs: ExportGlyph[]; drawnCount: number; duplicates: number[]; weight: FontWeightVariant; error?: string };

/**
 * Compiles the project into the same OTF bytes the download uses (names, Tamil GSUB and all) and registers it as a
 * browser FontFace, so the sandbox is shaped by the browser's own text engine exactly like an installed font.
 */
export function useCompiledFont(delay = 250, weight: FontWeightVariant = "regular") {
  const project = useProject();
  const glyphs = project.glyphs;
  const order = project.order;
  const metrics = project.metrics;
  const meta = project.meta;
  const spaceWidth = project.spaceWidth;
  const spacing = project.syllableSpacing;
  const preprocess = project.preprocess;
  const [state, setState] = useState<CompiledFont | null>(null);

  const sources = useMemo(() => order.map((id) => glyphs[id]).filter((g): g is GlyphRecord => !!g), [order, glyphs]);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        let exportSources = sources;
        let exportMeta = metaForWeight(meta, weight);
        if (weight !== "regular") {
          const weighted = await buildWeightProject(projectSnapshot(project), weight);
          if (cancelled) return;
          exportSources = weighted.order.map((id) => weighted.glyphs[id]).filter((g): g is GlyphRecord => !!g);
          exportMeta = weighted.meta;
        }
        const { glyphs: list, skippedDuplicates, drawnCount, kerning } = collectExportGlyphs(exportSources, metrics, spaceWidth, spacing, { calt: true });
        const buf = buildOtf(list, exportMeta, metrics, kerning);
        const family = `TypeCraftPreview${++faceCounter}`;
        const face = new FontFace(family, buf);
        const loadedFace = await face.load();
        if (cancelled) return;
        document.fonts.add(loadedFace);
        setState((prev) => {
          if (prev) for (const old of document.fonts) if (old.family === prev.family) document.fonts.delete(old);
          return { family, glyphs: list, drawnCount, duplicates: skippedDuplicates, weight };
        });
      } catch (e) {
        if (!cancelled) setState((prev) => (prev ? { ...prev, error: String(e) } : prev));
      }
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [sources, metrics, meta, spaceWidth, spacing, preprocess, delay, weight]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}
