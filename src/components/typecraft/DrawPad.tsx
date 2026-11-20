// Square Apple Pencil / touch / mouse drawing surface spanning the whole em, with the project's metric guides.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { toSvgD, type Contour } from "@/lib/typecraft/contours";
import { compactStroke, nibWidth, paintStroke, paintStrokes, SAFE_MARGIN, unitsToPadY, type Stroke } from "@/lib/typecraft/drawing";
import type { Metrics } from "@/lib/typecraft/font";
import { TILE_ASCENDER, UNITS_PER_EM } from "@/lib/typecraft/trace";
import { cn } from "@/lib/utils";
import { FittedGlyphGuide } from "./FittedGlyphGuide";

export type DrawTool = "pen" | "eraser";

type Props = {
  strokes: Stroke[];
  onStroke: (s: Stroke) => void;
  tool: DrawTool;
  brush: number;
  smooth: number;
  pencilOnly: boolean;
  onPencil: () => void;
  metrics: Metrics;
  ghost: string | null;
  ghostTamil?: boolean;
  underlay?: string | null;
  outline?: Contour[] | null;
  bearings?: { left: number; right: number } | null;
  className?: string;
};

const U = UNITS_PER_EM;

export function DrawPad({ strokes, onStroke, tool, brush, smooth, pencilOnly, onPencil, metrics, ghost, ghostTamil, underlay, outline, bearings, className }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inkRef = useRef<HTMLSpanElement>(null);
  const [px, setPx] = useState(0);
  const active = useRef<{ id: number; type: string; stroke: Stroke } | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setPx(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ink = () => (inkRef.current ? getComputedStyle(inkRef.current).color : "#000");
  const committed = useRef<HTMLCanvasElement | null>(null);
  const frame = useRef(0);
  const ctx = () => {
    const c = canvasRef.current?.getContext("2d", { desynchronized: true }) as CanvasRenderingContext2D | null | undefined;
    if (!c) return null;
    const dpr = window.devicePixelRatio || 1;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    return c;
  };

  const redraw = (extra?: Stroke) => {
    const c = ctx();
    if (!c || !px) return;
    c.clearRect(0, 0, px, px);
    paintStrokes(c, extra ? [...strokes, extra] : strokes, px, ink());
  };

  // Snapshot of the finished strokes so the live stroke repaints once per frame without redrawing everything.
  const snapshot = () => {
    const src = canvasRef.current;
    if (!src) return;
    const s = committed.current ?? document.createElement("canvas");
    s.width = src.width; s.height = src.height;
    s.getContext("2d")!.drawImage(src, 0, 0);
    committed.current = s;
  };
  const paintLive = () => {
    frame.current = 0;
    const a = active.current, c = ctx();
    if (!a || !c || !committed.current) return;
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, c.canvas.width, c.canvas.height);
    c.drawImage(committed.current, 0, 0);
    c.restore();
    paintStroke(c, a.stroke, px, ink());
  };
  const schedule = () => { if (!frame.current) frame.current = requestAnimationFrame(paintLive); };

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !px) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(px * dpr);
    c.height = Math.round(px * dpr);
    redraw();
  }, [px]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!active.current) redraw();
  }, [strokes]); // eslint-disable-line react-hooks/exhaustive-deps

  const point = (e: { clientX: number; clientY: number; pressure: number; pointerType: string }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const pressure = e.pointerType === "pen" ? e.pressure || 0.5 : 0.5;
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, pressure] as const;
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "touch" && pencilOnly) return;
    // A resting palm reports a large contact area; a fingertip is small.
    if (e.pointerType === "touch" && Math.max(e.width, e.height) > 40) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.pointerType === "pen") {
      onPencil();
      // A palm that landed first is not a stroke.
      if (active.current && active.current.type === "touch") {
        const old = active.current;
        active.current = null;
        try { e.currentTarget.releasePointerCapture(old.id); } catch { /* already released */ }
        redraw();
      }
    }
    if (active.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const stroke: Stroke = tool === "eraser" ? { size: brush, erase: true, smooth, pts: [...point(e)] } : { size: brush, smooth, pts: [...point(e)] };
    setHover(null);
    snapshot();
    active.current = { id: e.pointerId, type: e.pointerType, stroke };
    schedule();
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const a = active.current;
    if (!a) {
      // Hover ring only while not drawing, so React never re-renders mid-stroke.
      if (e.pointerType !== "touch") {
        const [x, y] = point(e);
        setHover({ x, y });
      }
      return;
    }
    if (a.id !== e.pointerId) return;
    const st = a.stroke;
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const ev of events.length ? events : [e.nativeEvent]) {
      const [x, y, p] = point(ev);
      const n = st.pts.length;
      if (Math.hypot(x - st.pts[n - 3]!, y - st.pts[n - 2]!) < 0.0012) continue;
      st.pts.push(x, y, p);
    }
    schedule();
  };

  const finish = (e: React.PointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
    const a = active.current;
    if (!a || a.id !== e.pointerId) return;
    active.current = null;
    if (frame.current) { cancelAnimationFrame(frame.current); frame.current = 0; }
    if (cancelled) return redraw();
    onStroke(compactStroke(a.stroke));
  };

  const lines = [
    { key: "ascender", label: "Ascender", v: metrics.ascender, strong: false },
    { key: "cap", label: "Cap height", v: metrics.capHeight, strong: false },
    { key: "x", label: "x-height", v: metrics.xHeight, strong: false },
    { key: "base", label: "Baseline", v: 0, strong: true },
    { key: "desc", label: "Descender", v: metrics.descender, strong: false },
  ].map((l) => ({ ...l, y: unitsToPadY(l.v) * U }));

  const m = SAFE_MARGIN * U;
  const nib = (nibWidth(brush, 0.5) / U) * 100;

  return (
    <div ref={wrapRef} className={cn("relative aspect-square w-full touch-none select-none overflow-hidden overscroll-none rounded-xl border-2 bg-sheet shadow-sheet [-webkit-touch-callout:none]", className)}>
      <span ref={inkRef} className="hidden text-ink" aria-hidden />
      <svg viewBox={`0 0 ${U} ${U}`} className="absolute inset-0 size-full" aria-hidden>
        <path d={`M0 0H${U}V${U}H0Z M${m} ${m}V${U - m}H${U - m}V${m}Z`} fillRule="evenodd" className="fill-muted/70" />
        {Array.from({ length: 11 }, (_, i) => i * 100).map((t) => (
          <line key={t} x1={0} x2={t % 500 === 0 ? 18 : 10} y1={unitsToPadY(TILE_ASCENDER - t) * U} y2={unitsToPadY(TILE_ASCENDER - t) * U} className="stroke-muted-foreground/40" strokeWidth={1.5} />
        ))}
        <line x1={U / 2} x2={U / 2} y1={m} y2={U - m} className="stroke-guide-soft" strokeWidth={1.5} strokeDasharray="6 10" />
        {lines.map((l) => (
          <line key={l.key} x1={0} x2={U} y1={l.y} y2={l.y} className={l.strong ? "stroke-guide" : "stroke-guide-soft"} strokeWidth={l.strong ? 4 : 2.5} strokeDasharray={l.strong || l.key === "ascender" || l.key === "desc" ? undefined : "14 12"} />
        ))}
        {ghost && (
          <FittedGlyphGuide text={ghost} baseline={unitsToPadY(0) * U} fontSize={ghostTamil ? 760 : 980} className="fill-foreground/[0.07]" />
        )}
      </svg>
      {underlay && <img src={underlay} alt="" className="pointer-events-none absolute inset-0 size-full opacity-35 mix-blend-multiply" />}
      <canvas
        ref={canvasRef}
        className={cn("absolute inset-0 size-full touch-none", tool === "eraser" ? "cursor-cell" : "cursor-crosshair")}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={(e) => finish(e, false)}
        onPointerCancel={(e) => finish(e, true)}
        onPointerLeave={() => setHover(null)}
        aria-label="Drawing pad"
        role="img"
      />
      <svg viewBox={`0 0 ${U} ${U}`} className="pointer-events-none absolute inset-0 size-full" aria-hidden>
        {outline && outline.length > 0 && (
          <path d={toSvgD(outline, ([x, y]) => [x, TILE_ASCENDER - y], 1)} className="fill-proof/10 stroke-proof" strokeWidth={2.5} fillRule="nonzero" />
        )}
        {bearings && (
          <g className="stroke-proof" strokeWidth={2} strokeDasharray="4 8">
            <line x1={bearings.left} x2={bearings.left} y1={m} y2={U - m} />
            <line x1={bearings.right} x2={bearings.right} y1={m} y2={U - m} />
          </g>
        )}
        {hover && !active.current && (
          <circle cx={hover.x * U} cy={hover.y * U} r={(nib / 100) * U * 0.5} className={tool === "eraser" ? "fill-none stroke-destructive" : "fill-none stroke-ink/40"} strokeWidth={1.5} />
        )}
      </svg>
      <div className="pointer-events-none absolute inset-0 font-mono text-[0.62rem] leading-none text-muted-foreground sm:text-[0.7rem]">
        {lines.map((l) => (
          <span key={l.key} className={cn("absolute right-2 rounded bg-sheet/80 px-1 py-0.5", l.strong && "text-guide")} style={{ top: `${(l.y / U) * 100}%`, translate: l.y < U * 0.06 ? "0 30%" : "0 -115%" }}>
            {l.label} {l.v}
          </span>
        ))}
      </div>
    </div>
  );
}
