// Editable Vector Bézier data model and geometry engine, bidirectionally coupled to Contour[].
import { getStroke } from "perfect-freehand";
import { cubicAt, reverseContour, signedArea, type BBox, type Contour, type P, type Seg } from "./contours";
import { resolveLasso, type CloseMode } from "./lasso";

export type PointType = "corner" | "smooth" | "symmetric";

export type VectorHandle = { x: number; y: number };

export type VectorNode = {
  id: string;
  x: number; // Font units (0 - 1000 em)
  y: number;
  inHandle?: VectorHandle; // Absolute control handle in font units
  outHandle?: VectorHandle; // Absolute control handle in font units
  type: PointType;
  isSelected?: boolean;
};

export type VectorPath = {
  id: string;
  closed: boolean;
  nodes: VectorNode[];
};

export type VectorTool =
  | "select"
  | "lasso"
  | "lasso-fill"
  | "pen"
  | "freeform"
  | "curvature"
  | "add-anchor"
  | "delete-anchor"
  | "convert-point";

export type NodeHit = {
  pathId: string;
  nodeId: string;
  kind: "node" | "inHandle" | "outHandle";
  dist: number;
};

export type SegmentHit = {
  pathId: string;
  segIndex: number;
  t: number;
  point: P;
  dist: number;
};

let uidCounter = 0;
export const nextVectorId = (prefix = "v"): string => `${prefix}-${(++uidCounter).toString(36)}`;

const EPS = 1e-3;
const nearPt = (a: P, b: P, eps = EPS) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= eps;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpH = (a: VectorHandle, b: VectorHandle, t: number): VectorHandle => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });

/** Infers whether a node's in/out handles are symmetric, smooth (collinear), or corner. */
export function inferPointType(x: number, y: number, inHandle?: VectorHandle, outHandle?: VectorHandle): PointType {
  if (!inHandle || !outHandle) return "corner";
  const inDx = inHandle.x - x;
  const inDy = inHandle.y - y;
  const outDx = outHandle.x - x;
  const outDy = outHandle.y - y;
  const inLen = Math.hypot(inDx, inDy);
  const outLen = Math.hypot(outDx, outDy);
  if (inLen < EPS || outLen < EPS) return "corner";
  const dot = (inDx * outDx + inDy * outDy) / (inLen * outLen);
  if (dot > -0.995) return "corner";
  return Math.abs(inLen - outLen) <= 1.5 ? "symmetric" : "smooth";
}

/** Converts TypeCraft `Contour[]` into editable `VectorPath[]` without duplicating closing anchors. */
export function contoursToVectorPaths(contours: Contour[]): VectorPath[] {
  return contours
    .filter((c) => c.segs.length > 0)
    .map((c, ci) => {
      const segs = [...c.segs];
      const last = segs[segs.length - 1]!;
      const closesToStart = nearPt(last.p, c.start);
      // If the contour didn't explicitly end on `start`, add an implicit closing line segment.
      if (!closesToStart) segs.push({ t: "L", p: c.start });

      const n = segs.length;
      const points: P[] = [c.start, ...segs.slice(0, n - 1).map((s) => s.p)];
      const inHandles: (VectorHandle | undefined)[] = new Array(n).fill(undefined);
      const outHandles: (VectorHandle | undefined)[] = new Array(n).fill(undefined);

      for (let i = 0; i < n; i++) {
        const s = segs[i]!;
        if (s.t === "C") {
          const nextIdx = (i + 1) % n;
          outHandles[i] = { x: s.c1[0], y: s.c1[1] };
          inHandles[nextIdx] = { x: s.c2[0], y: s.c2[1] };
        }
      }

      const nodes: VectorNode[] = points.map((pt, i) => {
        const inH = inHandles[i];
        const outH = outHandles[i];
        return {
          id: nextVectorId(`n${ci}`),
          x: pt[0],
          y: pt[1],
          ...(inH ? { inHandle: inH } : {}),
          ...(outH ? { outHandle: outH } : {}),
          type: inferPointType(pt[0], pt[1], inH, outH),
          isSelected: false,
        };
      });

      return { id: nextVectorId("path"), closed: true, nodes };
    });
}

