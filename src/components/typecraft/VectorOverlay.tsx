// Optimized SVG vector overlay for GlyphCanvas: renders anchors, Bézier handles, selection box, lasso, and Pen previews.
import type { BBox, P } from "@/lib/typecraft/contours";
import { resolveLasso, type CloseMode } from "@/lib/typecraft/lasso";
import type { LazyTetherState } from "@/lib/typecraft/lazyTether";
import { vectorPathsToSvgD, type SegmentHit, type VectorPath } from "@/lib/typecraft/vectorEditor";

type Props = {
  width: number;
  height: number;
  fx: (x: number) => number;
  fy: (y: number) => number;
  k: number;
  paths: VectorPath[];
  activePathId: string | null;
  showNodes: boolean;
  showLivePaths: boolean;
  marquee: BBox | null;
  lasso: P[];
  lassoFillPts: P[];
  lassoCloseMode?: CloseMode;
  lassoThreshold?: number;
  lassoErase?: boolean;
  tether?: LazyTetherState | null;
  freeformPts: P[];
  cursorFont: P | null;
  penPreviewHandle: { x: number; y: number } | null;
  hoverSeg: SegmentHit | null;
  canCloseActive: boolean;
};

export function VectorOverlay({
  width,
  height,
  fx,
  fy,
  k,
  paths,
  activePathId,
  showNodes,
  showLivePaths,
  marquee,
  lasso,
  lassoFillPts,
  lassoCloseMode = "always",
  lassoThreshold = 120,
  lassoErase = false,
  tether = null,
  freeformPts,
  cursorFont,
  penPreviewHandle,
  hoverSeg,
  canCloseActive,
}: Props) {
  if (!width || !height) return null;

  const activePath = activePathId ? paths.find((p) => p.id === activePathId) ?? null : null;
  const lastActiveNode = activePath && !activePath.closed && activePath.nodes.length ? activePath.nodes[activePath.nodes.length - 1]! : null;
  const firstActiveNode = activePath && !activePath.closed && activePath.nodes.length ? activePath.nodes[0]! : null;

  const lassoPreview =
    lassoFillPts.length >= 2 ? resolveLasso(lassoFillPts, lassoCloseMode, lassoThreshold, 0.7) : null;
  const lassoStart = lassoFillPts[0];
  const lassoEnd = lassoFillPts[lassoFillPts.length - 1];
  const lassoGap = lassoStart && lassoEnd ? Math.hypot(lassoEnd[0] - lassoStart[0], lassoEnd[1] - lassoStart[1]) : Infinity;
  const lassoWithinSnap = lassoFillPts.length >= 3 && lassoGap <= lassoThreshold;

  // Rubber-band curve from the last node of an open Pen path to the current pointer.
  let rubberBandD = "";
  if (lastActiveNode && cursorFont) {
    const x0 = fx(lastActiveNode.x);
    const y0 = fy(lastActiveNode.y);
    const x1 = fx(cursorFont[0]);
    const y1 = fy(cursorFont[1]);
    if (lastActiveNode.outHandle || penPreviewHandle) {
      const c1x = fx(lastActiveNode.outHandle?.x ?? lastActiveNode.x);
      const c1y = fy(lastActiveNode.outHandle?.y ?? lastActiveNode.y);
      const c2x = fx(penPreviewHandle ? 2 * cursorFont[0] - penPreviewHandle.x : cursorFont[0]);
      const c2y = fy(penPreviewHandle ? 2 * cursorFont[1] - penPreviewHandle.y : cursorFont[1]);
      rubberBandD = `M${x0} ${y0}C${c1x} ${c1y} ${c2x} ${c2y} ${x1} ${y1}`;
    } else {
      rubberBandD = `M${x0} ${y0}L${x1} ${y1}`;
    }
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="pointer-events-none absolute inset-0 size-full select-none"
      aria-hidden
    >
      {/* Live vector outline preview during interactive edits or open Pen paths */}
      {showLivePaths && paths.length > 0 && (
        <path
          d={vectorPathsToSvgD(paths, ([x, y]) => [fx(x), fy(y)], 1)}
          fill="none"
          className="stroke-proof"
          strokeWidth={1.75}
        />
      )}

      {/* Rubber-band preview segment for Pen / Curvature Pen */}
      {rubberBandD && (
        <path
          d={rubberBandD}
          fill="none"
          className="stroke-proof/75"
          strokeWidth={1.5}
          strokeDasharray="5 4"
        />
      )}

      {/* Freeform Pen live stroke preview */}
      {freeformPts.length > 1 && (
        <polyline
          points={freeformPts.map(([x, y]) => `${fx(x)},${fy(y)}`).join(" ")}
          fill="none"
          className="stroke-proof"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {/* Control handles & anchor points */}
      {showNodes &&
        paths.map((path) =>
          path.nodes.map((node, idx) => {
            const nx = fx(node.x);
            const ny = fy(node.y);
            const showHandles = Boolean(node.isSelected || path.id === activePathId);
            const isCloseTarget = canCloseActive && path.id === activePathId && idx === 0;

            return (
              <g key={node.id}>
                {showHandles && node.inHandle && (
                  <>
                    <line
                      x1={nx}
                      y1={ny}
                      x2={fx(node.inHandle.x)}
                      y2={fy(node.inHandle.y)}
                      className="stroke-proof/70"
                      strokeWidth={1.25}
                    />
                    <circle
                      cx={fx(node.inHandle.x)}
                      cy={fy(node.inHandle.y)}
                      r={4}
                      className="fill-card stroke-proof"
                      strokeWidth={1.5}
                    />
                  </>
                )}
                {showHandles && node.outHandle && (
                  <>
                    <line
                      x1={nx}
                      y1={ny}
                      x2={fx(node.outHandle.x)}
                      y2={fy(node.outHandle.y)}
                      className="stroke-proof/70"
                      strokeWidth={1.25}
                    />
                    <circle
                      cx={fx(node.outHandle.x)}
                      cy={fy(node.outHandle.y)}
                      r={4}
                      className="fill-card stroke-proof"
                      strokeWidth={1.5}
                    />
                  </>
                )}

                {isCloseTarget && (
                  <circle
                    cx={nx}
                    cy={ny}
                    r={9}
                    fill="none"
                    className="stroke-proof"
                    strokeWidth={2}
                  />
                )}

                {node.type === "corner" ? (
                  <rect
                    x={nx - 4}
                    y={ny - 4}
                    width={8}
                    height={8}
                    rx={1}
                    className={node.isSelected ? "fill-proof stroke-sheet" : "fill-card stroke-proof"}
                    strokeWidth={1.75}
                  />
                ) : node.type === "symmetric" ? (
                  <rect
                    x={nx - 4}
                    y={ny - 4}
                    width={8}
                    height={8}
                    transform={`rotate(45 ${nx} ${ny})`}
                    className={node.isSelected ? "fill-proof stroke-sheet" : "fill-card stroke-proof"}
                    strokeWidth={1.75}
                  />
                ) : (
                  <circle
                    cx={nx}
                    cy={ny}
                    r={4.5}
                    className={node.isSelected ? "fill-proof stroke-sheet" : "fill-card stroke-proof"}
                    strokeWidth={1.75}
                  />
                )}
              </g>
            );
          }),
        )}

      {/* Highlight close ring when dragging out handles on the starting node */}
      {firstActiveNode && canCloseActive && (
        <circle
          cx={fx(firstActiveNode.x)}
          cy={fy(firstActiveNode.y)}
          r={11}
          fill="none"
          className="stroke-proof/60"
          strokeWidth={1.5}
          strokeDasharray="3 3"
        />
      )}

      {/* Add-Anchor hover preview point on curve */}
      {hoverSeg && (
        <g>
          <circle
            cx={fx(hoverSeg.point[0])}
            cy={fy(hoverSeg.point[1])}
            r={5.5}
            className="fill-proof/25 stroke-proof"
            strokeWidth={2}
          />
          <circle cx={fx(hoverSeg.point[0])} cy={fy(hoverSeg.point[1])} r={2} className="fill-proof" />
        </g>
      )}

      {/* Box selection marquee */}
      {marquee && (
        <rect
          x={Math.min(fx(marquee.xMin), fx(marquee.xMax))}
          y={Math.min(fy(marquee.yMin), fy(marquee.yMax))}
          width={Math.abs(fx(marquee.xMax) - fx(marquee.xMin))}
          height={Math.abs(fy(marquee.yMax) - fy(marquee.yMin))}
          className="fill-guide/12 stroke-guide"
          strokeWidth={1.5}
          strokeDasharray="5 4"
        />
      )}

      {/* Freeform Lasso selection polygon */}
      {lasso.length > 1 && (
        <polygon
          points={lasso.map(([x, y]) => `${fx(x)},${fy(y)}`).join(" ")}
          className="fill-guide/12 stroke-guide"
          strokeWidth={1.5}
          strokeDasharray="4 4"
        />
      )}

      {/* Studio Lasso Fill live preview */}
      {lassoFillPts.length > 1 && (
        <g>
          {lassoPreview?.closed && lassoPreview.polygon.length >= 3 && (
            <polygon
              points={lassoPreview.polygon.map(([x, y]) => `${fx(x)},${fy(y)}`).join(" ")}
              className={lassoErase ? "fill-destructive/25 stroke-none" : "fill-ink/25 stroke-none"}
              fillRule="nonzero"
            />
          )}
          <polyline
            points={lassoFillPts.map(([x, y]) => `${fx(x)},${fy(y)}`).join(" ")}
            fill="none"
            className={lassoErase ? "stroke-destructive" : "stroke-ink"}
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {lassoPreview?.closed && lassoStart && lassoEnd && (
            <line
              x1={fx(lassoEnd[0])}
              y1={fy(lassoEnd[1])}
              x2={fx(lassoStart[0])}
              y2={fy(lassoStart[1])}
              className={lassoErase ? "stroke-destructive/80" : "stroke-ink/65"}
              strokeWidth={1.5}
              strokeDasharray="6 5"
            />
          )}
          {lassoStart && lassoCloseMode !== "off" && (
            <circle
              cx={fx(lassoStart[0])}
              cy={fy(lassoStart[1])}
              r={lassoWithinSnap ? 9 : 4}
              className={
                lassoWithinSnap
                  ? lassoErase
                    ? "fill-destructive/20 stroke-destructive"
                    : "fill-guide/20 stroke-ink"
                  : "fill-none stroke-ink/70"
              }
              strokeWidth={lassoWithinSnap ? 2 : 1.25}
            />
          )}
        </g>
      )}

      {/* Lazy "Rubber Band" tether line & dead-zone circle */}
      {tether && tether.radius > 0 && (
        <g>
          <circle
            cx={fx(tether.tip.x)}
            cy={fy(tether.tip.y)}
            r={tether.radius * k}
            fill="none"
            className="stroke-guide/55"
            strokeWidth={1.25}
            strokeDasharray="4 4"
          />
          <line
            x1={fx(tether.tip.x)}
            y1={fy(tether.tip.y)}
            x2={fx(tether.pen.x)}
            y2={fy(tether.pen.y)}
            className="stroke-proof"
            strokeWidth={1.75}
          />
          <circle cx={fx(tether.tip.x)} cy={fy(tether.tip.y)} r={3} className="fill-proof" />
        </g>
      )}
    </svg>
  );
}
