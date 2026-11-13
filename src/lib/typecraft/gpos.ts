// Minimal GPOS writer: one pair-adjustment ("kern") lookup for Tamil syllable spacing, e.g. the gap in கெ (ெ|க) or கா (க|ா).
import { layoutTable, Writer } from "./gsub";

export type PairAdjust = { left: number; right: number; value: number }; // glyph ids; value adds to the left glyph's advance

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

export function buildGpos(pairs: PairAdjust[]): Uint8Array | null {
  const used = pairs.filter((p) => Math.round(p.value) !== 0);
  if (!used.length) return null;
  const kern = [0];
  return layoutTable(
    [{ tag: "DFLT", features: kern }, { tag: "taml", features: kern }, { tag: "tml2", features: kern }],
    [{ tag: "kern", lookups: [0] }],
    [pairLookup(used)],
    "GPOS",
  );
}