/** Serializes editable `VectorPath[]` back into TypeCraft `Contour[]` for live preview and font export. */
export function vectorPathsToContours(paths: VectorPath[], opts: { includeOpen?: boolean } = {}): Contour[] {
  const out: Contour[] = [];
  for (const path of paths) {
    if (!path.closed && !opts.includeOpen) continue;
    if (path.nodes.length < 2) continue;
    const count = path.closed ? path.nodes.length : path.nodes.length - 1;
    const segs: Seg[] = [];
    for (let i = 0; i < count; i++) {
      const a = path.nodes[i]!;
      const b = path.nodes[(i + 1) % path.nodes.length]!;
      if (a.outHandle || b.inHandle) {
        const c1: P = a.outHandle ? [a.outHandle.x, a.outHandle.y] : [a.x, a.y];
        const c2: P = b.inHandle ? [b.inHandle.x, b.inHandle.y] : [b.x, b.y];
        segs.push({ t: "C", c1, c2, p: [b.x, b.y] });
      } else {
        segs.push({ t: "L", p: [b.x, b.y] });
      }
    }
    const start = path.nodes[0]!;
    out.push({ start: [start.x, start.y], segs });
  }
  return out;
}

/** Generates an SVG path `d` string for both open and closed VectorPaths. */
export function vectorPathsToSvgD(paths: VectorPath[], map: (p: P) => P = (p) => p, digits = 2): string {
  const r = (n: number) => +n.toFixed(digits);
  const fmt = (p: P) => {
    const q = map(p);
    return `${r(q[0])} ${r(q[1])}`;
  };
  return paths
    .filter((path) => path.nodes.length > 0)
    .map((path) => {
      const first = path.nodes[0]!;
      let d = `M${fmt([first.x, first.y])}`;
      const segCount = path.closed ? path.nodes.length : path.nodes.length - 1;
      for (let i = 0; i < segCount; i++) {
        const a = path.nodes[i]!;
        const b = path.nodes[(i + 1) % path.nodes.length]!;
        if (a.outHandle || b.inHandle) {
          const c1: P = a.outHandle ? [a.outHandle.x, a.outHandle.y] : [a.x, a.y];
          const c2: P = b.inHandle ? [b.inHandle.x, b.inHandle.y] : [b.x, b.y];
          d += `C${fmt(c1)} ${fmt(c2)} ${fmt([b.x, b.y])}`;
        } else {
          d += `L${fmt([b.x, b.y])}`;
        }
      }
      if (path.closed) d += "Z";
      return d;
    })
    .join("");
}

// ---------- Selection & Isolation ----------

export function clearSelection(paths: VectorPath[]): VectorPath[] {
  return paths.map((p) => ({ ...p, nodes: p.nodes.map((n) => (n.isSelected ? { ...n, isSelected: false } : n)) }));
}

export function selectAllNodes(paths: VectorPath[]): VectorPath[] {
  return paths.map((p) => ({ ...p, nodes: p.nodes.map((n) => (n.isSelected ? n : { ...n, isSelected: true })) }));
}

export function selectNode(paths: VectorPath[], pathId: string, nodeId: string, additive = false): VectorPath[] {
  return paths.map((p) => ({
    ...p,
    nodes: p.nodes.map((n) => {
      if (p.id === pathId && n.id === nodeId) return { ...n, isSelected: additive ? !n.isSelected : true };
      return additive ? n : n.isSelected ? { ...n, isSelected: false } : n;
    }),
  }));
}

export function selectNodesInBox(paths: VectorPath[], box: BBox, additive = false): VectorPath[] {
  const xMin = Math.min(box.xMin, box.xMax);
  const xMax = Math.max(box.xMin, box.xMax);
  const yMin = Math.min(box.yMin, box.yMax);
  const yMax = Math.max(box.yMin, box.yMax);
  return paths.map((p) => ({
    ...p,
    nodes: p.nodes.map((n) => {
      const inside = n.x >= xMin && n.x <= xMax && n.y >= yMin && n.y <= yMax;
      return { ...n, isSelected: additive ? Boolean(n.isSelected || inside) : inside };
    }),
  }));
}

/** Ray-casting even-odd point-in-polygon check for freeform Lasso selection. */
export function pointInPolygon(pt: P, polygon: P[]): boolean {
  if (polygon.length < 3) return false;
  const [px, py] = pt;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]!;
    const [xj, yj] = polygon[j]!;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function selectNodesInLasso(paths: VectorPath[], polygon: P[], additive = false): VectorPath[] {
  return paths.map((p) => ({
    ...p,
    nodes: p.nodes.map((n) => {
      const inside = pointInPolygon([n.x, n.y], polygon);
      return { ...n, isSelected: additive ? Boolean(n.isSelected || inside) : inside };
    }),
  }));
}

