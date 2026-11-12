import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, FileDown, ImageDown } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CHARSETS } from "@/lib/typecraft/charsets";
import { downloadBlob, renderTemplateCanvas } from "@/lib/typecraft/imageio";
import { dataUrlToBytes, jpegsToPdf } from "@/lib/typecraft/pdf";
import { useProject } from "@/lib/typecraft/store";
import { buildTemplateLayout } from "@/lib/typecraft/template";
import { Loading } from "@/components/typecraft/EmptyProject";

export const Route = createFileRoute("/template")({
  head: () => ({
    meta: [
      { title: "Print a handwriting template — TypeCraft" },
      { name: "description", content: "Choose Latin and Tamil character sets and download a printable template with guide lines and corner markers." },
      { property: "og:title", content: "Print a handwriting template — TypeCraft" },
      { property: "og:description", content: "A printable sheet with baseline, x-height and cap-height guides for every character." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TemplatePage,
});

function TemplatePage() {
  const hydrated = useProject((s) => s.hydrated);
  const charsetIds = useProject((s) => s.charsetIds);
  const extraChars = useProject((s) => s.extraChars);
  const ghost = useProject((s) => s.ghost);
  const setCharsets = useProject((s) => s.setCharsets);
  const setExtraChars = useProject((s) => s.setExtraChars);
  const setGhost = useProject((s) => s.setGhost);
  const layout = useMemo(() => buildTemplateLayout(charsetIds, extraChars), [charsetIds, extraChars]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(async () => {
      await document.fonts.ready;
      const urls: string[] = [];
      for (let p = 0; p < layout.pageCount; p++) urls.push(renderTemplateCanvas(p, charsetIds, extraChars, ghost).toDataURL("image/jpeg", 0.7));
      setPreviews(urls);
    }, 150);
    return () => clearTimeout(t);
  }, [hydrated, layout.pageCount, charsetIds, extraChars, ghost]);

  if (!hydrated) return <Loading />;

  const toggle = (id: string, on: boolean) => setCharsets(on ? [...charsetIds, id] : charsetIds.filter((x) => x !== id));

  const downloadPdf = async () => {
    setBusy(true);
    try {
      await document.fonts.ready;
      const pages = [];
      for (let p = 0; p < layout.pageCount; p++) {
        const c = renderTemplateCanvas(p, charsetIds, extraChars, ghost);
        pages.push({ jpeg: dataUrlToBytes(c.toDataURL("image/jpeg", 0.92)), width: c.width, height: c.height });
      }
      downloadBlob(jpegsToPdf(pages), "typecraft-template.pdf");
    } catch (e) {
      toast.error("Couldn't create the PDF", { description: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const downloadPng = (page: number) =>
    renderTemplateCanvas(page, charsetIds, extraChars, ghost).toBlob((b) => b && downloadBlob(b, `typecraft-template-p${page + 1}.png`), "image/png");

  return (
    <main className="mx-auto grid max-w-[1600px] gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[360px_1fr]">
      <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-proof">Step 01</p>
          <h1 className="mt-2 font-display text-4xl">Template</h1>
          <p className="mt-2 text-sm text-muted-foreground">Print at 100% scale on Letter or A4. Write with a dark pen, one character per box, sitting on the solid blue line.</p>
        </div>

        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-semibold">Character sets</legend>
          {CHARSETS.map((c) => (
            <label key={c.id} className="flex cursor-pointer items-center gap-3 rounded-md border bg-card px-3 py-2.5 has-[:checked]:border-foreground/40">
              <Checkbox checked={charsetIds.includes(c.id)} onCheckedChange={(v) => toggle(c.id, v === true)} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{c.title}</span>
                <span className="block truncate text-xs text-muted-foreground">{c.description}</span>
              </span>
              <span className="font-mono text-xs text-muted-foreground">{c.chars.length}</span>
            </label>
          ))}
        </fieldset>

        <div className="space-y-2">
          <Label htmlFor="extra">Extra characters</Label>
          <Input id="extra" value={extraChars} onChange={(e) => setExtraChars(e.target.value)} placeholder="e.g. €£₹ ñ ç" />
          <p className="text-xs text-muted-foreground">Any characters typed here get their own box.</p>
        </div>

        <label className="flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2.5">
          <span>
            <span className="block text-sm font-medium">Faint reference letters</span>
            <span className="block text-xs text-muted-foreground">Light grey letters to trace over</span>
          </span>
          <Switch checked={ghost} onCheckedChange={setGhost} />
        </label>

        <div className="rounded-md border bg-card p-3 font-mono text-xs text-muted-foreground">
          {layout.slots.length} boxes · {layout.pageCount} page{layout.pageCount > 1 ? "s" : ""}
        </div>

        <div className="flex flex-col gap-2">
          <Button size="lg" onClick={downloadPdf} disabled={busy || !layout.slots.length}>
            <FileDown /> {busy ? "Preparing…" : "Download PDF"}
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link to="/upload">
              I've filled it in <ArrowRight />
            </Link>
          </Button>
        </div>
      </aside>

      <section aria-label="Template preview" className="grid gap-6 xl:grid-cols-2">
        {previews.length === 0 && <div className="aspect-[17/22] animate-pulse rounded-lg bg-muted" />}
        {previews.map((src, i) => (
          <figure key={i} className="space-y-2">
            <img src={src} alt={`Template page ${i + 1}`} className="w-full rounded-md border bg-sheet shadow-sheet" />
            <figcaption className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="font-mono">Page {i + 1}</span>
              <Button variant="ghost" size="sm" onClick={() => downloadPng(i)}>
                <ImageDown /> PNG
              </Button>
            </figcaption>
          </figure>
        ))}
      </section>
    </main>
  );
}
