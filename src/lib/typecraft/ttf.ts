// Converts an opentype.js CFF font into a TrueType (glyf/loca) font with the same tables and glyph order.
import { reverseContour, type Contour, type P } from "./contours";

type TTPoint = { x: number; y: number; on: boolean };

/** Approximates a cubic with quadratic pieces; returns [control, end] pairs. */
export function cubicToQuads(p0: P, c1: P, c2: P, p3: P, tolerance = 0.75): [P, P][] {
  const ex = p3[0] - 3 * c2[0] + 3 * c1[0] - p0[0];
  const ey = p3[1] - 3 * c2[1] + 3 * c1[1] - p0[1];
  const err = (Math.sqrt(3) / 36) * Math.hypot(ex, ey);
  const n = Math.min(16, Math.max(1, Math.ceil(Math.cbrt(err / tolerance))));
  const at = (t: number): P => {
    const mt = 1 - t;
    return [
      mt ** 3 * p0[0] + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t ** 3 * p3[0],
      mt ** 3 * p0[1] + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t ** 3 * p3[1],
    ];
  };
  const deriv = (t: number): P => {
    const mt = 1 - t;
    return [
      3 * mt * mt * (c1[0] - p0[0]) + 6 * mt * t * (c2[0] - c1[0]) + 3 * t * t * (p3[0] - c2[0]),
      3 * mt * mt * (c1[1] - p0[1]) + 6 * mt * t * (c2[1] - c1[1]) + 3 * t * t * (p3[1] - c2[1]),
    ];
  };
  const out: [P, P][] = [];
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n, dt = (t1 - t0) / 3;
    const q0 = at(t0), q3 = i === n - 1 ? p3 : at(t1);
    const d0 = deriv(t0), d1 = deriv(t1);
    const q1: P = [q0[0] + d0[0] * dt, q0[1] + d0[1] * dt];
    const q2: P = [q3[0] - d1[0] * dt, q3[1] - d1[1] * dt];
    out.push([[(3 * (q1[0] + q2[0]) - q0[0] - q3[0]) / 4, (3 * (q1[1] + q2[1]) - q0[1] - q3[1]) / 4], q3]);
  }
  return out;
}

function toTTContours(contours: Contour[]): TTPoint[][] {
  const result: TTPoint[][] = [];
  for (const src of contours) {
    // TrueType wants clockwise outer contours: the opposite of CFF.
    const c = reverseContour(src);
    const pts: TTPoint[] = [{ x: c.start[0], y: c.start[1], on: true }];
    let cur = c.start;
    for (const s of c.segs) {
      if (s.t === "L") pts.push({ x: s.p[0], y: s.p[1], on: true });
      else for (const [q, e] of cubicToQuads(cur, s.c1, s.c2, s.p)) pts.push({ x: q[0], y: q[1], on: false }, { x: e[0], y: e[1], on: true });
      cur = s.p;
    }
    const rounded = pts.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), on: p.on }));
    const clean: TTPoint[] = [];
    for (const p of rounded) {
      const prev = clean[clean.length - 1];
      if (prev && prev.x === p.x && prev.y === p.y && prev.on && p.on) continue;
      clean.push(p);
    }
    const first = clean[0], last = clean[clean.length - 1];
    if (first && last && clean.length > 1 && last.on && first.x === last.x && first.y === last.y) clean.pop();
    if (clean.length >= 3) result.push(clean);
  }
  return result;
}

function encodeGlyph(contours: Contour[]) {
  const tt = toTTContours(contours);
  if (!tt.length) return { bytes: new Uint8Array(0), points: 0, contours: 0 };
  const all = tt.flat();
  const n = all.length;
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (const p of all) {
    xMin = Math.min(xMin, p.x); xMax = Math.max(xMax, p.x);
    yMin = Math.min(yMin, p.y); yMax = Math.max(yMax, p.y);
  }
  const len = 10 + 2 * tt.length + 2 + n + 4 * n;
  const padded = (len + 3) & ~3;
  const buf = new Uint8Array(padded);
  const dv = new DataView(buf.buffer);
  let o = 0;
  dv.setInt16(o, tt.length); o += 2;
  dv.setInt16(o, xMin); dv.setInt16(o + 2, yMin); dv.setInt16(o + 4, xMax); dv.setInt16(o + 6, yMax); o += 8;
  let end = -1;
  for (const c of tt) { end += c.length; dv.setUint16(o, end); o += 2; }
  dv.setUint16(o, 0); o += 2; // no hinting instructions
  for (const p of all) buf[o++] = p.on ? 1 : 0; // every coordinate stored as a 16-bit delta
  let px = 0;
  for (const p of all) { dv.setInt16(o, p.x - px); px = p.x; o += 2; }
  let py = 0;
  for (const p of all) { dv.setInt16(o, p.y - py); py = p.y; o += 2; }
  return { bytes: buf, points: n, contours: tt.length };
}

