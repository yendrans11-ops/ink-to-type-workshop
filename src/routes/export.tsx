import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { PreflightPanel } from "@/components/typecraft/PreflightPanel";
import { CoverageAdvisor } from "@/components/typecraft/CoverageAdvisor";
import { FontDetailsEditor } from "@/components/typecraft/FontDetailsEditor";
import { EmptyProject, Loading } from "@/components/typecraft/EmptyProject";
import { ParamSlider } from "@/components/typecraft/ParamSlider";
import { runPreflight } from "@/lib/typecraft/preflight";
import { buildTemplateLayout } from "@/lib/typecraft/template";
import { useProject, type GlyphRecord } from "@/lib/typecraft/store";
import { useCompiledFont } from "@/lib/typecraft/useCompiledFont";
import { syllablesInText } from "@/lib/typecraft/tamil";
import { SPECIMENS } from "@/lib/typecraft/specimens";
import { DownloadOtfButton } from "@/components/typecraft/DownloadOtfButton";
import { InstallProfileButton } from "@/components/typecraft/InstallProfileButton";

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

const SAMPLES = SPECIMENS;

function ExportPage() {
  const hydrated = useProject((s) => s.hydrated);
  const order = useProject((s) => s.order);
  const glyphs = useProject((s) => s.glyphs);
  const meta = useProject((s) => s.meta);
  const metrics = useProject((s) => s.metrics);
  const setMeta = useProject((s) => s.setMeta);
  const charsetIds = useProject((s) => s.charsetIds);
  const extraChars = useProject((s) => s.extraChars);
  const compiled = useCompiledFont();
  const [text, setText] = useState(SAMPLES[0] ?? "");
  const [size, setSize] = useState(64);

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
  const syllables = useMemo(() => {
    const drawn = new Set(Object.values(glyphs).filter((g) => g.traced?.length && !g.empty).map((g) => g.unicode));
    return syllablesInText(text, drawn);
  }, [text, glyphs]);
  const missingSyllables = syllables.filter((s) => !s.drawn);
  const fieldErrors = new Set(preflight.errors.map((i) => i.field).filter(Boolean));
  const fieldWarnings = new Set(preflight.warnings.map((i) => i.field).filter(Boolean));

  if (!hydrated) return <Loading />;
  if (!order.length) return <EmptyProject title="Nothing to export yet" />;

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
          {syllables.length > 0 && (
            <div className="space-y-2 rounded-md border border-dashed p-3 text-sm" aria-label="Tamil syllables in this text">
              <p className="text-muted-foreground">
                {missingSyllables.length
                  ? `${missingSyllables.length} Tamil syllable${missingSyllables.length === 1 ? " isn't" : "s aren't"} drawn yet, so ${missingSyllables.length === 1 ? "it shows" : "they show"} as a letter followed by a separate sign. Add the “Tamil syllables” set to your template to draw them.`
                  : "Every Tamil syllable here uses your hand-drawn joined shape."}{" "}
                Signs like ெ ே ை move before the letter and dots like க் are centred automatically.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {syllables.map((s) => (
                  <span
                    key={s.id}
                    className={s.drawn ? "rounded border bg-secondary px-2 py-0.5 text-base" : "rounded border border-dashed px-2 py-0.5 text-base text-muted-foreground"}
                    title={s.drawn ? "Hand-drawn" : "Not drawn yet"}
                  >
                    {s.text}
                  </span>
                ))}
              </div>
            </div>
          )}
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
          <DownloadOtfButton kind="ttf" label="TTF" className="h-12" />
          <DownloadOtfButton kind="otf" label="OTF" className="h-12" />
        </div>
        <InstallProfileButton className="w-full h-12" />
        <p className="text-xs text-muted-foreground">
          {compiled ? `${compiled.drawnCount} glyphs` : "…"} · TTF works everywhere; OTF keeps the smoothest curves; Profile installs natively on iPad/iPhone.
        </p>
      </aside>

    </main>
  );
}
