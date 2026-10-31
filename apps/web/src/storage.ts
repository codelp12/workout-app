export type PersistResult = "persisted" | "denied" | "unsupported";

/**
 * Asks the browser not to evict our IndexedDB/cache data (SPEC §3.4). iOS can
 * still evict an installed PWA, so callers must not treat "persisted" as a
 * guarantee.
 */
export async function requestPersistentStorage(
  storage:
    Pick<StorageManager, "persist" | "persisted"> | undefined = globalThis
    .navigator?.storage,
): Promise<PersistResult> {
  if (!storage?.persist) return "unsupported";
  try {
    if (await storage.persisted()) return "persisted";
    return (await storage.persist()) ? "persisted" : "denied";
  } catch {
    return "unsupported";
  }
}
