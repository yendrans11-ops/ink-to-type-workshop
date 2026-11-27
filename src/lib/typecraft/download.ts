import JSZip from "jszip";
import { compileProject, preflightProject, type FontKind } from "./compile";
import { splitForExport, isFreeCp } from "./exportTier";
import { buildTemplateLayout } from "./template";
import { runPreflight } from "./preflight";
import type { ProjectData } from "./store";
import { buildWeightProject, FONT_WEIGHT_VARIANTS, type FontWeightVariant } from "./weights";

/** The sole ordinary download pipeline: restrict first, then validate exactly the bytes being exported. */
export function prepareDownload(project: ProjectData, full: boolean) {
  const split = splitForExport(project, full);
  const check = full ? preflightProject(split.project) : runPreflight({
    glyphs: split.project.order.flatMap((id) => split.project.glyphs[id] ? [split.project.glyphs[id]] : []),
    expected: buildTemplateLayout(project.charsetIds, project.extraChars).slots.map((s) => s.cp).filter(isFreeCp),
    meta: project.meta,
    metrics: project.metrics,
  });
  return { ...split, check };
}

export function compileDownload(project: ProjectData, full: boolean, kind: FontKind, allowWarnings = false) {
  const prepared = prepareDownload(project, full);
  if (prepared.check.errors.length) throw new Error(prepared.check.errors.map((e) => e.title).join("; "));
  if (prepared.check.warnings.length && !allowWarnings) throw new Error("Confirm the font warnings before downloading");
  const compiled = compileProject(prepared.project);
  return { bytes: compiled.build(kind), fileName: compiled.fileName(kind), count: prepared.included.length };
}

export type FamilyPackageFile = {
  weight: FontWeightVariant;
  fileName: string;
  bytes: ArrayBuffer;
};

/**
 * Compiles Light (300), Regular (400), and Bold (700) fonts from a single project and
 * packages them into a downloadable `.zip` archive via JSZip.
 */
export async function compileFamilyPackage(
  project: ProjectData,
  format: FontKind = "otf",
  full = true,
  allowWarnings = false,
): Promise<{ bytes: Uint8Array; fileName: string; count: number; files: FamilyPackageFile[] }> {
  const prepared = prepareDownload(project, full);
  if (prepared.check.errors.length) throw new Error(prepared.check.errors.map((e) => e.title).join("; "));
  if (prepared.check.warnings.length && !allowWarnings) throw new Error("Confirm the font warnings before downloading");

  const zip = new JSZip();
  const files: FamilyPackageFile[] = [];

  for (const weight of FONT_WEIGHT_VARIANTS) {
    const weightedProject = await buildWeightProject(prepared.project, weight);
    const compiled = compileProject(weightedProject);
    const bytes = compiled.build(format);
    const fileName = compiled.fileName(format);
    files.push({ weight, fileName, bytes });
    zip.file(fileName, bytes);
  }

  const baseName = (project.meta.familyName.trim() || "TypeCraftHand").replace(/[^A-Za-z0-9_-]+/g, "") || "TypeCraftHand";
  const bytes = await zip.generateAsync({ type: "uint8array" });
  return {
    bytes,
    fileName: `${baseName}-Family-${format.toUpperCase()}.zip`,
    count: prepared.included.length,
    files,
  };
}
