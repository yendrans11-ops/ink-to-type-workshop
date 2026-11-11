import { useMemo, useRef } from "react";
import { BOX, buildTemplateLayout, FIDUCIAL_CENTERS } from "@/lib/typecraft/template";
import { applyHomography, solveHomography, type Pt } from "@/lib/typecraft/vision";
import type { UploadPage } from "@/lib/typecraft/store";

const CORNER_NAMES = ["Top left", "Top right", "Bottom left", "Bottom right"];

/** Shows the upload with the 4 detected fiducials (draggable) and the projected template grid. */
export function CornerAdjuster({ page, charsetIds, extraChars, onChange }: { page: UploadPage; charsetIds: string[]; extraChars: string; onChange: (c: Pt[]) => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragIdx = useRef<number | null>(null);
  const { width: W, height: H, corners } = page;

  const cells = useMemo(() => {
    try {
      const h = solveHomography(FIDUCIAL_CENTERS, corners);
      const layout = buildTemplateLayout(charsetIds, extraChars);
      return layout.slots
        .filter((s) => s.page === page.page)
        .map((s) => [[s.x, s.y], [s.x + BOX, s.y], [s.x + BOX, s.y + BOX], [s.x, s.y + BOX]].map(([x, y]) => applyHomography(h, x, y)));
    } catch {
      return [];
    }
  }, [corners, charsetIds, extraChars, page.page]);

  const toImage = (e: React.PointerEvent): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const handle = Math.max(W, H) * 0.022;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className="block w-full touch-none select-none rounded-md bg-muted"
      onPointerMove={(e) => {
        if (dragIdx.current === null) return;
        const p = toImage(e);
        const next = corners.slice();
        next[dragIdx.current] = { x: Math.max(0, Math.min(W, p.x)), y: Math.max(0, Math.min(H, p.y)) };
        onChange(next);
      }}
      onPointerUp={() => (dragIdx.current = null)}
      onPointerCancel={() => (dragIdx.current = null)}
    >
      <image href={page.preview} width={W} height={H} />
      <polygon
        points={[corners[0], corners[1], corners[3], corners[2]].map((p) => `${p.x},${p.y}`).join(" ")}
        className="fill-none stroke-proof"
        strokeWidth={handle * 0.12}
        strokeDasharray={`${handle * 0.5} ${handle * 0.3}`}
      />
      {cells.map((q, i) => (
        <polygon key={i} points={q.map((p) => `${p.x},${p.y}`).join(" ")} className="fill-guide/10 stroke-guide" strokeWidth={handle * 0.08} />
      ))}
      {corners.map((p, i) => (
        <g key={i} onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); dragIdx.current = i; }} className="cursor-grab">
          <circle cx={p.x} cy={p.y} r={handle * 1.6} className="fill-transparent" />
          <circle cx={p.x} cy={p.y} r={handle} className={page.found[i] ? "fill-proof/25 stroke-proof" : "fill-destructive/25 stroke-destructive"} strokeWidth={handle * 0.18} />
          <circle cx={p.x} cy={p.y} r={handle * 0.18} className="fill-proof" />
          <title>{CORNER_NAMES[i]}</title>
        </g>
      ))}
    </svg>
  );
}
