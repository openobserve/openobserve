// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it } from "vitest";
import {
  backtest,
  buildHistoryQuery,
  fillCountBuckets,
  parseBucketTime,
  percentile,
  scoreHistory,
  splitFitTest,
  suggestThreshold,
  type Bucket,
} from "./backtest";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);

/** Buckets every `step` ms ending at `end`, valued by `fn(i)`. */
const series = (count: number, step: number, end: number, fn: (i: number) => number): Bucket[] =>
  Array.from({ length: count }, (_, i) => ({
    time: end - (count - i) * step,
    value: fn(i),
  }));

describe("percentile", () => {
  it("uses the nearest rank", () => {
    const values = [10, 1, 9, 2, 8, 3, 7, 4, 6, 5];
    expect(percentile(values, 0.9)).toBe(9);
    expect(percentile(values, 0.99)).toBe(10);
    expect(percentile(values, 0.5)).toBe(5);
  });

  it("is null for no values", () => {
    expect(percentile([], 0.9)).toBeNull();
  });
});

describe("suggestThreshold", () => {
  it("fits a count rule at max(5, ceil(2.5 × p90))", () => {
    const buckets = series(10, 10 * MIN, NOW, (i) => i + 1);
    expect(suggestThreshold(buckets, "count")).toBe(23);
  });

  it("never suggests a count limit below 5", () => {
    const buckets = series(10, 10 * MIN, NOW, () => 1);
    expect(suggestThreshold(buckets, "count")).toBe(5);
  });

  it("fits a value rule at p99", () => {
    const buckets = series(100, 10 * MIN, NOW, (i) => i + 1);
    expect(suggestThreshold(buckets, "value")).toBe(99);
  });

  it("rounds a fractional value limit up to two decimals", () => {
    const buckets = series(4, 10 * MIN, NOW, (i) => [0.1, 0.2, 0.3, 0.4561][i]);
    expect(suggestThreshold(buckets, "value")).toBe(0.46);
  });

  it("is null with nothing to fit on", () => {
    expect(suggestThreshold([], "count")).toBeNull();
  });
});

describe("splitFitTest", () => {
  it("fits on everything before the last 24 h and tests on the last 24 h", () => {
    const old = { time: NOW - DAY - MIN, value: 1 };
    const edge = { time: NOW - DAY, value: 2 };
    const recent = { time: NOW - HOUR, value: 3 };
    const { fit, test } = splitFitTest([recent, old, edge], NOW);
    expect(fit).toEqual([old]);
    expect(test).toEqual([edge, recent]);
  });
});

describe("backtest", () => {
  const at = (minutesAgo: number, value: number): Bucket => ({
    time: NOW - minutesAgo * MIN,
    value,
  });

  it("counts consecutive breaches as one episode", () => {
    const buckets = [at(60, 1), at(50, 20), at(40, 25), at(30, 1)];
    expect(backtest(buckets, ">=", 15, 0, 10)).toEqual({ episodes: 1, at: [NOW - 50 * MIN] });
  });

  it("merges breaches inside the silence window", () => {
    const buckets = [at(120, 20), at(110, 1), at(100, 1), at(90, 20), at(30, 20)];
    expect(backtest(buckets, ">=", 15, 30, 10)).toEqual({
      episodes: 2,
      at: [NOW - 120 * MIN, NOW - 30 * MIN],
    });
  });

  it("ends an episode at a gap in the data even without a silence", () => {
    const buckets = [at(90, 20), at(30, 20)];
    expect(backtest(buckets, ">=", 15, 0, 10).episodes).toBe(2);
  });

  it("splits breaches further apart than the silence", () => {
    const buckets = [at(120, 20), at(110, 1), at(60, 20)];
    expect(backtest(buckets, ">=", 15, 10, 10).episodes).toBe(2);
  });

  it("honours each operator", () => {
    const buckets = [at(30, 5), at(20, 1), at(10, 5)];
    expect(backtest(buckets, "<", 2, 0, 10).episodes).toBe(1);
    expect(backtest(buckets, ">", 5, 0, 10).episodes).toBe(0);
    expect(backtest(buckets, "=", 5, 0, 10).episodes).toBe(2);
    expect(backtest(buckets, "!=", 5, 0, 10).episodes).toBe(1);
  });

  it("sorts buckets by time before scoring", () => {
    const buckets = [at(10, 20), at(30, 20), at(20, 1)];
    expect(backtest(buckets, ">=", 15, 0, 10)).toEqual({
      episodes: 2,
      at: [NOW - 30 * MIN, NOW - 10 * MIN],
    });
  });
});

