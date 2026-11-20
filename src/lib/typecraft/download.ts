import { compileProject, preflightProject, type FontKind } from "./compile";
import { splitForExport, isFreeCp } from "./exportTier";
import { buildTemplateLayout } from "./template";
import { runPreflight } from "./preflight";
import type { ProjectData } from "./store";

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