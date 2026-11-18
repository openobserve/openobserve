// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import {
  backtestBucketMinutes,
  backtestHintKey,
  backtestWindows,
  cronCheckTimes,
  windowedCountSql,
} from "./alertBacktest";

const BUILDER_SQL =
  "SELECT histogram(_timestamp) AS zo_sql_key, COUNT(*) as zo_sql_val FROM \"app\" WHERE level = 'error' GROUP BY zo_sql_key ORDER BY zo_sql_key ASC";
const START = Date.UTC(2026, 10, 5, 0, 0, 0);

describe("windowedCountSql", () => {
  it("buckets the builder's count query by the given minutes", () => {
    expect(windowedCountSql(BUILDER_SQL, 10)).toContain("histogram(_timestamp, '10 minute')");
    expect(windowedCountSql(BUILDER_SQL, 10)).toContain("WHERE level = 'error'");
  });

  it("declines queries that do not count events or have no look-back", () => {
    expect(windowedCountSql(BUILDER_SQL.replace("COUNT(*)", "avg(latency)"), 10)).toBeNull();
    expect(windowedCountSql("SELECT * FROM app", 10)).toBeNull();
    expect(windowedCountSql(BUILDER_SQL, 0)).toBeNull();
  });

  it.each([
    { period: 10, frequency: 5, checkTimesMs: undefined, bucket: 5 },
    { period: 10, frequency: 10, checkTimesMs: undefined, bucket: 10 },
    { period: 7, frequency: 3, checkTimesMs: undefined, bucket: 1 },
    { period: 60, frequency: 60, checkTimesMs: [START], bucket: 1 },
  ])("buckets period $period, frequency $frequency by $bucket min", ({ bucket, ...o }) => {
    expect(backtestBucketMinutes(o)).toBe(bucket);
  });
});

describe("backtestWindows", () => {
  const options = {
    startMs: START,
    hours: 24,
    period: 10,
    frequency: 10,
    silence: 0,
    operator: ">=",
    threshold: 5,
  };
  const at = (hhmm: string, value: number) => ({
    zo_sql_key: `2026-11-05T${hhmm}:00`,
    zo_sql_val: value,
  });

  it.each([
    {
      name: "period 10, frequency 5 counts 288 checks, not 144",
      opts: { frequency: 5 },
      rows: [],
      expected: { total: 288 },
    },
    {
      name: "a burst split by a look-back boundary fires at the 5-min check between",
      opts: { frequency: 5 },
      rows: [at("02:55", 3), at("03:00", 3)],
      expected: { fired: 1, alerts: 1 },
    },
    {
      name: "a burst inside one 10-min window fires at two 5-min checks",
      opts: { frequency: 5 },
      rows: [at("03:00", 6)],
      expected: { fired: 2 },
    },
    {
      name: "silence 30 counts one alert for three consecutive firing checks",
      opts: { period: 5, frequency: 5, silence: 30 },
      rows: [at("03:00", 6), at("03:05", 6), at("03:10", 6)],
      expected: { fired: 3, alerts: 1, singleCheckSpikes: 0 },
    },
    {
      name: "a lone firing check is a single-check spike",
      opts: { period: 5, frequency: 5 },
      rows: [at("03:00", 6)],
      expected: { alerts: 1, singleCheckSpikes: 1, refires: 0 },
    },
    {
      name: "fire, clear, fire within two checks counts one refire",
      opts: { period: 5, frequency: 5 },
      rows: [at("03:00", 6), at("03:10", 6)],
      expected: { alerts: 2, refires: 1 },
    },
  ])("$name", ({ opts, rows, expected }) => {
    expect(backtestWindows(rows, { ...options, ...opts })).toMatchObject(expected);
  });

  it("cron times in Europe/Berlin drive the checks", () => {
    const checkTimesMs = cronCheckTimes("0 9 * * *", "Europe/Berlin", START, START + 86_400_000);
    expect(checkTimesMs).toEqual([Date.UTC(2026, 10, 5, 8, 0)]);
    const result = backtestWindows([at("07:55", 6)], { ...options, checkTimesMs: checkTimesMs! });
    expect(result).toMatchObject({ total: 1, fired: 1 });
    expect(result.hours[8]).toBe(true);
  });

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
    expect(result.hours[12]).toBe(true);
  });
});

describe("backtestHintKey", () => {
  it.each([
    [0, 288, ">=", "alerts.sections.backtest.never"],
    [0, 288, "<", "alerts.sections.backtest.neverRaise"],
    [0, 288, "!=", "alerts.sections.backtest.neverCheck"],
    [100, 288, ">", "alerts.sections.backtest.noisy"],
    [100, 288, "<=", "alerts.sections.backtest.noisyLower"],
    [100, 288, "=", "alerts.sections.backtest.noisyCheck"],
    [10, 288, ">=", null],
    [0, 0, ">=", null],
  ])("%s of %s checks with %s advises %s", (alerts, total, operator, key) => {
    expect(backtestHintKey(alerts, total, operator)).toBe(key);
  });
});
