import { useEffect, useReducer, useRef, useState } from "react";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { toSvgD } from "@/lib/typecraft/contours";
import type { Metrics } from "@/lib/typecraft/font";
import type { GlyphParams, LaidOutGlyph } from "@/lib/typecraft/layout";
import type { GlyphRecord } from "@/lib/typecraft/store";
import { TILE, UNITS_PER_EM } from "@/lib/typecraft/trace";
import { BOX_GUIDES } from "@/lib/typecraft/template";
import { Button } from "@/components/ui/button";

type MetricKey = keyof Metrics;
type Drag =
  | { kind: "metric"; key: MetricKey }
  | { kind: "baseline"; oy0: number; cy0: number }
  | { kind: "lsb"; v0: number; cx0: number }
  | { kind: "rsb"; v0: number }
  | { kind: "glyph"; ox0: number; oy0: number }
  | { kind: "pan"; cx0: number; cy0: number };

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
  showNodes: boolean;
  showFill: boolean;
  showSource: boolean;
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

export function GlyphCanvas({ glyph, laid, metrics, showNodes, showFill, showSource, onParams, onMetrics }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const view = useRef({ cx: 0, cy: VIEW_MID, zoom: 1 });
  const drag = useRef<{ d: Drag; sx: number; sy: number } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d0: number; z0: number } | null>(null);
  const tileCache = useRef<{ src: Uint8Array | null; canvas: HTMLCanvasElement | null }>({ src: null, canvas: null });
  const [tick, redraw] = useReducer((x: number) => x + 1, 0);
  const latest = useRef({ laid, metrics, glyph });
  latest.current = { laid, metrics, glyph };

  const fitCenter = () => {
    const l = latest.current.laid;
    view.current.cx = latest.current.glyph.isMark ? (l.bbox ? l.bbox.xMin / 2 : 0) : l.advance / 2;
    view.current.cy = VIEW_MID;
  };

  useEffect(() => {
    fitCenter();
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glyph.id]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const k = () => (size.h / VIEW_RANGE) * view.current.zoom;
  const fx = (x: number) => size.w / 2 + (x - view.current.cx) * k();
  const fy = (y: number) => size.h / 2 - (y - view.current.cy) * k();
  const toFontY = (sy: number) => view.current.cy + (size.h / 2 - sy) / k();

  // ---------- drawing ----------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size.w || !size.h) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(size.w * dpr)) canvas.width = Math.round(size.w * dpr);
    if (canvas.height !== Math.round(size.h * dpr)) canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext("2d")!;
    const c = cssColors(canvas);
    const { w, h } = size;
    const K = k();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = c.sheet;
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
        ctx.fillRect(fx(0), fy(metrics.ascender), (bb.xMin) * K, (metrics.ascender - metrics.descender) * K);
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
          const v = glyph.source[i];
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
    const baselineLabelY = fy(0);
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
    void baselineLabelY;

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
    } else {
      ctx.fillStyle = c.muted;
      ctx.font = "14px 'IBM Plex Sans', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(glyph.source ? "This box was empty on the template" : "Not traced yet", w / 2, h / 2);
      ctx.textAlign = "start";
    }

    // Bézier nodes
    if (showNodes) {
      for (const cont of laid.contours) {
        let prev = cont.start;
        for (const s of cont.segs) {
          if (s.t === "C") {
            ctx.strokeStyle = c.proof;
            ctx.globalAlpha = 0.55;
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(fx(prev[0]), fy(prev[1])); ctx.lineTo(fx(s.c1[0]), fy(s.c1[1])); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(fx(s.p[0]), fy(s.p[1])); ctx.lineTo(fx(s.c2[0]), fy(s.c2[1])); ctx.stroke();
            ctx.globalAlpha = 1;
            for (const cp of [s.c1, s.c2]) {
              ctx.beginPath(); ctx.arc(fx(cp[0]), fy(cp[1]), 2.5, 0, Math.PI * 2);
              ctx.fillStyle = c.card; ctx.fill(); ctx.strokeStyle = c.proof; ctx.stroke();
            }
          }
          ctx.fillStyle = c.proof;
          ctx.fillRect(fx(s.p[0]) - 3, fy(s.p[1]) - 3, 6, 6);
          prev = s.p;
        }
      }
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
  }, [laid, metrics, size, showNodes, showFill, showSource, glyph, tick]);

  // ---------- interaction ----------
  const hitTest = (sx: number, sy: number): Drag => {
    const p = latest.current.glyph.params;
    const m = latest.current.metrics;
    const l = latest.current.laid;
    const isMark = latest.current.glyph.isMark;
    // Metric pills on the left edge
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

  const local = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    canvasRef.current!.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d0: Math.hypot(a.x - b.x, a.y - b.y), z0: view.current.zoom };
      drag.current = null;
      return;
    }
    drag.current = { d: hitTest(p.x, p.y), sx: p.x, sy: p.y };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = local(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p);
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      view.current.zoom = Math.max(0.4, Math.min(5, pinch.current.z0 * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.d0)));
      redraw();
      return;
    }
    const canvas = canvasRef.current!;
    if (!drag.current) {
      const d = hitTest(p.x, p.y).kind;
      canvas.style.cursor = d === "pan" ? "grab" : d === "glyph" ? "move" : d === "lsb" || d === "rsb" ? "ew-resize" : "ns-resize";
      return;
    }
    const { d, sx, sy } = drag.current;
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
        view.current.cy = d.cy0 - dyUp;
        redraw();
        break;
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    drag.current = null;
  };

  const zoomBy = (f: number) => {
    view.current.zoom = Math.max(0.4, Math.min(5, view.current.zoom * f));
    redraw();
  };

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden rounded-lg border bg-sheet">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full touch-none select-none"
        style={{ width: size.w, height: size.h }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={(e) => zoomBy(Math.exp(-e.deltaY * 0.0015))}
        onDoubleClick={() => { view.current.zoom = 1; fitCenter(); redraw(); }}
        aria-label={`Glyph editor for ${String.fromCodePoint(glyph.unicode)}`}
        role="img"
      />
      <div className="absolute right-3 top-3 flex flex-col gap-1.5">
        <Button variant="sheet" size="icon" onClick={() => zoomBy(1.25)} aria-label="Zoom in"><ZoomIn /></Button>
        <Button variant="sheet" size="icon" onClick={() => zoomBy(0.8)} aria-label="Zoom out"><ZoomOut /></Button>
        <Button variant="sheet" size="icon" onClick={() => { view.current.zoom = 1; fitCenter(); redraw(); }} aria-label="Fit glyph"><Maximize2 /></Button>
      </div>
    </div>
  );
}
