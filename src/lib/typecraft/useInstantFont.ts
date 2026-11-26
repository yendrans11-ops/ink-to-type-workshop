// Live preview font built straight from Draw-page strokes (no tracing wait), via fontCompiler.
import { useEffect, useMemo, useState } from "react";
import { mapContours, type P } from "./contours";
import { strokeOutline } from "./drawing";
import { CANVAS_EM, compileCanvasFont, fontToCanvas, loadCanvasFont, type CanvasGlyph } from "./fontCompiler";
import { useProject, type GlyphRecord } from "./store";
import { ligatureById } from "./tamil";

let instance = 0;

/** Drawn strokes become pen-outline polygons; vector-edited, erased, or scanned glyphs use traced outlines. */
export function toCanvasGlyph(g: GlyphRecord): CanvasGlyph | null {
  if (ligatureById(g.unicode) || g.isMark) return null;
  const side = { lsb: g.params.lsb, rsb: g.params.rsb, unicode: g.unicode, name: g.name };
  if (!g.vectorEdited && g.strokes?.length && !g.strokes.some((s) => s.erase)) {
    return { ...side, polygons: g.strokes.map((s) => strokeOutline(s).map(([x, y]): P => [x * CANVAS_EM, y * CANVAS_EM])) };
  }
  if (g.traced?.length) return { ...side, contours: mapContours(g.traced, (p) => fontToCanvas(p)) };
  return null;
}

/** Returns a CSS font-family name that always shows the latest drawn letters. */
export function useInstantFont(delay = 60) {
  const glyphs = useProject((s) => s.glyphs);
  const order = useProject((s) => s.order);
  const spaceWidth = useProject((s) => s.spaceWidth);
  const [family] = useState(() => `TypeCraftInstant${++instance}`);
  const [ready, setReady] = useState(false);
  const list = useMemo(() => order.map((id) => glyphs[id]).flatMap((g) => (g ? [toCanvasGlyph(g)].filter((x): x is CanvasGlyph => !!x) : [])), [order, glyphs]);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        loadCanvasFont(compileCanvasFont(list, { familyName: "TypeCraft Instant", spaceWidth }), family).then(() => setReady(true)).catch(() => {});
      } catch { /* a broken outline just leaves the previous preview */ }
    }, delay);
    return () => clearTimeout(t);
  }, [list, spaceWidth, family, delay]);

  return { family, ready, count: list.length };
}
