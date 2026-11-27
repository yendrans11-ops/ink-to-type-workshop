// Magnetic contour scanner and anchor calculator for Tamil marks (pulli, post-base hooks, pre-base clearance).
import { bboxOf, cubicAt, mapContours, type BBox, type Contour, type P } from "./contours";
import { layoutGlyph, type GlyphParams } from "./layout";
import { LIGATURES, PULLI } from "./tamil";

/** Default typographic clearance above a consonant's top ridge before placing pulli or stacked marks (font units). */
export const DEFAULT_MARK_GAP = 40;

export type BaseAnchor = {
  xCenter: number;
  yTop: number;
  ridgeWidth: number;
};

export type BaseAttachmentDetail = BaseAnchor & {
  bbox: BBox;
  rightStemX: number;
  rightStemY: number;
  restY: number;
};

export type AnchorPoint = { x: number; y: number };

export type PulliSnapResult = {
  contours: Contour[];
  baseAnchor: AnchorPoint;
  markAnchor: AnchorPoint;
  restY: number;
  dx: number;
  dy: number;
};

export type PostBaseSnapResult = {
  baseAnchor: AnchorPoint;
  signAnchor: AnchorPoint;
  dx: number;
  dy: number;
};

export type PreBaseClearanceResult = {
  minGap: number;
  recommendedDelta: number;
  overlapAmount: number;
};

function sampleClippedTopSegments(
  contours: Contour[],
  minY: number,
): { sumXWeight: number; sumYWeight: number; totalWeight: number; bandXMin: number; bandXMax: number; rightSumY: number; rightWeight: number } {
  let sumXWeight = 0;
  let sumYWeight = 0;
  let totalWeight = 0;
  let bandXMin = Infinity;
  let bandXMax = -Infinity;

  const subSegs: [P, P][] = [];
  for (const c of contours) {
    let cur = c.start;
    for (const s of c.segs) {
      if (s.t === "L") {
        subSegs.push([cur, s.p]);
      } else {
        let prev = cur;
        for (let k = 1; k <= 16; k++) {
          const next = cubicAt(cur, s.c1, s.c2, s.p, k / 16);
          subSegs.push([prev, next]);
          prev = next;
        }
      }
      cur = s.p;
    }
  }

  const clipped: { a: P; b: P; len: number }[] = [];
  for (const [p0, p1] of subSegs) {
    const y0 = p0[1];
    const y1 = p1[1];
    if (y0 < minY && y1 < minY) continue;
    let a = p0;
    let b = p1;
    if (y0 < minY) {
      const t = (minY - y0) / (y1 - y0 || 1);
      a = [p0[0] + (p1[0] - p0[0]) * t, minY];
    } else if (y1 < minY) {
      const t = (minY - y0) / (y1 - y0 || 1);
      b = [p0[0] + (p1[0] - p0[0]) * t, minY];
    }
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len <= 1e-6) continue;
    clipped.push({ a, b, len });
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    sumXWeight += mx * len;
    sumYWeight += my * len;
    totalWeight += len;
    bandXMin = Math.min(bandXMin, a[0], b[0]);
    bandXMax = Math.max(bandXMax, a[0], b[0]);
  }

  let rightSumY = 0;
  let rightWeight = 0;
  if (bandXMax > -Infinity) {
    const rightThreshold = bandXMax - Math.max((bandXMax - bandXMin) * 0.2, 20);
    for (const { a, b, len } of clipped) {
      const mx = (a[0] + b[0]) / 2;
      if (mx >= rightThreshold) {
        rightSumY += ((a[1] + b[1]) / 2) * len;
        rightWeight += len;
      }
    }
  }

  return { sumXWeight, sumYWeight, totalWeight, bandXMin, bandXMax, rightSumY, rightWeight };
}

/**
 * Scans the upper 25% horizontal span of a consonant's contours to compute:
 * - `xCenter`: horizontal center of gravity of the top bar/stroke
 * - `yTop`: highest ink y-coordinate where a mark/pulli rests above (use `+ clearance`)
 * - `ridgeWidth`: width of the upper 25% stroke silhouette
 */
