// Pre-export check: flags problems in the glyph set, Unicode mapping, font details and metrics
// before a font is compiled. Errors block the download; warnings can be overridden.
import { displayLabel, formatCodepoint } from "./charsets";
import type { FontMeta, Metrics } from "./font";

export type PreflightSeverity = "error" | "warning";
export type PreflightCategory = "glyphs" | "mapping" | "metadata" | "metrics";

export type PreflightIssue = {
  id: string;
  severity: PreflightSeverity;
  category: PreflightCategory;
  title: string;
  detail?: string;
  /** Font detail field the issue belongs to. */
  field?: keyof FontMeta;
  /** Glyphs involved, in project order. */
  glyphIds?: string[];
  /** Characters involved. */
  codepoints?: number[];
};

export type PreflightGlyph = {
  id: string;
  unicode: number;
  traced: unknown[] | null;
  source?: unknown;
};

export type PreflightInput = {
  glyphs: PreflightGlyph[];
  /** Characters the user chose to include (from the template character sets). */
  expected: number[];
  meta: FontMeta;
  metrics: Metrics;
};

export type PreflightResult = {
  issues: PreflightIssue[];
  errors: PreflightIssue[];
  warnings: PreflightIssue[];
  ok: boolean;
};

/** Longest family name most Windows apps show without truncating. */
export const MAX_FAMILY_NAME = 31;
export const VERSION_PATTERN = /^\d{1,5}(\.\d{1,3})?$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export const charLabel = (cp: number) => `${displayLabel(cp)} (${formatCodepoint(cp)})`;

const isDrawn = (g: PreflightGlyph) => !!g.traced && g.traced.length > 0;
const isValidCodepoint = (cp: number) =>
  Number.isInteger(cp) && cp > 0x20 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) && cp !== 0x7f;

function listChars(cps: number[], max = 12) {
  const shown = cps.slice(0, max).map((cp) => displayLabel(cp)).join(" ");
  return cps.length > max ? `${shown} +${cps.length - max} more` : shown;
}

