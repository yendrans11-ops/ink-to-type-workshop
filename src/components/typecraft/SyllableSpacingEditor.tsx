import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { MoveHorizontal, PenLine, RotateCcw, Rows3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ParamSlider } from "@/components/typecraft/ParamSlider";
import { displayLabel } from "@/lib/typecraft/charsets";
import { toSvgD, type Contour } from "@/lib/typecraft/contours";
import { pulliComposite } from "@/lib/typecraft/font";
import { DEFAULT_PARAMS, layoutGlyph } from "@/lib/typecraft/layout";
import { useProject, type GlyphRecord } from "@/lib/typecraft/store";
import {
  clampSpacing,
  GROUP_ORDER,
  listSyllables,
  SHARED_BY,
  SPACING_LIMIT,
  type Syllable,
  type SyllableGroup,
} from "@/lib/typecraft/syllables";
import { isTamilConsonant, PULLI } from "@/lib/typecraft/tamil";
import { useCompiledFont } from "@/lib/typecraft/useCompiledFont";
import { cn } from "@/lib/utils";

type Part = { d: string; current: boolean };
type Scene = { parts: Part[]; handleX: number; width: number; startX: number; endX: number };

const groupLabel = (g: SyllableGroup) => (g === "conjunct" ? "க்ஷ ஸ்ரீ" : displayLabel(g));

/** Lays out reference letter · syllable · reference letter the way the font will, with the editable gap applied. */
function buildScene(s: Syllable, byCp: Map<number, GlyphRecord>, spacing: Record<string, number>): Scene | null {
  const lay = (g: GlyphRecord | undefined, mark?: boolean) => (g?.traced ? layoutGlyph(g.traced, g.params, mark ?? g.isMark) : null);
  const ref = byCp.get(0x0bae) ?? byCp.get(0x0b95) ?? [...byCp.values()].find((g) => isTamilConsonant(g.unicode));
  const refLaid = lay(ref);
  const delta = spacing[s.key] ?? 0;
  const pieces: { contours: Contour[]; advance: number; current: boolean }[] = [];
  let handleAfter = -1; // index of the piece whose (adjusted) right edge carries the handle

  if (refLaid) pieces.push({ contours: refLaid.contours, advance: refLaid.advance, current: false });
  const base = pieces.length;
  if (s.kind === "joined") {
    const l = lay(byCp.get(s.ligatureId!), false);
    if (!l) return null;
    pieces.push({ contours: l.contours, advance: l.advance, current: true });
    handleAfter = base;
  } else if (s.kind === "pulli") {
    const c = lay(byCp.get(s.consonant!));
    const p = lay(byCp.get(PULLI));
    if (!c || !p) return null;
    const nudge = byCp.get(PULLI)?.params.offsetX ?? 0;
    pieces.push({ contours: pulliComposite(c.contours, p.contours, nudge), advance: Math.max(0, c.advance + delta), current: true });
    handleAfter = base;
  } else {
    const [left, right] = s.pair!;
    const a = lay(byCp.get(left));
    const b = lay(byCp.get(right));
    if (!a || !b) return null;
    pieces.push({ contours: a.contours, advance: a.advance + delta, current: true });
    pieces.push({ contours: b.contours, advance: b.advance, current: true });
    handleAfter = base;
  }
  if (refLaid) pieces.push({ contours: refLaid.contours, advance: refLaid.advance, current: false });

  let x = 0;
  let handleX = 0, startX = 0, endX = 0;
  const parts: Part[] = pieces.map((p, i) => {
    if (i === base) startX = x;
    const d = toSvgD(p.contours, ([px, py]) => [px + x, -py], 0);
    x += p.advance;
    if (i === handleAfter) handleX = x;
    if (p.current) endX = x;
    return { d, current: p.current };
  });
  return { parts, handleX, width: x, startX, endX };
}

