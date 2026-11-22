import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Lock, Sparkles, Tablet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PreflightList } from "./PreflightPanel";
import { useAuth } from "@/lib/auth/auth-context";
import { compileDownload, prepareDownload } from "@/lib/typecraft/download";
import { FREE_EXPORT_LABEL, UPGRADE_PRICE_LABEL } from "@/lib/typecraft/exportTier";
import { downloadMobileConfig, generateMobileConfig } from "@/lib/typecraft/mobileconfig";
import { projectSnapshot, useProject, type ProjectData } from "@/lib/typecraft/store";
import { useFullExport } from "@/lib/typecraft/useFullExport";
import { charText } from "@/lib/typecraft/tamil";

export function InstallProfileButton({
  className,
  project,
  label = "Install on iPad / iPhone",
  variant = "outline",
}: {
  className?: string | undefined;
  project?: ProjectData | undefined;
  label?: string | undefined;
  variant?: "default" | "outline" | "secondary" | undefined;
}) {
  const { user } = useAuth();
  const { full } = useFullExport();
  const state = useProject();
  const p = project ?? projectSnapshot(state);
  const [pending, setPending] = useState<{ project: ProjectData; full: boolean; mode: "tier" | "check" } | null>(null);
  const prepared = pending ? prepareDownload(pending.project, pending.full) : null;

  const install = (target: ProjectData, access: boolean, confirmed = false) => {
    try {
      // Compile OTF bytes with full GSUB/GPOS shaping and font naming
      const result = compileDownload(target, access, "otf", confirmed);
      const fontName = target.meta.familyName || "TypeCraft Font";
      const xml = generateMobileConfig({
        fontBytes: new Uint8Array(result.bytes),
        fontName,
      });

      downloadMobileConfig(xml, fontName);
      toast.success("Profile downloaded! Go to iOS Settings → Profile Downloaded to install.");
      setPending(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The font could not be compiled for iOS installation.");
    }
  };

  const request = (target: ProjectData, access: boolean) => {
    const check = prepareDownload(target, access).check;
    if (check.issues.length) {
      setPending({ project: target, full: access, mode: "check" });
    } else {
      install(target, access);
    }
  };

  return (
    <>
      <Button
        variant={variant}
        className={className ?? "h-11"}
        onClick={() => {
          if (!full && prepareDownload(p, false).locked.length) {
            setPending({ project: p, full: false, mode: "tier" });
          } else {
            request(p, full);
          }
        }}
      >
        <Tablet className="size-4" /> {label}
      </Button>

      <Dialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent className="max-h-[85dvh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display text-3xl font-normal">
              {pending?.mode === "tier"
                ? "Get your whole font on iPad"
                : prepared?.check.errors.length
                  ? "Fix the font before installing"
                  : "Install with warnings?"}
            </DialogTitle>
            <DialogDescription>
              {pending?.mode === "tier"
                ? `Free downloads include ${FREE_EXPORT_LABEL}. Full English and Tamil downloads are a one-time ${UPGRADE_PRICE_LABEL} account upgrade.`
                : prepared?.check.errors.length
                  ? "These problems block your font configuration profile."
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
                    <Link to="/auth" search={{ next: "/export" }}>
                      <Sparkles /> Sign in for full downloads
                    </Link>
                  </Button>
                ) : (
                  <Button disabled className="h-11 w-full">
                    <Sparkles /> Upgrade — {UPGRADE_PRICE_LABEL} one-time
                  </Button>
                )}
                <p className="text-center text-xs text-muted-foreground">Full checkout is not available yet. No payment will be taken.</p>
                <Button variant="outline" className="h-11 w-full" onClick={() => request(pending.project, false)}>
                  Install {FREE_EXPORT_LABEL} free (.mobileconfig)
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              {prepared && <PreflightList issues={prepared.check.issues} onNavigate={() => setPending(null)} />}
              <DialogFooter>
                <Button variant="outline" onClick={() => setPending(null)}>
                  Go back
                </Button>
                {pending && !prepared?.check.errors.length && (
                  <Button onClick={() => install(pending.project, pending.full, true)}>
                    Install on iPad anyway
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
