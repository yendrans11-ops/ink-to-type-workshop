import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Brush, Feather, Eraser, Lasso, ListChecks, PenLine, Redo2, SkipForward, Trash2, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CharacterSheet, isDrawn } from "@/components/typecraft/CharacterSheet";
import { DrawPad, type DrawTool } from "@/components/typecraft/DrawPad";
import { InstallProfileButton } from "@/components/typecraft/InstallProfileButton";
import { Loading } from "@/components/typecraft/EmptyProject";
import { CHARSETS, formatCodepoint } from "@/lib/typecraft/charsets";
import { bboxOf } from "@/lib/typecraft/contours";
import { BRUSH_MAX, BRUSH_MIN, DEFAULT_BRUSH, DEFAULT_SMOOTH, strokesToTile, type Stroke } from "@/lib/typecraft/drawing";
import type { Metrics } from "@/lib/typecraft/font";
import { layoutGlyph } from "@/lib/typecraft/layout";
import { flushProjectWrite, useProject, type GlyphRecord } from "@/lib/typecraft/store";
import { charText, isTamilCp } from "@/lib/typecraft/tamil";
import { buildTemplateLayout, type Slot } from "@/lib/typecraft/template";
import { tileToDataUrl } from "@/lib/typecraft/imageio";
import { retraceGlyph } from "@/lib/typecraft/tracer";
import { useCompiledFont } from "@/lib/typecraft/useCompiledFont";
import { useInstantFont } from "@/lib/typecraft/useInstantFont";
import { cn } from "@/lib/utils";

import {
  DEFAULT_LASSO_THRESHOLD,
  LASSO_THRESHOLD_MAX,
  LASSO_THRESHOLD_MIN,
  type CloseMode,
} from "@/lib/typecraft/lasso";
import { LAZY_RADIUS_MAX, LAZY_RADIUS_MIN, usePenSettings, type PenStyle } from "@/lib/typecraft/penSettings";

