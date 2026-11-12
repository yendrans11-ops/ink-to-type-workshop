// High-level flows shared by pages: load the built-in sample sheet, extract + trace everything.
import { addCanvasesAsPages, extractAllPages } from "./imageio";
import { makeSampleSheets } from "./sample";
import { useProject, useUploads } from "./store";
import { retraceAll } from "./tracer";

/** Replaces the current uploads with generated sample sheets (one per template page). */
export async function loadSampleUploads() {
  const { charsetIds, extraChars } = useProject.getState();
  const sheets = await makeSampleSheets(charsetIds, extraChars);
  useUploads.getState().clear();
  return addCanvasesAsPages(sheets.map((canvas, i) => ({ canvas, name: `Sample sheet · p${i + 1}` })));
}

/** Slices every uploaded page into glyph tiles and traces them all. Returns the number of cells. */
export async function extractAndTrace() {
  const n = extractAllPages();
  await retraceAll();
  return n;
}
