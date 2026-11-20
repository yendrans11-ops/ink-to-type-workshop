// Template geometry. All values are in template pixels; uploads are mapped back to this space.
import { CHARSETS, displayLabel, formatCodepoint, glyphNameFor, isCombiningMark } from "./charsets";

export type TemplateFormat = "print" | "ipad";

/** Geometry of one template page format, in template pixels. */
export type PageSpec = {
  format: TemplateFormat;
  pageW: number;
  pageH: number;
  fidSize: number;
  fidMargin: number;
  cols: number;
  rows: number;
  box: number;
  gapX: number;
  pitchY: number;
  labelH: number;
  gridTop: number;
  gridLeft: number;
  /** Centers of the four fiducial squares: TL, TR, BL, BR. */
  fiducials: { x: number; y: number }[];
};

function makeSpec(s: Omit<PageSpec, "gridLeft" | "fiducials">): PageSpec {
  const half = s.fidMargin + s.fidSize / 2;
  return {
    ...s,
    gridLeft: (s.pageW - (s.cols * s.box + (s.cols - 1) * s.gapX)) / 2,
    fiducials: [
      { x: half, y: half },
      { x: s.pageW - half, y: half },
      { x: half, y: s.pageH - half },
      { x: s.pageW - half, y: s.pageH - half },
    ],
  };
}

/** Paper (Letter/A4 ratio): 8 × 10 boxes per page. */
export const PRINT_SPEC = makeSpec({ format: "print", pageW: 1700, pageH: 2200, fidSize: 64, fidMargin: 56, cols: 8, rows: 10, box: 150, gapX: 22, pitchY: 186, labelH: 30, gridTop: 220 });
/** iPad Pro 12.9"/13" portrait screen (2048 × 2732 px): 6 × 7 larger boxes for Apple Pencil in a drawing app. */
export const IPAD_SPEC = makeSpec({ format: "ipad", pageW: 2048, pageH: 2732, fidSize: 84, fidMargin: 64, cols: 6, rows: 7, box: 250, gapX: 30, pitchY: 330, labelH: 44, gridTop: 220 });

export const PAGE_SPECS: Record<TemplateFormat, PageSpec> = { print: PRINT_SPEC, ipad: IPAD_SPEC };
export const specFor = (format: TemplateFormat | undefined) => PAGE_SPECS[format ?? "print"] ?? PRINT_SPEC;

// Paper-format constants, kept for code that only deals with the printable sheet.
export const PAGE_W = PRINT_SPEC.pageW;
export const PAGE_H = PRINT_SPEC.pageH;
export const FID_SIZE = PRINT_SPEC.fidSize;
export const FID_MARGIN = PRINT_SPEC.fidMargin;
export const COLS = PRINT_SPEC.cols;
export const ROWS = PRINT_SPEC.rows;
export const BOX = PRINT_SPEC.box;
export const CELLS_PER_PAGE = COLS * ROWS;

/** Vertical metrics drawn in each template box, as fractions of the box height from the top. */
export const BOX_GUIDES = { ascender: 0, capHeight: 0.1, xHeight: 0.3, baseline: 0.8, descender: 1 };

export const FIDUCIAL_CENTERS = PRINT_SPEC.fiducials;

export type Slot = {
  id: string;
  cp: number;
  name: string;
  label: string;
  isMark: boolean;
  setId: string;
  page: number;
  cell: number;
  x: number;
  y: number;
};

export type TemplateLayout = { slots: Slot[]; pageCount: number; spec: PageSpec };

export function cellPosition(cell: number, spec: PageSpec = PRINT_SPEC) {
  const col = cell % spec.cols;
  const row = Math.floor(cell / spec.cols);
  return { x: spec.gridLeft + col * (spec.box + spec.gapX), y: spec.gridTop + row * spec.pitchY + spec.labelH };
}

export function buildTemplateLayout(charsetIds: string[], extraChars: string, format: TemplateFormat = "print"): TemplateLayout {
  const spec = specFor(format);
  const perPage = spec.cols * spec.rows;
  const defs: { id: string; cp: number; isMark: boolean; setId: string }[] = [];
  const seen = new Set<number>();
  for (const set of CHARSETS) {
    if (!charsetIds.includes(set.id)) continue;
    set.chars.forEach((c) => {
      if (seen.has(c.cp)) return;
      seen.add(c.cp);
      defs.push({ id: `${set.id}-${c.cp.toString(16)}`, cp: c.cp, isMark: !!c.isMark, setId: set.id });
    });
  }
  for (const ch of Array.from(extraChars)) {
    const cp = ch.codePointAt(0)!;
    if (cp <= 0x20 || seen.has(cp)) continue;
    seen.add(cp);
    defs.push({ id: `custom-${cp.toString(16)}`, cp, isMark: isCombiningMark(cp), setId: "custom" });
  }
  const slots = defs.map((d, i) => {
    const page = Math.floor(i / perPage);
    const cell = i % perPage;
    return { ...d, name: glyphNameFor(d.cp), label: displayLabel(d.cp), page, cell, ...cellPosition(cell, spec) };
  });
  return { slots, pageCount: Math.max(1, Math.ceil(slots.length / perPage)), spec };
}

