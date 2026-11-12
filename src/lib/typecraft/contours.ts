// Closed Bézier contours in font units (y-up). Shared by tracing, editing, rendering and export.

export type P = [number, number];
export type Seg = { t: "L"; p: P } | { t: "C"; c1: P; c2: P; p: P };
export type Contour = { start: P; segs: Seg[] };
export type BBox = { xMin: number; yMin: number; xMax: number; yMax: number };

export const EMPTY_BBOX: BBox = { xMin: 0, yMin: 0, xMax: 0, yMax: 0 };

/** Parses an SVG path (absolute/relative M L H V C S Q Z) into contours, mapping each point through `map`. */
export function parseSvgPath(d: string, map: (x: number, y: number) => P = (x, y) => [x, y]): Contour[] {
  const tokens = d.match(/[MmLlHhVvCcSsQqZz]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const raw: { start: P; segs: Seg[] }[] = [];
  let i = 0, cmd = "";
  let cur: P = [0, 0], start: P = [0, 0];
  let lastC2: P | null = null;
  let contour: { start: P; segs: Seg[] } | null = null;
  const tok = (k: number) => tokens[k] ?? "";
  const num = () => parseFloat(tok(i++));
  const isCmd = (t: string) => /^[A-Za-z]$/.test(t);
  const begin = (p: P) => {
    contour = { start: p, segs: [] };
    raw.push(contour);
    start = p;
  };
  const ensure = () => { if (!contour) begin(cur); return contour!; };
  while (i < tokens.length) {
    if (isCmd(tok(i))) cmd = tok(i++);
    else if (!cmd) { i++; continue; }
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === "Z") {
      if (contour) {
        const c: { start: P; segs: Seg[] } = contour;
        if (cur[0] !== start[0] || cur[1] !== start[1]) c.segs.push({ t: "L", p: start });
      }
      cur = start;
      contour = null;
      lastC2 = null;
      cmd = "";
      continue;
    }
    if (i >= tokens.length || isCmd(tok(i))) { cmd = ""; continue; }
    const ox = rel ? cur[0] : 0, oy = rel ? cur[1] : 0;
    if (C === "M") {
      const p: P = [num() + ox, num() + oy];
      begin(p); cur = p; lastC2 = null;
      cmd = rel ? "l" : "L";
    } else if (C === "L") {
      const p: P = [num() + ox, num() + oy];
      ensure().segs.push({ t: "L", p }); cur = p; lastC2 = null;
    } else if (C === "H") {
      const p: P = [num() + ox, cur[1]];
      ensure().segs.push({ t: "L", p }); cur = p; lastC2 = null;
    } else if (C === "V") {
      const p: P = [cur[0], num() + oy];
      ensure().segs.push({ t: "L", p }); cur = p; lastC2 = null;
    } else if (C === "C") {
      const c1: P = [num() + ox, num() + oy], c2: P = [num() + ox, num() + oy], p: P = [num() + ox, num() + oy];
      ensure().segs.push({ t: "C", c1, c2, p }); cur = p; lastC2 = c2;
    } else if (C === "S") {
      const c1: P = lastC2 ? [2 * cur[0] - lastC2[0], 2 * cur[1] - lastC2[1]] : cur;
      const c2: P = [num() + ox, num() + oy], p: P = [num() + ox, num() + oy];
      ensure().segs.push({ t: "C", c1, c2, p }); cur = p; lastC2 = c2;
    } else if (C === "Q") {
      const q: P = [num() + ox, num() + oy], p: P = [num() + ox, num() + oy];
      const c1: P = [cur[0] + (2 / 3) * (q[0] - cur[0]), cur[1] + (2 / 3) * (q[1] - cur[1])];
      const c2: P = [p[0] + (2 / 3) * (q[0] - p[0]), p[1] + (2 / 3) * (q[1] - p[1])];
      ensure().segs.push({ t: "C", c1, c2, p }); cur = p; lastC2 = null;
    } else {
      i++;
    }
  }
  return raw
    .filter((c) => c.segs.length > 0)
    .map((c) => mapContour(c, (p) => map(p[0], p[1])));
}

export function mapContour(c: Contour, f: (p: P) => P): Contour {
  return {
    start: f(c.start),
    segs: c.segs.map((s) => (s.t === "L" ? { t: "L", p: f(s.p) } : { t: "C", c1: f(s.c1), c2: f(s.c2), p: f(s.p) })),
  };
}

