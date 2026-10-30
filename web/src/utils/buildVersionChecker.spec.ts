import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/config", () => ({
  default: {
    get_config: vi.fn(),
  },
}));

import configService from "@/services/config";

const loadChecker = async () => {
  vi.resetModules();
  const mod = await import("./buildVersionChecker");
  return mod.buildVersionChecker;
};

describe("buildVersionChecker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("reports a new version when the server commit hash changes", async () => {
    const checker = await loadChecker();
    checker.setInitialVersion("aaaaaaa1111111111");
    (configService.get_config as any).mockResolvedValue({
      data: { commit_hash: "bbbbbbb2222222222" },
    });

    await expect(checker.checkForNewVersion()).resolves.toBe(true);
  });

  it("reports no new version when the server commit hash is unchanged", async () => {
    const checker = await loadChecker();
    checker.setInitialVersion("aaaaaaa1111111111");
    (configService.get_config as any).mockResolvedValue({
      data: { commit_hash: "aaaaaaa1111111111" },
    });

    await expect(checker.checkForNewVersion()).resolves.toBe(false);
  });

  it("reports no new version when no baseline was stored", async () => {
    const checker = await loadChecker();

    await expect(checker.checkForNewVersion()).resolves.toBe(false);
    expect(configService.get_config).not.toHaveBeenCalled();
  });

  it("reports no new version when the config fetch fails", async () => {
    const checker = await loadChecker();
    checker.setInitialVersion("aaaaaaa1111111111");
    (configService.get_config as any).mockRejectedValue(new Error("network"));

    await expect(checker.checkForNewVersion()).resolves.toBe(false);
  });
});

describe("chunk load error detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it.each([
    "Failed to fetch dynamically imported module: https://x/assets/a.js",
    "error loading dynamically imported module: https://x/assets/a.js",
    "Importing a module script failed.",
    "Unable to preload CSS for /web/assets/Logs-abc.css",
    "Loading chunk 123 failed.",
    "Loading chunk vendors-main failed.",
  ])("recognises %s as a chunk load error", async (message) => {
    const { isChunkLoadError } = await import("./buildVersionChecker");
    expect(isChunkLoadError(new Error(message))).toBe(true);
  });

  it("does not treat other errors as chunk load errors", async () => {
    const { isChunkLoadError } = await import("./buildVersionChecker");
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });

  it("matches the same wordings in the stale check", async () => {
    const checker = await loadChecker();
    checker.setInitialVersion("aaaaaaa1111111111");
    (configService.get_config as any).mockResolvedValue({
      data: { commit_hash: "bbbbbbb2222222222" },
    });

    await expect(
      checker.isStaleChunkError(new Error("Importing a module script failed.")),
    ).resolves.toBe(true);
  });

  it("keeps the baseline commit hash out of storage shared across tabs", async () => {
    const checker = await loadChecker();
    checker.setInitialVersion("aaaaaaa1111111111");

    for (let i = 0; i < localStorage.length; i++) {
      expect(localStorage.getItem(localStorage.key(i)!)).not.toBe("aaaaaaa1111111111");
    }
  });

  it("ignores a baseline another tab left in local storage", async () => {
    localStorage.setItem("o2_initial_commit_hash", "aaaaaaa1111111111");
    const checker = await loadChecker();
    (configService.get_config as any).mockResolvedValue({
      data: { commit_hash: "bbbbbbb2222222222" },
    });

    await expect(checker.checkForNewVersion()).resolves.toBe(false);
  });
});
