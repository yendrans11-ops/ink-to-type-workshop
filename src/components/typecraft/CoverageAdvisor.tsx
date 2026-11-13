import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CHARSETS } from "@/lib/typecraft/charsets";
import { summarizeCoverage } from "@/lib/typecraft/coverage";
import { getCompletionPlan, type AdvisorPlan } from "@/lib/typecraft/advisor.functions";
import { useProject } from "@/lib/typecraft/store";

export function CoverageAdvisor() {
  const charsetIds = useProject((s) => s.charsetIds);
  const setCharsets = useProject((s) => s.setCharsets);
  const glyphs = useProject((s) => s.glyphs);
  const [language, setLanguage] = useState(charsetIds.some((id) => id.startsWith("tamil")) ? "Tamil" : "English");
  const [plan, setPlan] = useState<AdvisorPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = useServerFn(getCompletionPlan);
  const sets = useMemo(
    () => summarizeCoverage(charsetIds, Object.values(glyphs).map((g) => ({ unicode: g.unicode, traced: !!g.traced, empty: g.empty }))),
    [charsetIds, glyphs],
  );

  const run = async () => {
    setBusy(true); setError(null);
    try {
      const r = await ask({ data: { language, sets: sets.map(({ id: _id, ...s }) => s) } });
      setPlan(r.plan); setError(r.error);
    } catch { setError("Couldn't get suggestions. Please try again."); }
    finally { setBusy(false); }
  };

  return (
    <section className="rounded-lg border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" /><h2 className="text-lg font-semibold">Coverage advisor</h2></div>
      <p className="text-sm text-muted-foreground">Pick the character sets you want, and get a plan for which missing letters to draw first.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {CHARSETS.map((c) => {
          const s = sets.find((x) => x.id === c.id);
          return (
            <label key={c.id} className="flex min-h-11 items-center gap-3 rounded-md border px-3 py-2 cursor-pointer">
              <Checkbox checked={charsetIds.includes(c.id)} onCheckedChange={(on) => setCharsets(on ? [...charsetIds, c.id] : charsetIds.filter((x) => x !== c.id))} />
              <span className="flex-1 text-sm">{c.title}</span>
              {s && <span className="text-xs text-muted-foreground">{s.done}/{s.total}</span>}
            </label>
          );
        })}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="adv-lang">Language you'll write in</Label>
          <Input id="adv-lang" value={language} onChange={(e) => setLanguage(e.target.value)} className="w-56" />
        </div>
        <Button onClick={run} disabled={busy || !language.trim() || sets.length === 0} className="min-h-11">
          <Sparkles className="h-4 w-4" />{busy ? "Thinking…" : "Suggest a plan"}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {plan && (
        <div className="space-y-3">
          <p className="text-sm">{plan.summary}</p>
          <ol className="space-y-3">
            {plan.steps.map((st, i) => (
              <li key={i} className="rounded-md border p-3 space-y-1">
                <div className="flex items-center gap-2"><span className="font-medium">{i + 1}. {st.title}</span>
                  <Badge variant={st.priority === "high" ? "destructive" : st.priority === "medium" ? "default" : "secondary"}>{st.priority}</Badge></div>
                {st.chars.length > 0 && <p className="text-xl tracking-widest">{st.chars.join(" ")}</p>}
                <p className="text-sm text-muted-foreground">{st.why}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
