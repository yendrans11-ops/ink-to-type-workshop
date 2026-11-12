// Browser-only helpers: decode uploads (PNG/JPG/PDF) into canvases, then into detected template pages.
import { useProject, useUploads, type UploadPage } from "./store";
import { buildTemplateLayout, BOX, FIDUCIAL_CENTERS, PAGE_H, PAGE_W, renderTemplatePage } from "./template";
import { TILE } from "./trace";
import { detectFiducials, rgbaToGray, solveHomography, warpCell } from "./vision";

const MAX_DIM = 3000;

function fitCanvas(w: number, h: number) {
  const s = Math.min(1, MAX_DIM / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  return c;
}

async function imageFileToCanvas(file: File): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(file);
  const c = fitCanvas(bmp.width, bmp.height);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

async function pdfFileToCanvases(file: File): Promise<HTMLCanvasElement[]> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const out: HTMLCanvasElement[] = [];
  for (let i = 1; i <= Math.min(doc.numPages, 12); i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(4, 2400 / Math.max(base.width, base.height)) });
    const c = document.createElement("canvas");
    c.width = Math.round(viewport.width);
    c.height = Math.round(viewport.height);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvas: c, canvasContext: ctx, viewport }).promise;
    out.push(c);
  }
  return out;
}

export async function filesToCanvases(files: File[]) {
  const out: { canvas: HTMLCanvasElement; name: string }[] = [];
  for (const f of files) {
    if (f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")) {
      const pages = await pdfFileToCanvases(f);
      pages.forEach((canvas, i) => out.push({ canvas, name: `${f.name} · p${i + 1}` }));
    } else out.push({ canvas: await imageFileToCanvas(f), name: f.name });
  }
  return out;
}

function previewOf(c: HTMLCanvasElement) {
  const s = Math.min(1, 1100 / Math.max(c.width, c.height));
  const p = document.createElement("canvas");
  p.width = Math.round(c.width * s);
  p.height = Math.round(c.height * s);
  p.getContext("2d")!.drawImage(c, 0, 0, p.width, p.height);
  return p.toDataURL("image/jpeg", 0.82);
}

export function addCanvasesAsPages(items: { canvas: HTMLCanvasElement; name: string }[]) {
  const existing = useUploads.getState().pages.length;
  const pages: UploadPage[] = items.map(({ canvas, name }, i) => {
    const ctx = canvas.getContext("2d")!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const gray = rgbaToGray(data, canvas.width, canvas.height);
    const { corners, found } = detectFiducials(gray);
    return {
      id: `${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 7)}`,
      fileName: name,
      preview: previewOf(canvas),
      width: canvas.width,
      height: canvas.height,
      gray,
      corners,
      found,
      page: existing + i,
    };
  });
  useUploads.getState().addPages(pages);
  return pages;
}

/** Perspective-corrects every uploaded page and slices each template cell into a glyph tile. */
export function extractAllPages() {
  const { charsetIds, extraChars, ingestTiles } = useProject.getState();
  const layout = buildTemplateLayout(charsetIds, extraChars);
  const tiles: Parameters<typeof ingestTiles>[0] = [];
  for (const p of useUploads.getState().pages) {
    const H = solveHomography(FIDUCIAL_CENTERS, p.corners);
    for (const slot of layout.slots.filter((s) => s.page === p.page)) {
      tiles.push({ slot, source: warpCell(p.gray, H, slot.x, slot.y, BOX, TILE) });
    }
  }
  ingestTiles(tiles);
  return tiles.length;
}

export function tileToDataUrl(src: Uint8Array, size = TILE) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < src.length; i++) {
    const v = src[i] ?? 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL("image/png");
}

export function renderTemplateCanvas(page: number, charsetIds: string[], extraChars: string, ghost: boolean) {
  const c = document.createElement("canvas");
  c.width = PAGE_W;
  c.height = PAGE_H;
  renderTemplatePage(c.getContext("2d")!, buildTemplateLayout(charsetIds, extraChars), page, { ghost });
  return c;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
