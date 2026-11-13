import { useNavigate } from "@tanstack/react-router";
import { CircleCheck, CircleX, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProject } from "@/lib/typecraft/store";
import type { PreflightIssue, PreflightResult } from "@/lib/typecraft/preflight";
import { cn } from "@/lib/utils";

/** One-line status for the check, e.g. "2 problems to fix · 3 warnings". */
export function preflightSummary(r: PreflightResult) {
  if (!r.issues.length) return "Ready to export";
  const parts: string[] = [];
  if (r.errors.length) parts.push(`${r.errors.length} problem${r.errors.length === 1 ? "" : "s"} to fix`);
  if (r.warnings.length) parts.push(`${r.warnings.length} warning${r.warnings.length === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

function useIssueAction(onNavigate?: () => void) {
  const navigate = useNavigate();
  const select = useProject((s) => s.select);
  return (issue: PreflightIssue): { label: string; run: () => void } | null => {
    if (issue.field) {
      const field = issue.field;
      return {
        label: "Edit",
        run: () => {
          onNavigate?.();
          // Wait for any closing dialog to release focus before moving it to the field.
          setTimeout(() => {
            const el = document.getElementById(`meta-${field}`);
            el?.scrollIntoView({ block: "center", behavior: "smooth" });
            el?.focus();
          }, 50);
        },
      };
    }
    if (issue.id === "untraced" || issue.id === "no-glyphs") {
      return { label: "Go to upload", run: () => { onNavigate?.(); void navigate({ to: "/upload" }); } };
    }
    const target = issue.glyphIds?.[issue.id.startsWith("duplicate-") ? 1 : 0] ?? issue.glyphIds?.[0];
    if (target || issue.category === "metrics") {
      return {
        label: "Open in studio",
        run: () => {
          onNavigate?.();
          if (target) select(target);
          void navigate({ to: "/studio" });
        },
      };
    }
    return null;
  };
}

export function PreflightList({ issues, onNavigate, className }: { issues: PreflightIssue[]; onNavigate?: () => void; className?: string }) {
  const actionFor = useIssueAction(onNavigate);
  return (
    <ul className={cn("space-y-2", className)}>
      {issues.map((issue) => {
        const action = actionFor(issue);
        const Icon = issue.severity === "error" ? CircleX : TriangleAlert;
        return (
          <li
            key={issue.id}
            data-severity={issue.severity}
            className={cn(
              "flex gap-2.5 rounded-md border p-2.5 text-sm",
              issue.severity === "error" ? "border-destructive/40 bg-destructive/5" : "border-proof/40 bg-proof/5",
            )}
          >
            <Icon className={cn("mt-0.5 size-4 shrink-0", issue.severity === "error" ? "text-destructive" : "text-proof")} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-medium leading-snug">
                <span className="sr-only">{issue.severity === "error" ? "Problem: " : "Warning: "}</span>
                {issue.title}
              </p>
              {issue.detail && <p className="mt-0.5 break-words text-xs text-muted-foreground">{issue.detail}</p>}
              {action && (
                <Button size="sm" variant="link" className="mt-1 h-auto p-0 text-xs" onClick={action.run}>
                  {action.label}
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function PreflightPanel({ result }: { result: PreflightResult }) {
  const status = result.errors.length ? "error" : result.warnings.length ? "warning" : "ok";
  const Icon = status === "ok" ? CircleCheck : status === "error" ? CircleX : TriangleAlert;
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4" aria-labelledby="preflight-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="preflight-title" className="text-sm font-semibold">Pre-export check</h2>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-xs font-medium",
            status === "ok" ? "text-success" : status === "error" ? "text-destructive" : "text-proof",
          )}
          role="status"
        >
          <Icon className="size-3.5" aria-hidden />
          {preflightSummary(result)}
        </span>
      </div>
      {result.issues.length > 0 ? (
        <PreflightList issues={result.issues} className="max-h-[22rem] overflow-y-auto pr-1" />
      ) : (
        <p className="text-xs text-muted-foreground">No missing characters, clashing assignments or font detail problems.</p>
      )}
    </section>
  );
}
