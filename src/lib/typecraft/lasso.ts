// Pure Lasso Fill geometry: deduplication, RDP simplification, closing rules, and nonzero-winding area.
export type CloseMode = "far" | "off" | "always";
export type Point = [number, number];

export const DEFAULT_LASSO_THRESHOLD = 120;
export const LASSO_THRESHOLD_MIN = 20;
export const LASSO_THRESHOLD_MAX = 400;
export const LASSO_SIMPLIFY_TOLERANCE = 1.5;
export const LASSO_MIN_AREA = 40;

const DEDUP_EPS = 1e-4;
const SNAP_EPS = 8;

/**
 * Corner-preserving Chaikin curve smoothing for freehand lasso contours.
 * Smooths hand jitter along gentle curves while keeping sharp geometric corners (> ~65 deg) intact.
 */
export function smoothLassoPolygon(points: Point[], smoothAmount: number, closed: boolean): Point[] {
  const amt = Math.max(0, Math.min(1, smoothAmount));
  if (amt <= 0.02 || points.length < 3) return points;

  const passes = amt >= 0.5 ? 2 : 1;
  const cut = 0.25 * Math.min(1, amt * 1.15);
  const cornerCos = Math.cos((65 * Math.PI) / 180);
  let cur = points;

  for (let pass = 0; pass < passes; pass++) {
    const n = cur.length;
    if (n < 3) break;
    const nextPts: Point[] = [];
    for (let i = 0; i < n; i++) {
      const p = cur[i]!;
      const prev = closed ? cur[(i - 1 + n) % n]! : cur[i - 1];
      const next = closed ? cur[(i + 1) % n]! : cur[i + 1];

      let isCorner = !prev || !next;
      if (prev && next) {
        const v1x = p[0] - prev[0];
        const v1y = p[1] - prev[1];
        const v2x = next[0] - p[0];
        const v2y = next[1] - p[1];
        const l1 = Math.hypot(v1x, v1y);
        const l2 = Math.hypot(v2x, v2y);
        if (l1 > DEDUP_EPS && l2 > DEDUP_EPS) {
          const dot = (v1x * v2x + v1y * v2y) / (l1 * l2);
          if (dot < cornerCos) isCorner = true;
        }
      }

      if (isCorner) {
        nextPts.push(p);
      } else {
        nextPts.push([p[0] + (prev![0] - p[0]) * cut, p[1] + (prev![1] - p[1]) * cut]);
        nextPts.push([p[0] + (next![0] - p[0]) * cut, p[1] + (next![1] - p[1]) * cut]);
      }
    }
    cur = nextPts;
  }
  return cur;
}

function perpendicularDistance(pt: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return Math.hypot(pt[0] - a[0], pt[1] - a[1]);
  const t = ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dy) / len2;
  return Math.hypot(pt[0] - (a[0] + t * dx), pt[1] - (a[1] + t * dy));
}

