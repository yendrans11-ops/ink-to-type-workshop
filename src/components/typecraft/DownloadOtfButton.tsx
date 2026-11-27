import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, Download, FolderArchive, Lock, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PreflightList } from "./PreflightPanel";
import { useAuth } from "@/lib/auth/auth-context";
import { compileDownload, compileFamilyPackage, prepareDownload } from "@/lib/typecraft/download";
import type { FontKind } from "@/lib/typecraft/compile";
import { FREE_EXPORT_LABEL, UPGRADE_PRICE_LABEL } from "@/lib/typecraft/exportTier";
import { downloadBlob } from "@/lib/typecraft/imageio";
import { projectSnapshot, useProject, type ProjectData } from "@/lib/typecraft/store";
import { useFullExport } from "@/lib/typecraft/useFullExport";
import { charText } from "@/lib/typecraft/tamil";

type ExportBundle = "single" | "family";

export function DownloadOtfButton({ className, project, kind = "otf", label }: { className?: string; project?: ProjectData; kind?: FontKind; label?: string }) {
  const { user } = useAuth();
  const { full } = useFullExport();
  const state = useProject();
  const p = project ?? projectSnapshot(state);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ project: ProjectData; full: boolean; mode: "tier" | "check"; bundle: ExportBundle } | null>(null);
  const prepared = pending ? prepareDownload(pending.project, pending.full) : null;

  const download = async (target: ProjectData, access: boolean, bundle: ExportBundle, confirmed = false) => {
    setBusy(true);
    try {
      if (bundle === "family") {
        const result = await compileFamilyPackage(target, kind, access, confirmed);
        const zipBuffer = result.bytes.buffer.slice(result.bytes.byteOffset, result.bytes.byteOffset + result.bytes.byteLength) as ArrayBuffer;
        downloadBlob(new Blob([zipBuffer], { type: "application/zip" }), result.fileName);
        toast.success(`3-weight ${kind.toUpperCase()} family downloaded · ${result.count} characters`);
      } else {
        const result = compileDownload(target, access, kind, confirmed);
        downloadBlob(new Blob([result.bytes], { type: kind === "ttf" ? "font/ttf" : "font/otf" }), result.fileName);
        toast.success(`${kind.toUpperCase()} downloaded · ${result.count} characters`);
      }
      setPending(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The font could not be built");
    } finally {
      setBusy(false);
    }
  };

  const request = (target: ProjectData, access: boolean, bundle: ExportBundle) => {
    const check = prepareDownload(target, access).check;
    if (check.issues.length) setPending({ project: target, full: access, mode: "check", bundle });
    else void download(target, access, bundle);
  };

  const start = (bundle: ExportBundle) => {
    if (!full && prepareDownload(p, false).locked.length) {
      setPending({ project: p, full: false, mode: "tier", bundle });
    } else {
      request(p, full, bundle);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className={className ?? "h-11"} disabled={busy}>
            <Download />
            <span>{busy ? "Building…" : label ?? `Download .${kind.toUpperCase()}`}</span>
            <ChevronDown className="ml-1 size-4 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem className="min-h-11 cursor-pointer gap-2" onSelect={() => start("single")}>
            <Download className="size-4" />
            <span>Download Single Weight (Regular)</span>
          </DropdownMenuItem>
          <DropdownMenuItem className="min-h-11 cursor-pointer gap-2" onSelect={() => start("family")}>
            <FolderArchive className="size-4" />
            <span>Download 3-Weight Family (.ZIP)</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent className="max-h-[85dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-3xl font-normal">
              {pending?.mode === "tier" ? "Get your whole font" : prepared?.check.errors.length ? "Fix the font before downloading" : "Download with warnings?"}
            </DialogTitle>
            <DialogDescription>
              {pending?.mode === "tier"
                ? `Free downloads include ${FREE_EXPORT_LABEL}. Full English and Tamil downloads are a one-time ${UPGRADE_PRICE_LABEL} account upgrade.`
                : prepared?.check.errors.length
                  ? "These problems block your font download."
                  : "Review the remaining warnings before continuing."}
            </DialogDescription>
          </DialogHeader>
          {pending?.mode === "tier" ? (
            <>
              <div className="flex flex-wrap gap-1 rounded-md border bg-sheet p-2 text-sm" aria-label="Characters in the full set">
                {prepared?.locked.slice(0, 48).map((g) => (
                  <span key={g.id} className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5">
                    <Lock className="size-3" aria-hidden />
                    {charText(g.unicode)}
                  </span>
                ))}
              </div>
              <DialogFooter className="flex-col gap-2 sm:flex-col">
                {!user ? (
                  <Button asChild className="h-11 w-full">
                    <Link to="/auth" search={{ next: "/grid" }}><Sparkles /> Sign in for full downloads</Link>
                  </Button>
                ) : (
                  <Button disabled className="h-11 w-full"><Sparkles /> Upgrade — {UPGRADE_PRICE_LABEL} one-time</Button>
                )}
                <p className="text-center text-xs text-muted-foreground">Full checkout is not available yet. No payment will be taken.</p>
                <Button variant="outline" className="h-11 w-full" onClick={() => request(pending.project, false, pending.bundle)}>
                  Download {FREE_EXPORT_LABEL} free
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              {prepared && <PreflightList issues={prepared.check.issues} onNavigate={() => setPending(null)} />}
              <DialogFooter>
                <Button variant="outline" onClick={() => setPending(null)}>Go back</Button>
                {pending && !prepared?.check.errors.length && (
                  <Button disabled={busy} onClick={() => void download(pending.project, pending.full, pending.bundle, true)}>
                    {pending.bundle === "family" ? `Download ${kind.toUpperCase()} family (.ZIP)` : `Download ${kind.toUpperCase()} anyway`}
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
