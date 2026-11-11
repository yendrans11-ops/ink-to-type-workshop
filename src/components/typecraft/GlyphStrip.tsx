import { useEffect, useRef } from "react";
import { Check } from "lucide-react";
import { GlyphThumb } from "./GlyphThumb";
import { useProject } from "@/lib/typecraft/store";
import { cn } from "@/lib/utils";

export function GlyphStrip() {
  const order = useProject((s) => s.order);
  const glyphs = useProject((s) => s.glyphs);
  const metrics = useProject((s) => s.metrics);
  const selectedId = useProject((s) => s.selectedId);
  const batchMode = useProject((s) => s.batchMode);
  const batchIds = useProject((s) => s.batchIds);
  const select = useProject((s) => s.select);
  const toggleBatchId = useProject((s) => s.toggleBatchId);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(`[data-id="${selectedId}"]`)?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [selectedId]);

  return (
    <div ref={ref} className="scrollbar-thin flex gap-1.5 overflow-x-auto px-1 pb-1.5 pt-1" role="listbox" aria-label="Glyphs">
      {order.map((id) => {
        const g = glyphs[id];
        if (!g) return null;
        const active = id === selectedId;
        const inBatch = batchMode && batchIds.includes(id);
        return (
          <button
            key={id}
            data-id={id}
            role="option"
            aria-selected={active}
            onClick={() => {
              select(id);
              if (batchMode) toggleBatchId(id);
            }}
            className={cn(
              "relative flex w-16 shrink-0 flex-col items-center rounded-md border bg-card pb-1 transition-colors",
              active ? "border-foreground ring-1 ring-foreground" : "hover:border-foreground/40",
              g.empty && "border-dashed opacity-55",
              inBatch && "bg-proof/10",
            )}
          >
            <GlyphThumb glyph={g} metrics={metrics} className="h-14 w-full" />
            <span className="max-w-full truncate px-1 text-xs leading-none">{String.fromCodePoint(g.unicode)}</span>
            {inBatch && (
              <span className="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-proof text-proof-foreground">
                <Check className="size-3" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
