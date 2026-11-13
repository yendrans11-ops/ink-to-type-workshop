import { useMemo } from "react";
import { toSvgD } from "@/lib/typecraft/contours";
import { layoutGlyph } from "@/lib/typecraft/layout";
import { useProject, type GlyphRecord } from "@/lib/typecraft/store";
import { isTamilCp } from "@/lib/typecraft/tamil";

/** Sets the selected glyph between spacing references (HH·H·OO / nn·n·oo) using live outlines. */
export function SpacingPreview({ glyph }: { glyph: GlyphRecord }) {
  const glyphs = useProject((s) => s.glyphs);
  const metrics = useProject((s) => s.metrics);
  const spaceWidth = useProject((s) => s.spaceWidth);
  const byCp = useMemo(() => {
    const m = new Map<number, GlyphRecord>();
    for (const g of Object.values(glyphs)) if (g.traced?.length && !m.has(g.unicode)) m.set(g.unicode, g);
    return m;
  }, [glyphs]);
  const ch = glyph.unicode;
  const isUpper = ch >= 0x41 && ch <= 0x5a;
  const isLower = ch >= 0x61 && ch <= 0x7a;
  const isTamil = isTamilCp(ch);
  const refs = isUpper ? [0x48, 0x48] : isLower ? [0x6e, 0x6e] : isTamil ? [0x0b95, 0x0bae] : [0x48, 0x6f];
  const refs2 = isUpper ? [0x4f, 0x4f] : isLower ? [0x6f, 0x6f] : isTamil ? [0x0ba4, 0x0b95] : [0x6f, 0x48];
  const seq: (GlyphRecord | null)[] = [...refs, -1, ...refs2].map((cp) => (cp === -1 ? glyph : byCp.get(cp) ?? null));

  let x = 0;
  const parts: { d: string; current: boolean }[] = [];
  for (const g of seq) {
    if (!g?.traced) { x += spaceWidth; continue; }
    const l = layoutGlyph(g.traced, g.params, g.isMark);
    parts.push({ d: toSvgD(l.contours, ([px, py]) => [px + x, -py], 0), current: g.id === glyph.id });
    x += l.advance;
  }
  const top = metrics.ascender + 40, h = top - metrics.descender + 80;
  return (
    <svg viewBox={`-40 ${-top} ${Math.max(x + 80, 1)} ${h}`} className="h-16 w-full" preserveAspectRatio="xMidYMid meet" aria-label="Spacing preview">
      <line x1={-40} x2={x + 40} y1={0} y2={0} className="stroke-guide-soft" strokeWidth={6} />
      {parts.map((p, i) => <path key={i} d={p.d} className={p.current ? "fill-proof" : "fill-ink"} />)}
    </svg>
  );
}
