// Fiducial detection, perspective correction and cell slicing — pure functions over grayscale buffers.

export type Pt = { x: number; y: number };
export type GrayImage = { data: Uint8Array; width: number; height: number };

/** Solves the 3x3 homography (h33 = 1) that maps src[i] to dst[i] for four point pairs. */
export function solveHomography(src: Pt[], dst: Pt[]): number[] {
  // Dense 8×9 matrix; indices are always in range, so access is asserted below.
  const A: number[][] = [];
  const at = (r: number) => A[r]!;
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]!;
    const { x: u, y: v } = dst[i]!;
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u, u]);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v, v]);
  }
  const n = 8;
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(at(r)[c]!) > Math.abs(at(piv)[c]!)) piv = r;
    if (Math.abs(at(piv)[c]!) < 1e-12) throw new Error("Degenerate corner points");
    [A[c], A[piv]] = [at(piv), at(c)];
    const pr = at(c);
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const row = at(r);
      const f = row[c]! / pr[c]!;
      for (let k = c; k <= n; k++) row[k] = row[k]! - f * pr[k]!;
    }
  }
  const h = A.map((row, i) => row[n]! / row[i]!);
  return [...h, 1];
}

export function applyHomography(h: number[], x: number, y: number): Pt {
  const [h0 = 0, h1 = 0, h2 = 0, h3 = 0, h4 = 0, h5 = 0, h6 = 0, h7 = 0, h8 = 1] = h;
  const w = h6 * x + h7 * y + h8;
  return { x: (h0 * x + h1 * y + h2) / w, y: (h3 * x + h4 * y + h5) / w };
}

export function rgbaToGray(rgba: Uint8ClampedArray, width: number, height: number): GrayImage {
  const data = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) {
    const a = rgba[j + 3]! / 255;
    // Composite transparent pixels (Procreate exports) over white.
    const l = 0.2126 * rgba[j]! + 0.7152 * rgba[j + 1]! + 0.0722 * rgba[j + 2]!;
    data[i] = Math.round(l * a + 255 * (1 - a));
  }
  return { data, width, height };
}

export function otsuThreshold(data: Uint8Array): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < data.length; i++) hist[data[i]!]!++;
  const total = data.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i]!;
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!;
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t]!;
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

function downscale(img: GrayImage, maxDim: number): { img: GrayImage; factor: number } {
  const factor = Math.max(1, Math.ceil(Math.max(img.width, img.height) / maxDim));
  if (factor === 1) return { img, factor };
  const w = Math.floor(img.width / factor), h = Math.floor(img.height / factor);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < factor; dy++)
        for (let dx = 0; dx < factor; dx++) s += img.data[(y * factor + dy) * img.width + x * factor + dx]!;
      out[y * w + x] = s / (factor * factor);
    }
  return { img: { data: out, width: w, height: h }, factor };
}

export type FiducialResult = { corners: Pt[]; found: boolean[] };

/**
 * Finds the four solid corner squares. Ink is labelled into connected components; candidates
 * must be square, densely filled and sized like a fiducial, then the closest one to each
 * image corner wins. Missing corners fall back to an inset estimate the user can drag.
 */
export function detectFiducials(full: GrayImage): FiducialResult {
  const { img, factor } = downscale(full, 1200);
  const { width: w, height: h, data } = img;
  const thr = Math.min(otsuThreshold(data), 160);
  const labels = new Int32Array(w * h);
  const parent: number[] = [0];
  const find = (a: number) => {
    while (parent[a]! !== a) { parent[a] = parent[parent[a]!]!; a = parent[a]!; }
    return a;
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (data[i]! > thr) continue;
      const l = x > 0 ? labels[i - 1]! : 0;
      const u = y > 0 ? labels[i - w]! : 0;
      if (!l && !u) { labels[i] = parent.length; parent.push(parent.length); }
      else if (l && u) {
        const a = find(l), b = find(u);
        labels[i] = Math.min(a, b);
        if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
      } else labels[i] = l || u;
    }
  const n = parent.length;
  const area = new Float64Array(n), sx = new Float64Array(n), sy = new Float64Array(n);
  const minX = new Int32Array(n).fill(1e9), minY = new Int32Array(n).fill(1e9);
  const maxX = new Int32Array(n).fill(-1), maxY = new Int32Array(n).fill(-1);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const lab = labels[y * w + x]!;
      if (!lab) continue;
      const r = find(lab);
      area[r]!++; sx[r]! += x; sy[r]! += y;
      if (x < minX[r]!) minX[r] = x;
      if (x > maxX[r]!) maxX[r] = x;
      if (y < minY[r]!) minY[r] = y;
      if (y > maxY[r]!) maxY[r] = y;
    }
  const s = Math.min(w, h);
  const cands: Pt[] = [];
  for (let r = 1; r < n; r++) {
    if (!area[r]!) continue;
    const bw = maxX[r]! - minX[r]! + 1, bh = maxY[r]! - minY[r]! + 1;
    if (bw < 0.015 * s || bw > 0.1 * s || bh < 0.015 * s || bh > 0.1 * s) continue;
    const aspect = bw / bh;
    if (aspect < 0.65 || aspect > 1.55) continue;
    if (area[r]! / (bw * bh) < 0.6) continue;
    cands.push({ x: sx[r]! / area[r]!, y: sy[r]! / area[r]! });
  }
  const targets = [ { x: 0, y: 0 }, { x: w, y: 0 }, { x: 0, y: h }, { x: w, y: h } ];
  const corners: Pt[] = [];
  const found: boolean[] = [];
  targets.forEach((t, i) => {
    const inQuadrant = cands.filter((c) => (c.x < w / 2) === (t.x === 0) && (c.y < h / 2) === (t.y === 0));
    let best: Pt | null = null, bestD = Infinity;
    for (const c of inQuadrant) {
      const d = Math.hypot(c.x - t.x, c.y - t.y);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (best && bestD < 0.35 * Math.hypot(w, h)) {
      corners.push({ x: (best.x + 0.5) * factor, y: (best.y + 0.5) * factor });
      found.push(true);
    } else {
      const ix = 0.052 * full.width, iy = 0.04 * full.height;
      corners.push({ x: i % 2 ? full.width - ix : ix, y: i < 2 ? iy : full.height - iy });
      found.push(false);
    }
  });
  return { corners, found };
}

/** Samples a square region of template space through the homography into an outSize² grayscale tile. */
export function warpCell(img: GrayImage, H: number[], cx: number, cy: number, size: number, outSize: number): Uint8Array {
  const out = new Uint8Array(outSize * outSize);
  const { data, width, height } = img;
  const step = size / outSize;
  for (let v = 0; v < outSize; v++)
    for (let u = 0; u < outSize; u++) {
      const p = applyHomography(H, cx + (u + 0.5) * step, cy + (v + 0.5) * step);
      const x = p.x - 0.5, y = p.y - 0.5;
      const x0 = Math.floor(x), y0 = Math.floor(y);
      if (x0 < 0 || y0 < 0 || x0 + 1 >= width || y0 + 1 >= height) { out[v * outSize + u] = 255; continue; }
      const fx = x - x0, fy = y - y0;
      const i = y0 * width + x0;
      const top = data[i]! * (1 - fx) + data[i + 1]! * fx;
      const bot = data[i + width]! * (1 - fx) + data[i + width + 1]! * fx;
      out[v * outSize + u] = top * (1 - fy) + bot * fy;
    }
  return out;
}
