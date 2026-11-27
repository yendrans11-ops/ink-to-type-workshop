// A grid tile: the character's SVG thumbnail, drawn straight from its pen strokes (so it updates the moment you save).
import { memo, useMemo } from "react";
import { Check, Lock } from "lucide-react";
import { toSvgD } from "@/lib/typecraft/contours";
import { strokeOutline, unitsToPadY, CANVAS_HEADROOM, CANVAS_SIDE_PAD } from "@/lib/typecraft/drawing";
import type { Metrics } from "@/lib/typecraft/font";
import type { GlyphRecord } from "@/lib/typecraft/store";
import type { Slot } from "@/lib/typecraft/template";
import { TILE_ASCENDER, UNITS_PER_EM } from "@/lib/typecraft/trace";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FittedGlyphGuide } from "./FittedGlyphGuide";

const U = UNITS_PER_EM;

export function glyphThumbPath(g: GlyphRecord | undefined): string {
  if (!g) return "";
  const strokes = g.strokes ?? [];
  if (strokes.length && !strokes.some((s) => s.erase)) {
    return strokes
      .map((s) => strokeOutline(s))
      .filter((poly) => poly.length > 2)
      .map((poly) => "M" + poly.map(([x, y]) => `${Math.round(x * U)} ${Math.round(y * U)}`).join("L") + "Z")
      .join("");
  }
  if (g.traced?.length && !g.empty) return toSvgD(g.traced, ([x, y]) => [x, TILE_ASCENDER - y], 0);
  return "";
}

type Props = { slot: Slot; glyph: GlyphRecord | undefined; metrics: Metrics; locked?: boolean; onOpen: (id: string) => void };

export const GlyphTile = memo(function GlyphTile({ slot, glyph, metrics, locked, onOpen }: Props) {
  const d = useMemo(() => glyphThumbPath(glyph), [glyph]);
  const drawn = !!d;
  return (
    <Button
      variant="ghost"
      type="button"
      onClick={() => onOpen(slot.id)}
      aria-label={`${slot.label}${drawn ? ", drawn" : ", not drawn"}${locked ? ", included with the upgrade" : ""}`}
      className="group h-auto w-full min-h-11 min-w-0 flex-col gap-1 overflow-hidden rounded-lg border bg-card p-1.5 text-left transition-[transform,box-shadow] active:scale-[0.97] hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-proof [&>svg]:size-auto [&>svg]:w-full"
    >
      <span className="flex w-full min-w-0 items-center justify-between gap-1 px-0.5 font-mono text-[0.7rem] leading-none text-muted-foreground">
        <span className="truncate">{slot.label}</span>
        <span className="flex items-center gap-1">
          {locked && drawn && <Lock className="size-3" aria-hidden />}
          {drawn && <Check className="size-3.5 text-proof" aria-hidden />}
        </span>
      </span>
      <svg viewBox={`${-CANVAS_SIDE_PAD} ${-CANVAS_HEADROOM} ${U + CANVAS_HEADROOM} ${U + CANVAS_HEADROOM}`} className={cn("aspect-square h-auto w-full shrink-0 overflow-hidden rounded-md bg-sheet", !drawn && "opacity-80")} aria-hidden>
        {[metrics.capHeight, metrics.xHeight].map((v) => (
          <line key={v} x1={-CANVAS_SIDE_PAD} x2={-CANVAS_SIDE_PAD + U + CANVAS_HEADROOM} y1={unitsToPadY(v) * U} y2={unitsToPadY(v) * U} className="stroke-guide-soft" strokeWidth={8} strokeDasharray="28 28" />
        ))}
        <line x1={-CANVAS_SIDE_PAD} x2={-CANVAS_SIDE_PAD + U + CANVAS_HEADROOM} y1={unitsToPadY(0) * U} y2={unitsToPadY(0) * U} className="stroke-guide" strokeWidth={12} />
        {drawn ? (
          <path d={d} className="fill-ink" fillRule="nonzero" />
        ) : (
          <FittedGlyphGuide text={slot.label} baseline={unitsToPadY(0) * U} fontSize={600} className="fill-foreground/10" />
        )}
      </svg>
    </Button>
  );
});
