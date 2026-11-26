// Square Apple Pencil / touch / mouse drawing surface spanning the whole em, with the project's metric guides.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Eraser, PenLine } from "lucide-react";
import { toSvgD, type Contour } from "@/lib/typecraft/contours";
import { compactStroke, nibWidth, paintStroke, paintStrokes, SAFE_MARGIN, unitsToPadY, type Stroke } from "@/lib/typecraft/drawing";
import type { Metrics } from "@/lib/typecraft/font";
import { TILE_ASCENDER, UNITS_PER_EM } from "@/lib/typecraft/trace";
import { cn } from "@/lib/utils";
import { FittedGlyphGuide } from "./FittedGlyphGuide";
import { DEFAULT_LASSO_THRESHOLD, resolveLasso, type CloseMode, type Point } from "@/lib/typecraft/lasso";
import { createLazyTether, stepLazyTether, type LazyTetherState } from "@/lib/typecraft/lazyTether";
import { stabilizePencilSample, type PencilSample } from "@/lib/typecraft/pencilInput";

export type DrawTool = "pen" | "eraser" | "lasso";

type Props = {
  strokes: Stroke[];
  onStroke: (s: Stroke) => void;
  tool: DrawTool;
  brush: number;
  smooth: number;
  stabilization?: number;
  penStyle?: Stroke["penStyle"];
  lassoCloseMode?: CloseMode;
  lassoThreshold?: number;
  lassoErase?: boolean;
  lazyEnabled?: boolean;
  lazyRadius?: number;
  pencilOnly: boolean;
  onPencil: () => void;
  metrics: Metrics;
  ghost: string | null;
  ghostTamil?: boolean;
  ghostOpacity?: number | undefined;
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
  lassoCloseMode = "always",
  lassoThreshold = DEFAULT_LASSO_THRESHOLD,
  lassoErase = false,
  lazyEnabled = false,
  lazyRadius = 45,
  pencilOnly,
  onPencil,
  metrics,
  ghost,
  ghostTamil,
  ghostOpacity = 0.15,
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
  const [view, setView] = useState<{ scale: number; tx: number; ty: number }>({ scale: 1, tx: 0, ty: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const active = useRef<{
    id: number;
    type: string;
    stroke: Stroke;
    rect: DOMRect;
    sample: PencilSample | null;
    tether: LazyTetherState | null;
    stabilization: number;
    ink: string;
  } | null>(null);
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

    if (a.stroke.kind === "lassoFill") {
      const pts = a.stroke.pts;
      const n = Math.floor(pts.length / 3);
      if (!n) return;
      const emPts: Point[] = [];
      for (let k = 0; k < n; k++) emPts.push([pts[k * 3]! * U, pts[k * 3 + 1]! * U]);
      const mode = a.stroke.closeMode ?? "always";
      const threshold = a.stroke.lassoThreshold ?? DEFAULT_LASSO_THRESHOLD;
      const resolved = resolveLasso(emPts, mode, threshold, a.stroke.smooth ?? 0.7);
      const startX = pts[0]! * px;
      const startY = pts[1]! * px;
      const endX = pts[(n - 1) * 3]! * px;
      const endY = pts[(n - 1) * 3 + 1]! * px;
      const gap = Math.hypot(emPts[n - 1]![0] - emPts[0]![0], emPts[n - 1]![1] - emPts[0]![1]);
      const withinThreshold = gap <= threshold;

      const drawTetherOverlay = () => {
        if (!a.tether || a.tether.radius <= 0) return;
        const tipX = (a.tether.tip.x / U) * px;
        const tipY = (a.tether.tip.y / U) * px;
        const penX = (a.tether.pen.x / U) * px;
        const penY = (a.tether.pen.y / U) * px;
        const rPx = (a.tether.radius / U) * px;
        c.save();
        c.strokeStyle = "rgba(59, 130, 246, 0.45)";
        c.lineWidth = 1.25;
        c.setLineDash([4, 4]);
        c.beginPath();
        c.arc(tipX, tipY, rPx, 0, Math.PI * 2);
        c.stroke();
        c.setLineDash([]);
        c.strokeStyle = "rgba(210, 65, 45, 0.85)";
        c.lineWidth = 1.75;
        c.beginPath();
        c.moveTo(tipX, tipY);
        c.lineTo(penX, penY);
        c.stroke();
        c.fillStyle = "rgba(210, 65, 45, 0.9)";
        c.beginPath();
        c.arc(tipX, tipY, 3, 0, Math.PI * 2);
        c.fill();
        c.restore();
      };

      if (resolved.closed && resolved.polygon.length >= 3) {
        c.save();
        c.fillStyle = a.stroke.erase ? "rgba(210, 65, 45, 0.28)" : a.ink;
        if (!a.stroke.erase) c.globalAlpha = 0.28;
        c.beginPath();
        c.moveTo((resolved.polygon[0]![0] / U) * px, (resolved.polygon[0]![1] / U) * px);
        for (let i = 1; i < resolved.polygon.length; i++) {
          c.lineTo((resolved.polygon[i]![0] / U) * px, (resolved.polygon[i]![1] / U) * px);
        }
        c.closePath();
        c.fill("nonzero");
        c.restore();

        // Dashed closing preview line from pen tip back to start point
        if (n >= 2) {
          c.save();
          c.strokeStyle = a.stroke.erase ? "rgba(210, 65, 45, 0.85)" : a.ink;
          c.globalAlpha = 0.65;
          c.lineWidth = 1.5;
          c.setLineDash([6, 5]);
          c.beginPath();
          c.moveTo(endX, endY);
          c.lineTo(startX, startY);
          c.stroke();
          c.restore();
        }
      } else {
        c.save();
        c.globalAlpha = 0.7;
        paintStroke(c, { ...a.stroke, kind: "stroke", erase: false }, px, a.ink, 0, false);
        c.restore();
      }

      // Live trace outline
      c.save();
      c.strokeStyle = a.stroke.erase ? "rgba(210, 65, 45, 0.9)" : a.ink;
      c.lineWidth = 1.5;
      c.lineJoin = "round";
      c.lineCap = "round";
      c.beginPath();
      c.moveTo(startX, startY);
      for (let k = 1; k < n; k++) c.lineTo(pts[k * 3]! * px, pts[k * 3 + 1]! * px);
      c.stroke();
      c.restore();

      // Snap ring at start point when within threshold (or subtle start anchor when far)
      if (mode !== "off") {
        c.save();
        const activeSnap = n >= 3 && withinThreshold;
        c.strokeStyle = a.stroke.erase ? "rgba(210, 65, 45, 0.95)" : a.ink;
        c.fillStyle = activeSnap ? (a.stroke.erase ? "rgba(210, 65, 45, 0.2)" : "rgba(59, 130, 246, 0.18)") : "transparent";
        c.lineWidth = activeSnap ? 2 : 1.25;
        c.beginPath();
        c.arc(startX, startY, activeSnap ? 9 : 4, 0, Math.PI * 2);
        if (activeSnap) c.fill();
        c.stroke();
        c.restore();
      }
      drawTetherOverlay();
      return;
    }

    paintStroke(c, a.stroke, px, a.ink, 0, false);
    if (a.tether && a.tether.radius > 0) {
      const tipX = (a.tether.tip.x / U) * px;
      const tipY = (a.tether.tip.y / U) * px;
      const penX = (a.tether.pen.x / U) * px;
      const penY = (a.tether.pen.y / U) * px;
      const rPx = (a.tether.radius / U) * px;
      c.save();
      c.strokeStyle = "rgba(59, 130, 246, 0.45)";
      c.lineWidth = 1.25;
      c.setLineDash([4, 4]);
      c.beginPath();
      c.arc(tipX, tipY, rPx, 0, Math.PI * 2);
      c.stroke();
      c.setLineDash([]);
      c.strokeStyle = "rgba(210, 65, 45, 0.85)";
      c.lineWidth = 1.75;
      c.beginPath();
      c.moveTo(tipX, tipY);
      c.lineTo(penX, penY);
      c.stroke();
      c.fillStyle = "rgba(210, 65, 45, 0.9)";
      c.beginPath();
      c.arc(tipX, tipY, 3, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
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

  // Multi-finger gesture listener (2-finger pan/pinch-zoom, 2-finger tap undo, 3-finger tap redo with palm rejection guard)
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    interface TouchTracking {
      startCount: number;
      maxCount: number;
      startTime: number;
      startX: number;
      startY: number;
      moved: boolean;
      pinching: boolean;
      startDist: number;
      startMidX: number;
      startMidY: number;
      startView: { scale: number; tx: number; ty: number };
    }

    let gesture: TouchTracking | null = null;

    const pinchMetrics = (touches: TouchList, rect: DOMRect) => {
      const a = touches[0]!;
      const b = touches[1]!;
      const dx = b.clientX - a.clientX;
      const dy = b.clientY - a.clientY;
      return {
        dist: Math.hypot(dx, dy),
        midX: (a.clientX + b.clientX) / 2 - rect.left,
        midY: (a.clientY + b.clientY) / 2 - rect.top,
      };
    };

    const clampView = (scale: number, tx: number, ty: number) => {
      const w = wrap.clientWidth || 1;
      const h = wrap.clientHeight || 1;
      const s = Math.max(1, Math.min(5, scale));
      if (s <= 1.01) return { scale: 1, tx: 0, ty: 0 };
      const minTx = w * (1 - s);
      const minTy = h * (1 - s);
      return {
        scale: s,
        tx: Math.max(minTx, Math.min(0, tx)),
        ty: Math.max(minTy, Math.min(0, ty)),
      };
    };

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
        const rect = wrap.getBoundingClientRect();
        const pm = pinchMetrics(e.touches, rect);
        if (!gesture) {
          gesture = {
            startCount: count,
            maxCount: count,
            startTime: performance.now(),
            startX: primary.clientX,
            startY: primary.clientY,
            moved: false,
            pinching: count === 2,
            startDist: Math.max(1, pm.dist),
            startMidX: pm.midX,
            startMidY: pm.midY,
            startView: { ...viewRef.current },
          };
        } else {
          gesture.maxCount = Math.max(gesture.maxCount, count);
          if (count === 2 && !gesture.pinching) {
            gesture.pinching = true;
            gesture.startDist = Math.max(1, pm.dist);
            gesture.startMidX = pm.midX;
            gesture.startMidY = pm.midY;
            gesture.startView = { ...viewRef.current };
          } else if (count >= 3) {
            gesture.pinching = false;
          }
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
          pinching: false,
          startDist: 1,
          startMidX: 0,
          startMidY: 0,
          startView: { ...viewRef.current },
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
      if (e.touches.length === 2 && gesture.maxCount === 2) {
        const rect = wrap.getBoundingClientRect();
        const pm = pinchMetrics(e.touches, rect);
        const midMove = Math.hypot(pm.midX - gesture.startMidX, pm.midY - gesture.startMidY);
        const distChange = Math.abs(pm.dist - gesture.startDist);
        if (midMove > 14 || distChange > 14) {
          gesture.moved = true;
        }
        if (gesture.moved && gesture.pinching) {
          const factor = pm.dist / gesture.startDist;
          const nextScale = Math.max(1, Math.min(5, gesture.startView.scale * factor));
          const ratio = nextScale / gesture.startView.scale;
          const nextTx = pm.midX - (gesture.startMidX - gesture.startView.tx) * ratio;
          const nextTy = pm.midY - (gesture.startMidY - gesture.startView.ty) * ratio;
          setView(clampView(nextScale, nextTx, nextTy));
        }
        e.preventDefault();
        return;
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

    wrap.addEventListener("touchstart", onTouchStart, { passive: false });
    wrap.addEventListener("touchmove", onTouchMove, { passive: false });
    wrap.addEventListener("touchend", onTouchEnd, { passive: false });
    wrap.addEventListener("touchcancel", onTouchCancel, { passive: false });

    return () => {
      wrap.removeEventListener("touchstart", onTouchStart);
      wrap.removeEventListener("touchmove", onTouchMove);
      wrap.removeEventListener("touchend", onTouchEnd);
      wrap.removeEventListener("touchcancel", onTouchCancel);
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
    const stroke: Stroke = tool === "lasso"
      ? {
          kind: "lassoFill",
          closeMode: lassoCloseMode,
          lassoThreshold,
          size: brush,
          erase: lassoErase || e.altKey,
          penStyle,
          smooth,
          pts: [...point(e, rect)],
        }
      : {
          kind: "stroke",
          size: brush,
          erase: tool === "eraser",
          penStyle: tool === "eraser" ? "pen" : penStyle,
          smooth,
          pts: [...point(e, rect)],
        };
    setHover(null);
    snapshot();
    const [x, y, pressure] = point(e, rect);
    const tether = lazyEnabled && lazyRadius > 0 ? createLazyTether(x * U, y * U, pressure, lazyRadius) : null;
    active.current = { id: e.pointerId, type: e.pointerType, stroke, rect, sample: { x, y, pressure, time: e.timeStamp }, tether, stabilization, ink: ink() };
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
      if (a.tether) {
        const step = stepLazyTether(a.tether, x * U, y * U, p);
        a.tether = step.state;
        if (!step.moved) continue;
        x = step.state.tip.x / U;
        y = step.state.tip.y / U;
        p = step.state.tip.pressure;
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
      // Preserve the Lazy tether tip (or filtered Pencil tip) so lift-off doesn't jump across the dead zone.
      if (!a.tether) {
        const [x, y] = a.type === "pen" && a.sample ? [a.sample.x, a.sample.y] : point(e, a.rect);
        const n = a.stroke.pts.length;
        a.stroke.pts.push(x, y, a.stroke.pts[n - 1] ?? 0.5);
      }
      const n = a.stroke.pts.length;

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
    <div ref={wrapRef} className={cn("relative aspect-square w-full touch-none select-none overflow-hidden overscroll-none rounded-xl border-2 bg-sheet shadow-sheet [-webkit-touch-callout:none] [-webkit-user-select:none]", className)}>
      <span ref={inkRef} className="hidden text-ink" aria-hidden />
      <div
        className="absolute inset-0 origin-top-left touch-none select-none [-webkit-user-select:none]"
        style={view.scale !== 1 || view.tx !== 0 || view.ty !== 0 ? { transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})` } : undefined}
      >
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
            <FittedGlyphGuide
              text={ghost}
              baseline={unitsToPadY(0) * U}
              fontSize={ghostTamil ? 760 : 980}
              className="fill-foreground"
              opacity={ghostOpacity}
            />
          )}
        </svg>
        {underlay && <img src={underlay} alt="" className="pointer-events-none absolute inset-0 size-full opacity-35 mix-blend-multiply" />}
        <canvas
          ref={canvasRef}
          className={cn("absolute inset-0 size-full touch-none overscroll-none select-none [-webkit-touch-callout:none] [-webkit-user-select:none]", tool === "eraser" ? "cursor-cell" : "cursor-crosshair")}
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
            <circle
              cx={hover.x * U}
              cy={hover.y * U}
              r={tool === "lasso" ? 6 : (nib / 100) * U * 0.5}
              className={tool === "eraser" || (tool === "lasso" && lassoErase) ? "fill-none stroke-destructive" : "fill-none stroke-ink/40"}
              strokeWidth={1.5}
            />
          )}
        </svg>
      </div>
      <div className="pointer-events-none absolute inset-0 font-mono text-[0.62rem] leading-none text-muted-foreground sm:text-[0.7rem]">
        {lines.map((l) => (
          <span key={l.key} className={cn("absolute right-2 rounded bg-sheet/80 px-1 py-0.5", l.strong && "text-guide")} style={{ top: `${((l.y / U) * view.scale * (px || 1) + view.ty) / (px || 1) * 100}%`, translate: l.y < U * 0.06 ? "0 30%" : "0 -115%" }}>
            {l.label} {l.v}
          </span>
        ))}
      </div>

      {view.scale > 1 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setView({ scale: 1, tx: 0, ty: 0 }); }}
          className="absolute right-3 bottom-3 z-10 flex h-9 items-center gap-1.5 rounded-full border border-border/80 bg-background/95 px-3 text-xs font-mono font-medium text-foreground shadow-md backdrop-blur hover:bg-accent touch-none select-none [-webkit-user-select:none]"
          aria-label="Reset zoom"
        >
          {Math.round(view.scale * 100)}% · Reset
        </button>
      )}

      {/* Floating Apple Pencil 2 Tool Switcher Trigger */}
      {onToggleTool && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleTool();
            triggerFeedback(tool === "pen" ? "Switched to Eraser" : "Switched to Pen");
          }}
          className="absolute bottom-3 left-3 z-10 flex h-10 items-center gap-2 rounded-full border-2 border-border/80 bg-background/95 px-3.5 py-1 text-xs font-semibold text-foreground shadow-md backdrop-blur hover:bg-accent active:scale-95 transition-all touch-none select-none [-webkit-user-select:none] cursor-pointer"
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
