// Template geometry. All values are in template pixels; uploads are mapped back to this space.
import { CHARSETS, displayLabel, formatCodepoint, glyphNameFor, isCombiningMark } from "./charsets";

export const PAGE_W = 1700;
export const PAGE_H = 2200;
export const FID_SIZE = 64;
export const FID_MARGIN = 56;
export const COLS = 8;
export const ROWS = 10;
export const BOX = 150;
export const GAP_X = 22;
export const PITCH_Y = 186;
export const LABEL_H = 30;
export const GRID_TOP = 220;
export const GRID_LEFT = (PAGE_W - (COLS * BOX + (COLS - 1) * GAP_X)) / 2;
export const CELLS_PER_PAGE = COLS * ROWS;

/** Vertical metrics drawn in each template box, as fractions of the box height from the top. */
export const BOX_GUIDES = { ascender: 0, capHeight: 0.1, xHeight: 0.3, baseline: 0.8, descender: 1 };

/** Centers of the four fiducial squares: TL, TR, BL, BR. */
export const FIDUCIAL_CENTERS = [
  { x: FID_MARGIN + FID_SIZE / 2, y: FID_MARGIN + FID_SIZE / 2 },
  { x: PAGE_W - FID_MARGIN - FID_SIZE / 2, y: FID_MARGIN + FID_SIZE / 2 },
  { x: FID_MARGIN + FID_SIZE / 2, y: PAGE_H - FID_MARGIN - FID_SIZE / 2 },
  { x: PAGE_W - FID_MARGIN - FID_SIZE / 2, y: PAGE_H - FID_MARGIN - FID_SIZE / 2 },
];

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

export type TemplateLayout = { slots: Slot[]; pageCount: number };

export function cellPosition(cell: number) {
  const col = cell % COLS;
  const row = Math.floor(cell / COLS);
  return { x: GRID_LEFT + col * (BOX + GAP_X), y: GRID_TOP + row * PITCH_Y + LABEL_H };
}

export function buildTemplateLayout(charsetIds: string[], extraChars: string): TemplateLayout {
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
    const page = Math.floor(i / CELLS_PER_PAGE);
    const cell = i % CELLS_PER_PAGE;
    return { ...d, name: glyphNameFor(d.cp), label: displayLabel(d.cp), page, cell, ...cellPosition(cell) };
  });
  return { slots, pageCount: Math.max(1, Math.ceil(slots.length / CELLS_PER_PAGE)) };
}

export type RenderOptions = { ghost: boolean; projectName?: string };

/** Draws one template page. Printed artifact colors are literal on purpose (they must survive printing). */
export function renderTemplatePage(
  ctx: CanvasRenderingContext2D,
  layout: TemplateLayout,
  page: number,
  opts: RenderOptions,
) {
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);

  ctx.fillStyle = "#000000";
  for (const c of FIDUCIAL_CENTERS) {
    ctx.fillRect(c.x - FID_SIZE / 2, c.y - FID_SIZE / 2, FID_SIZE, FID_SIZE);
  }

  ctx.fillStyle = "#555555";
  ctx.textBaseline = "alphabetic";
  ctx.font = "600 34px 'Instrument Serif', Georgia, serif";
  ctx.fillText(opts.projectName ? `TypeCraft — ${opts.projectName}` : "TypeCraft handwriting template", 160, 104);
  ctx.font = "20px 'IBM Plex Mono', monospace";
  ctx.fillStyle = "#888888";
  ctx.fillText(`PAGE ${page + 1} / ${layout.pageCount}`, PAGE_W - 330, 104);
  ctx.font = "18px 'IBM Plex Sans', sans-serif";
  ctx.fillText(
    "Write one character per box in dark ink. Sit letters on the solid blue baseline. Keep all four corner squares visible.",
    160,
    150,
  );

  const slots = layout.slots.filter((s) => s.page === page);
  for (const s of slots) {
    // Label strip
    ctx.fillStyle = "#666666";
    ctx.font = "20px 'IBM Plex Sans', 'Noto Sans Tamil', sans-serif";
    ctx.fillText(s.label, s.x + 2, s.y - 8);
    ctx.fillStyle = "#aaaaaa";
    ctx.font = "13px 'IBM Plex Mono', monospace";
    const cpText = formatCodepoint(s.cp);
    ctx.fillText(cpText, s.x + BOX - ctx.measureText(cpText).width - 2, s.y - 9);

    // Guides (light enough to fall above the default ink threshold)
    const g = (f: number) => s.y + f * BOX;
    ctx.strokeStyle = "#c9dbf6";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 6]);
    for (const f of [BOX_GUIDES.capHeight, BOX_GUIDES.xHeight]) {
      ctx.beginPath();
      ctx.moveTo(s.x + 4, g(f));
      ctx.lineTo(s.x + BOX - 4, g(f));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = "#a9c6f0";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(s.x + 4, g(BOX_GUIDES.baseline));
    ctx.lineTo(s.x + BOX - 4, g(BOX_GUIDES.baseline));
    ctx.stroke();

    if (opts.ghost) {
      ctx.fillStyle = "#ececec";
      ctx.font = `${BOX * 0.62}px 'IBM Plex Sans', 'Noto Sans Tamil', sans-serif`;
      const w = ctx.measureText(s.label).width;
      ctx.fillText(s.label, s.x + (BOX - w) / 2, g(BOX_GUIDES.baseline));
    }

    ctx.strokeStyle = "#bdbdbd";
    ctx.lineWidth = 2;
    ctx.strokeRect(s.x, s.y, BOX, BOX);
  }
  ctx.restore();
}