export function getSelectedNodes(paths: VectorPath[]): { pathId: string; node: VectorNode }[] {
  const out: { pathId: string; node: VectorNode }[] = [];
  for (const p of paths) for (const n of p.nodes) if (n.isSelected) out.push({ pathId: p.id, node: n });
  return out;
}

export function selectedBBox(paths: VectorPath[]): BBox | null {
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (const p of paths) {
    for (const n of p.nodes) {
      if (!n.isSelected) continue;
      if (n.x < xMin) xMin = n.x;
      if (n.x > xMax) xMax = n.x;
      if (n.y < yMin) yMin = n.y;
      if (n.y > yMax) yMax = n.y;
    }
  }
  return xMin === Infinity ? null : { xMin, yMin, xMax, yMax };
}

// ---------- Translation, Transforms & Handle Editing ----------

export function translateNode(n: VectorNode, dx: number, dy: number): VectorNode {
  return {
    ...n,
    x: n.x + dx,
    y: n.y + dy,
    ...(n.inHandle ? { inHandle: { x: n.inHandle.x + dx, y: n.inHandle.y + dy } } : {}),
    ...(n.outHandle ? { outHandle: { x: n.outHandle.x + dx, y: n.outHandle.y + dy } } : {}),
  };
}

export function translateSelectedNodes(paths: VectorPath[], dx: number, dy: number): VectorPath[] {
  if (!dx && !dy) return paths;
  return paths.map((p) => ({
    ...p,
    nodes: p.nodes.map((n) => (n.isSelected ? translateNode(n, dx, dy) : n)),
  }));
}

export function transformSelectedNodes(
  paths: VectorPath[],
  opts: { scaleX?: number; scaleY?: number; rotateDeg?: number; pivot?: P },
): VectorPath[] {
  const bb = selectedBBox(paths);
  if (!bb) return paths;
  const pivot: P = opts.pivot ?? [(bb.xMin + bb.xMax) / 2, (bb.yMin + bb.yMax) / 2];
  const sx = opts.scaleX ?? 1;
  const sy = opts.scaleY ?? 1;
  const rad = ((opts.rotateDeg ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const tx = (x: number, y: number): VectorHandle => {
    const px = (x - pivot[0]) * sx;
    const py = (y - pivot[1]) * sy;
    return {
      x: pivot[0] + px * cos - py * sin,
      y: pivot[1] + px * sin + py * cos,
    };
  };
  return paths.map((p) => ({
    ...p,
    nodes: p.nodes.map((n) => {
      if (!n.isSelected) return n;
      const pt = tx(n.x, n.y);
      return {
        ...n,
        x: pt.x,
        y: pt.y,
        ...(n.inHandle ? { inHandle: tx(n.inHandle.x, n.inHandle.y) } : {}),
        ...(n.outHandle ? { outHandle: tx(n.outHandle.x, n.outHandle.y) } : {}),
      };
    }),
  }));
}

export function moveNodeHandle(
  paths: VectorPath[],
  pathId: string,
  nodeId: string,
  which: "inHandle" | "outHandle",
  pos: VectorHandle,
  opts: { breakTangent?: boolean } = {},
): VectorPath[] {
  return paths.map((p) => {
    if (p.id !== pathId) return p;
    return {
      ...p,
      nodes: p.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        const otherKey = which === "inHandle" ? "outHandle" : "inHandle";
        const other = n[otherKey];
        if (opts.breakTangent || n.type === "corner" || !other) {
          return { ...n, [which]: pos, ...(opts.breakTangent ? { type: "corner" as const } : {}) };
        }
        const dx = pos.x - n.x;
        const dy = pos.y - n.y;
        const len = Math.hypot(dx, dy);
        if (n.type === "symmetric" || len < EPS) {
          return { ...n, [which]: pos, [otherKey]: { x: n.x - dx, y: n.y - dy } };
        }
        // Smooth: preserve opposite handle's length while mirroring direction.
        const otherLen = Math.hypot(other.x - n.x, other.y - n.y);
        const ux = -dx / len;
        const uy = -dy / len;
        return {
          ...n,
          [which]: pos,
          [otherKey]: { x: n.x + ux * otherLen, y: n.y + uy * otherLen },
        };
      }),
    };
  });
}