/** Ramer-Douglas-Peucker simplification preserving start and end points. */
export function simplifyLassoPoints(points: Point[], tolerance = LASSO_SIMPLIFY_TOLERANCE): Point[] {
  if (points.length <= 2) return points;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  let maxDist = 0;
  let maxIdx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i]!, first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }
  if (maxDist > tolerance) {
    const left = simplifyLassoPoints(points.slice(0, maxIdx + 1), tolerance);
    const right = simplifyLassoPoints(points.slice(maxIdx), tolerance);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

/**
 * Exact nonzero-winding area of a polygon, supporting self-intersecting loops (such as figure-8 shapes).
 */
export function nonzeroPolygonArea(poly: Point[]): number {
  if (poly.length < 3) return 0;
  const ySet = new Set<number>(poly.map((p) => p[1]));
  if (poly.length <= 150) {
    // Include edge-edge crossing Y coordinates so slabs never span a crossing pinch point.
    for (let i = 0; i < poly.length; i++) {
      const a1 = poly[i]!;
      const a2 = poly[(i + 1) % poly.length]!;
      const dax = a2[0] - a1[0];
      const day = a2[1] - a1[1];
      for (let j = i + 2; j < poly.length; j++) {
        if (i === 0 && j === poly.length - 1) continue;
        const b1 = poly[j]!;
        const b2 = poly[(j + 1) % poly.length]!;
        const dbx = b2[0] - b1[0];
        const dby = b2[1] - b1[1];
        const denom = dax * dby - day * dbx;
        if (Math.abs(denom) < 1e-9) continue;
        const t = ((b1[0] - a1[0]) * dby - (b1[1] - a1[1]) * dbx) / denom;
        const u = ((b1[0] - a1[0]) * day - (b1[1] - a1[1]) * dax) / denom;
        if (t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6) {
          ySet.add(a1[1] + t * day);
        }
      }
    }
  }
  const ys = Array.from(ySet).sort((a, b) => a - b);
  let area = 0;
  for (let yi = 0; yi < ys.length - 1; yi++) {
    const y0 = ys[yi]!;
    const y1 = ys[yi + 1]!;
    const dy = y1 - y0;
    if (dy <= 1e-9) continue;
    const subCount = poly.length > 150 ? 4 : 1;
    const subDy = dy / subCount;
    for (let s = 0; s < subCount; s++) {
      const sy = y0 + (s + 0.5) * subDy;
      const xs: { x: number; d: number }[] = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i]!;
        const b = poly[(i + 1) % poly.length]!;
        if ((a[1] <= sy) === (b[1] <= sy)) continue;
        const t = (sy - a[1]) / (b[1] - a[1]);
        xs.push({ x: a[0] + (b[0] - a[0]) * t, d: b[1] > a[1] ? 1 : -1 });
      }
      xs.sort((p, q) => p.x - q.x);
      let w = 0;
      for (let i = 0; i < xs.length - 1; i++) {
        w += xs[i]!.d;
        if (w !== 0) area += Math.max(0, xs[i + 1]!.x - xs[i]!.x) * subDy;
      }
    }
  }
  return area;
}

/**
 * Resolves a raw lasso loop (in em units, 0..1000) into either a closed fill polygon
 * or an open outline path according to `closeMode` and `threshold`.
 */
export function resolveLasso(
  points: Point[],
  closeMode: CloseMode,
  threshold = DEFAULT_LASSO_THRESHOLD,
  smoothAmount = 0,
): { closed: boolean; polygon: Point[] } {
  const deduped: Point[] = [];
  for (const pt of points) {
    if (!Number.isFinite(pt[0]) || !Number.isFinite(pt[1])) continue;
    const prev = deduped[deduped.length - 1];
    if (!prev || Math.hypot(pt[0] - prev[0], pt[1] - prev[1]) > DEDUP_EPS) {
      deduped.push([pt[0], pt[1]]);
    }
  }
  if (deduped.length < 2) return { closed: false, polygon: deduped };

  const simplified = simplifyLassoPoints(deduped, LASSO_SIMPLIFY_TOLERANCE);
  const start = simplified[0]!;
  const end = simplified[simplified.length - 1]!;
  const gap = Math.hypot(end[0] - start[0], end[1] - start[1]);

  let wantsClose = false;
  if (closeMode === "always") wantsClose = true;
  else if (closeMode === "far") wantsClose = gap <= threshold;

  if (!wantsClose) {
    return { closed: false, polygon: smoothAmount > 0 ? smoothLassoPolygon(simplified, smoothAmount, false) : simplified };
  }

  // Snap endpoint onto start when within snap tolerance (or micro-duplicate), leaving a clean closing edge.
  const basePolygon = [...simplified];
  if (basePolygon.length > 3 && (gap <= DEDUP_EPS || (closeMode === "always" && gap <= Math.min(threshold, SNAP_EPS)))) {
    basePolygon.pop();
  }

  const polygon = smoothAmount > 0 ? smoothLassoPolygon(basePolygon, smoothAmount, true) : basePolygon;
  if (polygon.length < 3 || nonzeroPolygonArea(polygon) < LASSO_MIN_AREA) {
    return { closed: false, polygon: simplified };
  }
  return { closed: true, polygon };
}
