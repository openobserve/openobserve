import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/search", () => ({
  default: { search: vi.fn() },
}));

import SearchService from "@/services/search";
import { fetchUsageAnalytics } from "./useUsageAnalytics";

const mockSearch = SearchService.search as unknown as ReturnType<typeof vi.fn>;

describe("fetchUsageAnalytics", () => {
  beforeEach(() => mockSearch.mockReset());

  it("returns hasData=false when all queries are empty", async () => {
    mockSearch.mockResolvedValue({ data: { hits: [] } });
    const res = await fetchUsageAnalytics("org1", 1000, 2000);
    expect(res.hasData).toBe(false);
    expect(res.last24hMb).toBe(0);
    expect(res.avgDailyMb).toBe(0);
    expect(res.perStream).toEqual([]);
  });

  it("aggregates last24h, per-stream, and avg daily", async () => {
    // Call order in implementation: last24h, perStream, trend
    mockSearch
      .mockResolvedValueOnce({ data: { hits: [{ total_mb: 2048 }] } })
      .mockResolvedValueOnce({
        data: {
          hits: [
            { stream_name: "logs_a", total_mb: 3072, records: 100, days: 2 },
            { stream_name: "logs_b", total_mb: 1024, records: 50, days: 2 },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          hits: [
            { day: "2026-7-1", total_mb: 2048 },
            { day: "2026-7-2", total_mb: 2048 },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          hits: [
            { stream_name: "logs_a", day: "2026-7-1", total_mb: 1024 },
            { stream_name: "logs_a", day: "2026-7-2", total_mb: 2048 },
          ],
        },
      });
    const res = await fetchUsageAnalytics("org1", 1000, 2000);
    expect(res.hasData).toBe(true);
    expect(res.last24hMb).toBe(2048);
    expect(res.daysOfData).toBe(2);
    expect(res.avgDailyMb).toBe(2048); // (2048+2048)/2
    expect(res.perStream[0].stream_name).toBe("logs_a");
    expect(res.perStream[0].spark.length).toBe(2);
  });
});
