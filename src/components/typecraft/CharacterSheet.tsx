// The on-screen character template sheet: every character of the project in a box with the same guides as the pad.
import { memo, useMemo } from "react";
import { Check } from "lucide-react";
import { toSvgD } from "@/lib/typecraft/contours";
import { unitsToPadY } from "@/lib/typecraft/drawing";
import type { Metrics } from "@/lib/typecraft/font";
import type { GlyphRecord } from "@/lib/typecraft/store";
import type { Slot } from "@/lib/typecraft/template";
import { TILE_ASCENDER, UNITS_PER_EM } from "@/lib/typecraft/trace";
import { cn } from "@/lib/utils";

export const isDrawn = (g: GlyphRecord | undefined) => !!g?.traced?.length && !g.empty;

const U = UNITS_PER_EM;

const Cell = memo(function Cell({ slot, glyph, metrics, current, onSelect }: { slot: Slot; glyph: GlyphRecord | undefined; metrics: Metrics; current: boolean; onSelect: (id: string) => void }) {
  const d = useMemo(() => (glyph?.traced?.length && !glyph.empty ? toSvgD(glyph.traced, ([x, y]) => [x, TILE_ASCENDER - y], 0) : ""), [glyph?.traced, glyph?.empty]);
  const drawn = !!d;
  return (
    <button
      type="button"
      onClick={() => onSelect(slot.id)}
      aria-current={current || undefined}
      aria-label={`${slot.label}${drawn ? ", drawn" : ", not drawn"}`}
      className={cn("group flex min-w-0 flex-col gap-0.5 rounded-md p-1 text-left transition-colors hover:bg-accent", current && "bg-accent ring-2 ring-proof")}
    >
      <span className="flex items-center justify-between gap-1 px-0.5 text-[0.7rem] leading-none text-muted-foreground">
        <span className="truncate">{slot.label}</span>
        {drawn && <Check className="size-3 shrink-0 text-proof" />}
      </span>
      <svg viewBox={`0 0 ${U} ${U}`} className="aspect-square w-full rounded-sm border bg-sheet">
        {[metrics.capHeight, metrics.xHeight].map((v) => (
          <line key={v} x1={0} x2={U} y1={unitsToPadY(v) * U} y2={unitsToPadY(v) * U} className="stroke-guide-soft" strokeWidth={10} strokeDasharray="30 30" />
        ))}
        <line x1={0} x2={U} y1={unitsToPadY(0) * U} y2={unitsToPadY(0) * U} className="stroke-guide" strokeWidth={14} />
        {drawn ? (
          <path d={d} className="fill-ink" />
        ) : (
          <text x={U / 2} y={unitsToPadY(0) * U} textAnchor="middle" fontSize={620} className="fill-foreground/10" style={{ fontFamily: "var(--font-sans)" }}>
            {slot.label}
          </text>
        )}
      </svg>
    </button>
  );
});

export function CharacterSheet({ slots, glyphs, metrics, currentId, onSelect, className }: { slots: Slot[]; glyphs: Record<string, GlyphRecord>; metrics: Metrics; currentId: string | null; onSelect: (id: string) => void; className?: string }) {
  return (
    <div className={cn("grid grid-cols-[repeat(auto-fill,minmax(4.25rem,1fr))] gap-1", className)} role="list" aria-label="Character sheet">
      {slots.map((s) => (
        <div role="listitem" key={s.id} className="min-w-0">
          <Cell slot={s} glyph={glyphs[s.id]} metrics={metrics} current={s.id === currentId} onSelect={onSelect} />
        </div>
      ))}
    </div>
  );
}