// ---------- Hit Testing ----------

export function hitTestNodeOrHandle(paths: VectorPath[], pt: P, tolerance: number): NodeHit | null {
  let bestHandle: NodeHit | null = null;
  let bestNode: NodeHit | null = null;

  for (const p of paths) {
    for (const n of p.nodes) {
      const nd = Math.hypot(pt[0] - n.x, pt[1] - n.y);
      if (nd <= tolerance && (!bestNode || nd < bestNode.dist)) {
        bestNode = { pathId: p.id, nodeId: n.id, kind: "node", dist: nd };
      }
      if (n.isSelected) {
        if (n.inHandle) {
          const d = Math.hypot(pt[0] - n.inHandle.x, pt[1] - n.inHandle.y);
          if (d <= tolerance && (!bestHandle || d < bestHandle.dist)) {
            bestHandle = { pathId: p.id, nodeId: n.id, kind: "inHandle", dist: d };
          }
        }
        if (n.outHandle) {
          const d = Math.hypot(pt[0] - n.outHandle.x, pt[1] - n.outHandle.y);
          if (d <= tolerance && (!bestHandle || d < bestHandle.dist)) {
            bestHandle = { pathId: p.id, nodeId: n.id, kind: "outHandle", dist: d };
          }
        }
      }
    }
  }
  return bestHandle ?? bestNode;
}

function closestOnLine(pt: P, a: P, b: P): { t: number; point: P; dist: number } {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const len2 = vx * vx + vy * vy;
  if (len2 < 1e-9) return { t: 0, point: a, dist: Math.hypot(pt[0] - a[0], pt[1] - a[1]) };
  const t = Math.max(0, Math.min(1, ((pt[0] - a[0]) * vx + (pt[1] - a[1]) * vy) / len2));
  const q: P = [a[0] + vx * t, a[1] + vy * t];
  return { t, point: q, dist: Math.hypot(pt[0] - q[0], pt[1] - q[1]) };
}

function closestOnCubic(pt: P, p0: P, c1: P, c2: P, p1: P): { t: number; point: P; dist: number } {
  const SAMPLES = 24;
  let bestT = 0;
  let bestPt = p0;
  let bestD = Infinity;
  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const q = cubicAt(p0, c1, c2, p1, t);
    const d = Math.hypot(pt[0] - q[0], pt[1] - q[1]);
    if (d < bestD) { bestD = d; bestT = t; bestPt = q; }
  }
  // Golden-section local refinement around bestT
  let lo = Math.max(0, bestT - 1 / SAMPLES);
  let hi = Math.min(1, bestT + 1 / SAMPLES);
  for (let iter = 0; iter < 12; iter++) {
    const t1 = lo + (hi - lo) / 3;
    const t2 = hi - (hi - lo) / 3;
    const q1 = cubicAt(p0, c1, c2, p1, t1);
    const q2 = cubicAt(p0, c1, c2, p1, t2);
    const d1 = Math.hypot(pt[0] - q1[0], pt[1] - q1[1]);
    const d2 = Math.hypot(pt[0] - q2[0], pt[1] - q2[1]);
    if (d1 < d2) { hi = t2; if (d1 < bestD) { bestD = d1; bestT = t1; bestPt = q1; } }
    else { lo = t1; if (d2 < bestD) { bestD = d2; bestT = t2; bestPt = q2; } }
  }
  return { t: bestT, point: bestPt, dist: bestD };
}

export function hitTestSegment(paths: VectorPath[], pt: P, tolerance: number): SegmentHit | null {
  let best: SegmentHit | null = null;
  for (const path of paths) {
    if (path.nodes.length < 2) continue;
    const segCount = path.closed ? path.nodes.length : path.nodes.length - 1;
    for (let i = 0; i < segCount; i++) {
      const a = path.nodes[i]!;
      const b = path.nodes[(i + 1) % path.nodes.length]!;
      const p0: P = [a.x, a.y];
      const p1: P = [b.x, b.y];
      const res = a.outHandle || b.inHandle
        ? closestOnCubic(
            pt,
            p0,
            a.outHandle ? [a.outHandle.x, a.outHandle.y] : p0,
            b.inHandle ? [b.inHandle.x, b.inHandle.y] : p1,
            p1,
          )
        : closestOnLine(pt, p0, p1);
      if (res.dist <= tolerance && (!best || res.dist < best.dist)) {
        best = { pathId: path.id, segIndex: i, t: res.t, point: res.point, dist: res.dist };
      }
    }
  }
  return best;
}

