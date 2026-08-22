import { describe, it, expect, vi, beforeEach } from "vitest";

// The unauthenticated /config bootstrap intentionally exposes no version or
// commit hash; deploy detection runs on the opaque `build_id` it serves.
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

  it("reports a new version when the server build_id changes", async () => {
    const checker = await loadChecker();
    checker.setInitialVersion("aaaaaaaaaaaaaaaa");
    (configService.get_config as any).mockResolvedValue({
      data: { build_id: "bbbbbbbbbbbbbbbb" },
    });

    await expect(checker.checkForNewVersion()).resolves.toBe(true);
  });

  it("reports no new version when the server build_id is unchanged", async () => {
    const checker = await loadChecker();
    checker.setInitialVersion("aaaaaaaaaaaaaaaa");
    (configService.get_config as any).mockResolvedValue({
      data: { build_id: "aaaaaaaaaaaaaaaa" },
    });

    await expect(checker.checkForNewVersion()).resolves.toBe(false);
  });

  it("reports no new version when no baseline was stored", async () => {
    const checker = await loadChecker();

    await expect(checker.checkForNewVersion()).resolves.toBe(false);
    expect(configService.get_config).not.toHaveBeenCalled();
  });
});
