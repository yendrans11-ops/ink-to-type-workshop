import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyProject, Loading } from "@/components/typecraft/EmptyProject";
import { ParamSlider } from "@/components/typecraft/ParamSlider";
import { formatCodepoint } from "@/lib/typecraft/charsets";
import { buildOtf, buildTtf, collectExportGlyphs, fileBaseName, type FontMeta } from "@/lib/typecraft/font";
import { downloadBlob } from "@/lib/typecraft/imageio";
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

const META_FIELDS: { key: keyof FontMeta; label: string; placeholder: string }[] = [
  { key: "familyName", label: "Font name", placeholder: "My Handwriting" },
  { key: "styleName", label: "Style", placeholder: "Regular" },
  { key: "designer", label: "Author", placeholder: "Your name" },
  { key: "version", label: "Version", placeholder: "1.000" },
  { key: "license", label: "License", placeholder: "e.g. SIL Open Font License 1.1" },
];

function ExportPage() {
  const hydrated = useProject((s) => s.hydrated);
  const order = useProject((s) => s.order);
  const glyphs = useProject((s) => s.glyphs);
  const meta = useProject((s) => s.meta);
  const metrics = useProject((s) => s.metrics);
  const spaceWidth = useProject((s) => s.spaceWidth);
  const setMeta = useProject((s) => s.setMeta);
  const compiled = useCompiledFont();
  const [text, setText] = useState(SAMPLES[0] ?? "");
  const [size, setSize] = useState(64);

  if (!hydrated) return <Loading />;
  if (!order.length) return <EmptyProject title="Nothing to export yet" />;

  const download = (kind: "ttf" | "otf") => {
    try {
      const sources = order.map((id) => glyphs[id]).filter((g): g is GlyphRecord => !!g);
      const { glyphs: list, drawnCount } = collectExportGlyphs(sources, metrics, spaceWidth);
      if (!drawnCount) return toast.error("No traced glyphs to export yet");
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

        {compiled && compiled.duplicates.length > 0 && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            Some characters were drawn more than once; only the first is exported: {compiled.duplicates.map(formatCodepoint).join(", ")}
          </p>
        )}
      </section>

      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <div className="space-y-3 rounded-lg border bg-card p-4">
          <h2 className="text-sm font-semibold">Font details</h2>
          {META_FIELDS.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={`meta-${f.key}`}>{f.label}</Label>
              <Input id={`meta-${f.key}`} value={meta[f.key]} placeholder={f.placeholder} onChange={(e) => setMeta({ [f.key]: e.target.value })} />
            </div>
          ))}
          <div className="space-y-1.5">
            <Label htmlFor="meta-description">Description</Label>
            <Textarea id="meta-description" rows={2} value={meta.description} onChange={(e) => setMeta({ description: e.target.value })} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button size="lg" onClick={() => download("ttf")}><Download /> TTF</Button>
          <Button size="lg" variant="outline" onClick={() => download("otf")}><Download /> OTF</Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {compiled ? `${compiled.glyphs.length - 2} glyphs` : "…"} · TTF works everywhere; OTF keeps the smoothest curves.
        </p>
      </aside>
    </main>
  );
}