// ---------- Anchor Point & Convert Point Operations ----------

/** Splits a line or cubic Bézier segment at `t` using exact De Casteljau subdivision. */
export function splitSegmentAt(paths: VectorPath[], pathId: string, segIndex: number, t: number): { paths: VectorPath[]; newNodeId: string | null } {
  const clampedT = Math.max(0.02, Math.min(0.98, t));
  let newNodeId: string | null = null;
  const nextPaths = paths.map((path) => {
    if (path.id !== pathId || path.nodes.length < 2) return path;
    const count = path.closed ? path.nodes.length : path.nodes.length - 1;
    if (segIndex < 0 || segIndex >= count) return path;

    const aIdx = segIndex;
    const bIdx = (segIndex + 1) % path.nodes.length;
    const a = path.nodes[aIdx]!;
    const b = path.nodes[bIdx]!;
    const nodes: VectorNode[] = path.nodes.map((n) => ({ ...n, isSelected: false }));
    newNodeId = nextVectorId("n");

    if (a.outHandle || b.inHandle) {
      const p0: VectorHandle = { x: a.x, y: a.y };
      const c1: VectorHandle = a.outHandle ?? p0;
      const c2: VectorHandle = b.inHandle ?? { x: b.x, y: b.y };
      const p1: VectorHandle = { x: b.x, y: b.y };
      const q0 = lerpH(p0, c1, clampedT);
      const q1 = lerpH(c1, c2, clampedT);
      const q2 = lerpH(c2, p1, clampedT);
      const r0 = lerpH(q0, q1, clampedT);
      const r1 = lerpH(q1, q2, clampedT);
      const s = lerpH(r0, r1, clampedT);

      nodes[aIdx] = { ...nodes[aIdx]!, outHandle: q0 };
      nodes[bIdx] = { ...nodes[bIdx]!, inHandle: q2 };
      const inserted: VectorNode = {
        id: newNodeId,
        x: s.x,
        y: s.y,
        inHandle: r0,
        outHandle: r1,
        type: "smooth",
        isSelected: true,
      };
      nodes.splice(segIndex + 1, 0, inserted);
    } else {
      const inserted: VectorNode = {
        id: newNodeId,
        x: lerp(a.x, b.x, clampedT),
        y: lerp(a.y, b.y, clampedT),
        type: "corner",
        isSelected: true,
      };
      nodes.splice(segIndex + 1, 0, inserted);
    }
    return { ...path, nodes };
  });
  return { paths: nextPaths, newNodeId };
}

export function deleteNode(paths: VectorPath[], pathId: string, nodeId: string): VectorPath[] {
  return paths
    .map((p) => {
      if (p.id !== pathId) return p;
      const nodes = p.nodes.filter((n) => n.id !== nodeId);
      return { ...p, nodes };
    })
    .filter((p) => p.nodes.length >= (p.closed ? 2 : 1));
}

export function deleteSelectedNodes(paths: VectorPath[]): VectorPath[] {
  return paths
    .map((p) => ({ ...p, nodes: p.nodes.filter((n) => !n.isSelected) }))
    .filter((p) => p.nodes.length >= (p.closed ? 2 : 1));
}

