import { describe, expect, it } from "vitest";
import { isModuleLoadError, moduleRecoveryUrl, reserveModuleReload } from "../moduleRecovery";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe("module download recovery", () => {
  it("bypasses a cached home document while preserving search and hash", () => {
    expect(moduleRecoveryUrl("https://example.com/?project=abc#preview", 123))
      .toBe("https://example.com/?project=abc&_typecraft_reload=123#preview");
  });

  it("replaces an old recovery token without changing the drawing route", () => {
    expect(moduleRecoveryUrl("https://example.com/draw?_typecraft_reload=123", 456))
      .toBe("https://example.com/draw?_typecraft_reload=456");
  });

  it("recognizes Safari's reported Grid failure and other browser import failures", () => {
    expect(isModuleLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isModuleLoadError(new TypeError("Failed to fetch dynamically imported module: /assets/grid.js"))).toBe(true);
    expect(isModuleLoadError(new TypeError("error loading dynamically imported module"))).toBe(true);
    expect(isModuleLoadError(new Error("Invalid font metadata"))).toBe(false);
  });

  it("reserves only one automatic reload across page reloads within 60 seconds", () => {
    const storage = memoryStorage();
    const error = new TypeError("Importing a module script failed.");
    expect(reserveModuleReload(error, storage, 100_000)).toBe(true);
    expect(reserveModuleReload(error, storage, 100_001)).toBe(false);
    expect(reserveModuleReload(error, storage, 159_999)).toBe(false);
    expect(reserveModuleReload(error, storage, 160_000)).toBe(true);
  });

  it("does not reload for unrelated errors or when session storage is unavailable", () => {
    expect(reserveModuleReload(new Error("Drawing error"), memoryStorage(), 100_000)).toBe(false);
    const unavailable = {
      getItem: () => { throw new Error("Storage blocked"); },
      setItem: () => { throw new Error("Storage blocked"); },
    };
    expect(reserveModuleReload("Importing a module script failed.", unavailable, 100_000)).toBe(false);
  });
});