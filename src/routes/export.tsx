import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PreflightList, PreflightPanel } from "@/components/typecraft/PreflightPanel";
import { CoverageAdvisor } from "@/components/typecraft/CoverageAdvisor";
import { FontDetailsEditor } from "@/components/typecraft/FontDetailsEditor";
import { EmptyProject, Loading } from "@/components/typecraft/EmptyProject";
import { ParamSlider } from "@/components/typecraft/ParamSlider";
import { buildOtf, buildTtf, collectExportGlyphs, fileBaseName } from "@/lib/typecraft/font";
import { downloadBlob } from "@/lib/typecraft/imageio";
import { runPreflight } from "@/lib/typecraft/preflight";
import { buildTemplateLayout } from "@/lib/typecraft/template";
import { useProject, type GlyphRecord } from "@/lib/typecraft/store";
import { useCompiledFont } from "@/lib/typecraft/useCompiledFont";

export const Route = createFileRoute("/export")({
  head: () => ({
    meta: [
      { title: "Test & export your font — TypeCraft" },
      { name: "description", content: "Type with your handwriting font live, set its name, designer and version, and download it as TTF or OTF." },
      { property: "og:title", content: "Test & export your font — TypeCraft" },
      { property: "og:description", content: "Live type tester and one-click TTF / OTF download." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ExportPage,
});

const SAMPLES = [
  "The quick brown fox jumps over the lazy dog.",
  "Sphinx of black quartz, judge my vow! 0123456789",
  "யாமறிந்த மொழிகளிலே தமிழ்மொழி போல் இனிதாவது எங்கும் காணோம்",
];

function ExportPage() {
  const hydrated = useProject((s) => s.hydrated);
  const order = useProject((s) => s.order);
  const glyphs = useProject((s) => s.glyphs);
  const meta = useProject((s) => s.meta);
  const metrics = useProject((s) => s.metrics);
  const spaceWidth = useProject((s) => s.spaceWidth);
  const setMeta = useProject((s) => s.setMeta);
  const charsetIds = useProject((s) => s.charsetIds);
  const extraChars = useProject((s) => s.extraChars);
  const compiled = useCompiledFont();
  const [text, setText] = useState(SAMPLES[0] ?? "");
  const [size, setSize] = useState(64);
  const [pending, setPending] = useState<"ttf" | "otf" | null>(null);

  const preflight = useMemo(
    () =>
      runPreflight({
        glyphs: order.map((id) => glyphs[id]).filter((g): g is GlyphRecord => !!g),
        expected: buildTemplateLayout(charsetIds, extraChars).slots.map((s) => s.cp),
        meta,
        metrics,
      }),
    [order, glyphs, charsetIds, extraChars, meta, metrics],
  );
  const fieldErrors = new Set(preflight.errors.map((i) => i.field).filter(Boolean));
  const fieldWarnings = new Set(preflight.warnings.map((i) => i.field).filter(Boolean));

  if (!hydrated) return <Loading />;
  if (!order.length) return <EmptyProject title="Nothing to export yet" />;

  /** Runs the pre-export check first; only a clean check downloads straight away. */
  const requestDownload = (kind: "ttf" | "otf") => {
    if (preflight.issues.length) setPending(kind);
    else download(kind);
  };

  const download = (kind: "ttf" | "otf") => {
    try {
      const sources = order.map((id) => glyphs[id]).filter((g): g is GlyphRecord => !!g);
      const { glyphs: list, drawnCount } = collectExportGlyphs(sources, metrics, spaceWidth);
      if (!drawnCount) {
        toast.error("No traced glyphs to export yet");
        return;
      }
      const buf = kind === "ttf" ? buildTtf(list, meta, metrics) : buildOtf(list, meta, metrics);
      downloadBlob(new Blob([buf], { type: kind === "ttf" ? "font/ttf" : "font/otf" }), `${fileBaseName(meta)}.${kind}`);
      toast.success(`${kind.toUpperCase()} downloaded`, { description: `${drawnCount} glyphs` });
    } catch (e) {
      toast.error("Export failed", { description: String(e) });
    }
  };

  const family = compiled ? `"${compiled.family}", var(--font-sans)` : undefined;

  return (
    <main className="mx-auto grid max-w-[1600px] gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[1fr_360px]">
      <section className="min-w-0 space-y-6">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-proof">Step 04</p>
          <h1 className="mt-2 font-display text-4xl">Test &amp; export</h1>
        </div>

        <div className="space-y-3 rounded-lg border bg-card p-4">
          <div className="flex flex-wrap gap-2">
            {SAMPLES.map((s) => (
              <Button key={s} size="sm" variant="outline" onClick={() => setText(s)} className="max-w-[16rem] truncate">{s}</Button>
            ))}
          </div>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} aria-label="Test text" />
          <ParamSlider label="Size" value={size} min={16} max={200} unit="px" onChange={setSize} />
          <div className="min-h-40 overflow-hidden whitespace-pre-wrap break-words rounded-md bg-sheet p-5 leading-[1.25] text-ink" style={{ fontFamily: family, fontSize: size }}>
            {compiled ? text : <span className="font-mono text-sm text-muted-foreground">Building font…</span>}
          </div>
          {compiled?.error && <p className="text-sm text-destructive">Preview error: {compiled.error}</p>}
        </div>

        {compiled && (
          <div className="space-y-1 rounded-lg border bg-card p-4" aria-label="Waterfall">
            {[14, 20, 28, 40, 56].map((s) => (
              <div key={s} className="flex items-baseline gap-4 overflow-hidden whitespace-nowrap">
                <span className="w-8 shrink-0 font-mono text-[0.68rem] text-muted-foreground">{s}</span>
                <span style={{ fontFamily: family, fontSize: s }}>{text}</span>
              </div>
            ))}
          </div>
        )}

        <FontDetailsEditor meta={meta} setMeta={setMeta} errors={fieldErrors} warnings={fieldWarnings} />
      </section>

      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <PreflightPanel result={preflight} />
        <CoverageAdvisor />
        <div className="grid grid-cols-2 gap-2">
          <Button size="lg" onClick={() => requestDownload("ttf")}><Download /> TTF</Button>
          <Button size="lg" variant="outline" onClick={() => requestDownload("otf")}><Download /> OTF</Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {compiled ? `${compiled.glyphs.length - 2} glyphs` : "…"} · TTF works everywhere; OTF keeps the smoothest curves.
        </p>
      </aside>

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent className="max-h-[85vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {preflight.errors.length
                ? `Fix ${preflight.errors.length} problem${preflight.errors.length === 1 ? "" : "s"} before downloading`
                : "Download with warnings?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {preflight.errors.length
                ? "These would produce a broken or confusing font file."
                : "Your font will work, but these may not be what you want."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <PreflightList issues={preflight.issues} onNavigate={() => setPending(null)} />
          <AlertDialogFooter>
            <AlertDialogCancel>{preflight.errors.length ? "Close" : "Go back"}</AlertDialogCancel>
            {preflight.errors.length === 0 && pending && (
              <AlertDialogAction
                onClick={() => {
                  const kind = pending;
                  setPending(null);
                  download(kind);
                }}
              >
                Download {pending.toUpperCase()} anyway
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
