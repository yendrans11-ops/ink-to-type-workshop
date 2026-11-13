// Pure coverage summary for the AI advisor: which chosen characters are drawn vs missing.
import { CHARSETS, formatCodepoint } from "./charsets";

export type CoverageGlyph = { unicode: number; traced: boolean; empty: boolean };
export type CoverageSet = { id: string; title: string; script: string; total: number; done: number; missing: { char: string; code: string }[] };

export function summarizeCoverage(charsetIds: string[], glyphs: CoverageGlyph[]): CoverageSet[] {
  const done = new Set(glyphs.filter((g) => g.traced && !g.empty).map((g) => g.unicode));
  return CHARSETS.filter((c) => charsetIds.includes(c.id)).map((c) => {
    const missing = c.chars.filter((ch) => !done.has(ch.cp)).map((ch) => ({ char: String.fromCodePoint(ch.cp), code: formatCodepoint(ch.cp) }));
    return { id: c.id, title: c.title, script: c.script, total: c.chars.length, done: c.chars.length - missing.length, missing };
  });
}
