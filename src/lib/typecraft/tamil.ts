// Tamil shaping data: drawn syllable ligatures (கு, கூ, டி, க்ஷ …), their internal ids, and pulli composites.
// Syllables are stored like characters, keyed by a private id in Supplementary Private Use Area-A. They are
// exported unencoded and reached only through GSUB ligatures, so the private ids never appear in the font's cmap.

export const LIGATURE_BASE = 0xf0000;
export const PULLI = 0x0bcd;
export const VOWEL_U = 0x0bc1;
export const VOWEL_UU = 0x0bc2;

/** The 18 native consonants; each has its own drawn shape with ு and ூ. */
export const NATIVE_CONSONANTS = [
  0x0b95, 0x0b99, 0x0b9a, 0x0b9e, 0x0b9f, 0x0ba3, 0x0ba4, 0x0ba8, 0x0baa,
  0x0bae, 0x0baf, 0x0bb0, 0x0bb2, 0x0bb5, 0x0bb4, 0x0bb3, 0x0bb1, 0x0ba9,
];

export type LigatureKind = "conjunct" | "syllable";
export type LigatureDef = { id: number; seq: number[]; kind: LigatureKind };

// Order is part of saved projects (ids are index-based): only ever append.
const SEQUENCES: { seq: number[]; kind: LigatureKind }[] = [
  ...NATIVE_CONSONANTS.flatMap((c) => [
    { seq: [c, VOWEL_U], kind: "syllable" as const },
    { seq: [c, VOWEL_UU], kind: "syllable" as const },
  ]),
  { seq: [0x0b9f, 0x0bbf], kind: "syllable" }, // டி
  { seq: [0x0b9f, 0x0bc0], kind: "syllable" }, // டீ
  { seq: [0x0b95, PULLI, 0x0bb7], kind: "conjunct" }, // க்ஷ
  { seq: [0x0bb8, PULLI, 0x0bb0, 0x0bc0], kind: "conjunct" }, // ஸ்ரீ
  // ி / ீ join the consonant's outline too; preserve all older private ids by appending.
  ...NATIVE_CONSONANTS.filter((c) => c !== 0x0b9f).flatMap((c) => [
    { seq: [c, 0x0bbf], kind: "syllable" as const },
    { seq: [c, 0x0bc0], kind: "syllable" as const },
  ]),
];

export const LIGATURES: LigatureDef[] = SEQUENCES.map((s, i) => ({ id: LIGATURE_BASE + i, ...s }));

const byId = new Map(LIGATURES.map((l) => [l.id, l]));
const byText = new Map(LIGATURES.map((l) => [String.fromCodePoint(...l.seq), l]));

export const ligatureById = (id: number) => byId.get(id);
export const ligatureByText = (text: string) => byText.get(text);
export const isLigatureId = (cp: number) => byId.has(cp);

export const isTamilConsonant = (cp: number) => cp >= 0x0b95 && cp <= 0x0bb9;
/** Vowel signs and pulli: combining characters that only make sense after a consonant. */
export const isTamilSign = (cp: number) => cp >= 0x0bbe && cp <= 0x0bd7;
export const isTamilCp = (cp: number) => (cp >= 0x0b80 && cp <= 0x0bff) || isLigatureId(cp);

/** The text a glyph stands for: one character, or the whole syllable for a ligature. */
export function charText(cp: number): string {
  const lig = byId.get(cp);
  if (lig) return String.fromCodePoint(...lig.seq);
  try {
    return String.fromCodePoint(cp);
  } catch {
    return "?";
  }
}

export type SyllableUse = { text: string; id: number; drawn: boolean };

/** Distinct drawable syllables in a text and whether the font has a hand-drawn shape for each, in order of appearance. */
export function syllablesInText(text: string, drawnIds: Set<number>): SyllableUse[] {
  const out = new Map<number, SyllableUse>();
  const cps = Array.from(text.normalize("NFC"), (c) => c.codePointAt(0)!);
  for (let i = 0; i < cps.length; i++) {
    // Longest match first so ஸ்ரீ wins over its parts.
    for (const len of [4, 3, 2]) {
      const lig = byText.get(String.fromCodePoint(...cps.slice(i, i + len)));
      if (!lig || lig.seq.length !== len) continue;
      if (!out.has(lig.id)) out.set(lig.id, { text: String.fromCodePoint(...lig.seq), id: lig.id, drawn: drawnIds.has(lig.id) });
      i += len - 1;
      break;
    }
  }
  return [...out.values()];
}
