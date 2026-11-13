// Syllable spacing: which Tamil letter+sign combinations a project can adjust, and the font rules that apply them.
// Joined syllables (கு, டி, க்ஷ) are their own glyph, so their width is the glyph's side bearings. Everything else is
// two glyphs side by side after the shaper's reordering, so the gap is a pair adjustment between them.
import { charText, isTamilConsonant, LIGATURES, PULLI, VOWEL_U, VOWEL_UU } from "./tamil";

export type SyllableKind = "joined" | "prebase" | "postbase" | "pulli";
/** Group a syllable is listed under: a vowel sign, pulli, or "conjunct". */
export type SyllableGroup = number | "conjunct";

export type Syllable = {
  key: string; // logical text, e.g. "கெ" — key of the project's syllableSpacing map
  label: string; // what the editor shows
  sample: string; // text typed into the shaped preview
  kind: SyllableKind;
  group: SyllableGroup;
  consonant: number | null;
  sign: number | null;
  ligatureId?: number;
  /** Visual order (after reordering): the gap sits after `left`. */
  pair?: [left: number, right: number];
};

export const PREBASE_SIGNS = [0x0bc6, 0x0bc7, 0x0bc8]; // ெ ே ை
export const POSTBASE_SIGNS = [0x0bbe, 0x0bbf, 0x0bc0, VOWEL_U, VOWEL_UU, 0x0bd7]; // ா ி ீ ு ூ ௗ
export const GROUP_ORDER: SyllableGroup[] = [VOWEL_U, VOWEL_UU, 0x0bc6, 0x0bc7, 0x0bc8, 0x0bbe, 0x0bbf, 0x0bc0, 0x0bd7, PULLI, "conjunct"];
export const SPACING_LIMIT = 400;

/** Other syllables that reuse a gap, so the editor can say so. */
export const SHARED_BY: Record<number, string> = {
  0x0bc6: "Also the left side of ொ and ௌ",
  0x0bc7: "Also the left side of ோ",
  0x0bbe: "Also the right side of ொ and ோ",
  0x0bd7: "The right side of ௌ",
};

const text = (...cps: number[]) => String.fromCodePoint(...cps);

/** Every adjustable syllable for the characters drawn so far, in group order then consonant order. */
export function listSyllables(drawn: Set<number>): Syllable[] {
  const out: Syllable[] = [];
  const consonants = [...drawn].filter(isTamilConsonant).sort((a, b) => a - b);
  const joinedSeq = new Set<string>();
  for (const lig of LIGATURES) {
    if (!drawn.has(lig.id)) continue;
    joinedSeq.add(lig.seq.join(","));
    const last = lig.seq[lig.seq.length - 1]!;
    out.push({
      key: charText(lig.id),
      label: charText(lig.id),
      sample: charText(lig.id),
      kind: "joined",
      group: lig.kind === "conjunct" ? "conjunct" : last,
      consonant: lig.seq[0]!,
      sign: lig.kind === "conjunct" ? null : last,
      ligatureId: lig.id,
    });
  }
  for (const c of consonants) {
    for (const s of PREBASE_SIGNS) {
      if (drawn.has(s)) out.push({ key: text(c, s), label: text(c, s), sample: text(c, s), kind: "prebase", group: s, consonant: c, sign: s, pair: [s, c] });
    }
    for (const s of POSTBASE_SIGNS) {
      if (!drawn.has(s) || joinedSeq.has(`${c},${s}`)) continue;
      const sample = s === 0x0bd7 ? text(c, 0x0bcc) : text(c, s);
      out.push({ key: text(c, s), label: sample, sample, kind: "postbase", group: s, consonant: c, sign: s, pair: [c, s] });
    }
    if (drawn.has(PULLI) && !joinedSeq.has(`${c},${PULLI}`)) {
      out.push({ key: text(c, PULLI), label: text(c, PULLI), sample: text(c, PULLI), kind: "pulli", group: PULLI, consonant: c, sign: PULLI });
    }
  }
  const rank = (g: SyllableGroup) => GROUP_ORDER.indexOf(g);
  return out.sort((a, b) => rank(a.group) - rank(b.group));
}

export type CpPair = { left: number; right: number; value: number };

/** Pair adjustments (by codepoint) for every non-zero gap in the project's syllable spacing. */
export function syllableKerning(syllables: Syllable[], spacing: Record<string, number>): CpPair[] {
  const out: CpPair[] = [];
  for (const s of syllables) {
    const v = Math.round(spacing[s.key] ?? 0);
    if (s.pair && v) out.push({ left: s.pair[0], right: s.pair[1], value: v });
  }
  return out;
}

export const clampSpacing = (v: number) => Math.max(-SPACING_LIMIT, Math.min(SPACING_LIMIT, Math.round(v)));
