import { describe, expect, it } from "vitest";
import { emptyProject, newGlyphRecord, type ProjectData } from "../store";
import { fromCloudData, toCloudData } from "../cloudData";
import { buildTemplateLayout } from "../template";
import { strokesToTile, type Stroke } from "../drawing";

describe("account save format", () => {
  it("keeps pen strokes, drops tiles, and rebuilds the tile on load", () => {
    const slot = buildTemplateLayout(["latin-upper"], "").slots[0]!;
    const strokes: Stroke[] = [{ size: 70, smooth: 0.5, pts: [0.3, 0.2, 0.5, 0.5, 0.6, 0.5, 0.7, 0.62, 0.5] }];
    const p: ProjectData = { ...emptyProject(), glyphs: { [slot.id]: { ...newGlyphRecord(slot, strokesToTile(strokes)), strokes } }, order: [slot.id] };
    const json = JSON.parse(JSON.stringify(toCloudData(p)));
    expect(json.project.glyphs[slot.id].source).toBeUndefined();
    expect(json.project.glyphs[slot.id].strokes[0].pts).toHaveLength(9);
    const back = fromCloudData(json);
    expect(back.projectId).toBe(p.projectId);
    expect(back.glyphs[slot.id]!.strokes).toEqual(strokes);
    expect(back.glyphs[slot.id]!.source?.length).toBe(p.glyphs[slot.id]!.source!.length);
  });
  it("rejects data it doesn't understand", () => {
    expect(() => fromCloudData({ v: 99 })).toThrow();
  });
  it("preserves scanned source tiles so a reopened scan can be retraced", () => {
    const slot = buildTemplateLayout(["latin-upper"], "").slots[0];
    if (!slot) throw new Error("Missing A slot");
    const tile = new Uint8Array(240 * 240).fill(255);
    tile.fill(0, 100, 200);
    const p = { ...emptyProject(), glyphs: { [slot.id]: newGlyphRecord(slot, tile) }, order: [slot.id] };
    const loaded = fromCloudData(JSON.parse(JSON.stringify(toCloudData(p))));
    expect(loaded.glyphs[slot.id]?.source).toEqual(tile);
  });
});
