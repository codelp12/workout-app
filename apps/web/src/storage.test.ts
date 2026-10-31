import { describe, expect, it, vi } from "vitest";
import { requestPersistentStorage } from "./storage";

function fakeStorage(persisted: boolean, grant: boolean) {
  return {
    persisted: vi.fn(() => Promise.resolve(persisted)),
    persist: vi.fn(() => Promise.resolve(grant)),
  };
}

describe("requestPersistentStorage", () => {
  it("returns unsupported without the Storage API", async () => {
    expect(await requestPersistentStorage(undefined)).toBe("unsupported");
  });

  it("does not ask again when already persisted", async () => {
    const storage = fakeStorage(true, false);
    expect(await requestPersistentStorage(storage)).toBe("persisted");
    expect(storage.persist).not.toHaveBeenCalled();
  });

  it("reports whether the browser granted the request", async () => {
    expect(await requestPersistentStorage(fakeStorage(false, true))).toBe(
      "persisted",
    );
    expect(await requestPersistentStorage(fakeStorage(false, false))).toBe(
      "denied",
    );
  });

  it("treats a throwing browser as unsupported", async () => {
    const storage = {
      persisted: () => Promise.reject(new Error("blocked")),
      persist: () => Promise.resolve(true),
    };
    expect(await requestPersistentStorage(storage)).toBe("unsupported");
  });
});