export function analyzeBaseAnchor(contours: Contour[]): BaseAnchor {
  const bb = bboxOf(contours);
  if (!bb) return { xCenter: 0, yTop: 0, ridgeWidth: 0 };
  const height = Math.max(1, bb.yMax - bb.yMin);
  const bandMinY = bb.yMax - Math.max(height * 0.25, 1);
  const scan = sampleClippedTopSegments(contours, bandMinY);
  const fallbackX = (bb.xMin + bb.xMax) / 2;
  const xCenter = scan.totalWeight > 0 ? scan.sumXWeight / scan.totalWeight : fallbackX;
  const ridgeWidth = scan.bandXMax > -Infinity ? Math.max(0, scan.bandXMax - scan.bandXMin) : Math.max(0, bb.xMax - bb.xMin);
  return {
    xCenter,
    yTop: bb.yMax,
    ridgeWidth,
  };
}

/** Full base attachment geometry including the top-right vertical stem target and resting pulli Y. */
export function analyzeBaseAttachment(contours: Contour[], gap = DEFAULT_MARK_GAP): BaseAttachmentDetail | null {
  const bb = bboxOf(contours);
  if (!bb) return null;
  const height = Math.max(1, bb.yMax - bb.yMin);
  const bandMinY = bb.yMax - Math.max(height * 0.25, 1);
  const scan = sampleClippedTopSegments(contours, bandMinY);
  const fallbackX = (bb.xMin + bb.xMax) / 2;
  const xCenter = scan.totalWeight > 0 ? scan.sumXWeight / scan.totalWeight : fallbackX;
  const ridgeWidth = scan.bandXMax > -Infinity ? Math.max(0, scan.bandXMax - scan.bandXMin) : Math.max(0, bb.xMax - bb.xMin);
  const rightStemX = scan.bandXMax > -Infinity ? scan.bandXMax : bb.xMax;
  const rightStemY = scan.rightWeight > 0 ? scan.rightSumY / scan.rightWeight : bb.yMax;
  return {
    xCenter,
    yTop: bb.yMax,
    ridgeWidth,
    bbox: bb,
    rightStemX,
    rightStemY,
    restY: bb.yMax + gap,
  };
}

/**
 * Snaps a pulli dot (்) magnetically to the consonant's detected top-ridge center and
 * `yTop + gap`, returning combined contours plus exact base/mark anchors for GPOS and guides.
 */
export function computePulliPlacement(
  baseContours: Contour[],
  pulliContours: Contour[],
  nudgeX = 0,
  gap = DEFAULT_MARK_GAP,
): PulliSnapResult {
  const base = analyzeBaseAttachment(baseContours, gap);
  const pb = bboxOf(pulliContours);
  if (!base || !pb) {
    return {
      contours: [...baseContours, ...pulliContours],
      baseAnchor: { x: 0, y: 0 },
      markAnchor: { x: 0, y: 0 },
      restY: gap,
      dx: 0,
      dy: 0,
    };
  }
  const markCenterX = (pb.xMin + pb.xMax) / 2;
  const targetX = base.xCenter + nudgeX;
  const targetY = base.restY;
  const dx = targetX - markCenterX;
  const dy = targetY - pb.yMin;
  return {
    contours: [...baseContours, ...mapContours(pulliContours, ([x, y]): P => [x + dx, y + dy])],
    baseAnchor: { x: Math.round(targetX), y: Math.round(targetY) },
    markAnchor: { x: Math.round(markCenterX), y: Math.round(pb.yMin) },
    restY: targetY,
    dx,
    dy,
  };
}

/**
 * Aligns post-base hook signs (ி, ீ) so the start of the sign's hook snaps onto the
 * consonant's top-right vertical stem.
 */
export function computePostBaseHookSnap(
  baseContours: Contour[],
  signContours: Contour[],
  gap = 20,
): PostBaseSnapResult | null {
  const base = analyzeBaseAttachment(baseContours, gap);
  const sb = bboxOf(signContours);
  if (!base || !sb) return null;
  // Scan the sign's left-top edge where the hook begins.
  const signHeight = Math.max(1, sb.yMax - sb.yMin);
  const hookBand = sampleClippedTopSegments(signContours, sb.yMax - Math.max(signHeight * 0.35, 1));
  const hookStartX = hookBand.bandXMin < Infinity ? hookBand.bandXMin : sb.xMin;
  const hookStartY = hookBand.totalWeight > 0 ? hookBand.sumYWeight / hookBand.totalWeight : sb.yMax;
  const targetX = base.rightStemX + gap;
  const targetY = base.rightStemY;
  return {
    baseAnchor: { x: Math.round(targetX), y: Math.round(targetY) },
    signAnchor: { x: Math.round(hookStartX), y: Math.round(hookStartY) },
    dx: targetX - hookStartX,
    dy: targetY - hookStartY,
  };
}

