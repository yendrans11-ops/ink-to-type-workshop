import { useEffect, useReducer, useRef, useState } from "react";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { toSvgD, type BBox, type Contour, type P } from "@/lib/typecraft/contours";
import type { Metrics } from "@/lib/typecraft/font";
import type { GlyphParams, LaidOutGlyph } from "@/lib/typecraft/layout";
import { stabilizePencilSample, type PencilSample } from "@/lib/typecraft/pencilInput";
import type { GlyphRecord } from "@/lib/typecraft/store";
import { DEFAULT_LASSO_THRESHOLD, type CloseMode } from "@/lib/typecraft/lasso";
import { createLazyTether, stepLazyTether, type LazyTetherState } from "@/lib/typecraft/lazyTether";
import { TILE, UNITS_PER_EM } from "@/lib/typecraft/trace";
import { BOX_GUIDES } from "@/lib/typecraft/template";
import { charText } from "@/lib/typecraft/tamil";
import {
  clearSelection,
  computeCurvatureHandles,
  convertNodeType,
  deleteNode,
  fitFreeformPointsToVectorPath,
  hitTestNodeOrHandle,
  hitTestSegment,
  lassoPointsToVectorPath,
  moveNodeHandle,
  nextVectorId,
  selectNode,
  selectNodesInBox,
  selectNodesInLasso,
  setNodeSymmetricHandles,
  splitSegmentAt,
  translateSelectedNodes,
  vectorPathsToContours,
  type SegmentHit,
  type VectorPath,
} from "@/lib/typecraft/vectorEditor";
import { Button } from "@/components/ui/button";
import { VectorOverlay } from "./VectorOverlay";
import type { StudioTool } from "./VectorToolbar";

type MetricKey = keyof Metrics;
type LayoutDrag =
  | { kind: "metric"; key: MetricKey }
  | { kind: "baseline"; oy0: number; cy0: number }
  | { kind: "lsb"; v0: number; cx0: number }
  | { kind: "rsb"; v0: number }
  | { kind: "glyph"; ox0: number; oy0: number }
  | { kind: "pan"; cx0: number; cy0: number };

type VectorDrag =
  | { kind: "move-nodes"; startFont: P; basePaths: VectorPath[]; moved: boolean }
  | { kind: "move-handle"; pathId: string; nodeId: string; which: "inHandle" | "outHandle"; breakTangent: boolean; basePaths: VectorPath[]; moved: boolean }
  | { kind: "marquee"; startFont: P; endFont: P; additive: boolean }
  | { kind: "lasso"; pts: P[]; additive: boolean }
  | { kind: "lasso-fill"; pts: P[]; sample: PencilSample | null; tether: LazyTetherState | null; rect: DOMRect; erase: boolean }
  | { kind: "pen-drag"; pathId: string; nodeId: string; anchor: P; closing: boolean; moved: boolean }
  | { kind: "curvature-drag"; pathId: string; nodeId: string; startFont: P; basePaths: VectorPath[]; moved: boolean }
  | { kind: "freeform"; pts: P[]; sample: PencilSample | null; tether: LazyTetherState | null; rect: DOMRect }
  | { kind: "convert-drag"; pathId: string; nodeId: string; anchor: P; basePaths: VectorPath[]; moved: boolean };

const METRIC_LINES: { key: MetricKey; label: string }[] = [
  { key: "ascender", label: "Ascender" },
  { key: "capHeight", label: "Cap height" },
  { key: "xHeight", label: "x-height" },
  { key: "descender", label: "Descender" },
];
const VIEW_RANGE = 1500;
const VIEW_MID = 300;

type Props = {
  glyph: GlyphRecord;
  laid: LaidOutGlyph;
  metrics: Metrics;
  tool: StudioTool;
  paths: VectorPath[];
  activePathId: string | null;
  pencilOnly: boolean;
  lassoCloseMode?: CloseMode;
  lassoThreshold?: number;
  lassoErase?: boolean;
  lassoSmooth?: number;
  lassoNibWidth?: number;
  lazyEnabled?: boolean;
  lazyRadius?: number;
  showNodes: boolean;
  showFill: boolean;
  showSource: boolean;
  onPathsChange: (next: VectorPath[], commitContours?: Contour[]) => void;
  onActivePathId: (id: string | null) => void;
  onPencilDetected?: () => void;
  onParams: (p: Partial<GlyphParams>) => void;
  onMetrics: (m: Partial<Metrics>) => void;
};

function cssColors(el: HTMLElement) {
  const cs = getComputedStyle(el);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    sheet: v("--sheet"), ink: v("--ink"), guide: v("--guide"), guideSoft: v("--guide-soft"),
    proof: v("--proof"), proofFg: v("--proof-foreground"), muted: v("--muted-foreground"),
    border: v("--border"), card: v("--card"), fg: v("--foreground"),
  };
}

function clampMetrics(key: MetricKey, value: number, m: Metrics) {
  const r = Math.round(value);
  switch (key) {
    case "ascender": return Math.max(m.capHeight, Math.min(1000, r));
    case "capHeight": return Math.max(m.xHeight + 10, Math.min(m.ascender, r));
    case "xHeight": return Math.max(50, Math.min(m.capHeight - 10, r));
    case "descender": return Math.max(-450, Math.min(-10, r));
  }
}