export const mapContours = (cs: Contour[], f: (p: P) => P) => cs.map((c) => mapContour(c, f));

export function reverseContour(c: Contour): Contour {
  const pts: P[] = [c.start, ...c.segs.map((s) => s.p)];
  const segs: Seg[] = [];
  for (let i = c.segs.length - 1; i >= 0; i--) {
    const s = c.segs[i]!;
    const target = pts[i]!;
    segs.push(s.t === "L" ? { t: "L", p: target } : { t: "C", c1: s.c2, c2: s.c1, p: target });
  }
  return { start: pts[pts.length - 1]!, segs };
}

/** Signed area (positive = counter-clockwise in y-up space), sampling curves for accuracy. */
export function signedArea(c: Contour): number {
  const pts: P[] = [c.start];
  let cur = c.start;
  for (const s of c.segs) {
    if (s.t === "L") pts.push(s.p);
    else for (let k = 1; k <= 8; k++) pts.push(cubicAt(cur, s.c1, s.c2, s.p, k / 8));
    cur = s.p;
  }
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!, [x2, y2] = pts[(i + 1) % pts.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Makes the largest contour counter-clockwise (PostScript/CFF convention), flipping all if needed. */
export function normalizeOrientation(cs: Contour[]): Contour[] {
  if (!cs.length) return cs;
  let big = cs[0], bigA = 0;
  for (const c of cs) {
    const a = signedArea(c);
    if (Math.abs(a) > Math.abs(bigA)) { bigA = a; big = c; }
  }
  void big;
  return bigA < 0 ? cs.map(reverseContour) : cs;
}

export function cubicAt(p0: P, c1: P, c2: P, p3: P, t: number): P {
  const mt = 1 - t;
  const a = mt * mt * mt, b = 3 * mt * mt * t, c = 3 * mt * t * t, d = t * t * t;
  return [a * p0[0] + b * c1[0] + c * c2[0] + d * p3[0], a * p0[1] + b * c1[1] + c * c2[1] + d * p3[1]];
}

function cubicExtrema(a: number, b: number, c: number, d: number): number[] {
  // Roots of the derivative of a 1D cubic Bézier in (0,1)
  const qa = -a + 3 * b - 3 * c + d, qb = 2 * (a - 2 * b + c), qc = b - a;
  const out: number[] = [];
  if (Math.abs(qa) < 1e-9) {
    if (Math.abs(qb) > 1e-9) out.push(-qc / qb);
  } else {
    const disc = qb * qb - 4 * qa * qc;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      out.push((-qb + sq) / (2 * qa), (-qb - sq) / (2 * qa));
    }
  }
  return out.filter((t) => t > 0 && t < 1);
}

/** Exact bounding box of the outline (curve extrema, not control points). */
export function bboxOf(cs: Contour[]): BBox | null {
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  const add = (p: P) => {
    if (p[0] < xMin) xMin = p[0];
    if (p[0] > xMax) xMax = p[0];
    if (p[1] < yMin) yMin = p[1];
    if (p[1] > yMax) yMax = p[1];
  };
  for (const c of cs) {
    let cur = c.start;
    add(cur);
    for (const s of c.segs) {
      add(s.p);
      if (s.t === "C") {
        const ts = [...cubicExtrema(cur[0], s.c1[0], s.c2[0], s.p[0]), ...cubicExtrema(cur[1], s.c1[1], s.c2[1], s.p[1])];
        for (const t of ts) add(cubicAt(cur, s.c1, s.c2, s.p, t));
      }
      cur = s.p;
    }
  }
  return xMin === Infinity ? null : { xMin, yMin, xMax, yMax };
}

export function toSvgD(cs: Contour[], f: (p: P) => P = (p) => p, digits = 1): string {
  const r = (n: number) => +n.toFixed(digits);
  const pt = (p: P) => {
    const q = f(p);
    return `${r(q[0])} ${r(q[1])}`;
  };
  return cs
    .map(
      (c) =>
        `M${pt(c.start)}` +
        c.segs.map((s) => (s.t === "L" ? `L${pt(s.p)}` : `C${pt(s.c1)} ${pt(s.c2)} ${pt(s.p)}`)).join("") +
        "Z",
    )
    .join("");
}

export function countNodes(cs: Contour[]) {
  let on = 0, off = 0;
  for (const c of cs) for (const s of c.segs) { on++; if (s.t === "C") off += 2; }
  return { on, off };
}