/**
 * Checks whether a pre-base sign (ெ, ே, ை) before a wide consonant has adequate horizontal clearance.
 * Returns any positive advance adjustment needed so the sign does not collide with wide consonant ink.
 */
export function computePreBaseClearance(
  baseContours: Contour[],
  signContours: Contour[],
  signAdvance: number,
  currentSpacing = 0,
  minClearance = 30,
): PreBaseClearanceResult {
  const baseBB = bboxOf(baseContours);
  const signBB = bboxOf(signContours);
  if (!baseBB || !signBB) return { minGap: minClearance, recommendedDelta: 0, overlapAmount: 0 };
  const signRightEdge = signBB.xMax;
  const baseLeftWithAdvance = signAdvance + currentSpacing + baseBB.xMin;
  const gap = baseLeftWithAdvance - signRightEdge;
  const deficit = Math.max(0, minClearance - gap);
  return {
    minGap: Math.round(gap),
    recommendedDelta: Math.round(deficit),
    overlapAmount: Math.round(Math.max(0, -gap)),
  };
}

export type SnapGlyphInput = {
  traced: Contour[] | null;
  params: GlyphParams;
  isMark: boolean;
};

/**
 * Builds pre-positioned magnetic composite contours for an undrawn joined Tamil syllable
 * (`கு`, `கூ`, `கி`, `கீ`, `டி`, `டீ`, `க்ஷ`, `ஸ்ரீ`) using the already-drawn consonant and sign.
 */
export function buildJoinedSyllableGuide(
  ligatureId: number,
  byCp: Map<number, SnapGlyphInput>,
): Contour[] | null {
  const lig = LIGATURES.find((l) => l.id === ligatureId);
  if (!lig) return null;
  const lay = (cp: number) => {
    const rec = byCp.get(cp);
    return rec?.traced?.length ? layoutGlyph(rec.traced, rec.params, rec.isMark) : null;
  };

  if (lig.seq.length === 2) {
    const [cCp, sCp] = lig.seq as [number, number];
    const cons = lay(cCp);
    if (!cons) return null;
    if (sCp === PULLI) {
      const pulli = lay(PULLI);
      if (!pulli) return cons.contours;
      return computePulliPlacement(cons.contours, pulli.contours, byCp.get(PULLI)?.params.offsetX ?? 0).contours;
    }
    const sign = lay(sCp);
    if (!sign) return cons.contours;
    if (sCp === 0x0bbf || sCp === 0x0bc0) {
      const snap = computePostBaseHookSnap(cons.contours, sign.contours);
      if (snap) {
        return [...cons.contours, ...mapContours(sign.contours, ([x, y]): P => [x + snap.dx, y + snap.dy])];
      }
    }
    return [...cons.contours, ...mapContours(sign.contours, ([x, y]): P => [x + cons.advance, y])];
  }

  // Conjuncts (e.g. க்ஷ, ஸ்ரீ): lay out drawn components sequentially with pulli snapped if present.
  const out: Contour[] = [];
  let cursorX = 0;
  let lastCons: Contour[] | null = null;
  for (const cp of lig.seq) {
    const part = lay(cp);
    if (!part) continue;
    if (cp === PULLI && lastCons) {
      const snapped = computePulliPlacement(lastCons, part.contours, byCp.get(PULLI)?.params.offsetX ?? 0);
      out.push(...snapped.contours.slice(lastCons.length));
      continue;
    }
    const shifted = mapContours(part.contours, ([x, y]): P => [x + cursorX, y]);
    out.push(...shifted);
    lastCons = shifted;
    cursorX += part.advance;
  }
  return out.length ? out : null;
}
