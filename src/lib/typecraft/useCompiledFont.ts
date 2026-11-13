import { useEffect, useMemo, useState } from "react";
import { buildOtf, collectExportGlyphs, type ExportGlyph } from "./font";
import { useProject, type GlyphRecord } from "./store";

let faceCounter = 0;

export type CompiledFont = { family: string; glyphs: ExportGlyph[]; drawnCount: number; duplicates: number[]; error?: string };

/**
 * Compiles the project into the same OTF bytes the download uses (names, Tamil GSUB and all) and registers it as a
 * browser FontFace, so the sandbox is shaped by the browser's own text engine exactly like an installed font.
 */
export function useCompiledFont(delay = 250) {
  const glyphs = useProject((s) => s.glyphs);
  const order = useProject((s) => s.order);
  const metrics = useProject((s) => s.metrics);
  const meta = useProject((s) => s.meta);
  const spaceWidth = useProject((s) => s.spaceWidth);
  const spacing = useProject((s) => s.syllableSpacing);
  const [state, setState] = useState<CompiledFont | null>(null);

  const sources = useMemo(() => order.map((id) => glyphs[id]).filter((g): g is GlyphRecord => !!g), [order, glyphs]);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const { glyphs: list, skippedDuplicates, drawnCount, kerning } = collectExportGlyphs(sources, metrics, spaceWidth, spacing);
        const buf = buildOtf(list, meta, metrics, kerning);
        const family = `TypeCraftPreview${++faceCounter}`;
        const face = new FontFace(family, buf);
        face.load().then((f) => {
          document.fonts.add(f);
          setState((prev) => {
            if (prev) for (const old of document.fonts) if (old.family === prev.family) document.fonts.delete(old);
            return { family, glyphs: list, drawnCount, duplicates: skippedDuplicates };
          });
        }).catch((e) => setState((prev) => (prev ? { ...prev, error: String(e) } : prev)));
      } catch (e) {
        setState((prev) => (prev ? { ...prev, error: String(e) } : prev));
      }
    }, delay);
    return () => clearTimeout(t);
  }, [sources, metrics, meta, spaceWidth, spacing, delay]);

  return state;
}
