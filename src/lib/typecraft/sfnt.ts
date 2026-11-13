// Minimal sfnt (OTF/TTF) container helpers: read tables, rewrite with correct checksums, build a name table.
import type { NameRecord } from "./naming";

export type Sfnt = { flavor: number; tables: Map<string, Uint8Array> };

export function readSfnt(buf: ArrayBuffer): Sfnt {
  const dv = new DataView(buf);
  const flavor = dv.getUint32(0);
  const numTables = dv.getUint16(4);
  const tables = new Map<string, Uint8Array>();
  for (let i = 0; i < numTables; i++) {
    const r = 12 + i * 16;
    const tag = String.fromCharCode(dv.getUint8(r), dv.getUint8(r + 1), dv.getUint8(r + 2), dv.getUint8(r + 3));
    const off = dv.getUint32(r + 8), len = dv.getUint32(r + 12);
    tables.set(tag, new Uint8Array(buf.slice(off, off + len)));
  }
  return { flavor, tables };
}

export function tableChecksum(b: Uint8Array): number {
  const padded = new Uint8Array((b.length + 3) & ~3);
  padded.set(b);
  const dv = new DataView(padded.buffer);
  let sum = 0;
  for (let i = 0; i < padded.length; i += 4) sum = (sum + dv.getUint32(i)) >>> 0;
  return sum;
}

export function writeSfnt({ flavor, tables }: Sfnt): ArrayBuffer {
  const head = tables.get("head");
  if (head) new DataView(head.buffer, head.byteOffset).setUint32(8, 0); // checkSumAdjustment is computed last
  const tags = [...tables.keys()].sort();
  const n = tags.length;
  const entrySelector = Math.floor(Math.log2(n));
  const searchRange = 2 ** entrySelector * 16;
  let total = 12 + 16 * n;
  for (const t of tags) total += (tables.get(t)!.length + 3) & ~3;
  const out = new Uint8Array(total);
  const o = new DataView(out.buffer);
  o.setUint32(0, flavor);
  o.setUint16(4, n);
  o.setUint16(6, searchRange);
  o.setUint16(8, entrySelector);
  o.setUint16(10, n * 16 - searchRange);
  let dataOff = 12 + 16 * n;
  let headOff = -1;
  tags.forEach((t, i) => {
    const data = tables.get(t)!;
    const r = 12 + i * 16;
    for (let k = 0; k < 4; k++) o.setUint8(r + k, t.charCodeAt(k));
    o.setUint32(r + 4, tableChecksum(data));
    o.setUint32(r + 8, dataOff);
    o.setUint32(r + 12, data.length);
    out.set(data, dataOff);
    if (t === "head") headOff = dataOff;
    dataOff += (data.length + 3) & ~3;
  });
  if (headOff >= 0) o.setUint32(headOff + 8, (0xb1b0afba - tableChecksum(out)) >>> 0);
  return out.buffer;
}

/** Format-0 name table with Windows Unicode (3/1/0x409) records, as modern fonts ship. */
export function buildNameTable(records: NameRecord[]): Uint8Array {
  const sorted = [...records].sort((a, b) => a.nameID - b.nameID);
  const strings = sorted.map((r) => {
    const units: number[] = [];
    for (let i = 0; i < r.value.length; i++) units.push(r.value.charCodeAt(i)); // UTF-16 code units
    const b = new Uint8Array(units.length * 2);
    const dv = new DataView(b.buffer);
    units.forEach((u, i) => dv.setUint16(i * 2, u));
    return b;
  });
  const headerLen = 6 + 12 * sorted.length;
  const total = headerLen + strings.reduce((a, s) => a + s.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, 0);
  dv.setUint16(2, sorted.length);
  dv.setUint16(4, headerLen);
  let strOff = 0;
  sorted.forEach((r, i) => {
    const p = 6 + i * 12;
    const s = strings[i]!;
    dv.setUint16(p, 3);
    dv.setUint16(p + 2, 1);
    dv.setUint16(p + 4, 0x0409);
    dv.setUint16(p + 6, r.nameID);
    dv.setUint16(p + 8, s.length);
    dv.setUint16(p + 10, strOff);
    out.set(s, headerLen + strOff);
    strOff += s.length;
  });
  return out;
}