/** Converts a node between sharp corner and smooth/symmetric handles. */
export function convertNodeType(paths: VectorPath[], pathId: string, nodeId: string, targetType?: PointType): VectorPath[] {
  return paths.map((p) => {
    if (p.id !== pathId) return p;
    const idx = p.nodes.findIndex((n) => n.id === nodeId);
    if (idx === -1) return p;
    const n = p.nodes[idx]!;
    const nextType: PointType = targetType ?? (n.type === "corner" && !n.inHandle && !n.outHandle ? "smooth" : "corner");
    const nodes = [...p.nodes];

    if (nextType === "corner") {
      const { inHandle: _i, outHandle: _o, ...rest } = n;
      nodes[idx] = { ...rest, type: "corner", isSelected: true };
      return { ...p, nodes };
    }

    // Synthesize smooth handles from neighboring nodes if none exist yet.
    const count = p.nodes.length;
    const prev = p.closed ? p.nodes[(idx - 1 + count) % count] : p.nodes[idx - 1];
    const next = p.closed ? p.nodes[(idx + 1) % count] : p.nodes[idx + 1];
    let tx = 1;
    let ty = 0;
    let baseLen = 40;
    if (prev && next) {
      const vx = next.x - prev.x;
      const vy = next.y - prev.y;
      const vLen = Math.hypot(vx, vy);
      if (vLen > EPS) {
        tx = vx / vLen;
        ty = vy / vLen;
        baseLen = Math.min(80, Math.max(20, vLen * 0.2));
      }
    } else if (next) {
      const vx = next.x - n.x;
      const vy = next.y - n.y;
      const vLen = Math.hypot(vx, vy);
      if (vLen > EPS) { tx = vx / vLen; ty = vy / vLen; baseLen = Math.min(80, vLen * 0.25); }
    } else if (prev) {
      const vx = n.x - prev.x;
      const vy = n.y - prev.y;
      const vLen = Math.hypot(vx, vy);
      if (vLen > EPS) { tx = vx / vLen; ty = vy / vLen; baseLen = Math.min(80, vLen * 0.25); }
    }

    const inHandle = { x: n.x - tx * baseLen, y: n.y - ty * baseLen };
    const outHandle = { x: n.x + tx * baseLen, y: n.y + ty * baseLen };
    nodes[idx] = { ...n, inHandle, outHandle, type: nextType, isSelected: true };
    return { ...p, nodes };
  });
}

export function setNodeSymmetricHandles(
  paths: VectorPath[],
  pathId: string,
  nodeId: string,
  outHandle: VectorHandle,
  type: PointType = "symmetric",
): VectorPath[] {
  return paths.map((p) => {
    if (p.id !== pathId) return p;
    return {
      ...p,
      nodes: p.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        const dx = outHandle.x - n.x;
        const dy = outHandle.y - n.y;
        return {
          ...n,
          type,
          outHandle,
          inHandle: { x: n.x - dx, y: n.y - dy },
        };
      }),
    };
  });
}

// ---------- Curvature Pen Tool (Catmull-Rom Tangent Fitting) ----------

/** Computes smooth cubic Bézier handles for all non-corner nodes along a path. */
export function computeCurvatureHandles(nodes: VectorNode[], closed: boolean, tension = 0.28): VectorNode[] {
  const n = nodes.length;
  if (n < 2) return nodes;
  return nodes.map((cur, i) => {
    if (cur.type === "corner") {
      const { inHandle: _i, outHandle: _o, ...rest } = cur;
      return rest;
    }
    const prev = closed ? nodes[(i - 1 + n) % n]! : nodes[i - 1];
    const next = closed ? nodes[(i + 1) % n]! : nodes[i + 1];
    if (!prev || !next) {
      const { inHandle: _i, outHandle: _o, ...rest } = cur;
      return rest;
    }
    const vx = next.x - prev.x;
    const vy = next.y - prev.y;
    const vLen = Math.hypot(vx, vy);
    if (vLen < EPS) return cur;
    const ux = vx / vLen;
    const uy = vy / vLen;
    const dPrev = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const dNext = Math.hypot(next.x - cur.x, next.y - cur.y);
    return {
      ...cur,
      inHandle: { x: cur.x - ux * dPrev * tension, y: cur.y - uy * dPrev * tension },
      outHandle: { x: cur.x + ux * dNext * tension, y: cur.y + uy * dNext * tension },
    };
  });
}

// ---------- Freeform Pen Tool (RDP Simplification + Cubic Curve Fitting) ----------

function perpendicularDist(pt: P, a: P, b: P): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return Math.hypot(pt[0] - a[0], pt[1] - a[1]);
  const t = ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / len2;
  const px = a[0] + t * dx;
  const py = a[1] + t * dy;
  return Math.hypot(pt[0] - px, pt[1] - py);
}

