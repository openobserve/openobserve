// Copyright 2026 OpenObserve Inc.

import { beforeEach, describe, expect, it, vi } from "vitest";

import analytics from "@/services/product_analytics";
import jsTransformService from "@/services/jstransform";
import { runSql } from "@/composables/security/useSecurityStreamPlans";
import threatIntel from "@/services/threat_intel";

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/services/jstransform", () => ({
  default: {
    create_enrichment_table: vi.fn(),
    create_enrichment_table_from_url: vi.fn(),
    get_all_enrichment_table_statuses: vi.fn(),
  },
}));
vi.mock("@/services/stream", () => ({ default: { nameList: vi.fn() } }));
vi.mock("@/composables/security/useSecurityStreamPlans", () => ({ runSql: vi.fn() }));
// The server classifies intel values; every non-blank one here is an IP.
vi.mock("@/services/securityIntel", () => ({
  classifyValues: vi.fn(async (_org: string, values: string[]) =>
    values.map((indicator) => (indicator ? { indicator, type: "ip" } : null)),
  ),
}));

const js = jsTransformService as unknown as Record<string, ReturnType<typeof vi.fn>>;

const INDICATOR = {
  indicator: "1.2.3.4",
  type: "ip" as const,
  severity: "high" as const,
  confidence: 80,
  source: "feed",
  description: "",
  addedAt: "2026-01-01T00:00:00.000Z",
  expiresAt: "",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("threatIntel analytics", () => {
  it("tracks an upload once it succeeds", async () => {
    js.create_enrichment_table.mockResolvedValue({ data: {} });
    await threatIntel.upload("org1", "ioc_list", [INDICATOR, INDICATOR], false);
    expect(analytics.track).toHaveBeenCalledWith("security_intel_indicators_uploaded", {
      count: 2,
      append: false,
    });
  });

  it("does not track a failed upload", async () => {
    js.create_enrichment_table.mockRejectedValue(new Error("boom"));
    await expect(threatIntel.upload("org1", "ioc_list", [INDICATOR], true)).rejects.toThrow();
    expect(analytics.track).not.toHaveBeenCalled();
  });

  it("tracks a feed import once it succeeds", async () => {
    js.create_enrichment_table_from_url.mockResolvedValue({ data: {} });
    await threatIntel.importUrl("org1", "ioc_feed", "https://example.com/f.csv", true);
    expect(analytics.track).toHaveBeenCalledWith("security_intel_feed_imported", {
      append: true,
    });
  });

  it("tracks a removal with the number of rows removed", async () => {
    const row = { indicator: "1.2.3.4", type: "ip" };
    vi.mocked(runSql)
      .mockResolvedValueOnce({ hits: [row, row, { indicator: "5.6.7.8", type: "ip" }] } as never)
      .mockResolvedValueOnce({ hits: [{ zo_n: 3 }] } as never);
    js.create_enrichment_table.mockResolvedValue({ data: {} });
    await threatIntel.removeIndicator("org1", {
      type: "ip",
      indicator: "1.2.3.4",
      table: "ioc_list",
    });
    expect(analytics.track).toHaveBeenCalledWith("security_intel_indicator_removed", {
      count: 2,
    });
  });
});
