// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { backtestWindows, windowedCountSql } from "./alertBacktest";

const BUILDER_SQL =
  "SELECT histogram(_timestamp) AS zo_sql_key, COUNT(*) as zo_sql_val FROM \"app\" WHERE level = 'error' GROUP BY zo_sql_key ORDER BY zo_sql_key ASC";
const START = Date.UTC(2026, 10, 5, 0, 0, 0);

describe("windowedCountSql", () => {
  it("buckets the builder's count query by the look-back", () => {
    expect(windowedCountSql(BUILDER_SQL, 10)).toContain("histogram(_timestamp, '10 minute')");
    expect(windowedCountSql(BUILDER_SQL, 10)).toContain("WHERE level = 'error'");
  });

  it("declines queries that do not count events or have no look-back", () => {
    expect(windowedCountSql(BUILDER_SQL.replace("COUNT(*)", "avg(latency)"), 10)).toBeNull();
    expect(windowedCountSql("SELECT * FROM app", 10)).toBeNull();
    expect(windowedCountSql(BUILDER_SQL, 0)).toBeNull();
  });
});

describe("backtestWindows", () => {
  const options = { startMs: START, hours: 24, period: 10, operator: ">=", threshold: 5 };

  it("counts the windows that reach the limit and marks their hours", () => {
    const rows = [
      { zo_sql_key: "2026-11-05T00:10:00", zo_sql_val: 7 },
      { zo_sql_key: "2026-11-05T00:20:00", zo_sql_val: 2 },
      { zo_sql_key: "2026-11-05T05:30:00", zo_sql_val: 5 },
    ];
    const result = backtestWindows(rows, options);
    expect(result.total).toBe(144);
    expect(result.fired).toBe(2);
    expect(result.hours[0]).toBe(true);
    expect(result.hours[5]).toBe(true);
    expect(result.hours.filter(Boolean)).toHaveLength(2);
  });

  it("reads microsecond keys", () => {
    const result = backtestWindows(
      [{ zo_sql_key: (START + 3_600_000) * 1000, zo_sql_val: 9 }],
      options,
    );
    expect(result.hours[1]).toBe(true);
  });

  it("treats windows with no events as zero, so a fewer-than limit fires in them", () => {
    const result = backtestWindows([{ zo_sql_key: "2026-11-05T00:10:00", zo_sql_val: 7 }], {
      ...options,
      operator: "<",
    });
    expect(result.fired).toBe(143);
    expect(result.hours.every(Boolean)).toBe(true);
  });

  it("marks only the hours that hold an empty window for a fewer-than limit", () => {
    const busyFirstHour = Array.from({ length: 6 }, (_, i) => ({
      zo_sql_key: START + i * 600_000,
      zo_sql_val: 9,
    }));
    const result = backtestWindows(busyFirstHour, { ...options, operator: "<" });
    expect(result.fired).toBe(138);
    expect(result.hours[0]).toBe(false);
    expect(result.hours.slice(1).every(Boolean)).toBe(true);
  });

  it("places buckets that start before an unaligned look-back start", () => {
    const rows = Array.from({ length: 144 }, (_, i) => ({
      zo_sql_key: START + i * 600_000,
      zo_sql_val: 9,
    })).filter((_, i) => i !== 72);
    const result = backtestWindows(rows, {
      ...options,
      startMs: START + 4 * 60_000,
      operator: "<",
    });
    expect(result.hours.filter(Boolean)).toHaveLength(1);
    expect(result.hours[11]).toBe(true);
  });
});
