import { describe, expect, it } from "vitest";
import { cubicAt, type Contour, type P } from "../contours";
import { DEFAULT_PARAMS, layoutGlyph, unlayoutContours } from "../layout";
import {
  computeCurvatureHandles,
  contoursToVectorPaths,
  convertNodeType,
  deleteNode,
  fitFreeformPointsToVectorPath,
  hitTestNodeOrHandle,
  hitTestSegment,
  moveNodeHandle,
  pointInPolygon,
  selectNodesInBox,
  selectNodesInLasso,
  splitSegmentAt,
  transformSelectedNodes,
  translateSelectedNodes,
  vectorPathsToContours,
  vectorPathsToSvgD,
} from "../vectorEditor";

const sampleCubicContour: Contour = {
  start: [100, 0],
  segs: [
    { t: "C", c1: [100, 150], c2: [200, 300], p: [300, 300] },
    { t: "C", c1: [400, 300], c2: [500, 150], p: [500, 0] },
    { t: "L", p: [100, 0] },
  ],
};

describe("vectorEditor bidirectional Contour[] translation", () => {
  it("round-trips closed cubic and line contours without duplicating the closing anchor", () => {
    const paths = contoursToVectorPaths([sampleCubicContour]);
    expect(paths).toHaveLength(1);
    const p = paths[0]!;
    expect(p.closed).toBe(true);
    expect(p.nodes).toHaveLength(3);
    expect(p.nodes[1]!.type).toBe("symmetric");
    expect(p.nodes[0]!.outHandle).toEqual({ x: 100, y: 150 });
    expect(p.nodes[1]!.inHandle).toEqual({ x: 200, y: 300 });
    expect(p.nodes[1]!.outHandle).toEqual({ x: 400, y: 300 });

    const back = vectorPathsToContours(paths);
    expect(back).toHaveLength(1);
    expect(back[0]!.start).toEqual([100, 0]);
    expect(back[0]!.segs).toEqual(sampleCubicContour.segs);
  });

  it("handles contours with an implicit closing line back to start", () => {
    const tri: Contour = {
      start: [0, 0],
      segs: [
        { t: "L", p: [200, 0] },
        { t: "L", p: [100, 200] },
      ],
    };
    const paths = contoursToVectorPaths([tri]);
    expect(paths[0]!.nodes).toHaveLength(3);
    const back = vectorPathsToContours(paths);
    expect(back[0]!.segs).toHaveLength(3);
    expect(back[0]!.segs[2]!.p).toEqual([0, 0]);
  });

  it("serializes open paths to SVG d while excluding them from closed Contour[] export by default", () => {
    const open = [
      {
        id: "open-1",
        closed: false,
        nodes: [
          { id: "a", x: 10, y: 20, type: "corner" as const },
          { id: "b", x: 110, y: 220, type: "corner" as const },
        ],
      },
    ];
    expect(vectorPathsToContours(open)).toHaveLength(0);
    expect(vectorPathsToSvgD(open)).toBe("M10 20L110 220");
  });
});

describe("vectorEditor selection, translation, and transforms", () => {
  it("selects nodes via box and lasso polygons", () => {
    const paths = contoursToVectorPaths([sampleCubicContour]);
    const boxed = selectNodesInBox(paths, { xMin: 250, yMin: 250, xMax: 350, yMax: 350 });
    expect(boxed[0]!.nodes.map((n) => n.isSelected)).toEqual([false, true, false]);

    const lassoPoly: P[] = [
      [50, -50],
      [350, -50],
      [350, 350],
      [50, 350],
    ];
    expect(pointInPolygon([100, 0], lassoPoly)).toBe(true);
    expect(pointInPolygon([500, 0], lassoPoly)).toBe(false);

    const lassoed = selectNodesInLasso(paths, lassoPoly);
    expect(lassoed[0]!.nodes.map((n) => n.isSelected)).toEqual([true, true, false]);
  });

  it("translates and scales/rotates selected nodes together with their handles", () => {
    const paths = selectNodesInBox(contoursToVectorPaths([sampleCubicContour]), { xMin: 290, yMin: 290, xMax: 310, yMax: 310 });
    const moved = translateSelectedNodes(paths, 20, -10);
    const n1 = moved[0]!.nodes[1]!;
    expect([n1.x, n1.y]).toEqual([320, 290]);
    expect(n1.inHandle).toEqual({ x: 220, y: 290 });
    expect(n1.outHandle).toEqual({ x: 420, y: 290 });

    const scaled = transformSelectedNodes(moved, { scaleX: 2, scaleY: 2, pivot: [320, 290] });
    expect(scaled[0]!.nodes[1]!.inHandle).toEqual({ x: 120, y: 290 });
    expect(scaled[0]!.nodes[1]!.outHandle).toEqual({ x: 520, y: 290 });
  });
});