export function runPreflight({ glyphs, expected, meta, metrics }: PreflightInput): PreflightResult {
  const issues: PreflightIssue[] = [];
  const drawn = glyphs.filter(isDrawn);

  // ---- Glyph coverage ----
  if (!drawn.length) {
    issues.push({
      id: "no-glyphs",
      severity: "error",
      category: "glyphs",
      title: "No drawn characters yet",
      detail: "Upload and trace a filled-in template before exporting.",
    });
  }

  const untraced = glyphs.filter((g) => g.traced === null);
  if (untraced.length) {
    issues.push({
      id: "untraced",
      severity: "warning",
      category: "glyphs",
      title: `${untraced.length} character${untraced.length === 1 ? " hasn't" : "s haven't"} been traced`,
      detail: "Run tracing on the upload page so they're included.",
      glyphIds: untraced.map((g) => g.id),
    });
  }

  const covered = new Set(drawn.map((g) => g.unicode));
  const missing = [...new Set(expected)].filter((cp) => !covered.has(cp));
  if (missing.length) {
    const fixable = glyphs.filter((g) => missing.includes(g.unicode) && !isDrawn(g)).map((g) => g.id);
    issues.push({
      id: "missing",
      severity: "warning",
      category: "glyphs",
      title: `${missing.length} character${missing.length === 1 ? " is" : "s are"} missing`,
      detail: `${listChars(missing)} — typing these will show a placeholder box.`,
      codepoints: missing,
      glyphIds: fixable,
    });
  }

  // ---- Unicode mapping ----
  const invalid = drawn.filter((g) => !isValidCodepoint(g.unicode));
  for (const g of invalid) {
    issues.push({
      id: `invalid-cp-${g.id}`,
      severity: "error",
      category: "mapping",
      title: `A glyph is assigned to an unusable code (${Number.isFinite(g.unicode) ? formatCodepoint(g.unicode) : "none"})`,
      detail: "Assign it to a real character in the studio.",
      glyphIds: [g.id],
    });
  }

  const byCp = new Map<number, string[]>();
  for (const g of drawn) {
    if (!isValidCodepoint(g.unicode)) continue;
    byCp.set(g.unicode, [...(byCp.get(g.unicode) ?? []), g.id]);
  }
  for (const [cp, ids] of byCp) {
    if (ids.length < 2) continue;
    issues.push({
      id: `duplicate-${cp}`,
      severity: "error",
      category: "mapping",
      title: `${ids.length} glyphs are assigned to ${charLabel(cp)}`,
      detail: "Only one can be used. Reassign or clear the extras in the studio.",
      codepoints: [cp],
      glyphIds: ids,
    });
  }

  // ---- Font details ----
  const fields: { key: keyof FontMeta; label: string }[] = [
    { key: "familyName", label: "Font name" },
    { key: "styleName", label: "Style" },
    { key: "designer", label: "Author" },
    { key: "version", label: "Version" },
    { key: "license", label: "License" },
    { key: "description", label: "Description" },
  ];
  for (const f of fields) {
    const value = f.key === "description" ? meta[f.key].replace(/[\n\r\t]/g, "") : meta[f.key];
    if (CONTROL_CHARS.test(value)) {
      issues.push({
        id: `control-${f.key}`,
        severity: "error",
        category: "metadata",
        title: `${f.label} contains hidden or line-break characters`,
        detail: "Retype it as a single line of plain text.",
        field: f.key,
      });
    }
  }

  const family = meta.familyName.trim();
  if (!family) {
    issues.push({ id: "family-empty", severity: "error", category: "metadata", title: "Font name is empty", detail: "It's the name you'll pick in your apps' font menu.", field: "familyName" });
  } else {
    if (family.length > MAX_FAMILY_NAME) {
      issues.push({
        id: "family-long",
        severity: "warning",
        category: "metadata",
        title: `Font name is longer than ${MAX_FAMILY_NAME} characters`,
        detail: "Some apps on Windows cut it off in the font menu.",
        field: "familyName",
      });
    }
    if (!/[A-Za-z0-9]/.test(family)) {
      issues.push({
        id: "family-ascii",
        severity: "warning",
        category: "metadata",
        title: "Font name has no English letters or numbers",
        detail: "It will still show in menus, but the file will be named “TypeCraftHand”.",
        field: "familyName",
      });
    }
  }

  if (!meta.styleName.trim()) {
    issues.push({ id: "style-empty", severity: "warning", category: "metadata", title: "Style is empty", detail: "“Regular” will be used.", field: "styleName" });
  }

  const version = meta.version.trim();
  if (!VERSION_PATTERN.test(version)) {
    issues.push({
      id: "version-format",
      severity: "error",
      category: "metadata",
      title: version ? `Version “${version}” isn't a valid number` : "Version is empty",
      detail: "Use a number like 1.000 or 2.1 — font installers rely on it to spot updates.",
      field: "version",
    });
  }

  if (!meta.designer.trim()) {
    issues.push({ id: "designer-empty", severity: "warning", category: "metadata", title: "Author is empty", detail: "Add your name so the font is credited to you.", field: "designer" });
  }

  // ---- Vertical metrics ----
  const { ascender, capHeight, xHeight, descender } = metrics;
  const nums = [ascender, capHeight, xHeight, descender];
  if (nums.some((n) => !Number.isFinite(n))) {
    issues.push({ id: "metrics-nan", severity: "error", category: "metrics", title: "Some guide lines have no value", detail: "Reset the guides in the studio." });
  } else if (!(descender < 0 && xHeight > 0 && xHeight < capHeight && capHeight <= ascender)) {
    issues.push({
      id: "metrics-order",
      severity: "error",
      category: "metrics",
      title: "Guide lines are out of order",
      detail: "From top to bottom they must be: ascender, cap height, x-height, baseline, descender.",
    });
  }

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  return { issues: [...errors, ...warnings], errors, warnings, ok: errors.length === 0 };
}