export type RenderOptions = { ghost: boolean; projectName?: string };

/** Draws one template page. Printed artifact colors are literal on purpose (they must survive printing). */
export function renderTemplatePage(
  ctx: CanvasRenderingContext2D,
  layout: TemplateLayout,
  page: number,
  opts: RenderOptions,
) {
  const sp = layout.spec;
  const B = sp.box;
  const k = B / PRINT_SPEC.box;
  const textX = sp.fidMargin + sp.fidSize + 40 * k;
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, sp.pageW, sp.pageH);

  ctx.fillStyle = "#000000";
  for (const c of sp.fiducials) {
    ctx.fillRect(c.x - sp.fidSize / 2, c.y - sp.fidSize / 2, sp.fidSize, sp.fidSize);
  }

  const headerY = sp.fidMargin + sp.fidSize * 0.75;
  ctx.fillStyle = "#555555";
  ctx.textBaseline = "alphabetic";
  ctx.font = `600 ${34 * k * 0.85 + 34 * 0.15}px 'Instrument Serif', Georgia, serif`;
  const title = opts.projectName ? `TypeCraft — ${opts.projectName}` : sp.format === "ipad" ? "TypeCraft iPad template" : "TypeCraft handwriting template";
  ctx.fillText(title, textX, headerY);
  ctx.font = `${20 * Math.min(k, 1.3)}px 'IBM Plex Mono', monospace`;
  ctx.fillStyle = "#888888";
  const pageText = `PAGE ${page + 1} / ${layout.pageCount}`;
  ctx.fillText(pageText, sp.pageW - textX - ctx.measureText(pageText).width, headerY);
  ctx.font = `${18 * Math.min(k, 1.3)}px 'IBM Plex Sans', sans-serif`;
  ctx.fillText(
    sp.format === "ipad"
      ? "Open in Procreate, GoodNotes or Notes. Draw one character per box with Apple Pencil, on the solid blue baseline. Export as PNG — don't crop."
      : "Write one character per box in dark ink. Sit letters on the solid blue baseline. Keep all four corner squares visible.",
    textX,
    sp.fidMargin + sp.fidSize + 30 * k,
  );

  const slots = layout.slots.filter((s) => s.page === page);
  for (const s of slots) {
    // Label strip
    ctx.fillStyle = "#666666";
    ctx.font = `${20 * k}px 'IBM Plex Sans', 'Noto Sans Tamil', sans-serif`;
    ctx.fillText(s.label, s.x + 2, s.y - 8 * k);
    ctx.fillStyle = "#aaaaaa";
    ctx.font = `${13 * k}px 'IBM Plex Mono', monospace`;
    const cpText = formatCodepoint(s.cp);
    ctx.fillText(cpText, s.x + B - ctx.measureText(cpText).width - 2, s.y - 9 * k);

    // Guides (light enough to fall above the default ink threshold)
    const g = (f: number) => s.y + f * B;
    ctx.strokeStyle = "#c9dbf6";
    ctx.lineWidth = 1.5 * k;
    ctx.setLineDash([6 * k, 6 * k]);
    for (const f of [BOX_GUIDES.capHeight, BOX_GUIDES.xHeight]) {
      ctx.beginPath();
      ctx.moveTo(s.x + 4 * k, g(f));
      ctx.lineTo(s.x + B - 4 * k, g(f));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = "#a9c6f0";
    ctx.lineWidth = 2 * k;
    ctx.beginPath();
    ctx.moveTo(s.x + 4 * k, g(BOX_GUIDES.baseline));
    ctx.lineTo(s.x + B - 4 * k, g(BOX_GUIDES.baseline));
    ctx.stroke();

    if (opts.ghost) {
      ctx.fillStyle = "#ececec";
      ctx.font = `${B * 0.62}px 'IBM Plex Sans', 'Noto Sans Tamil', sans-serif`;
      const measured = ctx.measureText(s.label);
      const above = measured.actualBoundingBoxAscent || B * 0.62;
      const below = measured.actualBoundingBoxDescent || 0;
      const scale = Math.min(1, B * 0.82 / Math.max(1, measured.width), B * (BOX_GUIDES.baseline - 0.08) / above, below ? B * (0.92 - BOX_GUIDES.baseline) / below : 1);
      ctx.font = `${B * 0.62 * scale}px 'IBM Plex Sans', 'Noto Sans Tamil', sans-serif`;
      const w = ctx.measureText(s.label).width;
      ctx.fillText(s.label, s.x + (B - w) / 2, g(BOX_GUIDES.baseline));
    }

    ctx.strokeStyle = "#bdbdbd";
    ctx.lineWidth = 2 * k;
    ctx.strokeRect(s.x, s.y, B, B);
  }
  ctx.restore();
}
