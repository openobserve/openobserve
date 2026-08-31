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
