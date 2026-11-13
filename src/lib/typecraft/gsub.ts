// Minimal GSUB writer for Tamil: declares the tml2/taml scripts (so browsers run the Indic shaper, which reorders
// ெ ே ை before the consonant and splits ொ ோ ௌ) and adds ligature lookups for drawn syllables and pulli forms.

export type LigatureRule = { components: number[]; glyph: number }; // glyph ids
export type GsubInput = { conjuncts: LigatureRule[]; syllables: LigatureRule[] };

class Writer {
  bytes: number[] = [];
  u16(v: number) { this.bytes.push((v >> 8) & 0xff, v & 0xff); }
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

export function buildGsub({ conjuncts, syllables }: GsubInput): Uint8Array {
  const lookups: number[][] = [];
  const conjunctIdx = conjuncts.length ? lookups.push(ligatureLookup(conjuncts)) - 1 : -1;
  const syllableIdx = syllables.length ? lookups.push(ligatureLookup(syllables)) - 1 : -1;
  const all = [conjunctIdx, syllableIdx].filter((i) => i >= 0);

  // Features sorted by tag. akhn runs before reordering, psts after — both cover the whole syllable in HarfBuzz/CoreText.
  const features: { tag: string; lookups: number[] }[] = [];
  if (conjunctIdx >= 0) features.push({ tag: "akhn", lookups: [conjunctIdx] });
  if (all.length) features.push({ tag: "liga", lookups: all });
  if (syllableIdx >= 0) features.push({ tag: "psts", lookups: [syllableIdx] });
  const fi = (tag: string) => features.findIndex((f) => f.tag === tag);
  const indic = [fi("akhn"), fi("psts")].filter((i) => i >= 0);
  const scripts: { tag: string; features: number[] }[] = [
    { tag: "DFLT", features: fi("liga") >= 0 ? [fi("liga")] : [] },
    { tag: "taml", features: indic },
    { tag: "tml2", features: indic },
  ];

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
  if (lookupOff + lookupList.length > 0xffff) throw new Error("Too many Tamil ligatures for one GSUB table");
  out.u16(scriptOff); out.u16(featureOff); out.u16(lookupOff);
  out.append(scriptList.bytes);
  out.append(featureList.bytes);
  out.append(lookupList.bytes);
  return new Uint8Array(out.bytes);
}
