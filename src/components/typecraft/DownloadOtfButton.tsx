// "Download .OTF": free accounts get A–M, the one-time upgrade unlocks every drawn character.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Download, Lock, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth/auth-context";
import { compileProject } from "@/lib/typecraft/compile";
import { FREE_EXPORT_LABEL, splitForExport, UPGRADE_PRICE_LABEL } from "@/lib/typecraft/exportTier";
import { downloadBlob } from "@/lib/typecraft/imageio";
import { projectSnapshot, useProject } from "@/lib/typecraft/store";
import { useFullExport } from "@/lib/typecraft/useFullExport";
import { charText } from "@/lib/typecraft/tamil";

function download(full: boolean) {
  const p = projectSnapshot(useProject.getState());
  const { project, included } = splitForExport(p, full);
  if (!included.length) {
    toast.error(full ? "Draw at least one character first" : `Draw at least one of ${FREE_EXPORT_LABEL} first`);
    return false;
  }
  try {
    const c = compileProject(project);
    downloadBlob(new Blob([c.build("otf")], { type: "font/otf" }), c.fileName("otf"));
    toast.success(`Downloaded ${included.length} character${included.length === 1 ? "" : "s"}`);
    return true;
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "The font could not be built");
    return false;
  }
}

export function DownloadOtfButton({ className }: { className?: string }) {
  const { user } = useAuth();
  const { full, checkoutReady } = useFullExport();
  const [open, setOpen] = useState(false);
  const glyphs = useProject((s) => s.glyphs);
  const order = useProject((s) => s.order);
  const locked = splitForExport({ ...projectSnapshot(useProject.getState()), glyphs, order }, full).locked;

  const onClick = () => {
    if (full || !locked.length) download(full);
    else setOpen(true);
  };

  return (
    <>
      <Button className={className ?? "h-11"} onClick={onClick}>
        <Download /> Download .OTF
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-3xl font-normal">Get your whole font</DialogTitle>
            <DialogDescription>
              The free download includes {FREE_EXPORT_LABEL}. {locked.length} more character{locked.length === 1 ? "" : "s"} you drew come with the full set — a one-time {UPGRADE_PRICE_LABEL}.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-1 rounded-md border bg-sheet p-2 font-mono text-sm" aria-label="Characters in the full set">
            {locked.slice(0, 48).map((g) => (
              <span key={g.id} className="inline-flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5"><Lock className="size-3 text-muted-foreground" aria-hidden />{charText(g.unicode)}</span>
            ))}
            {locked.length > 48 && <span className="px-1.5 py-0.5 text-muted-foreground">+{locked.length - 48}</span>}
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
            {!user ? (
              <Button asChild className="h-11 w-full"><Link to="/auth" search={{ next: "/grid" }}><Sparkles /> Sign in to upgrade — {UPGRADE_PRICE_LABEL}</Link></Button>
            ) : (
              <Button className="h-11 w-full" disabled={!checkoutReady}><Sparkles /> Upgrade — {UPGRADE_PRICE_LABEL} one-time</Button>
            )}
            {user && !checkoutReady && <p className="text-center text-xs text-muted-foreground">Checkout isn't switched on yet.</p>}
            <Button variant="outline" className="h-11 w-full" onClick={() => download(false) && setOpen(false)}>Download {FREE_EXPORT_LABEL} free</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
