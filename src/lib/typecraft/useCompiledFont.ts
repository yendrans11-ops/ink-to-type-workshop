import { useEffect, useMemo, useState } from "react";
import type { Font } from "opentype.js";
import { buildFont, collectExportGlyphs, type ExportGlyph } from "./font";
import { useProject, type GlyphRecord } from "./store";

let faceCounter = 0;

/** Compiles the project into an in-memory opentype.js font and registers it as a browser FontFace. */
export function useCompiledFont(delay = 250) {
  const glyphs = useProject((s) => s.glyphs);
  const order = useProject((s) => s.order);
  const metrics = useProject((s) => s.metrics);
  const meta = useProject((s) => s.meta);
  const spaceWidth = useProject((s) => s.spaceWidth);
  const [state, setState] = useState<{ font: Font; family: string; glyphs: ExportGlyph[]; duplicates: number[]; error?: string } | null>(null);

  const sources = useMemo(() => order.map((id) => glyphs[id]).filter((g): g is GlyphRecord => !!g), [order, glyphs]);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const { glyphs: list, skippedDuplicates } = collectExportGlyphs(sources, metrics, spaceWidth);
        const font = buildFont(list, meta, metrics);
        const buf = font.toArrayBuffer();
        const family = `TypeCraftPreview${++faceCounter}`;
        const face = new FontFace(family, buf);
        face.load().then((f) => {
          document.fonts.add(f);
          setState((prev) => {
            if (prev) for (const old of document.fonts) if (old.family === prev.family) document.fonts.delete(old);
            return { font, family, glyphs: list, duplicates: skippedDuplicates };
          });
        }).catch((e) => setState((prev) => (prev ? { ...prev, error: String(e) } : prev)));
      } catch (e) {
        setState((prev) => (prev ? { ...prev, error: String(e) } : prev));
      }
    }, delay);
    return () => clearTimeout(t);
  }, [sources, metrics, meta, spaceWidth, delay]);

  return state;
}
