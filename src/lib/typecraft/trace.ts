// Potrace (WebAssembly) bridge: grayscale tile → cleaned bitmap → Bézier contours in font units.
import { normalizeOrientation, parseSvgPath, type Contour } from "./contours";
import { adjustWeight, binarize, clearBorder, inkCount, majority, maskToRgba } from "./raster";
import { BOX_GUIDES } from "./template";

/** Glyph tiles are sampled at this resolution; the full tile spans the 1000-unit em (ascender → descender). */
export const TILE = 240;
export const UNITS_PER_EM = 1000;
export const TILE_ASCENDER = 800;

export type Preprocess = {
  threshold: number; // 0–255, darker than this is ink
  denoise: number; // 0–3 despeckle passes
  smoothing: number; // potrace alphamax 0–1.33
  optimize: number; // potrace opttolerance 0–1
};

export type TraceOverrides = { weight: number; smoothing: number | null; optimize: number | null };

type PotraceModule = typeof import("esm-potrace-wasm");
let potraceReady: Promise<PotraceModule> | null = null;
function getPotrace() {
  // Loaded lazily in the browser only: the module instantiates WebAssembly on import.
  potraceReady ??= import("esm-potrace-wasm").then(async (m) => {
    await m.init();
    return m;
  });
  return potraceReady;
}

/** Tile pixel (x right, y-up from the tile bottom) → font units with baseline at 0. */
export function tileToFont(x: number, yUp: number, size = TILE, pad = 0): [number, number] {
  const k = UNITS_PER_EM / size;
  return [(x - pad) * k, (yUp - pad - (1 - BOX_GUIDES.baseline) * size) * k];
}

export function prepareMask(source: Uint8Array, size: number, pre: Preprocess, weight: number, pad = 0) {
  const tileSize = size + pad * 2;
  let m = binarize(source, pre.threshold);
  // Padded tiles carry an outer clear border already; keep only a minimal 2px outer safety strip so headroom ink stays intact.
  clearBorder(m, tileSize, pad > 0 ? Math.min(2, pad - 1) : Math.round(size * 0.045));
  for (let k = 0; k < pre.denoise; k++) m = majority(m, tileSize);
  if (weight) m = adjustWeight(m, tileSize, weight);
  return m;
}

export async function traceTile(
  source: Uint8Array,
  pre: Preprocess,
  ov: TraceOverrides,
  size = TILE,
  pad = 0,
): Promise<{ contours: Contour[]; empty: boolean }> {
  const tileSize = size + pad * 2;
  const mask = prepareMask(source, size, pre, ov.weight, pad);
  if (inkCount(mask) < size * size * 0.0015) return { contours: [], empty: true };
  const { potrace } = await getPotrace();
  const paths = await potrace(maskToRgba(mask, tileSize), {
    pathonly: true,
    extractcolors: false,
    posterizelevel: 2,
    turdsize: 2 + pre.denoise * 6,
    turnpolicy: 4,
    alphamax: ov.smoothing ?? pre.smoothing,
    opticurve: 1,
    opttolerance: ov.optimize ?? pre.optimize,
  });
  // Potrace emits coordinates ×10, y-up from the bottom edge of the bitmap.
  const contours = paths.flatMap((d) => parseSvgPath(d, (x, y) => tileToFont(x / 10, y / 10, size, pad)));
  return { contours: normalizeOrientation(contours), empty: contours.length === 0 };
}
