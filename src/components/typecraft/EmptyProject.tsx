import { Link } from "@tanstack/react-router";
import { ArrowRight, FileImage } from "lucide-react";
import { Button } from "@/components/ui/button";

export function EmptyProject({ title = "No glyphs yet" }: { title?: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center animate-ink-in">
      <div className="mb-5 grid size-14 place-items-center rounded-full border bg-card">
        <FileImage className="size-6 text-muted-foreground" />
      </div>
      <h1 className="font-display text-4xl">{title}</h1>
      <p className="mt-3 text-muted-foreground">Upload a filled-in template, or try the built-in sample sheet to see the whole pipeline.</p>
      <Button asChild size="lg" className="mt-7">
        <Link to="/upload">Upload a template <ArrowRight /></Link>
      </Button>
    </div>
  );
}

export function Loading() {
  return <div className="grid min-h-[50vh] place-items-center font-mono text-xs text-muted-foreground">Opening your project…</div>;
}
