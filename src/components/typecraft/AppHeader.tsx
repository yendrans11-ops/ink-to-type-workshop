import { Link } from "@tanstack/react-router";
import { Grid3x3, LayoutGrid, PenLine } from "lucide-react";
import { AccountButton } from "@/components/typecraft/AccountButton";

const STEPS = [
  { to: "/template", n: "01", label: "Template" },
  { to: "/upload", n: "02", label: "Upload & trace" },
  { to: "/studio", n: "03", label: "Studio" },
  { to: "/export", n: "04", label: "Test & export" },
] as const;

export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-4 px-4 sm:px-6">
        <Link to="/" className="flex shrink-0 items-baseline gap-1.5">
          <span className="font-display text-[1.65rem] leading-none">TypeCraft</span>
          <span className="hidden size-1.5 rounded-full bg-proof sm:block" aria-hidden />
        </Link>
        <nav className="scrollbar-thin -mx-1 flex flex-1 justify-end gap-1 overflow-x-auto px-1" aria-label="Steps">
          {STEPS.map((s) => (
            <Link
              key={s.to}
              to={s.to}
              className="group flex h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              activeProps={{ className: "bg-card text-foreground shadow-sm ring-1 ring-border" }}
            >
              <span className="font-mono text-[0.68rem] text-proof">{s.n}</span>
              <span className="whitespace-nowrap">{s.label}</span>
            </Link>
          ))}
          <Link
            to="/grid"
            className="flex h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            activeProps={{ className: "bg-card text-foreground shadow-sm ring-1 ring-border" }}
          >
            <Grid3x3 className="size-3.5 text-proof" />
            <span className="whitespace-nowrap">Grid</span>
          </Link>
          <Link
            to="/draw"
            className="flex h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            activeProps={{ className: "bg-card text-foreground shadow-sm ring-1 ring-border" }}
          >
            <PenLine className="size-3.5 text-proof" />
            <span className="whitespace-nowrap">Draw</span>
          </Link>
          <Link
            to="/gallery"
            className="flex h-10 shrink-0 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            activeProps={{ className: "bg-card text-foreground shadow-sm ring-1 ring-border" }}
          >
            <LayoutGrid className="size-3.5 text-proof" />
            <span className="whitespace-nowrap">Gallery</span>
          </Link>
        </nav>
        <AccountButton />
      </div>
    </header>
  );
}
