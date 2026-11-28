import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, Download, PenLine, ScanLine, Sparkles, Type } from "lucide-react";
import { toast } from "sonner";
import heroImg from "@/assets/hero-template.jpg";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "TypeCraft — Turn your handwriting into a font" },
      { name: "description", content: "Print a template, fill it in by hand, upload a photo and download your own TTF or OTF font. Works offline in your browser." },
      { property: "og:title", content: "TypeCraft — Turn your handwriting into a font" },
      { property: "og:description", content: "Print, write, scan and export an installable handwriting font — all in the browser." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

const STEPS = [
  { to: "/template", icon: PenLine, title: "Print the template", body: "Pick Latin and Tamil sets, then print the sheet with guide lines and corner markers." },
  { to: "/upload", icon: ScanLine, title: "Upload & trace", body: "Drop a photo, scan or PDF. Corners are found automatically and every box is vectorised." },
  { to: "/studio", icon: Type, title: "Refine in the Studio", body: "Drag metric lines and side bearings, scale, rotate and thicken each glyph — or many at once." },
  { to: "/export", icon: Download, title: "Test & export", body: "Type with your font live, set its name and version, and download TTF or OTF." },
] as const;

function Home() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const trySample = async () => {
    setBusy(true);
    try {
      // Tracing is only needed on demand; don't make the home page depend on
      // loading the entire PDF/Potrace pipeline before its first render.
      const { extractAndTrace, loadSampleUploads } = await import("@/lib/typecraft/pipeline");
      await loadSampleUploads();
      const n = await extractAndTrace();
      toast.success(`Sample traced: ${n} glyphs ready`);
      void navigate({ to: "/studio" });
    } catch (e) {
      toast.error("Couldn't build the sample", { description: String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-[1600px] px-4 pb-24 sm:px-6">
      <section className="grid items-center gap-10 py-12 lg:grid-cols-[1.05fr_1fr] lg:py-20">
        <div className="animate-ink-in">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-proof">Handwriting → TTF · OTF</p>
          <h1 className="mt-4 font-display text-5xl leading-[1.02] sm:text-7xl">
            Your hand,
            <br />
            set in type.
          </h1>
          <p className="mt-6 max-w-lg text-lg text-muted-foreground">
            TypeCraft turns a filled-in template into an installable font. Tracing, spacing and font building all happen on your device — nothing is uploaded.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/template">
                Start with a template <ArrowRight />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/draw">
                <PenLine /> Draw with Apple Pencil
              </Link>
            </Button>
            <Button size="lg" variant="ghost" onClick={trySample} disabled={busy}>
              <Sparkles /> {busy ? "Tracing sample…" : "Try the sample sheet"}
            </Button>
          </div>
        </div>
        <div className="relative">
          <img src={heroImg} alt="A handwriting template sheet with letters written in ink" className="w-full rounded-lg border shadow-sheet" width={1280} height={960} />
        </div>
      </section>

      <section aria-labelledby="how" className="border-t pt-12">
        <h2 id="how" className="font-display text-3xl">Four steps</h2>
        <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.to}>
              <Link to={s.to} className="group flex h-full flex-col rounded-lg border bg-card p-5 transition-shadow hover:shadow-lift">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-proof">0{i + 1}</span>
                  <s.icon className="size-5 text-muted-foreground transition-colors group-hover:text-foreground" />
                </div>
                <h3 className="mt-6 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{s.body}</p>
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