function checksum(b: Uint8Array): number {
  const padded = new Uint8Array((b.length + 3) & ~3);
  padded.set(b);
  const dv = new DataView(padded.buffer);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + dv.getUint32(i)) >>> 0;
  return sum;
}

export function otfToTtf(otf: ArrayBuffer, glyphOutlines: Contour[][]): ArrayBuffer {
  const dv = new DataView(otf);
  const numTables = dv.getUint16(4);
  const tables = new Map<string, Uint8Array>();
  for (let i = 0; i < numTables; i++) {
    const r = 12 + i * 16;
    const tag = String.fromCharCode(dv.getUint8(r), dv.getUint8(r + 1), dv.getUint8(r + 2), dv.getUint8(r + 3));
    const off = dv.getUint32(r + 8), len = dv.getUint32(r + 12);
    tables.set(tag, new Uint8Array(otf.slice(off, off + len)));
  }
  tables.delete("CFF ");

  const encoded = glyphOutlines.map(encodeGlyph);
  const glyfLen = encoded.reduce((a, g) => a + g.bytes.length, 0);
  const glyf = new Uint8Array(glyfLen);
  const loca = new Uint8Array(4 * (encoded.length + 1));
  const locaDv = new DataView(loca.buffer);
  let off = 0;
  encoded.forEach((g, i) => {
    locaDv.setUint32(i * 4, off);
    glyf.set(g.bytes, off);
    off += g.bytes.length;
  });
  locaDv.setUint32(encoded.length * 4, off);
  tables.set("glyf", glyf);
  tables.set("loca", loca);

  const head = new Uint8Array(tables.get("head")!);
  const headDv = new DataView(head.buffer);
  headDv.setUint32(8, 0);
  headDv.setInt16(50, 1); // long loca offsets
  headDv.setInt16(52, 0);
  tables.set("head", head);

  const maxp = new Uint8Array(32);
  const m = new DataView(maxp.buffer);
  m.setUint32(0, 0x00010000);
  m.setUint16(4, encoded.length);
  m.setUint16(6, Math.max(0, ...encoded.map((g) => g.points)));
  m.setUint16(8, Math.max(0, ...encoded.map((g) => g.contours)));
  m.setUint16(14, 2); // maxZones
  tables.set("maxp", maxp);

  const tags = [...tables.keys()].sort();
  const n = tags.length;
  const entrySelector = Math.floor(Math.log2(n));
  const searchRange = 2 ** entrySelector * 16;
  let total = 12 + 16 * n;
  for (const t of tags) total += (tables.get(t)!.length + 3) & ~3;
  const out = new Uint8Array(total);
  const o = new DataView(out.buffer);
  o.setUint32(0, 0x00010000);
  o.setUint16(4, n);
  o.setUint16(6, searchRange);
  o.setUint16(8, entrySelector);
  o.setUint16(10, n * 16 - searchRange);
  let dataOff = 12 + 16 * n;
  let headOff = 0;
  tags.forEach((t, i) => {
    const data = tables.get(t)!;
    const r = 12 + i * 16;
    for (let k = 0; k < 4; k++) o.setUint8(r + k, t.charCodeAt(k));
    o.setUint32(r + 4, checksum(data));
    o.setUint32(r + 8, dataOff);
    o.setUint32(r + 12, data.length);
    out.set(data, dataOff);
    if (t === "head") headOff = dataOff;
    dataOff += (data.length + 3) & ~3;
  });
  o.setUint32(headOff + 8, (0xb1b0afba - checksum(out)) >>> 0);
  return out.buffer;
}
