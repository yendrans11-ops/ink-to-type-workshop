// Minimal GSUB writer for Tamil: declares the tml2/taml scripts (so browsers run the Indic shaper, which reorders
// ெ ே ை before the consonant and splits ொ ோ ௌ) and adds ligature lookups for drawn syllables and pulli forms.

export type LigatureRule = { components: number[]; glyph: number }; // glyph ids
export type CaltRule = { base: number; alt1: number; alt2: number }; // glyph ids for base -> .alt1 -> .alt2
export type GsubInput = { conjuncts: LigatureRule[]; syllables: LigatureRule[]; calt?: CaltRule[] };

export class Writer {
  bytes: number[] = [];
  u16(v: number) { this.bytes.push((v >> 8) & 0xff, v & 0xff); }
  i16(v: number) { const n = Math.round(v); this.bytes.push((n >> 8) & 0xff, n & 0xff); }
  tag(t: string) { for (let i = 0; i < 4; i++) this.bytes.push(t.charCodeAt(i)); }
  get length() { return this.bytes.length; }
  setU16(at: number, v: number) { this.bytes[at] = (v >> 8) & 0xff; this.bytes[at + 1] = v & 0xff; }
  append(b: number[]) { this.bytes.push(...b); }
}

/** One lookup type 4 (ligature substitution), format 1, with a single subtable. */
function ligatureLookup(rules: LigatureRule[]): number[] {
  const byFirst = new Map<number, LigatureRule[]>();
  for (const r of rules) byFirst.set(r.components[0]!, [...(byFirst.get(r.components[0]!) ?? []), r]);
  const firsts = [...byFirst.keys()].sort((a, b) => a - b);

  const sub = new Writer();
  sub.u16(1); // substFormat
  const covAt = sub.length; sub.u16(0);
  sub.u16(firsts.length);
  const setAt = sub.length;
  firsts.forEach(() => sub.u16(0));
  firsts.forEach((f, i) => {
    sub.setU16(setAt + i * 2, sub.length);
    // Longer sequences first so ஸ்ரீ is tried before shorter matches.
    const ligs = byFirst.get(f)!.sort((a, b) => b.components.length - a.components.length);
    const set = new Writer();
    set.u16(ligs.length);
    const offAt = set.length;
    ligs.forEach(() => set.u16(0));
    ligs.forEach((l, j) => {
      set.setU16(offAt + j * 2, set.length);
      set.u16(l.glyph);
      set.u16(l.components.length);
      for (const c of l.components.slice(1)) set.u16(c);
    });
    sub.append(set.bytes);
  });
  sub.setU16(covAt, sub.length);
  sub.u16(1); // coverage format 1
  sub.u16(firsts.length);
  for (const f of firsts) sub.u16(f);

  const lookup = new Writer();
  lookup.u16(4); // ligature substitution
  lookup.u16(0); // flags
  lookup.u16(1);
  lookup.u16(8); // subtable right after this header (6 bytes + this offset)
  return [...lookup.bytes, ...sub.bytes];
}

/** One lookup type 1 (single substitution), format 2. */
function singleSubstLookup(rules: { from: number; to: number }[]): number[] {
  const sorted = [...rules].sort((a, b) => a.from - b.from);
  const sub = new Writer();
  sub.u16(2); // substFormat = 2
  const covAt = sub.length; sub.u16(0);
  sub.u16(sorted.length);
  for (const r of sorted) sub.u16(r.to);
  sub.setU16(covAt, sub.length);
  sub.u16(1); // coverage format 1
  sub.u16(sorted.length);
  for (const r of sorted) sub.u16(r.from);

  const lookup = new Writer();
  lookup.u16(1); // single substitution
  lookup.u16(0); // flags
  lookup.u16(1); // subTableCount
  lookup.u16(8); // subtable offset
  return [...lookup.bytes, ...sub.bytes];
}

/** One LookupType 6 Format 1 subtable: when `backtrack` immediately precedes `input`, run `substLookupIndex` on `input`. */
function chainContextSubtable(rules: { input: number; backtrack: number }[], substLookupIndex: number): number[] {
  const sorted = [...rules].sort((a, b) => a.input - b.input);
  const sub = new Writer();
  sub.u16(1); // substFormat = 1
  const covAt = sub.length; sub.u16(0);
  sub.u16(sorted.length); // chainSubRuleSetCount
  const setOffAt = sub.length;
  sorted.forEach(() => sub.u16(0));
  sorted.forEach((r, i) => {
    sub.setU16(setOffAt + i * 2, sub.length);
    sub.u16(1); // chainSubRuleCount
    sub.u16(4); // chainSubRuleOffsets[0] right after count + offset
    sub.u16(1); // backtrackGlyphCount
    sub.u16(r.backtrack);
    sub.u16(1); // inputGlyphCount (0 additional input glyphs follow)
    sub.u16(0); // lookaheadGlyphCount
    sub.u16(1); // substCount
    sub.u16(0); // sequenceIndex
    sub.u16(substLookupIndex); // lookupListIndex
  });
  sub.setU16(covAt, sub.length);
  sub.u16(1); // coverage format 1
  sub.u16(sorted.length);
  for (const r of sorted) sub.u16(r.input);
  return sub.bytes;
}