export const Route = createFileRoute("/draw")({
  validateSearch: (s: Record<string, unknown>): { c?: string } => (typeof s["c"] === "string" ? { c: s["c"] } : {}),
  head: () => ({
    meta: [
      { title: "Draw your font with Apple Pencil — TypeCraft" },
      { name: "description", content: "Draw every Tamil or English character on a measured template with Apple Pencil, preview it as a real font and export TTF or OTF." },
      { property: "og:title", content: "Draw your font with Apple Pencil — TypeCraft" },
      { property: "og:description", content: "A character sheet with ascender, cap height, x-height, baseline and descender guides — draw, preview, export." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DrawPage,
});

function DrawPage() {
  const hydrated = useProject((s) => s.hydrated);
  const charsetIds = useProject((s) => s.charsetIds);
  const extraChars = useProject((s) => s.extraChars);
  const glyphs = useProject((s) => s.glyphs);
  const metrics = useProject((s) => s.metrics);
  const setCharsets = useProject((s) => s.setCharsets);
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/draw" });
  const layout = useMemo(() => buildTemplateLayout(charsetIds, extraChars), [charsetIds, extraChars]);
  const slots = layout.slots;

  const [selId, setSelId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const {
    tool,
    setTool,
    brush,
    setBrush,
    smooth,
    setSmooth,
    stabilization,
    setStabilization,
    penStyle,
    setPenStyle,
    lassoCloseMode,
    setLassoCloseMode,
    lassoThreshold,
    setLassoThreshold,
    lassoErase,
    setLassoErase,
    lazyEnabled,
    setLazyEnabled,
    lazyRadius,
    setLazyRadius,
  } = usePenSettings();
  const [pencilOnly, setPencilOnly] = useState(false);
  const [ghost, setGhost] = useState(true);
  const [guideOpacity, setGuideOpacity] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("typecraft-guide-opacity");
      if (saved === null) return 0.2;
      const n = Number(saved);
      return Number.isFinite(n) ? Math.max(0, Math.min(0.5, n)) : 0.2;
    } catch {
      return 0.2;
    }
  });
  const [outline, setOutline] = useState(true);

  const updateGuideOpacity = useCallback((val: number) => {
    const clamped = Math.max(0, Math.min(0.5, val));
    setGuideOpacity(clamped);
    try {
      localStorage.setItem("typecraft-guide-opacity", String(clamped));
    } catch {
      /* storage unavailable */
    }
  }, []);

  // Pick the starting character once: the one in the link, else the first one not drawn yet.
  useEffect(() => {
    if (!hydrated || selId || !slots.length) return;
    const st = useProject.getState();
    const first = slots.find((s) => s.id === search.c) ?? slots.find((s) => !isDrawn(st.glyphs[s.id])) ?? slots[0]!;
    setSelId(first.id);
  }, [hydrated, slots, selId, search.c]);

  const select = useCallback(
    (id: string) => {
      setSelId(id);
      void navigate({ search: { c: id }, replace: true });
    },
    [navigate],
  );

  const sets = useMemo(() => CHARSETS.filter((c) => charsetIds.includes(c.id)).concat(extraChars.trim() ? [{ id: "custom", title: "Extra", script: "Latin" as const, description: "", chars: [] }] : []), [charsetIds, extraChars]);
  const shown = filter === "all" ? slots : slots.filter((s) => s.setId === filter);
  const slot = slots.find((s) => s.id === selId) ?? null;
  const idx = slot ? slots.indexOf(slot) : -1;
  const drawnCount = slots.filter((s) => isDrawn(glyphs[s.id])).length;
  const go = (d: number) => {
    const next = slots[(idx + d + slots.length) % slots.length];
    if (next) select(next.id);
  };
  const nextEmpty = () => {
    for (let k = 1; k <= slots.length; k++) {
      const s = slots[(idx + k) % slots.length]!;
      if (!isDrawn(useProject.getState().glyphs[s.id])) return select(s.id);
    }
  };

  const prevSlot = slots.length ? slots[(idx - 1 + slots.length) % slots.length] : undefined;
  const nextSlot = slots.length ? slots[(idx + 1) % slots.length] : undefined;
  const setProgress = useMemo(() => {
    return sets.map((s) => {
      const setSlots = slots.filter((sl) => sl.setId === s.id);
      const done = setSlots.filter((sl) => isDrawn(glyphs[sl.id])).length;
      return { id: s.id, title: s.title, done, total: setSlots.length };
    });
  }, [sets, slots, glyphs]);
  const activeSetProgress = setProgress.find((s) => s.id === (filter !== "all" ? filter : slot?.setId)) ?? {
    id: "all",
    title: "Active set",
    done: drawnCount,
    total: slots.length,
  };
  const activePct = activeSetProgress.total ? Math.round((activeSetProgress.done / activeSetProgress.total) * 100) : 0;

  useEffect(() => {
    if (filter !== "all" && !sets.some((s) => s.id === filter)) setFilter("all");
  }, [sets, filter]);

  if (!hydrated) return <Loading />;

  const toggleSet = (id: string, on: boolean) => setCharsets(on ? [...charsetIds, id] : charsetIds.filter((x) => x !== id));

  return (
    <main className="mx-auto max-w-[1700px] space-y-4 px-3 py-3 sm:px-6 sm:py-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto font-display text-2xl sm:text-3xl leading-tight">Draw your characters</h1>
        <span className="font-mono text-xs text-muted-foreground">{drawnCount} / {slots.length} drawn</span>
        <InstallProfileButton label="Install on iPad" className="h-11" variant={drawnCount ? "default" : "outline"} />
        <Button asChild className="h-11" variant="outline">
          <Link to="/export">Preview &amp; export <ArrowRight /></Link>
        </Button>
      </div>

      {slots.length > 0 && (
        <section className="space-y-2 rounded-lg border bg-card px-3.5 py-2.5" aria-label="Character progress">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-medium text-foreground">
              {activeSetProgress.title}:{" "}
              <span className="font-mono text-muted-foreground">
                {activeSetProgress.done} / {activeSetProgress.total} completed ({activePct}%)
              </span>
            </span>
            <div className="flex flex-wrap gap-1.5">
              {setProgress.map((sp) => (
                <button
                  key={sp.id}
                  type="button"
                  onClick={() => setFilter(filter === sp.id ? "all" : sp.id)}
                  className={cn(
                    "rounded-full border px-2 py-0.5 font-mono text-[0.65rem] transition-colors",
                    sp.id === activeSetProgress.id ? "border-proof bg-proof/10 text-foreground" : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {sp.title} {sp.done}/{sp.total}
                </button>
              ))}
            </div>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={activePct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-proof transition-all duration-200" style={{ width: `${activePct}%` }} />
          </div>
        </section>
      )}

      {!slot ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="font-display text-2xl">Pick some characters to draw</p>
          <p className="mt-2 text-sm text-muted-foreground">Choose English or Tamil character sets on the Template page.</p>
          <Button asChild className="mt-5"><Link to="/template">Choose character sets</Link></Button>
        </div>
      ) : (
        <div className="grid gap-4 md:gap-5 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
          <CharacterEditor
            key={slot.id}
            slot={slot}
            glyph={glyphs[slot.id]}
            metrics={metrics}
            tool={tool}
            setTool={setTool}
            penStyle={penStyle}
            setPenStyle={setPenStyle}
            lassoCloseMode={lassoCloseMode}
            setLassoCloseMode={setLassoCloseMode}
            lassoThreshold={lassoThreshold}
            setLassoThreshold={setLassoThreshold}
            lassoErase={lassoErase}
            setLassoErase={setLassoErase}
            lazyEnabled={lazyEnabled}
            setLazyEnabled={setLazyEnabled}
            lazyRadius={lazyRadius}
            setLazyRadius={setLazyRadius}
            brush={brush}
            setBrush={setBrush}
            smooth={smooth}
            setSmooth={setSmooth}
            stabilization={stabilization}
            setStabilization={setStabilization}
            pencilOnly={pencilOnly}
            setPencilOnly={setPencilOnly}
            ghost={ghost}
            setGhost={setGhost}
            guideOpacity={guideOpacity}
            setGuideOpacity={updateGuideOpacity}
            outline={outline}
            setOutline={setOutline}
            onPrev={() => go(-1)}
            onNext={() => go(1)}
            onNextEmpty={nextEmpty}
            prevLabel={prevSlot?.label}
            nextLabel={nextSlot?.label}
            position={`${idx + 1} / ${slots.length}`}
          />

          <aside className="min-w-0 space-y-4">
            <Measurements glyph={glyphs[slot.id]} metrics={metrics} />
            <LivePreview tamil={isTamilCp(slot.cp)} current={charText(slot.cp)} />

            <section className="space-y-3 rounded-lg border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Character sheet</h2>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button size="sm" variant="outline"><ListChecks /> Sets</Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-72 space-y-1 p-2">
                    {(["Latin", "Tamil"] as const).map((script) => (
                      <div key={script} className="space-y-1">
                        <p className="px-2 pt-1 font-mono text-[0.68rem] uppercase tracking-widest text-muted-foreground">{script === "Latin" ? "English" : "Tamil"}</p>
                        {CHARSETS.filter((c) => c.script === script).map((c) => (
                          <label key={c.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-accent">
                            <Checkbox checked={charsetIds.includes(c.id)} onCheckedChange={(v) => toggleSet(c.id, v === true)} />
                            <span className="flex-1 text-sm">{c.title}</span>
                            <span className="font-mono text-xs text-muted-foreground">{c.chars.length}</span>
                          </label>
                        ))}
                      </div>
                    ))}
                  </PopoverContent>
                </Popover>
              </div>
              <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
                <Button size="sm" variant={filter === "all" ? "secondary" : "ghost"} className="shrink-0" onClick={() => setFilter("all")}>All</Button>
                {sets.map((s) => (
                  <Button key={s.id} size="sm" variant={filter === s.id ? "secondary" : "ghost"} className="shrink-0" onClick={() => setFilter(s.id)}>{s.title}</Button>
                ))}
              </div>
              <CharacterSheet slots={shown} glyphs={glyphs} metrics={metrics} currentId={slot.id} onSelect={select} className="lg:max-h-[min(60vh,560px)] lg:overflow-y-auto lg:pr-1" />
            </section>
          </aside>
        </div>
      )}
    </main>
  );
}

type EditorProps = {
  slot: Slot;
  glyph: GlyphRecord | undefined;
  metrics: Metrics;
  tool: DrawTool;
  setTool: (t: DrawTool) => void;
  penStyle: PenStyle;
  setPenStyle: (style: PenStyle) => void;
  lassoCloseMode: CloseMode;
  setLassoCloseMode: (m: CloseMode) => void;
  lassoThreshold: number;
  setLassoThreshold: (n: number) => void;
  lassoErase: boolean;
  setLassoErase: (b: boolean) => void;
  lazyEnabled: boolean;
  setLazyEnabled: (b: boolean) => void;
  lazyRadius: number;
  setLazyRadius: (n: number) => void;
  brush: number;
  setBrush: (n: number) => void;
  smooth: number;
  setSmooth: (n: number) => void;
  stabilization: number;
  setStabilization: (n: number) => void;
  pencilOnly: boolean;
  setPencilOnly: (b: boolean) => void;
  ghost: boolean;
  setGhost: (b: boolean) => void;
  guideOpacity: number;
  setGuideOpacity: (n: number) => void;
  outline: boolean;
  setOutline: (b: boolean) => void;
  onPrev: () => void;
  onNext: () => void;
  onNextEmpty: () => void;
  prevLabel?: string | undefined;
  nextLabel?: string | undefined;
  position: string;
};

function CharacterEditor({
  slot,
  glyph,
  metrics,
  tool,
  setTool,
  penStyle,
  setPenStyle,
  lassoCloseMode,
  setLassoCloseMode,
  lassoThreshold,
  setLassoThreshold,
  lassoErase,
  setLassoErase,
  lazyEnabled,
  setLazyEnabled,
  lazyRadius,
  setLazyRadius,
  brush,
  setBrush,
  smooth,
  setSmooth,
  stabilization,
  setStabilization,
  pencilOnly,
  setPencilOnly,
  ghost,
  setGhost,
  guideOpacity,
  setGuideOpacity,
  outline,
  setOutline,
  onPrev,
  onNext,
  onNextEmpty,
  prevLabel,
  nextLabel,
  position,
}: EditorProps) {
  const [strokes, setStrokes] = useState<Stroke[]>(() => glyph?.strokes ?? []);
  const [redo, setRedo] = useState<Stroke[]>([]);
  const pending = useRef<{ t: ReturnType<typeof setTimeout>; list: Stroke[] } | null>(null);
  const scanned = !!glyph?.source && !glyph.strokes;
  const underlay = useMemo(() => (scanned && glyph?.source && !strokes.length ? tileToDataUrl(glyph.source) : null), [scanned, glyph?.source, strokes.length]);

  const commitNow = useCallback((list: Stroke[]) => {
    const st = useProject.getState();
    if (!list.length && !st.glyphs[slot.id]) return;
    st.drawGlyph(slot, strokesToTile(list), list);
    void retraceGlyph(slot.id);
  }, [slot]);

  const flush = useCallback(() => {
    const p = pending.current;
    if (!p) return;
    clearTimeout(p.t);
    pending.current = null;
    commitNow(p.list);
  }, [commitNow]);

  useEffect(() => flush, [flush]);

  const update = useCallback((list: Stroke[]) => {
    setStrokes(list);
    if (pending.current) clearTimeout(pending.current.t);
    pending.current = { list, t: setTimeout(flush, 350) };
  }, [flush]);

  const undo = useCallback(() => {
    const last = strokes[strokes.length - 1];
    if (!last) return;
    setRedo((r) => [...r, last]);
    update(strokes.slice(0, -1));
  }, [strokes, update]);

  const redoOne = useCallback(() => {
    const s = redo[redo.length - 1];
    if (!s) return;
    setRedo((r) => r.slice(0, -1));
    update([...strokes, s]);
  }, [redo, strokes, update]);

  const saveAndNavigate = useCallback((direction: "prev" | "next") => {
    if (pending.current) {
      clearTimeout(pending.current.t);
      const list = pending.current.list;
      pending.current = null;
      commitNow(list);
    } else {
      commitNow(strokes);
    }
    void flushProjectWrite();
    if (direction === "prev") onPrev();
    else onNext();
  }, [commitNow, strokes, onPrev, onNext]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || (e.target as HTMLElement)?.closest("input, textarea, select, button, [role=slider], [contenteditable]")) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redoOne();
        else undo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redoOne();
      } else if (e.key === "[" || e.key === "ArrowLeft") {
        e.preventDefault();
        saveAndNavigate("prev");
      } else if (e.key === "]" || e.key === "ArrowRight") {
        e.preventDefault();
        saveAndNavigate("next");
      } else if (e.key === "e" && !e.metaKey && !e.ctrlKey) {
        setTool("eraser");
      } else if (e.key === "p" && !e.metaKey && !e.ctrlKey) {
        setTool("pen");
      } else if (e.key === "l" && !e.metaKey && !e.ctrlKey) {
        setTool("lasso");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redoOne, saveAndNavigate, setTool]);

  const laid = glyph?.traced?.length && !glyph.empty ? glyph.traced : null;
  const bb = laid ? bboxOf(laid) : null;
  const tamil = isTamilCp(slot.cp);

  return (
    <section className="min-w-0 space-y-3" aria-label={`Drawing ${slot.label}`}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 items-baseline gap-2 rounded-md border bg-card px-3 py-1.5">
          <span className="font-display text-3xl leading-none">{slot.label}</span>
          <span className="font-mono text-[0.68rem] text-muted-foreground">{formatCodepoint(slot.cp)} · {position}</span>
        </div>
        <Button variant="ghost" className="h-11" onClick={onNextEmpty}><SkipForward /> Next empty</Button>
        <div className="ml-auto flex flex-wrap items-center gap-3 rounded-md border bg-card px-3 py-1.5">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
            <Switch checked={ghost} onCheckedChange={setGhost} aria-label="Guide" />
            <span>Guide</span>
          </label>
          <div className="flex items-center gap-2">
            <Slider
              value={[guideOpacity]}
              min={0}
              max={0.5}
              step={0.02}
              onValueChange={([v]) => v !== undefined && setGuideOpacity(v)}
              className="w-24 sm:w-28"
              aria-label="Guide opacity"
              disabled={!ghost}
            />
            <span className="w-8 font-mono text-xs tabular-nums text-muted-foreground">
              {Math.round(guideOpacity * 100)}%
            </span>
          </div>
        </div>
        {scanned && <Badge variant="secondary">From scan — drawing replaces it</Badge>}
      </div>

      <div className="flex flex-col gap-3 lg:flex-row-reverse lg:items-start">
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-2 lg:w-44 lg:shrink-0 lg:flex-col lg:items-stretch">
          <ToggleGroup type="single" value={tool} onValueChange={(v) => v && setTool(v as DrawTool)} variant="outline" aria-label="Tool" className="lg:flex-col lg:items-stretch">
            <ToggleGroupItem value="pen" className="h-11 px-3 lg:justify-start" aria-label="Pen"><PenLine /> Pen</ToggleGroupItem>
            <ToggleGroupItem value="eraser" className="h-11 px-3 lg:justify-start" aria-label="Eraser"><Eraser /> Eraser</ToggleGroupItem>
          </ToggleGroup>
          <div className="flex items-center gap-1 lg:flex-col lg:items-stretch">
            <ToggleGroup type="single" value={tool === "pen" ? penStyle : ""} onValueChange={(v) => { if (v === "pen" || v === "brush" || v === "calligraphy") { setPenStyle(v); setTool("pen"); } }} variant="outline" aria-label="Pen style" className="flex-1 lg:w-full">
              <ToggleGroupItem value="pen" className="h-11 flex-1" aria-label="Round pen" title="Round pen"><PenLine /></ToggleGroupItem>
              <ToggleGroupItem value="brush" className="h-11 flex-1" aria-label="Brush pen" title="Brush pen"><Brush /></ToggleGroupItem>
              <ToggleGroupItem value="calligraphy" className="h-11 flex-1" aria-label="Calligraphy pen" title="Calligraphy pen"><Feather /></ToggleGroupItem>
            </ToggleGroup>
            <Button
              type="button"
              variant={tool === "lasso" ? "default" : "outline"}
              className="h-11 gap-2 px-3 touch-manipulation"
              onClick={() => setTool("lasso")}
              aria-pressed={tool === "lasso"}
              aria-label="Lasso Fill"
              title="Lasso Fill (L)"
            >
              <Lasso className="size-4" />
              <span>Lasso</span>
            </Button>
          </div>
          {tool === "lasso" && (
            <div className="w-full space-y-2 rounded-md border bg-muted/30 p-2">
              <p className="font-mono text-[0.65rem] uppercase tracking-wider text-muted-foreground">Lasso close</p>
              <ToggleGroup
                type="single"
                value={lassoCloseMode}
                onValueChange={(v) => v && setLassoCloseMode(v as CloseMode)}
                variant="outline"
                aria-label="Lasso close mode"
                className="grid w-full grid-cols-3 lg:grid-cols-1"
              >
                <ToggleGroupItem value="far" className="h-11 px-2 text-xs">Close Far</ToggleGroupItem>
                <ToggleGroupItem value="off" className="h-11 px-2 text-xs">Close Off</ToggleGroupItem>
                <ToggleGroupItem value="always" className="h-11 px-2 text-xs">Close Always</ToggleGroupItem>
              </ToggleGroup>
              {lassoCloseMode === "far" && (
                <div className="space-y-1.5 pt-1">
                  <div className="flex justify-between text-xs"><span className="font-medium">Snap</span><span className="font-mono tabular-nums text-muted-foreground">{lassoThreshold} u</span></div>
                  <div className="flex min-h-11 items-center">
                    <Slider value={[lassoThreshold]} min={LASSO_THRESHOLD_MIN} max={LASSO_THRESHOLD_MAX} step={5} onValueChange={([v]) => v !== undefined && setLassoThreshold(v)} aria-label="Lasso snap distance" />
                  </div>
                </div>
              )}
              <Button
                type="button"
                variant={lassoErase ? "destructive" : "outline"}
                className="h-11 w-full gap-2 text-xs touch-manipulation"
                onClick={() => setLassoErase(!lassoErase)}
                aria-pressed={lassoErase}
              >
                <Eraser className="size-4" />
                <span>{lassoErase ? "Subtracting ink" : "Subtract (Erase)"}</span>
              </Button>
            </div>
          )}
          <div className="w-44 space-y-2 px-1 lg:w-auto">
            <div className="flex justify-between text-sm"><span className="font-medium">Nib</span><span className="font-mono text-xs tabular-nums text-muted-foreground">{brush} u</span></div>
            <Slider value={[brush]} min={BRUSH_MIN} max={BRUSH_MAX} step={5} onValueChange={([v]) => v !== undefined && setBrush(v)} aria-label="Nib size" />
            <div className="flex justify-between pt-2 text-sm"><span className="font-medium">Smoothing</span><span className="font-mono text-xs tabular-nums text-muted-foreground">{Math.round(smooth * 100)}%</span></div>
            <Slider value={[smooth]} min={0} max={1} step={0.05} onValueChange={([v]) => v !== undefined && setSmooth(v)} aria-label="Smoothing" />
            <div className="flex justify-between pt-2 text-sm"><span className="font-medium">Stabilization</span><span className="font-mono text-xs tabular-nums text-muted-foreground">{Math.round(stabilization * 100)}%</span></div>
            <Slider value={[stabilization]} min={0} max={1} step={0.05} onValueChange={([v]) => v !== undefined && setStabilization(v)} aria-label="Pencil stabilization" />
            <label className="flex min-h-11 cursor-pointer items-center justify-between gap-2 pt-1 text-sm font-medium">
              <span>Rubber band</span>
              <Switch checked={lazyEnabled} onCheckedChange={setLazyEnabled} aria-label="Lazy rubber band stabilizer" />
            </label>
            {lazyEnabled && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs"><span className="font-medium text-muted-foreground">Tether radius</span><span className="font-mono tabular-nums text-muted-foreground">{lazyRadius} u</span></div>
                <div className="flex min-h-11 items-center">
                  <Slider value={[lazyRadius]} min={LAZY_RADIUS_MIN} max={LAZY_RADIUS_MAX} step={5} onValueChange={([v]) => v !== undefined && setLazyRadius(v)} aria-label="Rubber band tether radius" />
                </div>
              </div>
            )}
            <div className="flex justify-between pt-2 text-sm"><span className="font-medium">Guide Opacity</span><span className="font-mono text-xs tabular-nums text-muted-foreground">{Math.round(guideOpacity * 100)}%</span></div>
            <Slider value={[guideOpacity]} min={0} max={0.5} step={0.02} onValueChange={([v]) => v !== undefined && setGuideOpacity(v)} aria-label="Guide letter opacity" disabled={!ghost} />
          </div>
          <div className="flex gap-1 lg:justify-between">
            <Button size="icon" variant="outline" className="size-11 lg:size-10" onClick={undo} disabled={!strokes.length} aria-label="Undo"><Undo2 /></Button>
            <Button size="icon" variant="outline" className="size-11 lg:size-10" onClick={redoOne} disabled={!redo.length} aria-label="Redo"><Redo2 /></Button>
            <Button size="icon" variant="outline" className="size-11 lg:size-10" onClick={() => { setRedo([]); update([]); }} disabled={!strokes.length && !glyph?.source} aria-label="Clear character"><Trash2 /></Button>
          </div>
        </div>

        {/* Wide Tablet Workspace with Anchored Side Navigation (>= 56px touch targets) */}
        <div className="mx-auto flex w-full min-w-0 max-w-[min(100%,calc(100dvh-7.5rem))] items-center justify-center gap-1.5 sm:gap-3 md:gap-4">
          <Button
            type="button"
            variant="outline"
            className="flex h-36 min-w-14 w-14 sm:h-48 sm:w-16 md:h-64 md:w-20 shrink-0 flex-col items-center justify-center gap-1.5 rounded-2xl border-2 bg-card/95 hover:bg-accent/90 active:scale-95 shadow-sm transition-all touch-manipulation px-1"
            onClick={() => saveAndNavigate("prev")}
            aria-label={`Previous character (${prevLabel ?? "previous"})`}
            title={`Previous character (${prevLabel ?? ""}) [Shortcut: []`}
          >
            <ArrowLeft className="size-5 sm:size-6 md:size-7" />
            <span className="font-display text-sm sm:text-base md:text-lg font-bold leading-none text-foreground truncate max-w-full">
              {prevLabel ?? ""}
            </span>
            <span className="text-[0.62rem] font-medium uppercase tracking-wider text-muted-foreground hidden sm:inline">
              Prev
            </span>
            <kbd className="hidden md:inline-flex items-center justify-center rounded border bg-muted/60 px-1 py-0.5 font-mono text-[0.62rem] text-muted-foreground">
              [
            </kbd>
          </Button>

          <div className="min-w-0 flex-1 max-w-[min(100%,calc(100dvh-7.5rem))]">
            <DrawPad
              strokes={strokes}
              onStroke={(s) => { setRedo([]); update([...strokes, s]); }}
              tool={tool}
              brush={brush}
              smooth={smooth}
              stabilization={stabilization}
              penStyle={penStyle}
              lassoCloseMode={lassoCloseMode}
              lassoThreshold={lassoThreshold}
              lassoErase={lassoErase}
              lazyEnabled={lazyEnabled}
              lazyRadius={lazyRadius}
              pencilOnly={pencilOnly}
              onPencil={() => !pencilOnly && setPencilOnly(true)}
              metrics={metrics}
              ghost={ghost ? charText(slot.cp) : null}
              ghostTamil={tamil}
              ghostOpacity={guideOpacity}
              underlay={underlay}
              outline={outline ? laid : null}
              bearings={outline && bb && !slot.isMark && glyph ? { left: bb.xMin - glyph.params.lsb, right: bb.xMax + glyph.params.rsb } : null}
              onUndo={undo}
              onRedo={redoOne}
              onToggleTool={() => setTool(tool === "pen" ? "eraser" : "pen")}
              onSwipePrev={() => saveAndNavigate("prev")}
              onSwipeNext={() => saveAndNavigate("next")}
            />
          </div>

          <Button
            type="button"
            variant="outline"
            className="flex h-36 min-w-14 w-14 sm:h-48 sm:w-16 md:h-64 md:w-20 shrink-0 flex-col items-center justify-center gap-1.5 rounded-2xl border-2 bg-card/95 hover:bg-accent/90 active:scale-95 shadow-sm transition-all touch-manipulation px-1"
            onClick={() => saveAndNavigate("next")}
            aria-label={`Next character (${nextLabel ?? "next"})`}
            title={`Next character (${nextLabel ?? ""}) [Shortcut: ]]`}
          >
            <ArrowRight className="size-5 sm:size-6 md:size-7" />
            <span className="font-display text-sm sm:text-base md:text-lg font-bold leading-none text-foreground truncate max-w-full">
              {nextLabel ?? ""}
            </span>
            <span className="text-[0.62rem] font-medium uppercase tracking-wider text-muted-foreground hidden sm:inline">
              Next
            </span>
            <kbd className="hidden md:inline-flex items-center justify-center rounded border bg-muted/60 px-1 py-0.5 font-mono text-[0.62rem] text-muted-foreground">
              ]
            </kbd>
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <label className="flex min-h-11 items-center gap-2"><Switch checked={pencilOnly} onCheckedChange={setPencilOnly} /> Apple Pencil only <span className="text-xs text-muted-foreground">(fingers won't draw)</span></label>
        <label className="flex min-h-11 items-center gap-2"><Switch checked={outline} onCheckedChange={setOutline} /> Font outline &amp; spacing</label>
        <span className="text-xs text-muted-foreground">2-finger tap: undo · 2-finger swipe: prev / next</span>
      </div>
    </section>
  );
}

function Measurements({ glyph, metrics }: { glyph: GlyphRecord | undefined; metrics: Metrics }) {
  const laid = useMemo(() => (glyph?.traced?.length && !glyph.empty ? layoutGlyph(glyph.traced, glyph.params, glyph.isMark) : null), [glyph]);
  const near = (v: number) => {
    const named: [string, number][] = [["ascender", metrics.ascender], ["cap height", metrics.capHeight], ["x-height", metrics.xHeight], ["baseline", 0], ["descender", metrics.descender]];
    const [name, at] = named.reduce((a, b) => (Math.abs(b[1] - v) < Math.abs(a[1] - v) ? b : a));
    const d = Math.round(v - at);
    return d === 0 ? `on ${name}` : `${Math.abs(d)} ${d > 0 ? "above" : "below"} ${name}`;
  };
  const rows: [string, string, string?][] = laid?.bbox
    ? [
      ["Width", `${laid.advance}`, "advance"],
      ["Left space", `${Math.round(glyph!.params.lsb)}`],
      ["Right space", `${Math.round(glyph!.params.rsb)}`],
      ["Top", `${Math.round(laid.bbox.yMax)}`, near(laid.bbox.yMax)],
      ["Bottom", `${Math.round(laid.bbox.yMin)}`, near(laid.bbox.yMin)],
    ]
    : [];
  return (
    <section className="space-y-2 rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Measurements</h2>
        {glyph && <Link to="/studio" className="text-xs text-muted-foreground underline-offset-2 hover:underline">Fine-tune in Studio</Link>}
      </div>
      {!glyph ? (
        <p className="text-xs text-muted-foreground">Draw the character — its size and spacing in font units appear here.</p>
      ) : !laid ? (
        <p className="font-mono text-xs text-muted-foreground">{glyph.traced === null ? "Tracing…" : "Nothing drawn yet"}</p>
      ) : (
        <dl className="grid grid-cols-[auto_auto_1fr] gap-x-3 gap-y-1 text-sm">
          {rows.map(([k, v, note]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="text-right font-mono tabular-nums">{v}</dd>
              <dd className="truncate text-xs text-muted-foreground">{note}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="border-t pt-2 font-mono text-[0.68rem] text-muted-foreground">
        Em 1000 · ascender {metrics.ascender} · cap {metrics.capHeight} · x {metrics.xHeight} · descender {metrics.descender}
      </p>
    </section>
  );
}

function LivePreview({ tamil, current }: { tamil: boolean; current: string }) {
  const font = useCompiledFont(150);
  // English letters show instantly from the pen strokes; Tamil needs the full font for its joined syllables.
  const instant = useInstantFont();
  const families = [!tamil && instant.ready ? `"${instant.family}"` : null, font ? `"${font.family}"` : null, "var(--font-sans)"].filter(Boolean).join(", ");
  const [text, setText] = useState<string | null>(null);
  const [caltEnabled, setCaltEnabled] = useState(true);
  const value = text ?? (tamil ? "தமிழ் கையெழுத்து" : "Handwriting 2026");
  return (
    <section className="space-y-2 rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Your font</h2>
        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-[0.7rem] text-muted-foreground" title="Human Handwriting Randomizer (calt)">
            <span>calt</span>
            <Switch checked={caltEnabled} onCheckedChange={setCaltEnabled} aria-label="Human Handwriting Randomizer (calt)" />
          </label>
          <span className="font-mono text-[0.68rem] text-muted-foreground">{font ? `${font.drawnCount} glyphs` : "building…"}</span>
        </div>
      </div>
      <div
        className={cn("flex min-h-28 items-center gap-4 overflow-hidden rounded-md bg-sheet px-3 py-2 text-ink")}
        style={{ fontFamily: families, fontFeatureSettings: caltEnabled ? '"calt" 1' : '"calt" 0' }}
      >
        <span className="text-6xl leading-none">{current}</span>
        <span className="min-w-0 break-words text-3xl leading-tight">{value || " "}</span>
      </div>
      <Input value={value} onChange={(e) => setText(e.target.value)} aria-label="Preview text" className="h-11" />
    </section>
  );
}
