import { describe, it, expect } from "vitest";
import {
  buildLast24hSql,
  buildPerStreamSql,
  buildDailyTrendSql,
  buildPerStreamDailySql,
  mbToDisplay,
  distinctDays,
} from "./usageAnalytics";

describe("usageAnalytics SQL builders", () => {
  it("filters last-24h on Ingestion events only", () => {
    const sql = buildLast24hSql();
    expect(sql).toContain("SUM(size)");
    expect(sql).toContain("FROM \"usage\"");
    expect(sql).toContain("event = 'Ingestion'");
  });

  it("groups per-stream ranked by size descending", () => {
    const sql = buildPerStreamSql();
    expect(sql).toContain("GROUP BY stream_name");
    expect(sql).toContain("ORDER BY total_mb DESC");
    expect(sql).toContain("event = 'Ingestion'");
  });

  it("builds a daily trend grouped by day", () => {
    const sql = buildDailyTrendSql();
    expect(sql).toContain("GROUP BY day");
    expect(sql).toContain("event = 'Ingestion'");
  });

  it("builds a per-stream daily series grouped by stream and day", () => {
    const sql = buildPerStreamDailySql();
    expect(sql).toContain("GROUP BY stream_name, day");
    expect(sql).toContain("event = 'Ingestion'");
  });
});

describe("usageAnalytics helpers", () => {
  it("converts MB to GB rounded to 2 decimals", () => {
    expect(mbToDisplay(1536, "gb")).toBe(1.5);
    expect(mbToDisplay(1536, "mb")).toBe(1536);
    expect(mbToDisplay(0, "gb")).toBe(0);
  });

  it("counts distinct day buckets", () => {
    expect(
      distinctDays([{ day: "2026-7-1" }, { day: "2026-7-1" }, { day: "2026-7-2" }]),
    ).toBe(2);
    expect(distinctDays([])).toBe(0);
  });
});
