// Minimal GPOS writer: pair-adjustment ("kern") for Tamil syllable spacing plus MarkToBase ("mark") and MarkToMark ("mkmk") attachment.
import { layoutTable, Writer } from "./gsub";

export type PairAdjust = { left: number; right: number; value: number }; // glyph ids; value adds to the left glyph's advance
export type GposAnchor = { x: number; y: number };
export type MarkRecordInput = { glyph: number; anchor: GposAnchor; markClass?: number };
export type BaseRecordInput = { glyph: number; anchors: (GposAnchor | null)[] };
export type MarkAttachmentInput = {
  markClassCount: number;
  marks: MarkRecordInput[];
  bases: BaseRecordInput[];
};
export type GposAttachments = {
  markToBase?: MarkAttachmentInput;
  markToMark?: MarkAttachmentInput;
};

/** PairPos format 1 with XAdvance on the first glyph. */
function pairLookup(pairs: PairAdjust[]): number[] {
  const byLeft = new Map<number, Map<number, number>>();
  for (const p of pairs) {
    const m = byLeft.get(p.left) ?? new Map<number, number>();
    m.set(p.right, Math.round(p.value));
    byLeft.set(p.left, m);
  }
  const lefts = [...byLeft.keys()].sort((a, b) => a - b);
  const sub = new Writer();
  sub.u16(1); // posFormat
  const covAt = sub.length; sub.u16(0);
  sub.u16(0x0004); // valueFormat1: XAdvance
  sub.u16(0); // valueFormat2: none
  sub.u16(lefts.length);
  const setAt = sub.length;
  lefts.forEach(() => sub.u16(0));
  lefts.forEach((l, i) => {
    sub.setU16(setAt + i * 2, sub.length);
    const rights = [...byLeft.get(l)!.entries()].sort((a, b) => a[0] - b[0]);
    sub.u16(rights.length);
    for (const [r, v] of rights) { sub.u16(r); sub.u16(v & 0xffff); }
  });
  sub.setU16(covAt, sub.length);
  sub.u16(1);
  sub.u16(lefts.length);
  for (const l of lefts) sub.u16(l);

  const lookup = new Writer();
  lookup.u16(2); // pair adjustment
  lookup.u16(0);
  lookup.u16(1);
  lookup.u16(8);
  return [...lookup.bytes, ...sub.bytes];
}

function writeCoverage(w: Writer, glyphs: number[]) {
  w.u16(1); // coverage format 1
  w.u16(glyphs.length);
  for (const g of glyphs) w.u16(g);
}

/** LookupType 4 (MarkToBase Format 1) or LookupType 6 (MarkToMark Format 1). */
function markAttachmentLookup(lookupType: 4 | 6, spec: MarkAttachmentInput): number[] {
  const marks = [...new Map(spec.marks.map((m) => [m.glyph, m])).values()].sort((a, b) => a.glyph - b.glyph);
  const bases = [...new Map(spec.bases.map((b) => [b.glyph, b])).values()].sort((a, b) => a.glyph - b.glyph);
  const classCount = Math.max(1, spec.markClassCount);

  const sub = new Writer();
  sub.u16(1); // posFormat 1
  const markCovAt = sub.length; sub.u16(0);
  const baseCovAt = sub.length; sub.u16(0);
  sub.u16(classCount);
  const markArrAt = sub.length; sub.u16(0);
  const baseArrAt = sub.length; sub.u16(0);

  sub.setU16(markCovAt, sub.length);
  writeCoverage(sub, marks.map((m) => m.glyph));

  sub.setU16(baseCovAt, sub.length);
  writeCoverage(sub, bases.map((b) => b.glyph));

  sub.setU16(markArrAt, sub.length);
  const markArr = new Writer();
  markArr.u16(marks.length);
  const markAnchorSlots: number[] = [];
  for (const m of marks) {
    markArr.u16(m.markClass ?? 0);
    markAnchorSlots.push(markArr.length);
    markArr.u16(0);
  }
  marks.forEach((m, i) => {
    markArr.setU16(markAnchorSlots[i]!, markArr.length);
    markArr.u16(1); // Anchor format 1
    markArr.i16(m.anchor.x);
    markArr.i16(m.anchor.y);
  });
  sub.append(markArr.bytes);

  sub.setU16(baseArrAt, sub.length);
  const baseArr = new Writer();
  baseArr.u16(bases.length);
  const baseAnchorSlots: { at: number; anchor: GposAnchor | null }[] = [];
  for (const b of bases) {
    for (let c = 0; c < classCount; c++) {
      baseAnchorSlots.push({ at: baseArr.length, anchor: b.anchors[c] ?? null });
      baseArr.u16(0);
    }
  }
  for (const slot of baseAnchorSlots) {
    if (!slot.anchor) continue;
    baseArr.setU16(slot.at, baseArr.length);
    baseArr.u16(1); // Anchor format 1
    baseArr.i16(slot.anchor.x);
    baseArr.i16(slot.anchor.y);
  }
  sub.append(baseArr.bytes);

  const lookup = new Writer();
  lookup.u16(lookupType);
  lookup.u16(0); // lookupFlag
  lookup.u16(1); // subTableCount
  lookup.u16(8); // subtable offset
  return [...lookup.bytes, ...sub.bytes];
}

export function buildGpos(pairs: PairAdjust[], attachments?: GposAttachments): Uint8Array | null {
  const used = pairs.filter((p) => Math.round(p.value) !== 0);
  const hasMark = !!(attachments?.markToBase?.marks.length && attachments.markToBase.bases.length);
  const hasMkmk = !!(attachments?.markToMark?.marks.length && attachments.markToMark.bases.length);
  if (!used.length && !hasMark && !hasMkmk) return null;

  const lookups: number[][] = [];
  const features: { tag: string; lookups: number[] }[] = [];
  if (used.length) {
    const idx = lookups.push(pairLookup(used)) - 1;
    features.push({ tag: "kern", lookups: [idx] });
  }
  if (hasMark && attachments?.markToBase) {
    const idx = lookups.push(markAttachmentLookup(4, attachments.markToBase)) - 1;
    features.push({ tag: "mark", lookups: [idx] });
  }
  if (hasMkmk && attachments?.markToMark) {
    const idx = lookups.push(markAttachmentLookup(6, attachments.markToMark)) - 1;
    features.push({ tag: "mkmk", lookups: [idx] });
  }

  const allFeatures = features.map((_, i) => i);
  return layoutTable(
    [{ tag: "DFLT", features: allFeatures }, { tag: "taml", features: allFeatures }, { tag: "tml2", features: allFeatures }],
    features,
    lookups,
    "GPOS",
  );
}
