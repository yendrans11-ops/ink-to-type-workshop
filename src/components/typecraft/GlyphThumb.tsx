import { memo, useMemo } from "react";
import { toSvgD } from "@/lib/typecraft/contours";
import type { Metrics } from "@/lib/typecraft/font";
import { layoutGlyph } from "@/lib/typecraft/layout";
import type { GlyphRecord } from "@/lib/typecraft/store";
import { cn } from "@/lib/utils";

export const GlyphThumb = memo(function GlyphThumb({ glyph, metrics, className, showBaseline = true }: { glyph: GlyphRecord; metrics: Metrics; className?: string; showBaseline?: boolean }) {
  const laid = useMemo(() => (glyph.traced ? layoutGlyph(glyph.traced, glyph.params, glyph.isMark) : null), [glyph.traced, glyph.params, glyph.isMark]);
  const top = metrics.ascender + 60;
  const bottom = metrics.descender - 60;
  const h = top - bottom;
  const bb = laid?.bbox;
  const x0 = Math.min(0, bb?.xMin ?? 0) - 40;
  const x1 = Math.max(laid?.advance ?? 600, bb?.xMax ?? 0) + 40;
  const w = Math.max(x1 - x0, h * 0.6);
  const cx = (x0 + x1) / 2;
  const d = laid ? toSvgD(laid.contours, ([x, y]) => [x, -y], 0) : "";
  return (
    <svg viewBox={`${cx - w / 2} ${-top} ${w} ${h}`} className={cn("block", className)} aria-hidden>
      {showBaseline && <line x1={cx - w / 2} x2={cx + w / 2} y1={0} y2={0} className="stroke-guide-soft" strokeWidth={h / 120} />}
      {d && <path d={d} className="fill-ink" />}
    </svg>
  );
});
