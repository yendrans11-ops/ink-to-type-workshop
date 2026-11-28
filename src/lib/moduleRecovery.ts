const RECOVERY_KEY = "typecraft:module-recovery";
const RETRY_WINDOW_MS = 60_000;

/** Request a fresh document without dropping the current route, search or hash. */
export function moduleRecoveryUrl(href: string, now = Date.now()): string {
  const url = new URL(href);
  url.searchParams.set("_typecraft_reload", String(now));
  return url.href;
}

/** Safari, Chromium and Firefox use different messages for a failed lazy import. */
export function isModuleLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /importing a module script failed|failed to fetch dynamically imported module|error loading dynamically imported module|failed to load module script|loading chunk .+ failed/i.test(message);
}

/** At most one reload per minute; unavailable storage must never cause a reload loop. */
export function reserveModuleReload(error: unknown, storage: Pick<Storage, "getItem" | "setItem">, now = Date.now()): boolean {
  if (!isModuleLoadError(error)) return false;
  try {
    const previous = storage.getItem(RECOVERY_KEY);
    if (previous !== null) {
      const timestamp = Number(previous);
      if (Number.isFinite(timestamp) && now - timestamp < RETRY_WINDOW_MS) return false;
    }
    storage.setItem(RECOVERY_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}