// Square Apple Pencil / touch / mouse drawing surface spanning the whole em, with the project's metric guides.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Eraser, PenLine } from "lucide-react";
import { toSvgD, type Contour } from "@/lib/typecraft/contours";
import { compactStroke, nibWidth, paintStroke, paintStrokes, SAFE_MARGIN, unitsToPadY, type Stroke } from "@/lib/typecraft/drawing";
import type { Metrics } from "@/lib/typecraft/font";
import { TILE_ASCENDER, UNITS_PER_EM } from "@/lib/typecraft/trace";
import { cn } from "@/lib/utils";
import { FittedGlyphGuide } from "./FittedGlyphGuide";
import { stabilizePencilSample, type PencilSample } from "@/lib/typecraft/pencilInput";

export type DrawTool = "pen" | "eraser";

type Props = {
  strokes: Stroke[];
  onStroke: (s: Stroke) => void;
  tool: DrawTool;
  brush: number;
  smooth: number;
  stabilization?: number;
  penStyle?: Stroke["penStyle"];
  pencilOnly: boolean;
  onPencil: () => void;
  metrics: Metrics;
  ghost: string | null;
  ghostTamil?: boolean;
  underlay?: string | null;
  outline?: Contour[] | null;
  bearings?: { left: number; right: number } | null;
  onUndo?: (() => void) | undefined;
  onRedo?: (() => void) | undefined;
  onToggleTool?: (() => void) | undefined;
  className?: string;
};

const U = UNITS_PER_EM;