/** Studio panel for Tamil letter+sign spacing: pick a syllable, drag its gap or width, apply it to the whole row. */
export function SyllableSpacingEditor() {
  const glyphs = useProject((s) => s.glyphs);
  const order = useProject((s) => s.order);
  const metrics = useProject((s) => s.metrics);
  const spacing = useProject((s) => s.syllableSpacing);
  const { setSyllableSpacing, updateParams, select } = useProject.getState();
  const compiled = useCompiledFont(300);

  const byCp = useMemo(() => {
    const m = new Map<number, GlyphRecord>();
    for (const id of order) {
      const g = glyphs[id];
      if (g?.traced?.length && !m.has(g.unicode)) m.set(g.unicode, g);
    }
    return m;
  }, [order, glyphs]);
  const syllables = useMemo(() => listSyllables(new Set(byCp.keys())), [byCp]);
  const groups = GROUP_ORDER.filter((g) => syllables.some((s) => s.group === g));
  const [groupPick, setGroup] = useState<SyllableGroup | null>(null);
  const [keyPick, setKey] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; value: number; scale: number; width: number } | null>(null);
  const [frozenWidth, setFrozenWidth] = useState<number | null>(null);

  if (!syllables.length) return null;
  const group = groupPick !== null && groups.includes(groupPick) ? groupPick : groups[0]!;
  const row = syllables.filter((s) => s.group === group);
  const current = row.find((s) => s.key === keyPick) ?? row[0]!;
  const ligRecord = current.kind === "joined" ? byCp.get(current.ligatureId!) : undefined;
  const value = ligRecord ? ligRecord.params.rsb : spacing[current.key] ?? 0;
  const sameKind = row.filter((s) => s.kind === current.kind);

  const setValue = (v: number) => {
    if (ligRecord) updateParams([ligRecord.id], { rsb: Math.round(Math.max(-200, Math.min(400, v))) });
    else setSyllableSpacing({ [current.key]: clampSpacing(v) });
  };
  const applyToRow = () => {
    if (ligRecord) {
      const ids = sameKind.map((s) => byCp.get(s.ligatureId!)?.id).filter((id): id is string => !!id);
      updateParams(ids, { lsb: ligRecord.params.lsb, rsb: ligRecord.params.rsb });
    } else {
      setSyllableSpacing(Object.fromEntries(sameKind.map((s) => [s.key, value])));
    }
  };
  const reset = () => {
    if (ligRecord) updateParams([ligRecord.id], { lsb: DEFAULT_PARAMS.lsb, rsb: DEFAULT_PARAMS.rsb });
    else setSyllableSpacing({ [current.key]: 0 });
  };

  const scene = buildScene(current, byCp, spacing);
  const top = metrics.ascender + 80;
  const bottom = metrics.descender - 120;
  const vbWidth = frozenWidth ?? Math.max((scene?.width ?? 0) + 160, 1200);

  const onPointerDown = (e: ReactPointerEvent<SVGGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const scale = vbWidth / svg.getBoundingClientRect().width;
    drag.current = { x: e.clientX, value, scale, width: vbWidth };
    setFrozenWidth(vbWidth);
  };
  const onPointerMove = (e: ReactPointerEvent<SVGGElement>) => {
    const d = drag.current;
    if (d) setValue(d.value + (e.clientX - d.x) * d.scale);
  };
  const onPointerUp = () => {
    drag.current = null;
    setFrozenWidth(null);
  };

  const hint =
    current.kind === "joined"
      ? "Drawn as one shape — drag the right edge to change its width."
      : current.kind === "pulli"
        ? "Extra width after the dotted letter."
        : current.kind === "prebase"
          ? `Gap between the sign and the letter after it. ${SHARED_BY[current.sign!] ?? ""}`
          : `Gap between the letter and its sign. ${SHARED_BY[current.sign!] ?? ""}`;
  const family = compiled ? `"${compiled.family}", var(--font-sans)` : undefined;

  return (
    <section className="space-y-3 rounded-lg border bg-card p-3" aria-label="Syllable spacing">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Syllable spacing</h2>
          <p className="text-xs text-muted-foreground">Fine-tune how wide Tamil letters are when a sign joins them.</p>
        </div>
        <span className="font-mono text-[0.68rem] text-muted-foreground">{Object.keys(spacing).length} adjusted</span>
      </div>

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Sign">
        {groups.map((g) => (
          <Button
            key={String(g)}
            size="sm"
            role="tab"
            aria-selected={g === group}
            variant={g === group ? "default" : "outline"}
            className="min-w-11 text-base"
            onClick={() => { setGroup(g); setKey(null); }}
          >
            {groupLabel(g)}
          </Button>
        ))}
      </div>

      <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto" aria-label="Syllables">
        {row.map((s) => {
          const v = s.kind === "joined" ? null : spacing[s.key];
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setKey(s.key)}
              aria-pressed={s.key === current.key}
              className={cn(
                "flex min-h-11 min-w-11 flex-col items-center justify-center rounded-md border px-2 py-1 text-lg leading-none transition-colors",
                s.key === current.key ? "border-proof bg-proof/10" : "bg-background hover:bg-muted",
              )}
            >
              <span>{s.label}</span>
              {v ? <span className="mt-0.5 font-mono text-[0.6rem] text-proof">{v > 0 ? `+${v}` : v}</span> : null}
            </button>
          );
        })}
      </div>

      {scene ? (
        <svg
          ref={svgRef}
          viewBox={`-80 ${-top} ${vbWidth} ${top - bottom}`}
          className="h-40 w-full touch-none select-none rounded-md bg-sheet"
          preserveAspectRatio="xMidYMid meet"
          aria-label={`${current.label} spacing preview`}
        >
          <line x1={-80} x2={vbWidth} y1={0} y2={0} className="stroke-guide-soft" strokeWidth={5} />
          <rect x={scene.startX} y={-metrics.ascender} width={Math.max(0, scene.endX - scene.startX)} height={metrics.ascender - metrics.descender} className="fill-proof/5 stroke-proof/30" strokeWidth={3} strokeDasharray="14 10" />
          {scene.parts.map((p, i) => <path key={i} d={p.d} className={p.current ? "fill-ink" : "fill-ink/30"} />)}
          <g
            role="slider"
            aria-label={current.kind === "joined" ? "Right edge" : "Gap"}
            aria-valuenow={value}
            aria-valuemin={-SPACING_LIMIT}
            aria-valuemax={SPACING_LIMIT}
            tabIndex={0}
            className="cursor-ew-resize focus:outline-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                e.preventDefault();
                setValue(value + (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 20 : 5));
              }
            }}
          >
            <rect x={scene.handleX - 100} y={-top} width={200} height={top - bottom} className="fill-transparent" />
            <line x1={scene.handleX} x2={scene.handleX} y1={-metrics.ascender} y2={-metrics.descender} className="stroke-proof" strokeWidth={6} />
            <circle cx={scene.handleX} cy={-metrics.descender + 50} r={48} className="fill-proof" />
          </g>
        </svg>
      ) : (
        <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">Trace the letter and sign to preview this syllable.</p>
      )}

      <ParamSlider
        label={current.kind === "joined" ? "Right side" : current.kind === "pulli" ? "Extra width" : "Gap"}
        hint={hint}
        value={value}
        min={current.kind === "joined" ? -200 : -SPACING_LIMIT}
        max={SPACING_LIMIT}
        step={2}
        onChange={setValue}
      />
      {ligRecord && (
        <ParamSlider
          label="Left side"
          value={ligRecord.params.lsb}
          min={-200}
          max={400}
          step={2}
          onChange={(v) => updateParams([ligRecord.id], { lsb: Math.round(v) })}
        />
      )}

      <div className="flex flex-wrap gap-2">
        {sameKind.length > 1 && (
          <Button size="sm" variant="outline" onClick={applyToRow}><Rows3 /> Use for all {sameKind.length}</Button>
        )}
        <Button size="sm" variant="ghost" onClick={reset}><RotateCcw /> Reset</Button>
        {ligRecord && (
          <Button size="sm" variant="ghost" onClick={() => { select(ligRecord.id); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
            <PenLine /> Edit shape
          </Button>
        )}
      </div>

      <div className="space-y-1 border-t pt-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><MoveHorizontal className="size-3.5" /> As your font types it</div>
        <div className="overflow-x-auto whitespace-nowrap rounded-md bg-sheet px-3 py-2 text-4xl leading-snug text-ink" style={{ fontFamily: family }} aria-label="Typed preview">
          {compiled ? row.map((s) => s.sample).join(" ") : <span className="font-mono text-xs text-muted-foreground">Building font…</span>}
        </div>
      </div>
    </section>
  );
}
