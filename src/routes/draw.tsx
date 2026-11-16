import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Eraser, ListChecks, PenLine, Redo2, SkipForward, Trash2, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CharacterSheet, isDrawn } from "@/components/typecraft/CharacterSheet";
import { DrawPad, type DrawTool } from "@/components/typecraft/DrawPad";
import { Loading } from "@/components/typecraft/EmptyProject";
import { ParamSlider } from "@/components/typecraft/ParamSlider";
import { CHARSETS, formatCodepoint } from "@/lib/typecraft/charsets";
import { bboxOf } from "@/lib/typecraft/contours";
import { BRUSH_MAX, BRUSH_MIN, DEFAULT_BRUSH, strokesToTile, type Stroke } from "@/lib/typecraft/drawing";
import type { Metrics } from "@/lib/typecraft/font";
import { layoutGlyph } from "@/lib/typecraft/layout";
import { useProject, type GlyphRecord } from "@/lib/typecraft/store";
import { charText, isTamilCp } from "@/lib/typecraft/tamil";
import { buildTemplateLayout, type Slot } from "@/lib/typecraft/template";
import { tileToDataUrl } from "@/lib/typecraft/imageio";
import { retraceGlyph } from "@/lib/typecraft/tracer";
import { useCompiledFont } from "@/lib/typecraft/useCompiledFont";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/draw")({
  validateSearch: (s: Record<string, unknown>): { c?: string } => (typeof s.c === "string" ? { c: s.c } : {}),
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
  const [tool, setTool] = useState<DrawTool>("pen");
  const [brush, setBrush] = useState(DEFAULT_BRUSH);
  const [pencilOnly, setPencilOnly] = useState(false);
  const [ghost, setGhost] = useState(true);
  const [outline, setOutline] = useState(true);

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

  useEffect(() => {
    if (filter !== "all" && !sets.some((s) => s.id === filter)) setFilter("all");
  }, [sets, filter]);

  if (!hydrated) return <Loading />;

  const toggleSet = (id: string, on: boolean) => setCharsets(on ? [...charsetIds, id] : charsetIds.filter((x) => x !== id));

  return (
    <main className="mx-auto max-w-[1600px] space-y-4 px-4 py-5 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-proof">Draw</p>
          <h1 className="font-display text-3xl leading-tight sm:text-4xl">Draw your characters</h1>
        </div>
        <span className="font-mono text-xs text-muted-foreground">{drawnCount} / {slots.length} drawn</span>
        <Button asChild size="lg" variant={drawnCount ? "default" : "outline"}>
          <Link to="/export">Preview &amp; export <ArrowRight /></Link>
        </Button>
      </div>

      {!slot ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="font-display text-2xl">Pick some characters to draw</p>
          <p className="mt-2 text-sm text-muted-foreground">Choose English or Tamil character sets on the Template page.</p>
          <Button asChild className="mt-5"><Link to="/template">Choose character sets</Link></Button>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
          <CharacterEditor
            key={slot.id}
            slot={slot}
            glyph={glyphs[slot.id]}
            metrics={metrics}
            tool={tool}
            setTool={setTool}
            brush={brush}
            setBrush={setBrush}
            pencilOnly={pencilOnly}
            setPencilOnly={setPencilOnly}
            ghost={ghost}
            setGhost={setGhost}
            outline={outline}
            setOutline={setOutline}
            onPrev={() => go(-1)}
            onNext={() => go(1)}
            onNextEmpty={nextEmpty}
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
  brush: number;
  setBrush: (n: number) => void;
  pencilOnly: boolean;
  setPencilOnly: (b: boolean) => void;
  ghost: boolean;
  setGhost: (b: boolean) => void;
  outline: boolean;
  setOutline: (b: boolean) => void;
  onPrev: () => void;
  onNext: () => void;
  onNextEmpty: () => void;
  position: string;
};

function CharacterEditor({ slot, glyph, metrics, tool, setTool, brush, setBrush, pencilOnly, setPencilOnly, ghost, setGhost, outline, setOutline, onPrev, onNext, onNextEmpty, position }: EditorProps) {
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

  const update = (list: Stroke[]) => {
    setStrokes(list);
    if (pending.current) clearTimeout(pending.current.t);
    pending.current = { list, t: setTimeout(flush, 350) };
  };

  const undo = () => {
    const last = strokes[strokes.length - 1];
    if (!last) return;
    setRedo([...redo, last]);
    update(strokes.slice(0, -1));
  };
  const redoOne = () => {
    const s = redo[redo.length - 1];
    if (!s) return;
    setRedo(redo.slice(0, -1));
    update([...strokes, s]);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, [contenteditable]")) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redoOne();
        else undo();
      } else if (e.key === "ArrowRight") onNext();
      else if (e.key === "ArrowLeft") onPrev();
      else if (e.key === "e") setTool("eraser");
      else if (e.key === "p") setTool("pen");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const laid = glyph?.traced?.length && !glyph.empty ? glyph.traced : null;
  const bb = laid ? bboxOf(laid) : null;
  const tamil = isTamilCp(slot.cp);

  return (
    <section className="min-w-0 space-y-3" aria-label={`Drawing ${slot.label}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon" variant="outline" className="size-11" onClick={onPrev} aria-label="Previous character"><ArrowLeft /></Button>
        <div className="flex min-w-0 items-baseline gap-2 rounded-md border bg-card px-3 py-1.5">
          <span className="font-display text-3xl leading-none">{slot.label}</span>
          <span className="font-mono text-[0.68rem] text-muted-foreground">{formatCodepoint(slot.cp)} · {position}</span>
        </div>
        <Button size="icon" variant="outline" className="size-11" onClick={onNext} aria-label="Next character"><ArrowRight /></Button>
        <Button variant="ghost" className="h-11" onClick={onNextEmpty}><SkipForward /> Next empty</Button>
        {scanned && <Badge variant="secondary">From scan — drawing replaces it</Badge>}
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2">
        <ToggleGroup type="single" value={tool} onValueChange={(v) => v && setTool(v as DrawTool)} variant="outline" aria-label="Tool">
          <ToggleGroupItem value="pen" className="h-11 px-3" aria-label="Pen"><PenLine /> Pen</ToggleGroupItem>
          <ToggleGroupItem value="eraser" className="h-11 px-3" aria-label="Eraser"><Eraser /> Eraser</ToggleGroupItem>
        </ToggleGroup>
        <ParamSlider label="Nib" value={brush} min={BRUSH_MIN} max={BRUSH_MAX} step={5} unit=" u" onChange={setBrush} className="w-48 min-w-[10rem] flex-1 sm:flex-none" />
        <div className="flex gap-1">
          <Button size="icon" variant="outline" className="size-11" onClick={undo} disabled={!strokes.length} aria-label="Undo"><Undo2 /></Button>
          <Button size="icon" variant="outline" className="size-11" onClick={redoOne} disabled={!redo.length} aria-label="Redo"><Redo2 /></Button>
          <Button size="icon" variant="outline" className="size-11" onClick={() => { setRedo([]); update([]); }} disabled={!strokes.length && !glyph?.source} aria-label="Clear character"><Trash2 /></Button>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[min(100%,calc(100dvh-15rem))] min-w-[18rem]">
        <DrawPad
          strokes={strokes}
          onStroke={(s) => { setRedo([]); update([...strokes, s]); }}
          tool={tool}
          brush={brush}
          pencilOnly={pencilOnly}
          onPencil={() => !pencilOnly && setPencilOnly(true)}
          metrics={metrics}
          ghost={ghost ? charText(slot.cp) : null}
          ghostTamil={tamil}
          underlay={underlay}
          outline={outline ? laid : null}
          bearings={outline && bb && !slot.isMark && glyph ? { left: bb.xMin - glyph.params.lsb, right: bb.xMax + glyph.params.rsb } : null}
        />
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        <label className="flex min-h-11 items-center gap-2"><Switch checked={pencilOnly} onCheckedChange={setPencilOnly} /> Apple Pencil only <span className="text-xs text-muted-foreground">(fingers won't draw)</span></label>
        <label className="flex min-h-11 items-center gap-2"><Switch checked={ghost} onCheckedChange={setGhost} /> Guide letter</label>
        <label className="flex min-h-11 items-center gap-2"><Switch checked={outline} onCheckedChange={setOutline} /> Font outline &amp; spacing</label>
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
  const font = useCompiledFont(400);
  const [text, setText] = useState<string | null>(null);
  const value = text ?? (tamil ? "தமிழ் கையெழுத்து" : "Handwriting 2026");
  return (
    <section className="space-y-2 rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Your font</h2>
        <span className="font-mono text-[0.68rem] text-muted-foreground">{font ? `${font.drawnCount} glyphs` : "building…"}</span>
      </div>
      <div className={cn("flex min-h-28 items-center gap-4 overflow-hidden rounded-md bg-sheet px-3 py-2 text-ink")} style={{ fontFamily: font ? `"${font.family}", var(--font-sans)` : undefined }}>
        <span className="text-6xl leading-none">{current}</span>
        <span className="min-w-0 break-words text-3xl leading-tight">{value || " "}</span>
      </div>
      <Input value={value} onChange={(e) => setText(e.target.value)} aria-label="Preview text" className="h-11" />
    </section>
  );
}