/** LookupType 6 chaining contextual substitution rotating consecutive repeats: C -> C.alt1 -> C.alt2. */
function caltChainLookup(rules: CaltRule[], alt1LookupIdx: number, alt2LookupIdx: number): number[] {
  // Subtable 0 (checked first): after base.alt1, replace base with base.alt2.
  const sub0 = chainContextSubtable(
    rules.map((r) => ({ input: r.base, backtrack: r.alt1 })),
    alt2LookupIdx,
  );
  // Subtable 1: after base, replace base with base.alt1.
  const sub1 = chainContextSubtable(
    rules.map((r) => ({ input: r.base, backtrack: r.base })),
    alt1LookupIdx,
  );
  const lookup = new Writer();
  lookup.u16(6); // chaining contextual substitution
  lookup.u16(0); // flags
  lookup.u16(2); // subTableCount
  const off0 = 10; // 6-byte header + 2 * 2-byte offsets
  lookup.u16(off0);
  lookup.u16(off0 + sub0.length);
  lookup.append(sub0);
  lookup.append(sub1);
  return lookup.bytes;
}

export function buildGsub({ conjuncts, syllables, calt = [] }: GsubInput): Uint8Array {
  const lookups: number[][] = [];
  const conjunctIdx = conjuncts.length ? lookups.push(ligatureLookup(conjuncts)) - 1 : -1;
  const syllableIdx = syllables.length ? lookups.push(ligatureLookup(syllables)) - 1 : -1;
  const all = [conjunctIdx, syllableIdx].filter((i) => i >= 0);

  let caltIdx = -1;
  if (calt.length) {
    const single1Idx = lookups.push(singleSubstLookup(calt.map((r) => ({ from: r.base, to: r.alt1 })))) - 1;
    const single2Idx = lookups.push(singleSubstLookup(calt.map((r) => ({ from: r.base, to: r.alt2 })))) - 1;
    caltIdx = lookups.push(caltChainLookup(calt, single1Idx, single2Idx)) - 1;
  }

  // Features MUST be sorted alphabetically by tag.
  const features: FeatureDef[] = [];
  if (conjunctIdx >= 0) features.push({ tag: "akhn", lookups: [conjunctIdx] });
  if (caltIdx >= 0) features.push({ tag: "calt", lookups: [caltIdx] });
  if (all.length) features.push({ tag: "liga", lookups: all });
  if (syllableIdx >= 0) features.push({ tag: "psts", lookups: [syllableIdx] });
  const fi = (tag: string) => features.findIndex((f) => f.tag === tag);
  const indic = [fi("akhn"), fi("calt"), fi("psts")].filter((i) => i >= 0);
  const dflt = [fi("calt"), fi("liga")].filter((i) => i >= 0);
  const scripts: ScriptDef[] = caltIdx >= 0
    ? [
        { tag: "DFLT", features: dflt },
        { tag: "latn", features: [fi("calt")] },
        { tag: "taml", features: indic },
        { tag: "tml2", features: indic },
      ]
    : [
        { tag: "DFLT", features: dflt },
        { tag: "taml", features: indic },
        { tag: "tml2", features: indic },
      ];

  return layoutTable(scripts, features, lookups, "GSUB");
}

export type ScriptDef = { tag: string; features: number[] };
export type FeatureDef = { tag: string; lookups: number[] };

/** Shared GSUB/GPOS container: ScriptList (default LangSys only), FeatureList and LookupList. Tags must be pre-sorted. */
export function layoutTable(scripts: ScriptDef[], features: FeatureDef[], lookups: number[][], label: string): Uint8Array {
  const scriptList = new Writer();
  scriptList.u16(scripts.length);
  const sRecAt = scriptList.length;
  for (const s of scripts) { scriptList.tag(s.tag); scriptList.u16(0); }
  scripts.forEach((s, i) => {
    scriptList.setU16(sRecAt + i * 6 + 4, scriptList.length);
    scriptList.u16(4); // default LangSys right after this 4-byte Script header
    scriptList.u16(0); // langSysCount
    scriptList.u16(0); // lookupOrderOffset
    scriptList.u16(0xffff); // no required feature
    scriptList.u16(s.features.length);
    for (const f of s.features) scriptList.u16(f);
  });

  const featureList = new Writer();
  featureList.u16(features.length);
  const fRecAt = featureList.length;
  for (const f of features) { featureList.tag(f.tag); featureList.u16(0); }
  features.forEach((f, i) => {
    featureList.setU16(fRecAt + i * 6 + 4, featureList.length);
    featureList.u16(0); // featureParams
    featureList.u16(f.lookups.length);
    for (const l of f.lookups) featureList.u16(l);
  });

  const lookupList = new Writer();
  lookupList.u16(lookups.length);
  const lOffAt = lookupList.length;
  lookups.forEach(() => lookupList.u16(0));
  lookups.forEach((l, i) => {
    lookupList.setU16(lOffAt + i * 2, lookupList.length);
    lookupList.append(l);
  });

  const out = new Writer();
  out.u16(1); out.u16(0); // version 1.0
  const scriptOff = 10;
  const featureOff = scriptOff + scriptList.length;
  const lookupOff = featureOff + featureList.length;
  if (lookupOff + lookupList.length > 0xffff) throw new Error(`Too many Tamil rules for one ${label} table`);
  out.u16(scriptOff); out.u16(featureOff); out.u16(lookupOff);
  out.append(scriptList.bytes);
  out.append(featureList.bytes);
  out.append(lookupList.bytes);
  return new Uint8Array(out.bytes);
}
