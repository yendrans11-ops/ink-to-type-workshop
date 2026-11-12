import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { ArrowRight, Sparkles, Trash2, Upload, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CornerAdjuster } from "@/components/typecraft/CornerAdjuster";
import { Loading } from "@/components/typecraft/EmptyProject";
import { ParamSlider } from "@/components/typecraft/ParamSlider";
import { addCanvasesAsPages, filesToCanvases } from "@/lib/typecraft/imageio";
import { extractAndTrace, loadSampleUploads } from "@/lib/typecraft/pipeline";
import { useProject, useUploads } from "@/lib/typecraft/store";
import { buildTemplateLayout } from "@/lib/typecraft/template";
import { debounced, retraceAll } from "@/lib/typecraft/tracer";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/upload")({
  head: () => ({
    meta: [
      { title: "Upload & trace your handwriting — TypeCraft" },
      { name: "description", content: "Upload a photo, scan or PDF of your filled-in template. Corners are detected and every character is vectorised in your browser." },
      { property: "og:title", content: "Upload & trace your handwriting — TypeCraft" },
      { property: "og:description", content: "Automatic corner detection, perspective correction and Potrace vectorisation." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UploadPage,
});

function UploadPage() {
  const navigate = useNavigate();
  const hydrated = useProject((s) => s.hydrated);
  const charsetIds = useProject((s) => s.charsetIds);
  const extraChars = useProject((s) => s.extraChars);
  const preprocess = useProject((s) => s.preprocess);
  const setPreprocess = useProject((s) => s.setPreprocess);
  const glyphCount = useProject((s) => s.order.length);
  const tracing = useProject((s) => s.tracing);
  const pages = useUploads((s) => s.pages);
  const updatePage = useUploads((s) => s.updatePage);
  const removePage = useUploads((s) => s.removePage);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const pageCount = buildTemplateLayout(charsetIds, extraChars).pageCount;

  if (!hydrated) return <Loading />;

  const addFiles = async (files: File[]) => {
    const ok = files.filter((f) => /^image\/|application\/pdf/.test(f.type) || /\.(png|jpe?g|pdf)$/i.test(f.name));
    if (!ok.length) return toast.error("Please choose PNG, JPG or PDF files");
    setBusy("Reading files…");
    try {
      const added = addCanvasesAsPages(await filesToCanvases(ok));
      const missing = added.filter((p) => p.found.some((f) => !f)).length;
      if (missing) toast.warning(`${missing} page${missing > 1 ? "s" : ""} need corner adjustment`, { description: "Drag the red circles onto the black corner squares." });
    } catch (e) {
      toast.error("Couldn't read that file", { description: String(e) });
    } finally {
      setBusy(null);
    }
  };

  const useSample = async () => {
    setBusy("Drawing sample sheet…");
    try {
      await loadSampleUploads();
    } finally {
      setBusy(null);
    }
  };

  const run = async () => {
    setBusy("Tracing…");
    try {
      const n = await extractAndTrace();
      toast.success(`${n} glyphs traced`);
      void navigate({ to: "/studio" });
    } catch (e) {
      toast.error("Tracing failed", { description: String(e) });
    } finally {
      setBusy(null);
    }
  };

  const tune = (p: Parameters<typeof setPreprocess>[0]) => {
    setPreprocess(p);
    if (glyphCount) debounced("preprocess", () => void retraceAll(), 400);
  };

  return (
    <main className="mx-auto grid max-w-[1600px] gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[1fr_340px]">
      <section className="min-w-0 space-y-6">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-proof">Step 02</p>
          <h1 className="mt-2 font-display text-4xl">Upload &amp; trace</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Add one image or PDF page per template page. Check that the four circles sit on the black corner squares — drag them if not. Blue boxes show where each character will be cut out.
          </p>
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); void addFiles([...e.dataTransfer.files]); }}
          className={cn("flex flex-col items-center gap-3 rounded-lg border-2 border-dashed bg-card px-6 py-10 text-center transition-colors", dragOver && "border-proof bg-proof/5")}
        >
          <Upload className="size-7 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Drop PNG, JPG or PDF here — or</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => inputRef.current?.click()} disabled={!!busy}>Choose files</Button>
            <Button variant="outline" onClick={useSample} disabled={!!busy}><Sparkles /> Use sample sheet</Button>
          </div>
          <input ref={inputRef} type="file" accept="image/png,image/jpeg,application/pdf,.pdf" multiple className="hidden" onChange={(e) => { void addFiles([...(e.target.files ?? [])]); e.target.value = ""; }} />
        </div>

        {pages.map((p) => (
          <article key={p.id} className="space-y-3 rounded-lg border bg-card p-3 sm:p-4">
            <header className="flex flex-wrap items-center gap-3">
              <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{p.fileName}</h2>
              <span className={cn("font-mono text-xs", p.found.every(Boolean) ? "text-success" : "text-destructive")}>
                {p.found.filter(Boolean).length}/4 corners found
              </span>
              <Select value={String(p.page)} onValueChange={(v) => updatePage(p.id, { page: Number(v) })}>
                <SelectTrigger className="h-9 w-[150px]" aria-label="Template page"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: Math.max(pageCount, p.page + 1) }, (_, i) => (
                    <SelectItem key={i} value={String(i)}>Template page {i + 1}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="icon" onClick={() => removePage(p.id)} aria-label="Remove page"><Trash2 /></Button>
            </header>
            <CornerAdjuster page={p} charsetIds={charsetIds} extraChars={extraChars} onChange={(corners) => updatePage(p.id, { corners, found: [true, true, true, true] })} />
          </article>
        ))}
      </section>

      <aside className="space-y-5 lg:sticky lg:top-24 lg:self-start">
        <div className="space-y-4 rounded-lg border bg-card p-4">
          <h2 className="text-sm font-semibold">Tracing</h2>
          <ParamSlider label="Ink threshold" hint="Higher picks up lighter strokes" value={preprocess.threshold} min={40} max={240} onChange={(v) => tune({ threshold: v })} />
          <ParamSlider label="Despeckle" hint="Removes dust and paper texture" value={preprocess.denoise} min={0} max={3} onChange={(v) => tune({ denoise: v })} />
          <ParamSlider label="Corner smoothing" hint="0 = sharp corners" value={preprocess.smoothing} min={0} max={1.33} step={0.01} format={(v) => v.toFixed(2)} onChange={(v) => tune({ smoothing: v })} />
          <ParamSlider label="Curve simplify" hint="Fewer nodes, looser fit" value={preprocess.optimize} min={0} max={1} step={0.01} format={(v) => v.toFixed(2)} onChange={(v) => tune({ optimize: v })} />
        </div>

        {tracing && (
          <div className="space-y-2 rounded-lg border bg-card p-4">
            <div className="flex justify-between font-mono text-xs text-muted-foreground"><span>Tracing</span><span>{tracing.done}/{tracing.total}</span></div>
            <Progress value={(tracing.done / Math.max(1, tracing.total)) * 100} />
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Button size="lg" onClick={run} disabled={!pages.length || !!busy}>
            <Wand2 /> {busy ?? "Extract & trace glyphs"}
          </Button>
          {glyphCount > 0 && (
            <Button asChild variant="outline" size="lg">
              <Link to="/studio">Open Studio ({glyphCount}) <ArrowRight /></Link>
            </Button>
          )}
        </div>
      </aside>
    </main>
  );
}
