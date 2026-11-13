// Character sets offered on the template. Each slot is a drawable cell that maps to a codepoint
// (or, for Tamil syllables, to a private ligature id — see tamil.ts).
import { charText, ligatureById, ligatureByText, LIGATURES } from "./tamil";

export type CharDef = { cp: number; isMark?: boolean };
export type Charset = {
  id: string;
  title: string;
  script: "Latin" | "Tamil";
  description: string;
  chars: CharDef[];
};

const range = (from: number, to: number): CharDef[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ cp: from + i }));
const list = (cps: number[], marks: number[] = []): CharDef[] =>
  cps.map((cp) => (marks.includes(cp) ? { cp, isMark: true } : { cp }));

export const CHARSETS: Charset[] = [
  { id: "latin-upper", title: "Uppercase", script: "Latin", description: "A – Z", chars: range(0x41, 0x5a) },
  { id: "latin-lower", title: "Lowercase", script: "Latin", description: "a – z", chars: range(0x61, 0x7a) },
  { id: "digits", title: "Figures", script: "Latin", description: "0 – 9", chars: range(0x30, 0x39) },
  {
    id: "punctuation",
    title: "Punctuation",
    script: "Latin",
    description: "! ? & @ ( ) …",
    chars: [...range(0x21, 0x2f), ...range(0x3a, 0x40), ...range(0x5b, 0x60), ...range(0x7b, 0x7e)],
  },
  {
    id: "tamil-vowels",
    title: "Tamil vowels",
    script: "Tamil",
    description: "அ ஆ இ … ஔ ஃ",
    chars: list([0x0b85, 0x0b86, 0x0b87, 0x0b88, 0x0b89, 0x0b8a, 0x0b8e, 0x0b8f, 0x0b90, 0x0b92, 0x0b93, 0x0b94, 0x0b83]),
  },
  {
    id: "tamil-consonants",
    title: "Tamil consonants",
    script: "Tamil",
    description: "க ங ச … ஹ",
    chars: list([
      0x0b95, 0x0b99, 0x0b9a, 0x0b9c, 0x0b9e, 0x0b9f, 0x0ba3, 0x0ba4, 0x0ba8, 0x0ba9, 0x0baa, 0x0bae,
      0x0baf, 0x0bb0, 0x0bb1, 0x0bb2, 0x0bb3, 0x0bb4, 0x0bb5, 0x0bb6, 0x0bb7, 0x0bb8, 0x0bb9,
    ]),
  },
  {
    id: "tamil-signs",
    title: "Tamil signs",
    script: "Tamil",
    description: "ா ி ீ ு … ்",
    // Only pulli (U+0BCD) sits over the consonant with zero advance; ீ is Mn in Unicode but drawn to the right.
    // ொ ோ ௌ are split by the shaper into ெ/ே + ா/ௗ around the consonant, so their own cells are optional.
    chars: list(
      [0x0bbe, 0x0bbf, 0x0bc0, 0x0bc1, 0x0bc2, 0x0bc6, 0x0bc7, 0x0bc8, 0x0bca, 0x0bcb, 0x0bcc, 0x0bcd, 0x0bd7],
      [0x0bcd],
    ),
  },
  {
    id: "tamil-syllables",
    title: "Tamil syllables",
    script: "Tamil",
    description: "கு கூ டி … க்ஷ ஸ்ரீ",
    // Consonant + ு / ூ (and a few others) change shape completely, so each is drawn as one glyph.
    chars: LIGATURES.map((l) => ({ cp: l.id })),
  },
];

export const DEFAULT_CHARSETS = ["latin-upper", "latin-lower", "digits", "punctuation"];

const AGL: Record<number, string> = {
  0x21: "exclam", 0x22: "quotedbl", 0x23: "numbersign", 0x24: "dollar", 0x25: "percent",
  0x26: "ampersand", 0x27: "quotesingle", 0x28: "parenleft", 0x29: "parenright", 0x2a: "asterisk",
  0x2b: "plus", 0x2c: "comma", 0x2d: "hyphen", 0x2e: "period", 0x2f: "slash", 0x30: "zero",
  0x31: "one", 0x32: "two", 0x33: "three", 0x34: "four", 0x35: "five", 0x36: "six", 0x37: "seven",
  0x38: "eight", 0x39: "nine", 0x3a: "colon", 0x3b: "semicolon", 0x3c: "less", 0x3d: "equal",
  0x3e: "greater", 0x3f: "question", 0x40: "at", 0x5b: "bracketleft", 0x5c: "backslash",
  0x5d: "bracketright", 0x5e: "asciicircum", 0x5f: "underscore", 0x60: "grave", 0x7b: "braceleft",
  0x7c: "bar", 0x7d: "braceright", 0x7e: "asciitilde", 0x20: "space",
};

export function glyphNameFor(cp: number): string {
  const lig = ligatureById(cp);
  if (lig) return `uni${lig.seq.map((c) => c.toString(16).toUpperCase().padStart(4, "0")).join("")}`;
  if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) return String.fromCodePoint(cp);
  if (AGL[cp]) return AGL[cp];
  const hex = cp.toString(16).toUpperCase();
  return cp > 0xffff ? `u${hex}` : `uni${hex.padStart(4, "0")}`;
}

const hexCp = (cp: number) => `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
/** "U+0B85", or the component sequence "U+0B95 U+0BC1" for a syllable ligature. */
export const formatCodepoint = (cp: number) => {
  const lig = ligatureById(cp);
  return lig ? lig.seq.map(hexCp).join(" ") : hexCp(cp);
};

/** Unicode general category Mn (non-spacing mark) heuristic for scripts we offer. */
export function isCombiningMark(cp: number): boolean {
  return (cp >= 0x0300 && cp <= 0x036f) || cp === 0x0bcd || cp === 0x0b82;
}

/** Display label: combining marks are shown on a dotted circle so they remain visible. */
export function displayLabel(cp: number): string {
  const ch = charText(cp);
  return cp >= 0x0bbe && cp <= 0x0bd7 ? `\u25CC${ch}` : ch;
}

/** Parse a user-entered codepoint: "A", "அ", "U+0B85", "0x41", "65", or a syllable "கு" / "U+0B95 U+0BC1". */
export function parseCodepointInput(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const hex = s.match(/^(?:u\+|0x)([0-9a-f]{1,6})$/i);
  if (hex?.[1]) return validCp(parseInt(hex[1], 16));
  const hexSeq = s.match(/^(?:u\+[0-9a-f]{4,6}[\s,]*){2,4}$/i);
  if (hexSeq) {
    const cps = Array.from(s.matchAll(/u\+([0-9a-f]{4,6})/gi), (m) => parseInt(m[1]!, 16));
    return ligatureByText(String.fromCodePoint(...cps))?.id ?? null;
  }
  if (/^\d{2,7}$/.test(s)) return validCp(parseInt(s, 10));
  const text = s.replace(/\u25CC/g, "").normalize("NFC");
  const chars = Array.from(text);
  const only = chars.length === 1 ? chars[0]?.codePointAt(0) : undefined;
  if (only !== undefined) return validCp(only);
  return ligatureByText(text)?.id ?? null;
}
const validCp = (cp: number) => (cp > 0x20 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? cp : null);