/** Ramer-Douglas-Peucker polyline simplification in font units. */
export function simplifyPoints(pts: P[], tolerance: number): P[] {
  if (pts.length <= 2) return pts;
  let maxDist = 0;
  let maxIdx = 0;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpendicularDist(pts[i]!, first, last);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > tolerance) {
    const left = simplifyPoints(pts.slice(0, maxIdx + 1), tolerance);
    const right = simplifyPoints(pts.slice(maxIdx), tolerance);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

/** Fits raw freeform Apple Pencil / mouse points into a clean cubic Bézier VectorPath. */
export function fitFreeformPointsToVectorPath(
  points: P[],
  opts: { simplifyTolerance?: number; closeThreshold?: number; cornerAngleDeg?: number } = {},
): VectorPath | null {
  const tol = opts.simplifyTolerance ?? 10;
  const closeThreshold = opts.closeThreshold ?? 28;
  const cornerCos = Math.cos(((opts.cornerAngleDeg ?? 55) * Math.PI) / 180);

  if (points.length < 2) return null;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const closed = points.length >= 4 && Math.hypot(last[0] - first[0], last[1] - first[1]) <= closeThreshold;
  const basePts = closed ? points.slice(0, -1) : points;
  const simplified = simplifyPoints(basePts, tol);
  if (simplified.length < 2) return null;

  const n = simplified.length;
  const rawNodes: VectorNode[] = simplified.map((pt, i) => {
    let type: PointType = "smooth";
    if (!closed && (i === 0 || i === n - 1)) {
      type = "corner";
    } else {
      const prev = simplified[(i - 1 + n) % n]!;
      const next = simplified[(i + 1) % n]!;
      const v1x = pt[0] - prev[0];
      const v1y = pt[1] - prev[1];
      const v2x = next[0] - pt[0];
      const v2y = next[1] - pt[1];
      const l1 = Math.hypot(v1x, v1y);
      const l2 = Math.hypot(v2x, v2y);
      if (l1 > EPS && l2 > EPS) {
        const dot = (v1x * v2x + v1y * v2y) / (l1 * l2);
        if (dot < cornerCos) type = "corner";
      }
    }
    return { id: nextVectorId("fn"), x: pt[0], y: pt[1], type, isSelected: false };
  });

  const nodes = computeCurvatureHandles(rawNodes, closed, 0.3);
  return { id: nextVectorId("path"), closed, nodes };
}

/** Converts a Studio Lasso Fill polyline into a smooth VectorPath (CCW to fill, CW to subtract, or ribbon if open). */
export function lassoPointsToVectorPath(
  points: P[],
  opts: { closeMode: CloseMode; threshold: number; smooth?: number; erase?: boolean; nibWidth?: number },
): VectorPath | null {
  const smoothAmt = opts.smooth ?? 0.7;
  const resolved = resolveLasso(points, opts.closeMode, opts.threshold, smoothAmt);
  if (resolved.polygon.length < 2) return null;

  let poly: P[];
  if (resolved.closed) {
    poly = resolved.polygon;
  } else {
    const ribbon = getStroke(
      resolved.polygon.map(([x, y]): [number, number, number] => [x, y, 0.5]),
      {
        size: opts.nibWidth ?? 55,
        thinning: 0,
        smoothing: 0.75,
        streamline: smoothAmt * 0.5,
        simulatePressure: false,
      },
    );
    if (ribbon.length < 3) return null;
    poly = ribbon.map(([x = 0, y = 0]): P => [x, y]);
  }

  const cornerCos = Math.cos((65 * Math.PI) / 180);
  const n = poly.length;
  const rawNodes: VectorNode[] = poly.map((pt, i) => {
    const prev = poly[(i - 1 + n) % n]!;
    const next = poly[(i + 1) % n]!;
    const v1x = pt[0] - prev[0], v1y = pt[1] - prev[1];
    const v2x = next[0] - pt[0], v2y = next[1] - pt[1];
    const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
    const isCorner = l1 > EPS && l2 > EPS && (v1x * v2x + v1y * v2y) / (l1 * l2) < cornerCos;
    return { id: nextVectorId("lf"), x: pt[0], y: pt[1], type: isCorner ? "corner" : "smooth", isSelected: false };
  });

  const nodes = computeCurvatureHandles(rawNodes, true, 0.25);
  let path: VectorPath = { id: nextVectorId("path"), closed: true, nodes };
  const contour = vectorPathsToContours([path])[0];
  if (contour) {
    const area = signedArea(contour);
    const wantClockwise = Boolean(opts.erase && resolved.closed);
    if ((wantClockwise && area > 0) || (!wantClockwise && area < 0)) {
      const reversed = reverseContour(contour);
      path = contoursToVectorPaths([reversed])[0] ?? path;
    }
  }
  return path;
}
