import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, Layers, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyProject, Loading } from "@/components/typecraft/EmptyProject";
import { GlyphCanvas } from "@/components/typecraft/GlyphCanvas";
import { GlyphStrip } from "@/components/typecraft/GlyphStrip";
import { ParamSlider } from "@/components/typecraft/ParamSlider";
import { SpacingPreview } from "@/components/typecraft/SpacingPreview";
import { SyllableSpacingEditor } from "@/components/typecraft/SyllableSpacingEditor";
import { countNodes } from "@/lib/typecraft/contours";
import { formatCodepoint, parseCodepointInput } from "@/lib/typecraft/charsets";
import { charText, isTamilCp } from "@/lib/typecraft/tamil";
import { layoutGlyph, type GlyphParams } from "@/lib/typecraft/layout";
import { targetIds, useProject } from "@/lib/typecraft/store";
import { debounced, retraceAll, retraceGlyph } from "@/lib/typecraft/tracer";

export const Route = createFileRoute("/studio")({
  head: () => ({
    meta: [
      { title: "Glyph Studio — TypeCraft" },
      { name: "description", content: "Adjust each handwritten glyph: metric lines, side bearings, scale, rotation, stroke weight and curve smoothing." },
      { property: "og:title", content: "Glyph Studio — TypeCraft" },
      { property: "og:description", content: "A touch-friendly editor for spacing and shaping every glyph in your handwriting font." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: StudioPage,
});

const RETRACE_KEYS: (keyof GlyphParams)[] = ["weight", "smoothing", "optimize"];

function StudioPage() {
  const hydrated = useProject((s) => s.hydrated);
  const order = useProject((s) => s.order);
  const glyphs = useProject((s) => s.glyphs);
  const selectedId = useProject((s) => s.selectedId);
  const metrics = useProject((s) => s.metrics);
  const preprocess = useProject((s) => s.preprocess);
  const spaceWidth = useProject((s) => s.spaceWidth);
  const batchMode = useProject((s) => s.batchMode);
  const batchIds = useProject((s) => s.batchIds);
  const tracing = useProject((s) => s.tracing);
  const { select, updateParams, resetParams, setMetrics, setSpaceWidth, setBatchMode, setBatchIds, setUnicode, setIsMark } = useProject.getState();
  const [showNodes, setShowNodes] = useState(false);
  const [showFill, setShowFill] = useState(true);
  const [showSource, setShowSource] = useState(true);
  const [cpText, setCpText] = useState("");

  const glyph = selectedId ? glyphs[selectedId] : order[0] ? glyphs[order[0]] : undefined;
  const laid = useMemo(() => (glyph ? layoutGlyph(glyph.traced ?? [], glyph.params, glyph.isMark) : null), [glyph]);

  useEffect(() => {
    if (glyph) setCpText(formatCodepoint(glyph.unicode));
  }, [glyph?.id, glyph?.unicode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Glyphs restored from storage keep their outlines; anything without one gets traced once.
  useEffect(() => {
    if (!hydrated) return;
    const pending = order.filter((id) => glyphs[id]?.source && !glyphs[id]?.traced);
    if (pending.length && !useProject.getState().tracing) void retraceAll(pending);
  }, [hydrated]); // eslint-disable-line react-hooks/exhaustive-deps

  const step = (dir: number) => {
    if (!glyph) return;
    const i = order.indexOf(glyph.id);
    const next = order[(i + dir + order.length) % order.length];
    if (next) select(next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, [role=slider]")) return;
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!hydrated) return <Loading />;
  if (!glyph || !laid) return <EmptyProject />;

  const targets = targetIds({ batchMode, batchIds, selectedId: glyph.id });
  const p = glyph.params;
  const set = (patch: Partial<GlyphParams>) => {
    updateParams(targets, patch);
    if (Object.keys(patch).some((k) => RETRACE_KEYS.includes(k as keyof GlyphParams))) {
      const ids = [...targets];
      debounced("glyph-retrace", () => void (ids.length === 1 && ids[0] ? retraceGlyph(ids[0]) : retraceAll(ids)), 300);
    }
  };
  const nodes = countNodes(laid.contours);

  const commitCp = () => {
    const cp = parseCodepointInput(cpText);
    if (cp === null) {
      toast.error("Enter a character, U+XXXX or a number");
      setCpText(formatCodepoint(glyph.unicode));
      return;
    }
    if (cp !== glyph.unicode) {
      const clash = Object.values(glyphs).find((g) => g.id !== glyph.id && g.unicode === cp);
      if (clash) toast.warning(`${formatCodepoint(cp)} is already used`, { description: "Only the first glyph for each character is exported." });
      setUnicode(glyph.id, cp);
    }
  };

  return (
    <main className="mx-auto max-w-[1600px] px-3 py-4 sm:px-6">
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <section className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => step(-1)} aria-label="Previous glyph"><ChevronLeft /></Button>
            <div className="min-w-0 px-1">
              <div className="flex items-baseline gap-2">
                <span className="font-display text-3xl leading-none">{charText(glyph.unicode)}</span>
                <span className="font-mono text-xs text-muted-foreground">{formatCodepoint(glyph.unicode)} · {glyph.name}</span>
              </div>
              <div className="font-mono text-[0.68rem] text-muted-foreground">
                advance {laid.advance} · {nodes.on} nodes{glyph.empty ? " · empty box" : ""}
              </div>
            </div>
            <Button variant="outline" size="icon" onClick={() => step(1)} aria-label="Next glyph"><ChevronRight /></Button>
            <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
              <ToggleLabel label="Scan" checked={showSource} onChange={setShowSource} />
              <ToggleLabel label="Fill" checked={showFill} onChange={setShowFill} />
              <ToggleLabel label="Nodes" checked={showNodes} onChange={setShowNodes} />
            </div>
          </div>
          <div className="h-[58vh] min-h-[380px]">
            <GlyphCanvas
              glyph={glyph}
              laid={laid}
              metrics={metrics}
              showNodes={showNodes}
              showFill={showFill}
              showSource={showSource}
              onParams={(patch) => updateParams([glyph.id], patch)}
              onMetrics={setMetrics}
            />
          </div>
          <SpacingPreview glyph={glyph} />
          <SyllableSpacingEditor />
        </section>

        <aside className="space-y-3 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:self-start lg:overflow-y-auto">
          <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Layers className="size-4 text-muted-foreground" />
              <div>
                <div className="text-sm font-medium">Batch edit</div>
                <div className="text-xs text-muted-foreground">{batchMode ? `${batchIds.length} selected — tap glyphs below` : "Change many glyphs at once"}</div>
              </div>
            </div>
            <Switch checked={batchMode} onCheckedChange={setBatchMode} aria-label="Batch edit" />
          </div>
          {batchMode && (
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" onClick={() => setBatchIds([...order])}>All</Button>
              <Button size="sm" variant="outline" onClick={() => setBatchIds(order.filter((id) => { const u = glyphs[id]?.unicode ?? 0; return u >= 0x61 && u <= 0x7a; }))}>Lowercase</Button>
              <Button size="sm" variant="outline" onClick={() => setBatchIds(order.filter((id) => { const u = glyphs[id]?.unicode ?? 0; return u >= 0x41 && u <= 0x5a; }))}>Uppercase</Button>
              <Button size="sm" variant="outline" onClick={() => setBatchIds(order.filter((id) => { const u = glyphs[id]?.unicode ?? 0; return isTamilCp(u); }))}>Tamil</Button>
              <Button size="sm" variant="ghost" onClick={() => setBatchIds([])}>None</Button>
            </div>
          )}

          <Tabs defaultValue="shape" className="rounded-lg border bg-card p-3">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="shape">Shape</TabsTrigger>
              <TabsTrigger value="spacing">Spacing</TabsTrigger>
              <TabsTrigger value="font">Font</TabsTrigger>
            </TabsList>
            <TabsContent value="shape" className="space-y-4 pt-3">
              <ParamSlider label="Scale" value={p.scale} min={0.3} max={2} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set({ scale: v })} />
              <ParamSlider label="Rotation" value={p.rotation} min={-30} max={30} step={0.5} unit="°" onChange={(v) => set({ rotation: v })} />
              <ParamSlider label="Vertical shift" hint="Moves the glyph off the baseline" value={p.offsetY} min={-400} max={400} step={2} onChange={(v) => set({ offsetY: v })} />
              <ParamSlider label="Stroke weight" hint="Thicken or thin the strokes" value={p.weight} min={-4} max={6} onChange={(v) => set({ weight: v })} />
              <ParamSlider label="Corner smoothing" value={p.smoothing ?? preprocess.smoothing} min={0} max={1.33} step={0.01} format={(v) => v.toFixed(2)} hint={p.smoothing === null ? "Using upload setting" : "Custom for this glyph"} onChange={(v) => set({ smoothing: v })} />
              <ParamSlider label="Curve simplify" value={p.optimize ?? preprocess.optimize} min={0} max={1} step={0.01} format={(v) => v.toFixed(2)} hint={p.optimize === null ? "Using upload setting" : "Custom for this glyph"} onChange={(v) => set({ optimize: v })} />
            </TabsContent>
            <TabsContent value="spacing" className="space-y-4 pt-3">
              <ParamSlider label="Left side bearing" value={p.lsb} min={-200} max={400} step={2} onChange={(v) => set({ lsb: v })} />
              <ParamSlider label="Right side bearing" value={p.rsb} min={-200} max={400} step={2} onChange={(v) => set({ rsb: v })} />
              <ParamSlider label="Horizontal shift" value={p.offsetX} min={-300} max={300} step={2} onChange={(v) => set({ offsetX: v })} />
              <div className="space-y-2 border-t pt-3">
                <Label htmlFor="cp">Character mapping</Label>
                <Input id="cp" value={cpText} onChange={(e) => setCpText(e.target.value)} onBlur={commitCp} onKeyDown={(e) => e.key === "Enter" && commitCp()} className="font-mono" />
                <p className="text-xs text-muted-foreground">Type a character, U+0B95 or a decimal code.</p>
              </div>
              <label className="flex items-center justify-between gap-3">
                <span>
                  <span className="block text-sm font-medium">Combining mark</span>
                  <span className="block text-xs text-muted-foreground">Zero width, attaches to the previous letter</span>
                </span>
                <Switch checked={glyph.isMark} onCheckedChange={(v) => setIsMark(glyph.id, v)} />
              </label>
            </TabsContent>
            <TabsContent value="font" className="space-y-4 pt-3">
              <p className="text-xs text-muted-foreground">These apply to the whole font. You can also drag the lines on the canvas.</p>
              <ParamSlider label="Ascender" value={metrics.ascender} min={metrics.capHeight} max={1000} step={5} onChange={(v) => setMetrics({ ascender: v })} />
              <ParamSlider label="Cap height" value={metrics.capHeight} min={metrics.xHeight + 10} max={metrics.ascender} step={5} onChange={(v) => setMetrics({ capHeight: v })} />
              <ParamSlider label="x-height" value={metrics.xHeight} min={50} max={metrics.capHeight - 10} step={5} onChange={(v) => setMetrics({ xHeight: v })} />
              <ParamSlider label="Descender" value={metrics.descender} min={-450} max={-10} step={5} onChange={(v) => setMetrics({ descender: v })} />
              <ParamSlider label="Word space" value={spaceWidth} min={80} max={700} step={5} onChange={setSpaceWidth} />
            </TabsContent>
          </Tabs>

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => { resetParams(targets); void retraceAll(targets); }}>
              <RotateCcw /> Reset {targets.length > 1 ? `${targets.length} glyphs` : "glyph"}
            </Button>
            <Button asChild className="flex-1">
              <Link to="/export">Test font <ArrowRight /></Link>
            </Button>
          </div>
          {tracing && <p className="text-center font-mono text-xs text-muted-foreground">Tracing {tracing.done}/{tracing.total}…</p>}
        </aside>
      </div>

      <div className="sticky bottom-0 z-30 -mx-3 mt-4 border-t bg-background/95 px-3 pt-2 backdrop-blur sm:-mx-6 sm:px-6">
        <GlyphStrip />
      </div>
    </main>
  );
}

function ToggleLabel({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2">
      <Switch checked={checked} onCheckedChange={onChange} />
      <span className="text-muted-foreground">{label}</span>
    </label>
  );
}
