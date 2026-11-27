// Tracing scheduler: retraces glyphs sequentially, dropping stale runs when settings change mid-run.
import { strokesToPotraceTile } from "./drawing";
import { useProject } from "./store";
import { TILE, traceTile } from "./trace";

let runToken = 0;
const glyphVersion = new Map<string, number>();

export async function retraceGlyph(id: string) {
  const v = (glyphVersion.get(id) ?? 0) + 1;
  glyphVersion.set(id, v);
  const { glyphs, preprocess, setTraced } = useProject.getState();
  const g = glyphs[id];
  if (!g?.source && !g?.strokes?.length) return;
  const ov = {
    weight: g.params.weight,
    smoothing: g.params.smoothing,
    optimize: g.params.optimize,
  };
  const { contours, empty } = g.strokes?.length
    ? await (() => {
        const { tile, pad } = strokesToPotraceTile(g.strokes, TILE);
        return traceTile(tile, preprocess, ov, TILE, pad);
      })()
    : await traceTile(g.source!, preprocess, ov);
  if (glyphVersion.get(id) === v) setTraced(id, contours, empty);
}

export async function retraceAll(ids?: string[]) {
  const token = ++runToken;
  const st = useProject.getState();
  const list = (ids ?? st.order).filter((id) => st.glyphs[id]?.source);
  st.setTracing({ done: 0, total: list.length });
  for (let i = 0; i < list.length; i++) {
    if (token !== runToken) return;
    await retraceGlyph(list[i]!);
    if (i % 6 === 5) await new Promise((r) => setTimeout(r, 0));
    useProject.getState().setTracing({ done: i + 1, total: list.length });
  }
  if (token === runToken) useProject.getState().setTracing(null);
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();
export function debounced(key: string, fn: () => void, ms = 250) {
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(fn, ms));
}