export function GlyphCanvas({
  glyph,
  laid,
  metrics,
  tool,
  paths,
  activePathId,
  pencilOnly,
  lassoCloseMode = "always",
  lassoThreshold = DEFAULT_LASSO_THRESHOLD,
  lassoErase = false,
  lassoSmooth = 0.7,
  lassoNibWidth = 55,
  lazyEnabled = false,
  lazyRadius = 45,
  showNodes,
  showFill,
  showSource,
  onPathsChange,
  onActivePathId,
  onPencilDetected,
  onParams,
  onMetrics,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const view = useRef({ cx: 0, cy: VIEW_MID, zoom: 1 });
  const layoutDrag = useRef<{ d: LayoutDrag; sx: number; sy: number } | null>(null);
  const vectorDrag = useRef<{ id: number; type: string; rect: DOMRect; d: VectorDrag } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number; type: string }>());
  const pinch = useRef<{ d0: number; z0: number; mid0: { x: number; y: number }; cx0: number; cy0: number } | null>(null);
  const tileCache = useRef<{ src: Uint8Array | null; canvas: HTMLCanvasElement | null }>({ src: null, canvas: null });
  const spaceHeld = useRef(false);
  const [tick, redraw] = useReducer((x: number) => x + 1, 0);

  // Ephemeral overlay state for interactive vector editing
  const [marquee, setMarquee] = useState<BBox | null>(null);
  const [lasso, setLasso] = useState<P[]>([]);
  const [lassoFillPts, setLassoFillPts] = useState<P[]>([]);
  const [freeformPts, setFreeformPts] = useState<P[]>([]);
  const [tetherView, setTetherView] = useState<LazyTetherState | null>(null);
  const [cursorFont, setCursorFont] = useState<P | null>(null);
  const [penPreviewHandle, setPenPreviewHandle] = useState<{ x: number; y: number } | null>(null);
  const [hoverSeg, setHoverSeg] = useState<SegmentHit | null>(null);
  const [isDraggingVector, setIsDraggingVector] = useState(false);

  const latest = useRef({ laid, metrics, glyph, paths, tool, activePathId, pencilOnly, lassoCloseMode, lassoThreshold, lassoErase, lassoSmooth, lassoNibWidth, lazyEnabled, lazyRadius });
  latest.current = { laid, metrics, glyph, paths, tool, activePathId, pencilOnly, lassoCloseMode, lassoThreshold, lassoErase, lassoSmooth, lassoNibWidth, lazyEnabled, lazyRadius };

  const fitCenter = () => {
    const l = latest.current.laid;
    view.current.cx = latest.current.glyph.isMark ? (l.bbox ? l.bbox.xMin / 2 : 0) : l.advance / 2;
    view.current.cy = VIEW_MID;
  };

  useEffect(() => {
    fitCenter();
    redraw();
  }, [glyph.id]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.code === "Space") spaceHeld.current = true; };
    const onKeyUp = (e: KeyboardEvent) => { if (e.code === "Space") spaceHeld.current = false; };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); };
  }, []);

  // Clear hover previews when switching tools
  useEffect(() => {
    setHoverSeg(null);
    setCursorFont(null);
    setPenPreviewHandle(null);
    setMarquee(null);
    setLasso([]);
    setLassoFillPts([]);
    setFreeformPts([]);
    setTetherView(null);
  }, [tool]);

  const k = () => ((size.h || 1) / VIEW_RANGE) * view.current.zoom;
  const fx = (x: number) => size.w / 2 + (x - view.current.cx) * k();
  const fy = (y: number) => size.h / 2 - (y - view.current.cy) * k();
  const toFontX = (sx: number) => view.current.cx + (sx - size.w / 2) / k();
  const toFontY = (sy: number) => view.current.cy + (size.h / 2 - sy) / k();
  const toFont = (sx: number, sy: number): P => [toFontX(sx), toFontY(sy)];

  // ---------- background & outline drawing (alpha: false, desynchronized: true) ----------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size.w || !size.h) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(size.w * dpr)) canvas.width = Math.round(size.w * dpr);
    if (canvas.height !== Math.round(size.h * dpr)) canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext("2d", { desynchronized: true, alpha: false });
    if (!ctx) return;
    const c = cssColors(canvas);
    const { w, h } = size;
    const K = k();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = c.sheet || "#fff";
    ctx.fillRect(0, 0, w, h);

    // Unit grid every 100 units
    ctx.strokeStyle = c.border;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    const x0 = Math.floor((view.current.cx - w / 2 / K) / 100) * 100;
    for (let x = x0; fx(x) < w; x += 100) {
      ctx.beginPath(); ctx.moveTo(Math.round(fx(x)) + 0.5, 0); ctx.lineTo(Math.round(fx(x)) + 0.5, h); ctx.stroke();
    }
    const y0 = Math.floor((view.current.cy - h / 2 / K) / 100) * 100;
    for (let y = y0; fy(y) > 0; y += 100) {
      ctx.beginPath(); ctx.moveTo(0, Math.round(fy(y)) + 0.5); ctx.lineTo(w, Math.round(fy(y)) + 0.5); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const isMark = glyph.isMark;
    const adv = laid.advance;
    const bb = laid.bbox;

    // Advance box + bearing zones
    if (!isMark) {
      ctx.fillStyle = c.card;
      ctx.fillRect(fx(0), fy(metrics.ascender), adv * K, (metrics.ascender - metrics.descender) * K);
      if (bb) {
        ctx.fillStyle = c.proof;
        ctx.globalAlpha = 0.08;
        ctx.fillRect(fx(0), fy(metrics.ascender), bb.xMin * K, (metrics.ascender - metrics.descender) * K);
        ctx.fillRect(fx(bb.xMax), fy(metrics.ascender), (adv - bb.xMax) * K, (metrics.ascender - metrics.descender) * K);
        ctx.globalAlpha = 1;
      }
    }

    // Source bitmap underlay, through the same transform as the outline
    if (showSource && glyph.source) {
      if (tileCache.current.src !== glyph.source) {
        const tc = document.createElement("canvas");
        tc.width = tc.height = TILE;
        const tctx = tc.getContext("2d")!;
        const img = tctx.createImageData(TILE, TILE);
        for (let i = 0; i < glyph.source.length; i++) {
          const v = glyph.source[i] ?? 255;
          img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
          img.data[i * 4 + 3] = 255 - v;
        }
        tctx.putImageData(img, 0, 0);
        tileCache.current = { src: glyph.source, canvas: tc };
      }
      const U = UNITS_PER_EM / TILE;
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(K, -K);
      ctx.translate(-view.current.cx, -view.current.cy);
      ctx.transform(...laid.matrix);
      ctx.transform(U, 0, 0, -U, 0, BOX_GUIDES.baseline * TILE * U);
      ctx.globalAlpha = 0.35;
      ctx.drawImage(tileCache.current.canvas!, 0, 0);
      ctx.restore();
    }

    // Metric guidelines
    const lines = [...METRIC_LINES.map((l) => ({ ...l, y: metrics[l.key] })), { key: "baseline" as const, label: "Baseline", y: 0 }];
    ctx.font = "500 11px 'IBM Plex Mono', monospace";
    for (const l of lines) {
      const sy = Math.round(fy(l.y)) + 0.5;
      const strong = l.key === "baseline";
      ctx.strokeStyle = strong ? c.guide : c.guideSoft;
      ctx.lineWidth = strong ? 2 : 1.25;
      ctx.setLineDash(l.key === "xHeight" || l.key === "capHeight" ? [6, 5] : []);
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke();
      ctx.setLineDash([]);
      const text = `${l.label} ${Math.round(l.y)}`;
      const tw = ctx.measureText(text).width + 16;
      ctx.fillStyle = strong ? c.guide : c.card;
      ctx.strokeStyle = c.guide;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(8, sy - 11, tw, 22, 11); ctx.fill(); ctx.stroke();
      ctx.fillStyle = strong ? c.card : c.guide;
      ctx.fillText(text, 16, sy + 4);
    }

    // Glyph outline
    if (laid.contours.length) {
      const path = new Path2D(toSvgD(laid.contours, ([x, y]) => [fx(x), fy(y)], 2));
      if (showFill) {
        ctx.fillStyle = c.ink;
        ctx.fill(path, "nonzero");
      }
      ctx.strokeStyle = showFill ? c.ink : c.fg;
      ctx.lineWidth = showFill ? 0.5 : 1.25;
      ctx.stroke(path);
    } else if (tool === "layout") {
      ctx.fillStyle = c.muted;
      ctx.font = "14px 'IBM Plex Sans', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(glyph.source ? "This box was empty on the template" : "Pick Pen (P), Freeform (F), or Curvature (C) to draw vectors", w / 2, h / 2);
      ctx.textAlign = "start";
    }

    // Side bearing handles
    const drawBearing = (x: number, label: string) => {
      const sx = Math.round(fx(x)) + 0.5;
      ctx.strokeStyle = c.proof;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke();
      ctx.font = "500 11px 'IBM Plex Mono', monospace";
      const tw = ctx.measureText(label).width + 18;
      ctx.fillStyle = c.proof;
      ctx.beginPath(); ctx.roundRect(sx - tw / 2, h - 40, tw, 26, 13); ctx.fill();
      ctx.fillStyle = c.proofFg;
      ctx.textAlign = "center";
      ctx.fillText(label, sx, h - 23);
      ctx.textAlign = "start";
    };
    if (isMark) drawBearing(0, "origin · mark");
    else {
      drawBearing(0, `LSB ${bb ? Math.round(bb.xMin) : Math.round(glyph.params.lsb)}`);
      drawBearing(adv, `RSB ${bb ? Math.round(adv - bb.xMax) : Math.round(glyph.params.rsb)}`);
      ctx.fillStyle = c.muted;
      ctx.font = "500 11px 'IBM Plex Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText(`advance ${adv}`, fx(adv / 2), fy(metrics.descender) + 18);
      ctx.textAlign = "start";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laid, metrics, size, showFill, showSource, glyph, tick, tool]);

  // ---------- layout hit-testing ----------
  const hitTestLayout = (sx: number, sy: number): LayoutDrag => {
    const p = latest.current.glyph.params;
    const m = latest.current.metrics;
    const l = latest.current.laid;
    const isMark = latest.current.glyph.isMark;
    if (sx < 130) {
      if (Math.abs(sy - fy(0)) < 14) return { kind: "baseline", oy0: p.offsetY, cy0: view.current.cy };
      for (const ml of METRIC_LINES) if (Math.abs(sy - fy(m[ml.key])) < 14) return { kind: "metric", key: ml.key };
    }
    if (!isMark) {
      const nearPill = sy > size.h - 52;
      const tol = nearPill ? 40 : 10;
      if (Math.abs(sx - fx(l.advance)) < tol) return { kind: "rsb", v0: p.rsb };
      if (Math.abs(sx - fx(0)) < tol) return { kind: "lsb", v0: p.lsb, cx0: view.current.cx };
    }
    if (l.bbox && sx > fx(l.bbox.xMin) - 8 && sx < fx(l.bbox.xMax) + 8 && sy > fy(l.bbox.yMax) - 8 && sy < fy(l.bbox.yMin) + 8)
      return { kind: "glyph", ox0: p.offsetX, oy0: p.offsetY };
    if (Math.abs(sy - fy(0)) < 8) return { kind: "baseline", oy0: p.offsetY, cy0: view.current.cy };
    for (const ml of METRIC_LINES) if (Math.abs(sy - fy(m[ml.key])) < 8) return { kind: "metric", key: ml.key };
    return { kind: "pan", cx0: view.current.cx, cy0: view.current.cy };
  };

  const localFromRect = (clientX: number, clientY: number, rect: DOMRect) => ({
    x: clientX - rect.left,
    y: clientY - rect.top,
  });

  const abortActiveVectorDrag = () => {
    const vd = vectorDrag.current;
    if (!vd) return;
    if (vd.d.kind === "move-nodes" || vd.d.kind === "move-handle" || vd.d.kind === "curvature-drag" || vd.d.kind === "convert-drag") {
      onPathsChange(vd.d.basePaths);
    }
    vectorDrag.current = null;
    setIsDraggingVector(false);
    setMarquee(null);
    setLasso([]);
    setLassoFillPts([]);
    setFreeformPts([]);
    setTetherView(null);
    setPenPreviewHandle(null);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const p = localFromRect(e.clientX, e.clientY, rect);
    pointers.current.set(e.pointerId, { ...p, type: e.pointerType });
    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }

    // Two-finger pan & pinch-zoom always takes precedence over drawing/editing.
    if (pointers.current.size >= 2) {
      abortActiveVectorDrag();
      layoutDrag.current = null;
      const pts = [...pointers.current.values()];
      const a = pts[0]!;
      const b = pts[1]!;
      pinch.current = {
        d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        z0: view.current.zoom,
        mid0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        cx0: view.current.cx,
        cy0: view.current.cy,
      };
      return;
    }

    if (e.pointerType === "pen") onPencilDetected?.();

    const curTool = latest.current.tool;
    // Middle mouse or Spacebar always pans the canvas.
    if (e.button === 1 || spaceHeld.current) {
      layoutDrag.current = { d: { kind: "pan", cx0: view.current.cx, cy0: view.current.cy }, sx: p.x, sy: p.y };
      return;
    }

    if (curTool === "layout") {
      layoutDrag.current = { d: hitTestLayout(p.x, p.y), sx: p.x, sy: p.y };
      return;
    }

    // Strict palm rejection in Pencil mode: touch cannot create strokes or vector points.
    if (e.pointerType === "touch" && latest.current.pencilOnly) return;
    if (e.pointerType === "touch" && Math.max(e.width, e.height) > 40) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;

    const fontPt = toFont(p.x, p.y);
    const hitTol = 12 / k();
    const curPaths = latest.current.paths;
    const curActiveId = latest.current.activePathId;

    if (curTool === "select") {
      const hit = hitTestNodeOrHandle(curPaths, fontPt, hitTol);
      if (hit) {
        if (hit.kind === "inHandle" || hit.kind === "outHandle") {
          vectorDrag.current = {
            id: e.pointerId,
            type: e.pointerType,
            rect,
            d: { kind: "move-handle", pathId: hit.pathId, nodeId: hit.nodeId, which: hit.kind, breakTangent: e.altKey, basePaths: curPaths, moved: false },
          };
          setIsDraggingVector(true);
          return;
        }
        const targetNode = curPaths.find((cp) => cp.id === hit.pathId)?.nodes.find((cn) => cn.id === hit.nodeId);
        const nextPaths = targetNode?.isSelected && !e.shiftKey ? curPaths : selectNode(curPaths, hit.pathId, hit.nodeId, e.shiftKey);
        if (nextPaths !== curPaths) onPathsChange(nextPaths);
        vectorDrag.current = {
          id: e.pointerId,
          type: e.pointerType,
          rect,
          d: { kind: "move-nodes", startFont: fontPt, basePaths: nextPaths, moved: false },
        };
        setIsDraggingVector(true);
        return;
      }
      vectorDrag.current = {
        id: e.pointerId,
        type: e.pointerType,
        rect,
        d: { kind: "marquee", startFont: fontPt, endFont: fontPt, additive: e.shiftKey },
      };
      setMarquee({ xMin: fontPt[0], yMin: fontPt[1], xMax: fontPt[0], yMax: fontPt[1] });
      return;
    }

    if (curTool === "lasso") {
      vectorDrag.current = {
        id: e.pointerId,
        type: e.pointerType,
        rect,
        d: { kind: "lasso", pts: [fontPt], additive: e.shiftKey },
      };
      setLasso([fontPt]);
      return;
    }

    if (curTool === "lasso-fill") {
      const nx = rect.width ? p.x / rect.width : 0;
      const ny = rect.height ? p.y / rect.height : 0;
      const pressure = e.pointerType === "pen" ? e.pressure || 0.5 : 0.5;
      const tether = latest.current.lazyEnabled && latest.current.lazyRadius > 0
        ? createLazyTether(fontPt[0], fontPt[1], pressure, latest.current.lazyRadius)
        : null;
      vectorDrag.current = {
        id: e.pointerId,
        type: e.pointerType,
        rect,
        d: {
          kind: "lasso-fill",
          pts: [fontPt],
          sample: { x: nx, y: ny, pressure, time: e.timeStamp },
          tether,
          rect,
          erase: latest.current.lassoErase || e.altKey,
        },
      };
      setTetherView(tether);
      setLassoFillPts([fontPt]);
      setIsDraggingVector(true);
      return;
    }

    if (curTool === "freeform") {
      const nx = rect.width ? p.x / rect.width : 0;
      const ny = rect.height ? p.y / rect.height : 0;
      const pressure = e.pointerType === "pen" ? e.pressure || 0.5 : 0.5;
      const tether = latest.current.lazyEnabled && latest.current.lazyRadius > 0
        ? createLazyTether(fontPt[0], fontPt[1], pressure, latest.current.lazyRadius)
        : null;
      vectorDrag.current = {
        id: e.pointerId,
        type: e.pointerType,
        rect,
        d: { kind: "freeform", pts: [fontPt], sample: { x: nx, y: ny, pressure, time: e.timeStamp }, tether, rect },
      };
      setTetherView(tether);
      setFreeformPts([fontPt]);
      setIsDraggingVector(true);
      return;
    }

    if (curTool === "pen") {
      const activePath = curActiveId ? curPaths.find((cp) => cp.id === curActiveId && !cp.closed) : null;
      if (activePath && activePath.nodes.length >= 3) {
        const first = activePath.nodes[0]!;
        if (Math.hypot(fontPt[0] - first.x, fontPt[1] - first.y) <= hitTol) {
          const closedPaths = curPaths.map((cp) => (cp.id === activePath.id ? { ...cp, closed: true } : cp));
          onPathsChange(closedPaths);
          vectorDrag.current = {
            id: e.pointerId,
            type: e.pointerType,
            rect,
            d: { kind: "pen-drag", pathId: activePath.id, nodeId: first.id, anchor: [first.x, first.y], closing: true, moved: false },
          };
          setIsDraggingVector(true);
          return;
        }
      }
      const newNodeId = nextVectorId("pn");
      const base = clearSelection(curPaths);
      let pathId = activePath?.id;
      let nextPaths: VectorPath[];
      const newNode = { id: newNodeId, x: fontPt[0], y: fontPt[1], type: "corner" as const, isSelected: true };
      if (activePath) {
        nextPaths = base.map((cp) => (cp.id === activePath.id ? { ...cp, nodes: [...cp.nodes, newNode] } : cp));
      } else {
        pathId = nextVectorId("path");
        nextPaths = [...base, { id: pathId, closed: false, nodes: [newNode] }];
        onActivePathId(pathId);
      }
      onPathsChange(nextPaths);
      vectorDrag.current = {
        id: e.pointerId,
        type: e.pointerType,
        rect,
        d: { kind: "pen-drag", pathId: pathId!, nodeId: newNodeId, anchor: fontPt, closing: false, moved: false },
      };
      setIsDraggingVector(true);
      return;
    }

    if (curTool === "curvature") {
      const activePath = curActiveId ? curPaths.find((cp) => cp.id === curActiveId && !cp.closed) : null;
      if (activePath && activePath.nodes.length >= 3) {
        const first = activePath.nodes[0]!;
        if (Math.hypot(fontPt[0] - first.x, fontPt[1] - first.y) <= hitTol) {
          const closed = curPaths.map((cp) =>
            cp.id === activePath.id ? { ...cp, closed: true, nodes: computeCurvatureHandles(cp.nodes, true) } : cp,
          );
          onPathsChange(closed, vectorPathsToContours(closed));
          onActivePathId(null);
          return;
        }
      }
      const hit = hitTestNodeOrHandle(curPaths, fontPt, hitTol);
      if (hit && hit.kind === "node") {
        vectorDrag.current = {
          id: e.pointerId,
          type: e.pointerType,
          rect,
          d: { kind: "curvature-drag", pathId: hit.pathId, nodeId: hit.nodeId, startFont: fontPt, basePaths: curPaths, moved: false },
        };
        setIsDraggingVector(true);
        return;
      }
      const newNodeId = nextVectorId("cn");
      const base = clearSelection(curPaths);
      let pathId = activePath?.id;
      let nextPaths: VectorPath[];
      const newNode = { id: newNodeId, x: fontPt[0], y: fontPt[1], type: "smooth" as const, isSelected: true };
      if (activePath) {
        nextPaths = base.map((cp) =>
          cp.id === activePath.id ? { ...cp, nodes: computeCurvatureHandles([...cp.nodes, newNode], false) } : cp,
        );
      } else {
        pathId = nextVectorId("path");
        nextPaths = [...base, { id: pathId, closed: false, nodes: [newNode] }];
        onActivePathId(pathId);
      }
      onPathsChange(nextPaths);
      return;
    }

    if (curTool === "add-anchor") {
      const hit = hitTestSegment(curPaths, fontPt, hitTol);
      if (hit) {
        const { paths: split } = splitSegmentAt(curPaths, hit.pathId, hit.segIndex, hit.t);
        onPathsChange(split, vectorPathsToContours(split));
        setHoverSeg(null);
      }
      return;
    }

    if (curTool === "delete-anchor") {
      const hit = hitTestNodeOrHandle(curPaths, fontPt, hitTol);
      if (hit && hit.kind === "node") {
        const next = deleteNode(curPaths, hit.pathId, hit.nodeId);
        onPathsChange(next, vectorPathsToContours(next));
      }
      return;
    }

    if (curTool === "convert-point") {
      const hit = hitTestNodeOrHandle(curPaths, fontPt, hitTol);
      if (!hit) return;
      if (hit.kind === "inHandle" || hit.kind === "outHandle") {
        vectorDrag.current = {
          id: e.pointerId,
          type: e.pointerType,
          rect,
          d: { kind: "move-handle", pathId: hit.pathId, nodeId: hit.nodeId, which: hit.kind, breakTangent: true, basePaths: curPaths, moved: false },
        };
        setIsDraggingVector(true);
        return;
      }
      const node = curPaths.find((cp) => cp.id === hit.pathId)?.nodes.find((cn) => cn.id === hit.nodeId);
      if (!node) return;
      vectorDrag.current = {
        id: e.pointerId,
        type: e.pointerType,
        rect,
        d: { kind: "convert-drag", pathId: hit.pathId, nodeId: hit.nodeId, anchor: [node.x, node.y], basePaths: curPaths, moved: false },
      };
      setIsDraggingVector(true);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = vectorDrag.current?.rect ?? canvasRef.current!.getBoundingClientRect();
    const p = localFromRect(e.clientX, e.clientY, rect);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { ...p, type: e.pointerType });

    // Multi-touch pan + pinch-zoom
    if (pinch.current && pointers.current.size >= 2) {
      const pts = [...pointers.current.values()];
      const a = pts[0]!;
      const b = pts[1]!;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const nextZoom = Math.max(0.4, Math.min(8, pinch.current.z0 * (d / pinch.current.d0)));
      const k0 = ((size.h || 1) / VIEW_RANGE) * pinch.current.z0;
      const k1 = ((size.h || 1) / VIEW_RANGE) * nextZoom;
      const dxPan = (mid.x - pinch.current.mid0.x) / k1;
      const dyPan = (mid.y - pinch.current.mid0.y) / k0;
      view.current.zoom = nextZoom;
      view.current.cx = pinch.current.cx0 - dxPan;
      view.current.cy = pinch.current.cy0 + dyPan;
      redraw();
      return;
    }

    // Active layout drag
    if (layoutDrag.current) {
      const { d, sx, sy } = layoutDrag.current;
      const K = k();
      const dx = (p.x - sx) / K;
      const dyUp = (sy - p.y) / K;
      switch (d.kind) {
        case "metric":
          onMetrics({ [d.key]: clampMetrics(d.key, toFontY(p.y), latest.current.metrics) });
          break;
        case "baseline":
          view.current.cy = d.cy0 - dyUp;
          onParams({ offsetY: Math.round(d.oy0 - dyUp) });
          break;
        case "lsb":
          view.current.cx = d.cx0 - dx;
          onParams({ lsb: Math.round(d.v0 - dx) });
          break;
        case "rsb":
          onParams({ rsb: Math.round(d.v0 + dx) });
          break;
        case "glyph":
          onParams({ offsetX: Math.round(d.ox0 + dx), offsetY: Math.round(d.oy0 + dyUp) });
          break;
        case "pan":
          view.current.cx = d.cx0 - dx;
          view.current.cy = d.cy0 + dyUp;
          redraw();
          break;
      }
      return;
    }

    const vd = vectorDrag.current;
    const fontPt = toFont(p.x, p.y);
    const curTool = latest.current.tool;

    // Hover feedback when idle
    if (!vd) {
      const canvas = canvasRef.current!;
      if (curTool === "layout") {
        const d = hitTestLayout(p.x, p.y).kind;
        canvas.style.cursor = d === "pan" ? "grab" : d === "glyph" ? "move" : d === "lsb" || d === "rsb" ? "ew-resize" : "ns-resize";
        return;
      }
      canvas.style.cursor = curTool === "select" ? "default" : "crosshair";
      if (curTool === "pen" || curTool === "curvature") {
        setCursorFont(fontPt);
      } else if (curTool === "add-anchor") {
        setHoverSeg(hitTestSegment(latest.current.paths, fontPt, 12 / k()));
      }
      return;
    }

    if (vd.id !== e.pointerId) return;
    e.preventDefault();

    const d = vd.d;
    if (d.kind === "move-nodes") {
      let dx = fontPt[0] - d.startFont[0];
      let dy = fontPt[1] - d.startFont[1];
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      if (Math.hypot(dx, dy) * k() > 2) d.moved = true;
      if (d.moved) onPathsChange(translateSelectedNodes(d.basePaths, dx, dy));
      return;
    }

    if (d.kind === "move-handle") {
      d.moved = true;
      onPathsChange(
        moveNodeHandle(latest.current.paths, d.pathId, d.nodeId, d.which, { x: fontPt[0], y: fontPt[1] }, { breakTangent: d.breakTangent || e.altKey }),
      );
      return;
    }

    if (d.kind === "marquee") {
      d.endFont = fontPt;
      setMarquee({ xMin: d.startFont[0], yMin: d.startFont[1], xMax: fontPt[0], yMax: fontPt[1] });
      return;
    }

    if (d.kind === "lasso") {
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
      for (const ev of events.length ? events : [e.nativeEvent]) {
        const ep = localFromRect(ev.clientX, ev.clientY, vd.rect);
        const fpt = toFont(ep.x, ep.y);
        const last = d.pts[d.pts.length - 1];
        if (!last || Math.hypot(fpt[0] - last[0], fpt[1] - last[1]) * k() >= 4) d.pts.push(fpt);
      }
      setLasso([...d.pts]);
      return;
    }

    if (d.kind === "freeform" || d.kind === "lasso-fill") {
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
      for (const ev of events.length ? events : [e.nativeEvent]) {
        const ep = localFromRect(ev.clientX, ev.clientY, vd.rect);
        let nx = d.rect.width ? ep.x / d.rect.width : 0;
        let ny = d.rect.height ? ep.y / d.rect.height : 0;
        let pressure = vd.type === "pen" ? ev.pressure || 0.5 : 0.5;
        if (vd.type === "pen") {
          const sample = stabilizePencilSample(d.sample, { x: nx, y: ny, pressure: ev.pressure, time: ev.timeStamp }, 0.45);
          if (sample === d.sample) continue;
          d.sample = sample;
          nx = sample.x;
          ny = sample.y;
          pressure = sample.pressure;
        }
        const sx = nx * d.rect.width;
        const sy = ny * d.rect.height;
        let fpt = toFont(sx, sy);
        if (d.tether) {
          const step = stepLazyTether(d.tether, fpt[0], fpt[1], pressure);
          d.tether = step.state;
          if (!step.moved) continue;
          fpt = [step.state.tip.x, step.state.tip.y];
        }
        const last = d.pts[d.pts.length - 1];
        if (!last || Math.hypot(fpt[0] - last[0], fpt[1] - last[1]) * k() >= 3) d.pts.push(fpt);
      }
      if (d.tether) setTetherView(d.tether);
      if (d.kind === "lasso-fill") setLassoFillPts([...d.pts]);
      else setFreeformPts([...d.pts]);
      return;
    }

    if (d.kind === "pen-drag") {
      const distPx = Math.hypot(fontPt[0] - d.anchor[0], fontPt[1] - d.anchor[1]) * k();
      if (distPx > 4) d.moved = true;
      if (d.moved) {
        const h = { x: fontPt[0], y: fontPt[1] };
        setPenPreviewHandle(h);
        onPathsChange(setNodeSymmetricHandles(latest.current.paths, d.pathId, d.nodeId, h, "symmetric"));
      }
      return;
    }

    if (d.kind === "curvature-drag") {
      const dx = fontPt[0] - d.startFont[0];
      const dy = fontPt[1] - d.startFont[1];
      if (Math.hypot(dx, dy) * k() > 3) d.moved = true;
      if (d.moved) {
        const moved = d.basePaths.map((cp) => {
          if (cp.id !== d.pathId) return cp;
          const nodes = cp.nodes.map((cn) => (cn.id === d.nodeId ? { ...cn, x: cn.x + dx, y: cn.y + dy } : cn));
          return { ...cp, nodes: computeCurvatureHandles(nodes, cp.closed) };
        });
        onPathsChange(moved);
      }
      return;
    }

    if (d.kind === "convert-drag") {
      const distPx = Math.hypot(fontPt[0] - d.anchor[0], fontPt[1] - d.anchor[1]) * k();
      if (distPx > 4) d.moved = true;
      if (d.moved) {
        onPathsChange(setNodeSymmetricHandles(d.basePaths, d.pathId, d.nodeId, { x: fontPt[0], y: fontPt[1] }, "symmetric"));
      }
    }
  };

  const finishPointer = (e: React.PointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (layoutDrag.current) {
      layoutDrag.current = null;
      return;
    }

    const vd = vectorDrag.current;
    if (!vd || vd.id !== e.pointerId) return;
    vectorDrag.current = null;
    setIsDraggingVector(false);

    if (cancelled) {
      if (vd.d.kind === "move-nodes" || vd.d.kind === "move-handle" || vd.d.kind === "curvature-drag" || vd.d.kind === "convert-drag") {
        onPathsChange(vd.d.basePaths);
      }
      setMarquee(null);
      setLasso([]);
      setLassoFillPts([]);
      setFreeformPts([]);
      setTetherView(null);
      setPenPreviewHandle(null);
      return;
    }

    const d = vd.d;
    const curPaths = latest.current.paths;
    setTetherView(null);

    if (d.kind === "move-nodes" || d.kind === "move-handle") {
      if (d.moved) onPathsChange(curPaths, vectorPathsToContours(curPaths));
      return;
    }

    if (d.kind === "marquee") {
      const box: BBox = { xMin: d.startFont[0], yMin: d.startFont[1], xMax: d.endFont[0], yMax: d.endFont[1] };
      setMarquee(null);
      if (Math.abs(box.xMax - box.xMin) * k() > 4 || Math.abs(box.yMax - box.yMin) * k() > 4) {
        onPathsChange(selectNodesInBox(curPaths, box, d.additive));
      } else if (!d.additive) {
        onPathsChange(clearSelection(curPaths));
      }
      return;
    }

    if (d.kind === "lasso") {
      setLasso([]);
      if (d.pts.length >= 3) {
        onPathsChange(selectNodesInLasso(curPaths, d.pts, d.additive));
      } else if (!d.additive) {
        onPathsChange(clearSelection(curPaths));
      }
      return;
    }

    if (d.kind === "lasso-fill") {
      setLassoFillPts([]);
      const fitted = lassoPointsToVectorPath(d.pts, {
        closeMode: latest.current.lassoCloseMode,
        threshold: latest.current.lassoThreshold,
        smooth: latest.current.lassoSmooth,
        erase: d.erase,
        nibWidth: latest.current.lassoNibWidth,
      });
      if (fitted) {
        const next = [...clearSelection(curPaths), fitted];
        onPathsChange(next, vectorPathsToContours(next));
      }
      return;
    }

    if (d.kind === "freeform") {
      setFreeformPts([]);
      const fitted = fitFreeformPointsToVectorPath(d.pts, {
        simplifyTolerance: Math.max(4, 10 / Math.max(0.5, view.current.zoom)),
        closeThreshold: 26 / k(),
      });
      if (fitted) {
        const next = [...clearSelection(curPaths), fitted];
        onPathsChange(next, vectorPathsToContours(next));
      }
      return;
    }

    if (d.kind === "pen-drag") {
      setPenPreviewHandle(null);
      if (d.closing) {
        onActivePathId(null);
        onPathsChange(curPaths, vectorPathsToContours(curPaths));
      }
      return;
    }

    if (d.kind === "curvature-drag") {
      if (d.moved) {
        onPathsChange(curPaths, vectorPathsToContours(curPaths));
      } else {
        // Click on an existing node in Curvature mode toggles corner <-> smooth.
        const toggled = curPaths.map((cp) => {
          if (cp.id !== d.pathId) return cp;
          const nodes = cp.nodes.map((cn) =>
            cn.id === d.nodeId ? { ...cn, type: cn.type === "corner" ? ("smooth" as const) : ("corner" as const) } : cn,
          );
          return { ...cp, nodes: computeCurvatureHandles(nodes, cp.closed) };
        });
        onPathsChange(toggled, vectorPathsToContours(toggled));
      }
      return;
    }

    if (d.kind === "convert-drag") {
      if (d.moved) {
        onPathsChange(curPaths, vectorPathsToContours(curPaths));
      } else {
        const next = convertNodeType(d.basePaths, d.pathId, d.nodeId);
        onPathsChange(next, vectorPathsToContours(next));
      }
    }
  };

  const zoomBy = (f: number) => {
    view.current.zoom = Math.max(0.4, Math.min(8, view.current.zoom * f));
    redraw();
  };

  const activePath = activePathId ? paths.find((p) => p.id === activePathId && !p.closed) : null;
  const firstActive = activePath && activePath.nodes.length >= 3 ? activePath.nodes[0]! : null;
  const canCloseActive = Boolean(firstActive && cursorFont && Math.hypot(cursorFont[0] - firstActive.x, cursorFont[1] - firstActive.y) <= 14 / k());

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full overflow-hidden rounded-lg border bg-sheet touch-none overscroll-none select-none [-webkit-touch-callout:none] [-webkit-user-select:none]"
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full touch-none overscroll-none select-none [-webkit-touch-callout:none] [-webkit-user-select:none]"
        style={{ width: size.w, height: size.h }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => finishPointer(e, false)}
        onPointerCancel={(e) => finishPointer(e, true)}
        onPointerLeave={() => { setCursorFont(null); setHoverSeg(null); }}
        onWheel={(e) => zoomBy(Math.exp(-e.deltaY * 0.0015))}
        onDoubleClick={() => {
          if (tool === "layout") { view.current.zoom = 1; fitCenter(); redraw(); }
        }}
        aria-label={`Glyph editor for ${charText(glyph.unicode)}`}
        role="img"
      />
      <VectorOverlay
        width={size.w}
        height={size.h}
        fx={fx}
        fy={fy}
        k={k()}
        paths={paths}
        activePathId={activePathId}
        showNodes={showNodes || tool !== "layout"}
        showLivePaths={isDraggingVector || Boolean(activePath) || tool !== "layout"}
        marquee={marquee}
        lasso={lasso}
        lassoFillPts={lassoFillPts}
        lassoCloseMode={lassoCloseMode}
        lassoThreshold={lassoThreshold}
        lassoErase={lassoErase}
        tether={tetherView}
        freeformPts={freeformPts}
        cursorFont={tool === "pen" || tool === "curvature" ? cursorFont : null}
        penPreviewHandle={penPreviewHandle}
        hoverSeg={tool === "add-anchor" ? hoverSeg : null}
        canCloseActive={canCloseActive}
      />
      <div className="absolute right-3 top-3 flex flex-col gap-1.5">
        <Button variant="sheet" size="icon" className="touch-none select-none [-webkit-user-select:none]" onClick={() => zoomBy(1.25)} aria-label="Zoom in"><ZoomIn /></Button>
        <Button variant="sheet" size="icon" className="touch-none select-none [-webkit-user-select:none]" onClick={() => zoomBy(0.8)} aria-label="Zoom out"><ZoomOut /></Button>
        <Button variant="sheet" size="icon" className="touch-none select-none [-webkit-user-select:none]" onClick={() => { view.current.zoom = 1; fitCenter(); redraw(); }} aria-label="Fit glyph"><Maximize2 /></Button>
      </div>
    </div>
  );
}
