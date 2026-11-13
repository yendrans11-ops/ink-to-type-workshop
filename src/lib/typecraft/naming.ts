// OpenType naming: turns the font details into name-table records, style-linking flags and OS/2 / head values.
// Pure so the rules are unit-testable; font.ts writes the result into the binary.
import type { FontMeta } from "./font";

export const WEIGHTS = [
  { value: 100, name: "Thin" },
  { value: 200, name: "ExtraLight" },
  { value: 300, name: "Light" },
  { value: 400, name: "Regular" },
  { value: 500, name: "Medium" },
  { value: 600, name: "SemiBold" },
  { value: 700, name: "Bold" },
  { value: 800, name: "ExtraBold" },
  { value: 900, name: "Black" },
] as const;

export type Embedding = FontMeta["embedding"];
/** OS/2 fsType embedding permission bits. */
export const EMBEDDING: Record<Embedding, { fsType: number; label: string; hint: string }> = {
  installable: { fsType: 0, label: "Installable", hint: "Can be embedded in documents and installed by others" },
  editable: { fsType: 8, label: "Editable", hint: "Can be embedded in documents that others can edit" },
  preview: { fsType: 4, label: "Preview & print", hint: "Embedded documents can be viewed and printed, not edited" },
  restricted: { fsType: 2, label: "Restricted", hint: "Can't be embedded in documents" },
};

export const NAME_ID_LABELS: Record<number, string> = {
  0: "Copyright", 1: "Family (legacy)", 2: "Subfamily (legacy)", 3: "Unique ID", 4: "Full name", 5: "Version",
  6: "PostScript name", 7: "Trademark", 8: "Manufacturer", 9: "Designer", 10: "Description", 11: "Vendor URL",
  12: "Designer URL", 13: "License", 14: "License URL", 16: "Typographic family", 17: "Typographic subfamily", 19: "Sample text",
};

export type NameRecord = { nameID: number; value: string };

export type ResolvedNames = {
  family: string;
  subfamily: string;
  legacyFamily: string;
  legacySubfamily: string;
  fullName: string;
  postScriptName: string;
  uniqueId: string;
  versionString: string;
  fontRevision: number;
  bold: boolean;
  italic: boolean;
  weightClass: number;
  fsSelection: number;
  macStyle: number;
  fsType: number;
  vendorId: string;
  records: NameRecord[];
};

const ITALIC_WORD = /\b(italic|oblique)\b/gi;
// Characters PostScript names may not contain (besides space and non-ASCII).
const PS_FORBIDDEN = /[[\](){}<>/%]/;

export function weightName(weight: number) {
  return WEIGHTS.find((w) => w.value === weight)?.name ?? `W${weight}`;
}

/** "Regular", "Italic", "Bold Italic", "Light Italic", … */
export function standardStyleName(weight: number, italic: boolean) {
  const w = weightName(weight);
  if (!italic) return w;
  return w === "Regular" ? "Italic" : `${w} Italic`;
}

export function hasItalicWord(style: string) {
  return new RegExp(ITALIC_WORD.source, "i").test(style);
}

/** Style name without "Italic"/"Oblique", e.g. "Light Italic" → "Light", "Italic" → "". */
export function styleBase(style: string) {
  return style.replace(ITALIC_WORD, "").replace(/\s+/g, " ").trim();
}

export function isValidPostScriptName(s: string) {
  return s.length > 0 && s.length <= 63 && /^[\x21-\x7e]+$/.test(s) && !PS_FORBIDDEN.test(s);
}

export function isValidVendorId(s: string) {
  return s.length <= 4 && /^[\x20-\x7e]*$/.test(s);
}

export function autoPostScriptName(family: string, subfamily: string) {
  const f = family.replace(/[^A-Za-z0-9]+/g, "") || "TypeCraftHand";
  const s = subfamily.replace(/[^A-Za-z0-9]+/g, "") || "Regular";
  return `${f}-${s}`.slice(0, 63);
}

export function resolveNames(meta: FontMeta): ResolvedNames {
  const family = meta.familyName.trim() || "TypeCraft Hand";
  const weightClass = Math.min(1000, Math.max(1, Math.round(meta.weightClass || 400)));
  const italic = !!meta.italic;
  const subfamily = meta.styleName.trim() || standardStyleName(weightClass, italic);

  // Style linking: legacy apps only understand Regular / Italic / Bold / Bold Italic inside one family,
  // so any other style moves into the legacy family name ("My Hand Light" + "Regular").
  const base = styleBase(subfamily);
  const bold = /^bold$/i.test(base);
  const regularBase = base === "" || /^regular$/i.test(base);
  const legacyFamily = bold || regularBase ? family : `${family} ${base}`;
  const legacySubfamily = bold ? (italic ? "Bold Italic" : "Bold") : italic ? "Italic" : "Regular";
  const typographic = legacyFamily !== family || legacySubfamily !== subfamily;

  const fullName = `${family} ${subfamily}`;
  const psOverride = meta.postScriptName.trim();
  const postScriptName = isValidPostScriptName(psOverride) ? psOverride : autoPostScriptName(family, subfamily);
  const parsed = Number.parseFloat(meta.version.trim());
  const fontRevision = Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 1000) / 1000 : 1;
  const versionString = `Version ${fontRevision.toFixed(3)}`;
  const vendorRaw = meta.vendorId.trim();
  const vendorId = (isValidVendorId(vendorRaw) && vendorRaw ? vendorRaw : "NONE").padEnd(4, " ");
  const uniqueId = `${fontRevision.toFixed(3)};${vendorId.trim()};${postScriptName}`;

  const fsSelection = (italic ? 1 : 0) | (bold ? 32 : 0) | (!italic && !bold ? 64 : 0);
  const macStyle = (bold ? 1 : 0) | (italic ? 2 : 0);
  const fsType = EMBEDDING[meta.embedding]?.fsType ?? 0;

  const one = (s: string) => s.replace(/[\r\n\t]+/g, " ").trim();
  const entries: [number, string][] = [
    [0, one(meta.copyright)],
    [1, legacyFamily],
    [2, legacySubfamily],
    [3, uniqueId],
    [4, fullName],
    [5, versionString],
    [6, postScriptName],
    [7, one(meta.trademark)],
    [8, one(meta.manufacturer)],
    [9, one(meta.designer)],
    [10, meta.description.trim() || "Made with TypeCraft"],
    [11, one(meta.manufacturerURL)],
    [12, one(meta.designerURL)],
    [13, meta.license.trim()],
    [14, one(meta.licenseURL)],
    [16, typographic ? family : ""],
    [17, typographic ? subfamily : ""],
    [19, one(meta.sampleText)],
  ];
  const records = entries.filter(([, v]) => v.length > 0).map(([nameID, value]) => ({ nameID, value }));

  return {
    family, subfamily, legacyFamily, legacySubfamily, fullName, postScriptName, uniqueId, versionString, fontRevision,
    bold, italic, weightClass, fsSelection, macStyle, fsType, vendorId, records,
  };
}