describe("vectorEditor Bézier tools (Pen, Split, Delete, Convert, Curvature, Freeform)", () => {
  it("preserves exact cubic Bézier geometry when splitting with De Casteljau", () => {
    const paths = contoursToVectorPaths([sampleCubicContour]);
    const { paths: split, newNodeId } = splitSegmentAt(paths, paths[0]!.id, 0, 0.5);
    expect(newNodeId).toBeTruthy();
    expect(split[0]!.nodes).toHaveLength(4);

    // Check point at t=0.25 of original equals point at t=0.5 of first half
    const origMid = cubicAt([100, 0], [100, 150], [200, 300], [300, 300], 0.25);
    const n0 = split[0]!.nodes[0]!;
    const n1 = split[0]!.nodes[1]!;
    const halfMid = cubicAt(
      [n0.x, n0.y],
      [n0.outHandle!.x, n0.outHandle!.y],
      [n1.inHandle!.x, n1.inHandle!.y],
      [n1.x, n1.y],
      0.5,
    );
    expect(halfMid[0]).toBeCloseTo(origMid[0], 5);
    expect(halfMid[1]).toBeCloseTo(origMid[1], 5);
  });

  it("enforces symmetric and smooth handle constraints and supports breaking tangents", () => {
    const paths = contoursToVectorPaths([sampleCubicContour]);
    const pathId = paths[0]!.id;
    const node1 = paths[0]!.nodes[1]!;

    // Symmetric node mirrors opposite handle
    const sym = moveNodeHandle(paths, pathId, node1.id, "outHandle", { x: 450, y: 350 });
    expect(sym[0]!.nodes[1]!.inHandle).toEqual({ x: 150, y: 250 });

    // Break tangent turns it into a corner and leaves opposite handle untouched
    const broken = moveNodeHandle(sym, pathId, node1.id, "outHandle", { x: 450, y: 200 }, { breakTangent: true });
    expect(broken[0]!.nodes[1]!.type).toBe("corner");
    expect(broken[0]!.nodes[1]!.inHandle).toEqual({ x: 150, y: 250 });
  });

  it("converts between corner and smooth nodes and deletes anchor points", () => {
    const paths = contoursToVectorPaths([sampleCubicContour]);
    const pathId = paths[0]!.id;
    const node1Id = paths[0]!.nodes[1]!.id;

    const asCorner = convertNodeType(paths, pathId, node1Id, "corner");
    expect(asCorner[0]!.nodes[1]!.inHandle).toBeUndefined();
    expect(asCorner[0]!.nodes[1]!.outHandle).toBeUndefined();

    const backSmooth = convertNodeType(asCorner, pathId, node1Id, "smooth");
    expect(backSmooth[0]!.nodes[1]!.inHandle).toBeDefined();
    expect(backSmooth[0]!.nodes[1]!.outHandle).toBeDefined();
    expect(backSmooth[0]!.nodes[1]!.type).toBe("smooth");

    const deleted = deleteNode(backSmooth, pathId, node1Id);
    expect(deleted[0]!.nodes).toHaveLength(2);
  });

  it("hit-tests nodes, selected handles, and cubic segments", () => {
    const paths = selectNodesInBox(contoursToVectorPaths([sampleCubicContour]), { xMin: 290, yMin: 290, xMax: 310, yMax: 310 });
    expect(hitTestNodeOrHandle(paths, [401, 300], 8)?.kind).toBe("outHandle");
    expect(hitTestNodeOrHandle(paths, [102, 1], 8)?.kind).toBe("node");

    const segHit = hitTestSegment(paths, cubicAt([100, 0], [100, 150], [200, 300], [300, 300], 0.4), 5);
    expect(segHit).not.toBeNull();
    expect(segHit!.segIndex).toBe(0);
    expect(segHit!.t).toBeCloseTo(0.4, 1);
  });

  it("fits smooth curvature handles and freeform pen polylines into closed VectorPaths", () => {
    const curved = computeCurvatureHandles(
      [
        { id: "1", x: 0, y: 0, type: "smooth" },
        { id: "2", x: 200, y: 300, type: "smooth" },
        { id: "3", x: 400, y: 0, type: "corner" },
      ],
      true,
    );
    expect(curved[0]!.outHandle).toBeDefined();
    expect(curved[1]!.inHandle).toBeDefined();
    expect(curved[2]!.inHandle).toBeUndefined();

    const loop: P[] = [
      [100, 100],
      [200, 250],
      [350, 350],
      [500, 200],
      [350, 50],
      [105, 105],
    ];
    const fitted = fitFreeformPointsToVectorPath(loop);
    expect(fitted).not.toBeNull();
    expect(fitted!.closed).toBe(true);
    expect(fitted!.nodes.length).toBeGreaterThanOrEqual(3);
  });

  it("unlayoutContours round-trips Studio edits back through layoutGlyph without coordinate drift", () => {
    const raw: Contour[] = [sampleCubicContour];
    const params = { ...DEFAULT_PARAMS, scale: 1.25, rotation: 10, offsetX: 15, offsetY: 25, lsb: 50, rsb: 60 };
    const laid = layoutGlyph(raw, params, false);

    // Move one node in laid-out font space
    const paths = selectNodesInBox(contoursToVectorPaths(laid.contours), {
      xMin: laid.bbox!.xMin - 1,
      yMin: -50,
      xMax: laid.bbox!.xMin + 50,
      yMax: 50,
    });
    const moved = vectorPathsToContours(translateSelectedNodes(paths, -20, 30));
    const { traced, paramsPatch } = unlayoutContours(moved, params, false, laid);
    const nextLaid = layoutGlyph(traced, { ...params, ...paramsPatch }, false);

    expect(nextLaid.contours[0]!.start[0]).toBeCloseTo(moved[0]!.start[0], 3);
    expect(nextLaid.contours[0]!.start[1]).toBeCloseTo(moved[0]!.start[1], 3);
  });
});
