// Minimal PDF writer: one full-bleed JPEG per page (used for the printable template).
export function jpegsToPdf(pages: { jpeg: Uint8Array; width: number; height: number }[], pageW = 612, pageH = 792): Blob {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (c: Uint8Array | string) => {
    const b = typeof c === "string" ? enc.encode(c) : c;
    chunks.push(b);
    length += b.length;
  };
  const obj = (n: number, body: () => void) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    body();
    push("\nendobj\n");
  };
  push("%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n");
  const pageIds = pages.map((_, i) => 3 + i * 3);
  obj(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"));
  obj(2, () => push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`));
  pages.forEach((p, i) => {
    const id = pageIds[i] ?? 3 + i * 3;
    const content = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`;
    obj(id, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 ${id + 2} 0 R >> >> /Contents ${id + 1} 0 R >>`));
    obj(id + 1, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    obj(id + 2, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
      push(p.jpeg);
      push("\nendstream");
    });
  });
  const total = 3 + pages.length * 3;
  const xref = length;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let n = 1; n < total; n++) push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(chunks as BlobPart[], { type: "application/pdf" });
}

export function dataUrlToBytes(url: string): Uint8Array {
  const bin = atob(url.split(",")[1] ?? "");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
