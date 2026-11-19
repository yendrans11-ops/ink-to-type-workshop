import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CloudBar, useCloudSave } from "@/components/typecraft/CloudFonts";
import { DownloadOtfButton } from "@/components/typecraft/DownloadOtfButton";
import { GlyphDrawingCanvas } from "@/components/typecraft/GlyphDrawingCanvas";
import { GlyphTile, glyphThumbPath } from "@/components/typecraft/GlyphTile";
import { Loading } from "@/components/typecraft/EmptyProject";
import { strokesToTile, type Stroke } from "@/lib/typecraft/drawing";
import { FREE_EXPORT_LABEL, isFreeCp } from "@/lib/typecraft/exportTier";
import { useProject } from "@/lib/typecraft/store";
import { buildTemplateLayout } from "@/lib/typecraft/template";
import { retraceGlyph } from "@/lib/typecraft/tracer";
import { useFullExport } from "@/lib/typecraft/useFullExport";
import { useInstantFont } from "@/lib/typecraft/useInstantFont";
import { cn } from "@/lib/utils";

export const GRID_SETS = ["latin-upper", "latin-lower", "digits", "punctuation"] as const;
const FILTERS = [
  { id: "all", label: "All" },
  { id: "latin-upper", label: "A–Z" },
  { id: "latin-lower", label: "a–z" },
  { id: "digits", label: "0–9" },
  { id: "punctuation", label: "Punctuation" },
] as const;

export const Route = createFileRoute("/grid")({
  head: () => ({
    meta: [
      { title: "Character grid — draw A–Z, a–z, 0–9 | TypeCraft" },
      { name: "description", content: "Every English letter, figure and punctuation mark in one grid. Tap a tile, draw it with Apple Pencil, and type with your font instantly." },
      { property: "og:title", content: "Character grid — draw your whole alphabet | TypeCraft" },
      { property: "og:description", content: "Tap a character, draw it, save — the tile and the live preview font update straight away." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: GridPage,
});

function GridPage() {
  const hydrated = useProject((s) => s.hydrated);
  const glyphs = useProject((s) => s.glyphs);
  const metrics = useProject((s) => s.metrics);
  const slots = useMemo(() => buildTemplateLayout([...GRID_SETS], "").slots, []);
  const [filter, setFilter] = useState<string>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [text, setText] = useState("Handwritten fonts, 0123 & more!");
  const { full } = useFullExport();
  const cloud = useCloudSave();
  const instant = useInstantFont();

  const shown = filter === "all" ? slots : slots.filter((s) => s.setId === filter);
  const drawn = slots.filter((s) => glyphThumbPath(glyphs[s.id])).length;
  const slot = slots.find((s) => s.id === openId) ?? null;
  const idx = slot ? slots.indexOf(slot) : -1;
  const step = (d: number) => {
    const next = slots[(idx + d + slots.length) % slots.length];
    if (next) setOpenId(next.id);
  };

  const save = useCallback(
    (strokes: Stroke[]) => {
      if (!slot) return;
      useProject.getState().drawGlyph(slot, strokesToTile(strokes), strokes);
      void retraceGlyph(slot.id);
      cloud.schedule();
    },
    [slot, cloud],
  );

  if (!hydrated) return <Loading />;

  return (
    <main className="mx-auto max-w-[1600px] space-y-5 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="font-display text-4xl leading-tight">Character grid</h1>
          <p className="text-sm text-muted-foreground">Tap a character to draw it. <span className="font-mono text-xs">{drawn} / {slots.length} drawn</span></p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <DownloadOtfButton />
          {!full && <span className="text-xs text-muted-foreground">Free: {FREE_EXPORT_LABEL}</span>}
        </div>
      </div>

      <CloudBar save={cloud} />

      <section className="space-y-2 rounded-lg border bg-card p-3" aria-label="Live preview">
        <Input value={text} onChange={(e) => setText(e.target.value)} className="h-11" aria-label="Preview text" />
        <p
          className="min-h-20 break-words rounded-md bg-sheet px-3 py-2 text-5xl leading-tight text-ink"
          style={{ fontFamily: `"${instant.family}", var(--font-sans)` }}
        >
          {text || " "}
        </p>
        <p className="text-xs text-muted-foreground">Letters you haven't drawn show in a standard font.</p>
      </section>

      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Character set">
        {FILTERS.map((f) => (
          <Button key={f.id} role="tab" aria-selected={filter === f.id} variant={filter === f.id ? "secondary" : "ghost"} className="h-11 shrink-0" onClick={() => setFilter(f.id)}>
            {f.label}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2" role="list" aria-label="Characters">
        {shown.map((s) => (
          <div role="listitem" key={s.id} className="min-w-0">
            <GlyphTile slot={s} glyph={glyphs[s.id]} metrics={metrics} locked={!full && !isFreeCp(s.cp)} onOpen={setOpenId} />
          </div>
        ))}
      </div>

      <Dialog open={!!slot} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className={cn("max-h-[96dvh] w-[min(96vw,1100px)] max-w-none overflow-y-auto p-4 sm:p-5")}>
          <DialogTitle className="sr-only">Draw {slot?.label}</DialogTitle>
          <DialogDescription className="sr-only">Draw the character on the pad, then save it.</DialogDescription>
          {slot && (
            <GlyphDrawingCanvas
              key={slot.id}
              slot={slot}
              glyph={glyphs[slot.id]}
              metrics={metrics}
              onSave={save}
              onPrev={() => step(-1)}
              onNext={() => step(1)}
              onClose={() => setOpenId(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
