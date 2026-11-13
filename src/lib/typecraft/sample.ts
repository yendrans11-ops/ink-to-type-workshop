// Generates a "filled-in" template photo from handwriting web fonts so the full pipeline can be tried instantly.
import { charText, isTamilCp } from "./tamil";
import { BOX, BOX_GUIDES, buildTemplateLayout, PAGE_H, PAGE_W, renderTemplatePage } from "./template";

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}


export async function makeSampleSheets(charsetIds: string[], extraChars: string): Promise<HTMLCanvasElement[]> {
  await Promise.all([
    document.fonts.load("120px Caveat"),
    document.fonts.load("120px Kavivanar", "அகாகு"),
  ]);
  const layout = buildTemplateLayout(charsetIds, extraChars);
  const rand = rng(7);
  const sheets: HTMLCanvasElement[] = [];
  for (let page = 0; page < layout.pageCount; page++) {
    const flat = document.createElement("canvas");
    flat.width = PAGE_W;
    flat.height = PAGE_H;
    const ctx = flat.getContext("2d")!;
    renderTemplatePage(ctx, layout, page, { ghost: false });
    ctx.fillStyle = "#1c1a26";
    for (const s of layout.slots.filter((x) => x.page === page)) {
      const ch = charText(s.cp);
      const tamil = isTamilCp(s.cp);
      const family = tamil ? "Kavivanar" : "Caveat";
      const ref = tamil ? "க" : "H";
      let size = 120;
      ctx.font = `600 ${size}px ${family}`;
      const asc = ctx.measureText(ref).actualBoundingBoxAscent || size * 0.6;
      size *= ((tamil ? 0.56 : 0.68) * BOX) / asc;
      ctx.font = `600 ${size}px ${family}`;
      const w = ctx.measureText(ch).width;
      if (w > BOX * 0.84) {
        size *= (BOX * 0.84) / w;
        ctx.font = `600 ${size}px ${family}`;
      }
      const m = ctx.measureText(ch);
      const left = m.actualBoundingBoxLeft, right = m.actualBoundingBoxRight;
      const cx = s.x + BOX / 2 + (rand() - 0.5) * 8;
      const by = s.y + BOX * BOX_GUIDES.baseline + (rand() - 0.5) * 5;
      ctx.save();
      ctx.translate(cx, by);
      ctx.rotate((rand() - 0.5) * 0.06);
      ctx.fillText(ch, -(right - left) / 2 - left, 0);
      ctx.restore();
    }
    // "Photograph" it: slight rotation, offset and paper tone.
    const out = document.createElement("canvas");
    out.width = 1800;
    out.height = 2330;
    const o = out.getContext("2d")!;
    o.fillStyle = "#d9d4c7";
    o.fillRect(0, 0, out.width, out.height);
    o.translate(out.width / 2 + 14, out.height / 2 - 10);
    o.rotate(0.022);
    o.scale(0.98, 0.98);
    o.drawImage(flat, -PAGE_W / 2, -PAGE_H / 2);
    sheets.push(out);
  }
  return sheets;
}
