// Bitmap preprocessing for glyph tiles: binarization, despeckle and stroke weight morphology.

export function binarize(gray: Uint8Array, threshold: number): Uint8Array {
  const m = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) m[i] = gray[i] < threshold ? 1 : 0;
  return m;
}

export function clearBorder(m: Uint8Array, size: number, margin: number) {
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if (x < margin || y < margin || x >= size - margin || y >= size - margin) m[y * size + x] = 0;
}

/** 3×3 majority (median) filter: removes specks and fills pin-holes. */
export function majority(m: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(m.length);
  for (let y = 1; y < size - 1; y++)
    for (let x = 1; x < size - 1; x++) {
      const i = y * size + x;
      const s =
        m[i - size - 1] + m[i - size] + m[i - size + 1] + m[i - 1] + m[i] + m[i + 1] +
        m[i + size - 1] + m[i + size] + m[i + size + 1];
      out[i] = s >= 5 ? 1 : 0;
    }
  return out;
}

function morph(m: Uint8Array, size: number, grow: boolean, square: boolean): Uint8Array {
  const out = new Uint8Array(m.length);
  const v = grow ? 1 : 0;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      let hit = m[i] === v;
      for (let dy = -1; dy <= 1 && !hit; dy++)
        for (let dx = -1; dx <= 1 && !hit; dx++) {
          if (!square && dx && dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          if (m[ny * size + nx] === v) hit = true;
        }
      out[i] = hit ? v : 1 - v;
    }
  return out;
}

/** Positive px thickens strokes, negative thins them (alternating kernels give round-ish corners). */
export function adjustWeight(m: Uint8Array, size: number, px: number): Uint8Array {
  let out = m;
  for (let k = 0; k < Math.abs(Math.round(px)); k++) out = morph(out, size, px > 0, k % 2 === 1);
  return out;
}

export const inkCount = (m: Uint8Array) => m.reduce((a, b) => a + b, 0);

export function maskToRgba(m: Uint8Array, size: number) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < m.length; i++) {
    const v = m[i] ? 0 : 255;
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  return { data, width: size, height: size };
}
