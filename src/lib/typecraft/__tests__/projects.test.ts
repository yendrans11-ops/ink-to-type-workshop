import { describe, expect, it } from "vitest";
import { emptyProject, normalizeProject, projectSnapshot } from "../store";
import { compileProject, preflightProject } from "../compile";

describe("saved projects", () => {
  it("keeps a saved project's id and fills fields older saves lack", () => {
    const p = normalizeProject({ projectId: "abc", meta: { familyName: "Old Hand" } as never });
    expect(p.projectId).toBe("abc");
    expect(p.meta.familyName).toBe("Old Hand");
    expect(p.meta.weightClass).toBe(400);
    expect(p.syllableSpacing).toEqual({});
  });

  it("gives every new project its own id", () => {
    expect(emptyProject().projectId).not.toBe(emptyProject().projectId);
  });

  it("an empty project can't be downloaded from the gallery", () => {
    const p = projectSnapshot(emptyProject());
    expect(compileProject(p).drawnCount).toBe(0);
    expect(preflightProject(p).errors.length).toBeGreaterThan(0);
  });
});
