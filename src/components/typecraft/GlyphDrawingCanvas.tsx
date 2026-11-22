// Draw one character with Apple Pencil, finger or mouse, then save it into the project.
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Brush, Feather, Eraser, PenLine, Redo2, Save, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DrawPad, type DrawTool } from "@/components/typecraft/DrawPad";
import { formatCodepoint } from "@/lib/typecraft/charsets";
import { BRUSH_MAX, BRUSH_MIN, DEFAULT_BRUSH, DEFAULT_SMOOTH, type Stroke } from "@/lib/typecraft/drawing";
import type { Metrics } from "@/lib/typecraft/font";
import type { GlyphRecord } from "@/lib/typecraft/store";
import { charText, isTamilCp } from "@/lib/typecraft/tamil";
import type { Slot } from "@/lib/typecraft/template";

import { usePenSettings } from "@/lib/typecraft/penSettings";

const PENCIL_KEY = "typecraft-pencil-only";

type Props = {
  slot: Slot;
  glyph: GlyphRecord | undefined;
  metrics: Metrics;
  onSave: (strokes: Stroke[]) => void;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
};

export function GlyphDrawingCanvas({ slot, glyph, metrics, onSave, onPrev, onNext, onClose }: Props) {
  const [strokes, setStrokes] = useState<Stroke[]>(() => glyph?.strokes ?? []);
  const [redo, setRedo] = useState<Stroke[]>([]);
  const [tool, setTool] = useState<DrawTool>("pen");
  const { brush, setBrush, smooth, setSmooth, stabilization, setStabilization, penStyle, setPenStyle } = usePenSettings();
  const [pencilOnly, setPencilOnly] = useState(false);
  const [ghost, setGhost] = useState(true);
  const [dirty, setDirty] = useState(false);

  useEffect(() => setPencilOnly(localStorage.getItem(PENCIL_KEY) === "1"), []);
  const setPencil = (b: boolean) => {
    setPencilOnly(b);
    localStorage.setItem(PENCIL_KEY, b ? "1" : "0");
  };

  const change = (next: Stroke[]) => { setStrokes(next); setDirty(true); };
  const add = (s: Stroke) => { setRedo([]); change([...strokes, s]); };
  const undo = () => { const last = strokes[strokes.length - 1]; if (!last) return; setRedo([...redo, last]); change(strokes.slice(0, -1)); };
  const redoOne = () => { const s = redo[redo.length - 1]; if (!s) return; setRedo(redo.slice(0, -1)); change([...strokes, s]); };
  const save = () => { onSave(strokes); setDirty(false); };
  const saveAndNext = () => { if (dirty) onSave(strokes); onNext(); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || (e.target as HTMLElement)?.closest("input, textarea, select, button, [role=slider], [contenteditable]")) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redoOne(); else undo(); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
      else if (e.key === "e") setTool("eraser");
      else if (e.key === "p") setTool("pen");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="flex min-h-0 flex-col gap-3 md:flex-row">
      <div className="mx-auto w-full max-w-[min(100%,calc(100dvh-13rem))] md:mx-0 md:flex-1">
        <DrawPad
          strokes={strokes}
          onStroke={add}
          tool={tool}
          brush={brush}
          smooth={smooth}
          stabilization={stabilization}
          penStyle={penStyle}
          pencilOnly={pencilOnly}
          onPencil={() => !pencilOnly && setPencil(true)}
          metrics={metrics}
          ghost={ghost ? charText(slot.cp) : null}
          ghostTamil={isTamilCp(slot.cp)}
        />
      </div>

      <div className="flex flex-col gap-3 md:w-56 md:shrink-0">
        <div className="flex items-center gap-2">
          <Button size="icon" variant="outline" className="size-11" onClick={onPrev} aria-label="Previous character"><ArrowLeft /></Button>
          <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 overflow-hidden rounded-md border bg-card px-1 py-1.5">
            <span className="font-display text-3xl leading-none">{slot.label}</span>
            <span className="max-w-full break-words whitespace-normal text-center font-mono text-[0.68rem] text-muted-foreground">{formatCodepoint(slot.cp)}</span>
          </div>
          <Button size="icon" variant="outline" className="size-11" onClick={onNext} aria-label="Next character"><ArrowRight /></Button>
        </div>

        <ToggleGroup type="single" value={tool} onValueChange={(v) => v && setTool(v as DrawTool)} variant="outline" aria-label="Tool" className="w-full">
          <ToggleGroupItem value="pen" className="h-11 flex-1" aria-label="Pen"><PenLine /> Pen</ToggleGroupItem>
          <ToggleGroupItem value="eraser" className="h-11 flex-1" aria-label="Eraser"><Eraser /> Eraser</ToggleGroupItem>
        </ToggleGroup>

        <ToggleGroup type="single" value={penStyle} onValueChange={(v) => { if (v === "pen" || v === "brush" || v === "calligraphy") { setPenStyle(v); setTool("pen"); } }} variant="outline" aria-label="Pen style" className="w-full">
          <ToggleGroupItem value="pen" className="h-11 flex-1" aria-label="Round pen" title="Round pen"><PenLine /></ToggleGroupItem>
          <ToggleGroupItem value="brush" className="h-11 flex-1" aria-label="Brush pen" title="Brush pen"><Brush /></ToggleGroupItem>
          <ToggleGroupItem value="calligraphy" className="h-11 flex-1" aria-label="Calligraphy pen" title="Calligraphy pen"><Feather /></ToggleGroupItem>
        </ToggleGroup>

        <div className="space-y-2 px-1">
          <div className="flex justify-between text-sm"><span className="font-medium">Nib</span><span className="font-mono text-xs tabular-nums text-muted-foreground">{brush} u</span></div>
          <Slider value={[brush]} min={BRUSH_MIN} max={BRUSH_MAX} step={5} onValueChange={([v]) => v !== undefined && setBrush(v)} aria-label="Nib size" />
        </div>

        <div className="space-y-2 px-1"><span className="text-sm font-medium">Smoothing</span><Slider value={[smooth]} min={0} max={1} step={0.05} onValueChange={([v]) => v !== undefined && setSmooth(v)} aria-label="Smoothing" /></div>
        <div className="space-y-2 px-1">
          <div className="flex justify-between text-sm"><span className="font-medium">Stabilization</span><span className="font-mono text-xs tabular-nums text-muted-foreground">{Math.round(stabilization * 100)}%</span></div>
          <Slider value={[stabilization]} min={0} max={1} step={0.05} onValueChange={([v]) => v !== undefined && setStabilization(v)} aria-label="Pencil stabilization" />
        </div>

        <div className="flex gap-1">
          <Button size="icon" variant="outline" className="size-11 flex-1" onClick={undo} disabled={!strokes.length} aria-label="Undo"><Undo2 /></Button>
          <Button size="icon" variant="outline" className="size-11 flex-1" onClick={redoOne} disabled={!redo.length} aria-label="Redo"><Redo2 /></Button>
          <Button size="icon" variant="outline" className="size-11 flex-1" onClick={() => { setRedo([]); change([]); }} disabled={!strokes.length} aria-label="Clear character"><Trash2 /></Button>
        </div>

        <label className="flex min-h-11 items-center justify-between gap-2 px-1 text-sm">Apple Pencil only <Switch checked={pencilOnly} onCheckedChange={setPencil} /></label>
        <label className="flex min-h-11 items-center justify-between gap-2 px-1 text-sm">Guide letter <Switch checked={ghost} onCheckedChange={setGhost} /></label>

        <div className="mt-auto flex flex-col gap-2">
          <Button className="h-11" onClick={save} disabled={!dirty}><Save /> Save</Button>
          <Button className="h-11" variant="secondary" onClick={saveAndNext}>{dirty ? "Save & next" : "Next"} <ArrowRight /></Button>
          <Button className="h-11" variant="ghost" onClick={onClose}>{dirty ? "Discard changes" : "Close"}</Button>
        </div>
      </div>
    </div>
  );
}