export function DrawPad({
  strokes,
  onStroke,
  tool,
  brush,
  smooth,
  stabilization = 0.5,
  penStyle = "pen",
  pencilOnly,
  onPencil,
  metrics,
  ghost,
  ghostTamil,
  underlay,
  outline,
  bearings,
  onUndo,
  onRedo,
  onToggleTool,
  className,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inkRef = useRef<HTMLSpanElement>(null);
  const [px, setPx] = useState(0);
  const active = useRef<{ id: number; type: string; stroke: Stroke; rect: DOMRect; sample: PencilSample | null; stabilization: number; ink: string } | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPenTap = useRef<{ x: number; y: number; time: number } | null>(null);

  const onUndoRef = useRef(onUndo);
  onUndoRef.current = onUndo;
  const onRedoRef = useRef(onRedo);
  onRedoRef.current = onRedo;
  const onToggleToolRef = useRef(onToggleTool);
  onToggleToolRef.current = onToggleTool;

  const triggerFeedback = (msg: string) => {
    setFeedback(msg);
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(null), 800);
  };

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
    s.getContext("2d")?.drawImage(src, 0, 0);
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
    paintStroke(c, a.stroke, px, a.ink, 0, false);
  };
  const schedule = () => { if (!frame.current) frame.current = requestAnimationFrame(paintLive); };
  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); }, []);

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

  // Multi-finger gesture listener (2-finger tap undo, 3-finger tap redo with palm rejection guard)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    interface TouchTracking {
      startCount: number;
      maxCount: number;
      startTime: number;
      startX: number;
      startY: number;
      moved: boolean;
    }

    let gesture: TouchTracking | null = null;

    const onTouchStart = (e: TouchEvent) => {
      const count = e.touches.length;
      if (count >= 2) {
        // Multi-touch detected! Palm rejection guard: immediately cancel and discard any in-flight touch stroke.
        if (active.current && active.current.type === "touch") {
          active.current = null;
          if (frame.current) {
            cancelAnimationFrame(frame.current);
            frame.current = 0;
          }
          redraw();
        }

        const primary = e.touches[0]!;
        if (!gesture) {
          gesture = {
            startCount: count,
            maxCount: count,
            startTime: performance.now(),
            startX: primary.clientX,
            startY: primary.clientY,
            moved: false,
          };
        } else {
          gesture.maxCount = Math.max(gesture.maxCount, count);
        }
        e.preventDefault();
      } else if (count === 1) {
        const primary = e.touches[0]!;
        gesture = {
          startCount: 1,
          maxCount: 1,
          startTime: performance.now(),
          startX: primary.clientX,
          startY: primary.clientY,
          moved: false,
        };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!gesture) return;
      if (e.touches.length > gesture.maxCount) {
        gesture.maxCount = e.touches.length;
        if (gesture.maxCount >= 2 && active.current && active.current.type === "touch") {
          active.current = null;
          if (frame.current) {
            cancelAnimationFrame(frame.current);
            frame.current = 0;
          }
          redraw();
        }
      }
      const primary = e.touches[0];
      if (primary) {
        const dist = Math.hypot(primary.clientX - gesture.startX, primary.clientY - gesture.startY);
        if (dist > 18) {
          gesture.moved = true;
        }
      }
      if (gesture.maxCount >= 2) {
        e.preventDefault();
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!gesture) return;
      if (e.touches.length === 0) {
        const duration = performance.now() - gesture.startTime;
        const count = gesture.maxCount;
        const isTap = !gesture.moved && duration <= 250;

        if (isTap) {
          if (count === 2) {
            e.preventDefault();
            triggerFeedback("Undo");
            onUndoRef.current?.();
          } else if (count === 3) {
            e.preventDefault();
            triggerFeedback("Redo");
            onRedoRef.current?.();
          }
        }
        gesture = null;
      }
    };

    const onTouchCancel = () => {
      gesture = null;
    };

    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd, { passive: false });
    canvas.addEventListener("touchcancel", onTouchCancel, { passive: false });

    return () => {
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
      canvas.removeEventListener("touchend", onTouchEnd);
      canvas.removeEventListener("touchcancel", onTouchCancel);
    };
  }, []);

  const point = (e: { clientX: number; clientY: number; pressure: number; pointerType: string }, rect?: DOMRect) => {
    const r = rect ?? canvasRef.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return [0, 0, 0.5] as const;
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
    if (active.current) {
      if (e.pointerType === "touch" && active.current.type === "touch") {
        const old = active.current;
        active.current = null;
        try { e.currentTarget.releasePointerCapture(old.id); } catch { /* already released */ }
        redraw();
      }
      return;
    }
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    const stroke: Stroke = { size: brush, erase: tool === "eraser", penStyle: tool === "eraser" ? "pen" : penStyle, smooth, pts: [...point(e)] };
    setHover(null);
    snapshot();
    const [x, y, pressure] = point(e, rect);
    active.current = { id: e.pointerId, type: e.pointerType, stroke, rect, sample: { x, y, pressure, time: e.timeStamp }, stabilization, ink: ink() };
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
    e.preventDefault();
    const st = a.stroke;
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const ev of events.length ? events : [e.nativeEvent]) {
      let [x, y, p] = point({ ...ev, clientX: ev.clientX, clientY: ev.clientY, pressure: ev.pressure, pointerType: a.type }, a.rect);
      if (a.type === "pen") {
        const sample = stabilizePencilSample(a.sample, { x, y, pressure: ev.pressure, time: ev.timeStamp }, a.stabilization);
        if (sample === a.sample) continue;
        a.sample = sample;
        x = sample.x; y = sample.y; p = sample.pressure;
      }
      const n = st.pts.length;
      const prevX = st.pts[n - 3] ?? x, prevY = st.pts[n - 2] ?? y, prevP = st.pts[n - 1] ?? p;
      if (Math.hypot(x - prevX, y - prevY) < 0.0003) continue;
      st.pts.push(x, y, a.type === "pen" ? p : prevP + (p - prevP) * 0.35);
    }
    schedule();
  };

  const finish = (e: React.PointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
    const a = active.current;
    if (!a || a.id !== e.pointerId) return;
    if (!cancelled) {
      // Safari's lift-off coordinates/zero pressure can jump; preserve the filtered Pencil tip.
      const [x, y] = a.type === "pen" && a.sample ? [a.sample.x, a.sample.y] : point(e, a.rect);
      const n = a.stroke.pts.length;
      a.stroke.pts.push(x, y, a.stroke.pts[n - 1] ?? 0.5);

      if (a.type === "pen") {
        const now = performance.now();
        const startX = a.stroke.pts[0] ?? 0;
        const startY = a.stroke.pts[1] ?? 0;
        const endX = a.stroke.pts[n - 3] ?? startX;
        const endY = a.stroke.pts[n - 2] ?? startY;
        const isShortTap = n <= 6 && Math.hypot(endX - startX, endY - startY) < 0.015;

        if (isShortTap && lastPenTap.current && (now - lastPenTap.current.time < 350) && Math.hypot(startX - lastPenTap.current.x, startY - lastPenTap.current.y) < 0.03) {
          lastPenTap.current = null;
          triggerFeedback(tool === "pen" ? "Eraser" : "Pen");
          onToggleToolRef.current?.();
        } else if (isShortTap) {
          lastPenTap.current = { x: startX, y: startY, time: now };
        }
      }
    }
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

      {/* Floating Apple Pencil 2 Tool Switcher Trigger */}
      {onToggleTool && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleTool();
            triggerFeedback(tool === "pen" ? "Switched to Eraser" : "Switched to Pen");
          }}
          className="absolute bottom-3 left-3 z-10 flex h-10 items-center gap-2 rounded-full border-2 border-border/80 bg-background/95 px-3.5 py-1 text-xs font-semibold text-foreground shadow-md backdrop-blur hover:bg-accent active:scale-95 transition-all touch-manipulation cursor-pointer"
          aria-label={`Toggle tool (Current: ${tool})`}
          title="Apple Pencil double-tap or tap here to switch between pen and eraser"
        >
          {tool === "pen" ? <Eraser className="size-4 text-destructive" /> : <PenLine className="size-4 text-primary" />}
          <span>{tool === "pen" ? "Eraser" : "Pen"}</span>
          <span className="font-mono text-[0.62rem] text-muted-foreground hidden sm:inline">(Pencil Double-Tap)</span>
        </button>
      )}

      {/* Visual Gesture Feedback Pill */}
      {feedback && (
        <div className="pointer-events-none absolute inset-x-0 top-4 z-20 flex justify-center">
          <div className="rounded-full bg-foreground/90 px-3.5 py-1 text-xs font-medium text-background shadow-lg backdrop-blur animate-in fade-in zoom-in-95 duration-150">
            {feedback}
          </div>
        </div>
      )}
    </div>
  );
}
