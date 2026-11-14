import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, Download, FolderOpen, Plus, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { Loading } from "@/components/typecraft/EmptyProject";
import { ParamSlider } from "@/components/typecraft/ParamSlider";
import { compileProject, preflightProject, type FontKind } from "@/lib/typecraft/compile";
import { downloadBlob } from "@/lib/typecraft/imageio";
import { deleteSnapshot, duplicateCurrent, listLibrary, loadSnapshot, saveCurrent, startBlankProject, switchProject, type LibraryEntry } from "@/lib/typecraft/library";
import { SPECIMENS } from "@/lib/typecraft/specimens";
import { useShallow } from "zustand/react/shallow";
import { projectSnapshot, useProject, type ProjectData } from "@/lib/typecraft/store";

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

function GalleryPage() {
  const hydrated = useProject((s) => s.hydrated);
  const currentId = useProject((s) => s.projectId);
  const current = useProject(useShallow(projectSnapshot));
  const navigate = useNavigate();
  const [others, setOthers] = useState<{ entry: LibraryEntry; data: ProjectData }[] | null>(null);
  const [text, setText] = useState(SPECIMENS[0] ?? "");
  const [size, setSize] = useState(40);
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

  const run = async (fn: () => Promise<unknown>, to?: "/studio" | "/template") => {
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
            <Button variant="outline" disabled={busy} onClick={() => run(async () => { await duplicateCurrent(); toast.success("Copy opened — tweak it in the Studio"); })}>
              <Copy /> Duplicate open project
            </Button>
          )}
          <Button disabled={busy} onClick={() => run(startBlankProject, "/template")}><Plus /> New project</Button>
        </div>
      </div>

      <div className="sticky top-16 z-30 -mx-4 space-y-3 border-b bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:bg-card sm:px-4">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {SPECIMENS.map((s) => (
            <Button key={s} size="sm" variant={s === text ? "secondary" : "outline"} onClick={() => setText(s)} className="max-w-[14rem] shrink-0 truncate">{s}</Button>
          ))}
        </div>
        <div className="grid gap-3 md:grid-cols-[1fr_260px] md:items-center">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} aria-label="Comparison text" className="min-h-10 resize-none" />
          <ParamSlider label="Size" value={size} min={16} max={120} unit="px" onChange={setSize} />
        </div>
      </div>

      {count === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="font-display text-2xl">No fonts to compare yet</p>
          <p className="mt-2 text-sm text-muted-foreground">Trace a template — or try the sample sheet — and it will show up here.</p>
          <Button asChild className="mt-5"><Link to="/upload">Upload a template</Link></Button>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {showCurrent && (
            <ProjectCard
              key={current.projectId}
              data={current}
              isCurrent
              text={text}
              size={size}
              delay={0}
              onOpen={() => void navigate({ to: "/studio" })}
            />
          )}
          {others.map(({ entry, data }, i) => (
            <ProjectCard
              key={entry.id}
              data={data}
              updatedAt={entry.updatedAt}
              text={text}
              size={size}
              delay={(i + 1) * 120}
              onOpen={() => run(() => switchProject(entry.id), "/studio")}
              onDelete={() => setToDelete(entry)}
            />
          ))}
        </div>
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

type CardProps = {
  data: ProjectData;
  isCurrent?: boolean;
  updatedAt?: number;
  text: string;
  size: number;
  delay: number;
  onOpen: () => void;
  onDelete?: () => void;
};

function ProjectCard({ data, isCurrent, updatedAt, text, size, delay, onOpen, onDelete }: CardProps) {
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

  const download = (kind: FontKind) => {
    if (!compiled) return;
    try {
      const buf = compiled.build(kind);
      downloadBlob(new Blob([buf], { type: kind === "ttf" ? "font/ttf" : "font/otf" }), compiled.fileName(kind));
      toast.success(`${data.meta.familyName} · ${kind.toUpperCase()} downloaded`, { description: `${compiled.drawnCount} glyphs` });
    } catch (e) {
      toast.error("Export failed", { description: String(e) });
    }
  };

  const blocked = check.errors.length > 0 || !compiled?.drawnCount;
  const name = data.meta.familyName.trim() || "Untitled font";

  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card shadow-sm" aria-label={`${name} ${data.meta.styleName}`}>
      <header className="flex flex-wrap items-start justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate font-display text-2xl leading-tight">{name}</h2>
            {isCurrent && <Badge>Open now</Badge>}
          </div>
          <p className="font-mono text-[0.7rem] text-muted-foreground">
            {data.meta.styleName} · {compiled?.drawnCount ?? 0} glyphs
            {updatedAt ? ` · saved ${new Date(updatedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}
          </p>
        </div>
        <Status errors={check.errors.length} warnings={check.warnings.length} />
      </header>

      <div
        className="min-h-32 flex-1 overflow-hidden whitespace-pre-wrap break-words bg-sheet px-4 py-4 leading-[1.3] text-ink"
        style={{ fontFamily: family ? `"${family}", var(--font-sans)` : undefined, fontSize: size }}
        aria-label={`${name} preview`}
      >
        {error ? <span className="text-sm text-destructive">Preview error: {error}</span> : family ? text || " " : <span className="font-mono text-xs text-muted-foreground">Building font…</span>}
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t px-4 py-3">
        <Button size="sm" disabled={blocked} onClick={() => download("ttf")}><Download /> TTF</Button>
        <Button size="sm" variant="outline" disabled={blocked} onClick={() => download("otf")}><Download /> OTF</Button>
        <Button size="sm" variant="ghost" onClick={onOpen}><FolderOpen /> {isCurrent ? "Edit" : "Open"}</Button>
        {onDelete && (
          <Button size="icon" variant="ghost" className="ml-auto text-muted-foreground" onClick={onDelete} aria-label={`Delete ${name}`}><Trash2 /></Button>
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
