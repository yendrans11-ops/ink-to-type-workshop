import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Copy, FolderOpen, GalleryHorizontal, LayoutGrid, PenLine, Plus, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Carousel, CarouselContent, CarouselItem, type CarouselApi } from "@/components/ui/carousel";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
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
import { Loading } from "@/components/typecraft/EmptyProject";
import { ParamSlider } from "@/components/typecraft/ParamSlider";
import { compileProject, preflightProject } from "@/lib/typecraft/compile";
import { deleteSnapshot, duplicateCurrent, listLibrary, loadSnapshot, saveCurrent, startBlankProject, switchProject, type LibraryEntry } from "@/lib/typecraft/library";
import { SPECIMENS } from "@/lib/typecraft/specimens";
import { projectSnapshot, useProject, type ProjectData } from "@/lib/typecraft/store";
import { DownloadOtfButton } from "@/components/typecraft/DownloadOtfButton";

export const Route = createFileRoute("/gallery")({
  head: () => ({
    meta: [
      { title: "Your fonts — TypeCraft gallery" },
      { name: "description", content: "Browse every handwriting font project, compare them typing the same text, and download the one you like best." },
      { property: "og:title", content: "Your fonts — TypeCraft gallery" },
      { property: "og:description", content: "Compare your handwriting fonts side by side and download the best one as TTF or OTF." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: GalleryPage,
});

let galleryFaces = 0;

/** The open project as one object that only changes identity when one of its saved fields does. */
function useOpenProject(): ProjectData {
  const projectId = useProject((s) => s.projectId);
  const charsetIds = useProject((s) => s.charsetIds);
  const extraChars = useProject((s) => s.extraChars);
  const ghost = useProject((s) => s.ghost);
  const templateFormat = useProject((s) => s.templateFormat);
  const glyphs = useProject((s) => s.glyphs);
  const order = useProject((s) => s.order);
  const metrics = useProject((s) => s.metrics);
  const preprocess = useProject((s) => s.preprocess);
  const meta = useProject((s) => s.meta);
  const spaceWidth = useProject((s) => s.spaceWidth);
  const syllableSpacing = useProject((s) => s.syllableSpacing);
  return useMemo(
    () => projectSnapshot({ projectId, charsetIds, extraChars, ghost, templateFormat, glyphs, order, metrics, preprocess, meta, spaceWidth, syllableSpacing }),
    [projectId, charsetIds, extraChars, ghost, templateFormat, glyphs, order, metrics, preprocess, meta, spaceWidth, syllableSpacing],
  );
}

function GalleryPage() {
  const hydrated = useProject((s) => s.hydrated);
  const currentId = useProject((s) => s.projectId);
  const current = useOpenProject();
  const navigate = useNavigate();
  const [others, setOthers] = useState<{ entry: LibraryEntry; data: ProjectData }[] | null>(null);
  const [text, setText] = useState(SPECIMENS[0] ?? "");
  const [size, setSize] = useState(56);
  const [view, setView] = useState<"swipe" | "grid">("swipe");
  const [toDelete, setToDelete] = useState<LibraryEntry | null>(null);
  const [busy, setBusy] = useState(false);

  // Keep the open project's library copy fresh, then load everything else.
  const refresh = async () => {
    await saveCurrent();
    const list = await listLibrary();
    const openId = useProject.getState().projectId;
    const loaded = await Promise.all(
      list.filter((e) => e.id !== openId).map(async (entry) => ({ entry, data: await loadSnapshot(entry.id) })),
    );
    setOthers(loaded.filter((x): x is { entry: LibraryEntry; data: ProjectData } => !!x.data));
  };

  useEffect(() => {
    if (hydrated) void refresh().catch((e) => toast.error("Couldn't load your projects", { description: String(e) }));
  }, [hydrated, currentId]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<unknown>, to?: "/studio" | "/template" | "/draw") => {
    setBusy(true);
    try {
      await fn();
      if (to) void navigate({ to });
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  if (!hydrated || !others) return <Loading />;
  const showCurrent = current.order.length > 0;
  const count = others.length + (showCurrent ? 1 : 0);

  return (
    <main className="mx-auto max-w-[1600px] space-y-6 px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-proof">Gallery</p>
          <h1 className="mt-2 font-display text-4xl">Your fonts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {count ? `${count} project${count === 1 ? "" : "s"} · type once, compare them all, download the winner.` : "Nothing saved yet."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {showCurrent && (
            <Button size="lg" variant="outline" disabled={busy} onClick={() => run(async () => { await duplicateCurrent(); toast.success("Copy opened — tweak it in the Studio"); })}>
              <Copy /> Duplicate open project
            </Button>
          )}
          <Button size="lg" variant="outline" disabled={busy} onClick={() => run(startBlankProject, "/draw")}><PenLine /> Draw a new font</Button>
          <Button size="lg" disabled={busy} onClick={() => run(startBlankProject, "/template")}><Plus /> New project</Button>
        </div>
      </div>

      <div className="z-30 -mx-4 space-y-3 md:sticky md:top-16 border-b bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:bg-card sm:px-4">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {SPECIMENS.map((s) => (
            <Button key={s} variant={s === text ? "secondary" : "outline"} onClick={() => setText(s)} className="h-11 max-w-[16rem] shrink-0 justify-start"><span className="truncate">{s}</span></Button>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_240px_auto] md:items-center">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} aria-label="Comparison text" className="min-h-11 resize-none text-base" />
          <ParamSlider label="Size" value={size} min={16} max={140} unit="px" onChange={setSize} />
          <ToggleGroup type="single" value={view} onValueChange={(v) => v && setView(v as "swipe" | "grid")} variant="outline" aria-label="Layout">
            <ToggleGroupItem value="swipe" className="h-11 px-3"><GalleryHorizontal /> Swipe</ToggleGroupItem>
            <ToggleGroupItem value="grid" className="h-11 px-3"><LayoutGrid /> Grid</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {count === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="font-display text-2xl">No fonts to compare yet</p>
          <p className="mt-2 text-sm text-muted-foreground">Trace a template — or try the sample sheet — and it will show up here.</p>
          <Button asChild className="mt-5"><Link to="/upload">Upload a template</Link></Button>
        </div>
      ) : (
        <Cards view={view}>
          {[
            ...(showCurrent
              ? [
                  <ProjectCard
                    key={current.projectId}
                    data={current}
                    isCurrent
                    text={text}
                    size={size}
                    delay={0}
                    onOpen={() => void navigate({ to: "/studio" })}
                    onDraw={() => void navigate({ to: "/draw" })}
                  />,
                ]
              : []),
            ...others.map(({ entry, data }, i) => (
              <ProjectCard
                key={entry.id}
                data={data}
                updatedAt={entry.updatedAt}
                text={text}
                size={size}
                delay={(i + 1) * 120}
                onOpen={() => run(() => switchProject(entry.id), "/studio")}
                onDraw={() => run(() => switchProject(entry.id), "/draw")}
                onDelete={() => setToDelete(entry)}
              />
            )),
          ]}
        </Cards>
      )}

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{toDelete?.familyName}”?</AlertDialogTitle>
            <AlertDialogDescription>Its glyphs and settings are removed from this device. Fonts you already downloaded keep working.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const e = toDelete;
                setToDelete(null);
                if (e) void run(async () => { await deleteSnapshot(e.id); await refresh(); toast.success("Project deleted"); });
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}

/** Swipe: one big card per screen (two on wide screens), drag or use the arrows/dots. Grid: everything at once. */
function Cards({ view, children }: { view: "swipe" | "grid"; children: ReactNode[] }) {
  const [api, setApi] = useState<CarouselApi>();
  const [index, setIndex] = useState(0);
  const [snaps, setSnaps] = useState(0);
  useEffect(() => {
    if (!api) return;
    const sync = () => {
      setIndex(api.selectedScrollSnap());
      setSnaps(api.scrollSnapList().length);
    };
    sync();
    api.on("select", sync);
    api.on("reInit", sync);
    return () => {
      api.off("select", sync);
      api.off("reInit", sync);
    };
  }, [api]);

  if (view === "grid") return <div className="grid gap-5 md:grid-cols-2">{children}</div>;

  return (
    <section aria-label="Font previews" aria-roledescription="carousel" className="space-y-4">
      <Carousel setApi={setApi} opts={{ align: "start", containScroll: "trimSnaps" }}>
        <CarouselContent className="-ml-4">
          {children.map((c, i) => (
            <CarouselItem key={i} className="basis-[92%] pl-4 md:basis-[86%] xl:basis-1/2" aria-label={`${i + 1} of ${children.length}`}>
              {c}
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>
      {snaps > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button size="icon" variant="outline" className="size-11 rounded-full" onClick={() => api?.scrollPrev()} disabled={index === 0} aria-label="Previous font"><ArrowLeft /></Button>
          <div className="flex items-center gap-1.5">
            {Array.from({ length: snaps }, (_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => api?.scrollTo(i)}
                aria-label={`Show font ${i + 1}`}
                aria-current={i === index || undefined}
                className="grid size-8 place-items-center"
              >
                <span className={cn("block h-2 rounded-full transition-all", i === index ? "w-6 bg-foreground" : "w-2 bg-muted-foreground/40")} />
              </button>
            ))}
          </div>
          <Button size="icon" variant="outline" className="size-11 rounded-full" onClick={() => api?.scrollNext()} disabled={index >= snaps - 1} aria-label="Next font"><ArrowRight /></Button>
        </div>
      )}
    </section>
  );
}

type CardProps = {
  data: ProjectData;
  isCurrent?: boolean;
  updatedAt?: number;
  text: string;
  size: number;
  delay: number;
  onOpen: () => void;
  onDraw: () => void;
  onDelete?: () => void;
};

function ProjectCard({ data, isCurrent, updatedAt, text, size, delay, onOpen, onDraw, onDelete }: CardProps) {
  const [family, setFamily] = useState<string | null>(null);
  const [loadError, setError] = useState<string | null>(null);
  const [compiled, compileError] = useMemo(() => {
    try {
      return [compileProject(data), null] as const;
    } catch (e) {
      return [null, String(e)] as const;
    }
  }, [data]);
  const error = compileError ?? loadError;
  const check = useMemo(() => preflightProject(data), [data]);

  useEffect(() => {
    if (!compiled) return;
    let face: FontFace | null = null;
    const t = setTimeout(() => {
      try {
        const name = `TypeCraftGallery${++galleryFaces}`;
        face = new FontFace(name, compiled.build("otf"));
        face.load().then((f) => { document.fonts.add(f); setFamily(name); }).catch((e) => setError(String(e)));
      } catch (e) {
        setError(String(e));
      }
    }, delay);
    return () => {
      clearTimeout(t);
      if (face) document.fonts.delete(face);
    };
  }, [compiled, delay]);

  const blocked = check.errors.length > 0 || !compiled?.drawnCount;
  const name = data.meta.familyName.trim() || "Untitled font";

  return (
    <article className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border bg-card shadow-sm" aria-label={`${name} ${data.meta.styleName}`}>
      <header className="flex flex-wrap items-start justify-between gap-2 border-b px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate font-display text-3xl leading-tight">{name}</h2>
            {isCurrent && <Badge>Open now</Badge>}
          </div>
          <p className="font-mono text-xs text-muted-foreground">
            {data.meta.styleName} · {compiled?.drawnCount ?? 0} glyphs
            {updatedAt ? ` · saved ${new Date(updatedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}
          </p>
        </div>
        <Status errors={check.errors.length} warnings={check.warnings.length} />
      </header>

      <div
        className="min-h-64 flex-1 overflow-hidden whitespace-pre-wrap break-words bg-sheet px-6 py-6 leading-[1.3] text-ink md:min-h-80"
        style={{ fontFamily: family ? `"${family}", var(--font-sans)` : undefined, fontSize: size }}
        aria-label={`${name} preview`}
      >
        {error ? <span className="text-sm text-destructive">Preview error: {error}</span> : family ? text || " " : <span className="font-mono text-xs text-muted-foreground">Building font…</span>}
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t px-5 py-4">
        <DownloadOtfButton project={data} kind="ttf" label="TTF" />
        <DownloadOtfButton project={data} kind="otf" label="OTF" />
        <Button className="h-11" variant="ghost" onClick={onOpen}><FolderOpen /> {isCurrent ? "Edit" : "Open"}</Button>
        <Button className="h-11" variant="ghost" onClick={onDraw}><PenLine /> Draw</Button>
        {onDelete && (
          <Button size="icon" variant="ghost" className="ml-auto size-11 text-muted-foreground" onClick={onDelete} aria-label={`Delete ${name}`}><Trash2 /></Button>
        )}
        {blocked && (
          <p className="w-full text-xs text-muted-foreground">
            {compiled?.drawnCount ? "Fix the problems first — open it and check Test & export." : "No traced glyphs yet."}
          </p>
        )}
      </footer>
    </article>
  );
}

function Status({ errors, warnings }: { errors: number; warnings: number }) {
  if (errors)
    return <span className="flex items-center gap-1 text-xs text-destructive"><XCircle className="size-3.5" /> {errors} problem{errors === 1 ? "" : "s"}</span>;
  if (warnings)
    return <span className="flex items-center gap-1 text-xs text-muted-foreground"><AlertTriangle className="size-3.5" /> {warnings} warning{warnings === 1 ? "" : "s"}</span>;
  return <span className="flex items-center gap-1 text-xs text-muted-foreground"><CheckCircle2 className="size-3.5 text-proof" /> Ready</span>;
}