describe("fillCountBuckets", () => {
  it("adds a zero for every period with no rows", () => {
    const step = 10 * MIN;
    const start = NOW - 40 * MIN;
    const filled = fillCountBuckets([{ time: NOW - 20 * MIN, value: 7 }], start, NOW, step);
    expect(filled.map((b) => b.value)).toEqual([0, 0, 7, 0]);
    expect(filled[0].time).toBe(start);
  });
});

describe("parseBucketTime", () => {
  it("reads a zone-less histogram key as UTC", () => {
    expect(parseBucketTime("2026-10-23T12:00:00")).toBe(NOW);
  });

  it("reads microseconds", () => {
    expect(parseBucketTime(NOW * 1000)).toBe(NOW);
  });
});

describe("scoreHistory", () => {
  const step = 10 * MIN;
  const week = (fn: (i: number) => number) => series((7 * DAY) / step, step, NOW, fn);

  it("suggests from the six older days and back-tests on the last one", () => {
    const testStart = (6 * DAY) / step;
    const buckets = week((i) => (i >= testStart && i % 36 === 0 ? 40 : (i % 10) + 1));
    const result = scoreHistory({
      buckets,
      now: NOW,
      historyStart: NOW - 7 * DAY,
      kind: "count",
      operator: ">=",
      silenceMinutes: 10,
      periodMinutes: 10,
    });
    expect(result.history).toBe("ok");
    expect(result.usualHigh).toBe(9);
    expect(result.suggested).toBe(23);
    expect(result.backtestFor(23)?.episodes).toBe(4);
  });

  it("fits on what exists and skips the back-test under 2 days", () => {
    const buckets = series((30 * HOUR) / step, step, NOW, () => 4);
    const result = scoreHistory({
      buckets,
      now: NOW,
      historyStart: NOW - 30 * HOUR,
      kind: "count",
      operator: ">=",
      silenceMinutes: 10,
      periodMinutes: 10,
    });
    expect(result.history).toBe("short");
    expect(result.suggested).toBe(10);
    expect(result.backtestFor(10)).toBeNull();
  });

  it("suggests nothing under 1 h of history", () => {
    const result = scoreHistory({
      buckets: [{ time: NOW - 20 * MIN, value: 3 }],
      now: NOW,
      historyStart: NOW - 30 * MIN,
      kind: "count",
      operator: ">=",
      silenceMinutes: 10,
      periodMinutes: 10,
    });
    expect(result.history).toBe("none");
    expect(result.suggested).toBeNull();
    expect(result.usualHigh).toBeNull();
  });

  it("only suggests a limit for rules that fire on a rise", () => {
    const result = scoreHistory({
      buckets: week(() => 4),
      now: NOW,
      historyStart: NOW - 7 * DAY,
      kind: "count",
      operator: "<",
      silenceMinutes: 10,
      periodMinutes: 10,
    });
    expect(result.suggested).toBeNull();
    expect(result.backtestFor(1)?.episodes).toBe(0);
  });
});

describe("buildHistoryQuery", () => {
  it("counts a row query per rule period", () => {
    expect(buildHistoryQuery(`SELECT * FROM "app" WHERE level = 'error'`, 10)).toBe(
      `SELECT histogram(_timestamp, '10 minute') AS zo_sql_key, count(*) AS zo_sql_num FROM "app" WHERE level = 'error' GROUP BY 1`,
    );
  });

  it("buckets an aggregate query by the period and drops its HAVING limit", () => {
    const sql = `SELECT histogram(_timestamp) AS zo_sql_key, avg(took) AS zo_sql_val FROM "app" GROUP BY zo_sql_key HAVING avg(took) >= 250`;
    const out = buildHistoryQuery(sql, 5) ?? "";
    expect(out).toContain("histogram(_timestamp, '5 minute') AS zo_sql_key");
    expect(out).toContain("avg(took) AS zo_sql_num");
    expect(out).not.toMatch(/HAVING|250/);
  });

  it("is the same query whatever the limit is", () => {
    const at = (limit: number) =>
      buildHistoryQuery(
        `SELECT histogram(_timestamp) AS zo_sql_key, max(v) AS zo_sql_val FROM "m" GROUP BY zo_sql_key HAVING max(v) > ${limit}`,
        10,
      );
    expect(at(1)).toBe(at(900));
  });

  it("is null for a query it cannot bucket", () => {
    expect(buildHistoryQuery("", 10)).toBeNull();
  });
});
