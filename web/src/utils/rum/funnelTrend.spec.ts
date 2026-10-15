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
  TREND_LOW_VOLUME,
  alignPrevious,
  bucketLabel,
  foldTrend,
  isTrendEmpty,
  pairParam,
  parseInterval,
  parsePair,
  previousTrendPeriods,
  resolveInterval,
  resolvePair,
  trendAverage,
  trendPeriods,
  type TrendContext,
  type TrendPeriods,
} from "@/utils/rum/funnelTrend";

const HOUR = 3_600_000_000;
const DAY = 24 * HOUR;
// 8 Oct 2026 00:00 UTC.
const D8 = Date.UTC(2026, 9, 8) * 1000;

const periodsOf = (startUs: number, days: number, nowUs: number, tz = "UTC"): TrendPeriods => {
  const p = trendPeriods({ startUs, endUs: startUs + days * DAY }, tz, nowUs, "day");
  if (!("boundariesUs" in p)) throw new Error("expected periods");
  return p;
};

const ctx = (patch: Partial<TrendContext> = {}): TrendContext => ({
  range: { startUs: D8, endUs: D8 + 8 * DAY },
  nowUs: D8 + 7 * DAY + 10 * HOUR,
  dataStartUs: null,
  dataThroughUs: null,
  windowUs: null,
  ...patch,
});

describe("funnel trend link params", () => {
  it("reads a 1-based pair, and only a forward one", () => {
    expect(parsePair("1-6")).toEqual({ a: 1, b: 6 });
    expect(parsePair("2-3")).toEqual({ a: 2, b: 3 });
    for (const bad of ["6-1", "3-3", "0-2", "a-b", "1-", "", undefined, 7]) {
      expect(parsePair(bad)).toBeNull();
    }
    expect(pairParam({ a: 2, b: 5 })).toBe("2-5");
  });

  it("falls back to step 1 → the last step when the funnel cannot hold the pair", () => {
    expect(resolvePair(null, 6)).toEqual({ a: 1, b: 6 });
    expect(resolvePair({ a: 2, b: 4 }, 6)).toEqual({ a: 2, b: 4 });
    expect(resolvePair({ a: 2, b: 7 }, 6)).toEqual({ a: 1, b: 6 });
    expect(resolvePair({ a: 1, b: 3 }, 2)).toEqual({ a: 1, b: 2 });
  });

  it("reads day, week and month; anything else is Auto", () => {
    expect(parseInterval("week")).toBe("week");
    expect(parseInterval("hour")).toBe("auto");
    expect(parseInterval(undefined)).toBe("auto");
  });

  it("resolves Auto like Retention, and a pick the range rules out falls back to Auto", () => {
    const week = { startUs: D8, endUs: D8 + 7 * DAY };
    expect(resolveInterval(week, "UTC", null, "auto")).toBe("day");
    expect(resolveInterval(week, "UTC", null, "week")).toBe("week");
    expect(resolveInterval(week, "UTC", null, "month")).toBe("day");
    const quarter = { startUs: D8, endUs: D8 + 60 * DAY };
    expect(resolveInterval(quarter, "UTC", null, "week")).toBe("week");
    expect(resolveInterval({ startUs: D8, endUs: D8 + HOUR }, "UTC", null, "auto")).toBeNull();
  });
});

describe("trendPeriods", () => {
  it("is too short below two buckets and too many past 36", () => {
    expect(trendPeriods({ startUs: D8, endUs: D8 + DAY }, "UTC", D8, null)).toEqual({
      tooShort: true,
    });
    expect(trendPeriods({ startUs: D8, endUs: D8 + 60 * DAY }, "UTC", D8, "day")).toEqual({
      tooMany: true,
    });
  });

  it("starts at local midnight in the viewer's zone and marks the bucket holding now", () => {
    const p = periodsOf(D8 + 5 * HOUR, 3, D8 + 2 * DAY + 6 * HOUR, "Asia/Kolkata");
    expect(p.boundariesUs[0]).toBe(D8 - 5.5 * HOUR);
    expect(bucketLabel(p.boundariesUs[0], "Asia/Kolkata", "day")).toBe("8 Oct");
    expect(p.runningIndex).toBe(p.boundariesUs.length - 1);
  });

  it("a DST week is a week of wall time, 169 hours long, with weeks from Monday", () => {
    // US clocks fall back on Sunday 1 Nov 2026.
    const start = Date.UTC(2026, 9, 26, 4) * 1000;
    const p = trendPeriods(
      { startUs: start, endUs: start + 21 * DAY },
      "America/New_York",
      start,
      "week",
    );
    if (!("boundariesUs" in p)) throw new Error("expected periods");
    expect(p.boundariesUs[0]).toBe(start);
    expect(p.endsUs[0] - p.boundariesUs[0]).toBe(7 * DAY + HOUR);
    expect(p.endsUs[1] - p.boundariesUs[1]).toBe(7 * DAY);
    expect(bucketLabel(p.boundariesUs[1], "America/New_York", "week")).toBe("2 Nov");
  });

  it("lines the previous window up at the same interval", () => {
    const pp = previousTrendPeriods({ startUs: D8 - 4 * DAY, endUs: D8 }, "UTC", D8, "day");
    expect(pp?.boundariesUs).toEqual([0, 1, 2, 3].map((i) => D8 - (4 - i) * DAY));
  });
});

describe("foldTrend", () => {
  const p = periodsOf(D8, 8, D8 + 7 * DAY + 10 * HOUR);
  const rows = [
    { bk: 1, ca: 5, cb: 1 },
    { bk: 3, ca: 7, cb: 4 },
    { bk: 5, ca: 52, cb: 21 },
    { bk: 7, ca: 11, cb: 4 },
  ];

  it("an empty bucket is a gap with no rate, never 0%", () => {
    const [s] = foldTrend(rows, p, ctx(), false);
    expect(s.buckets).toHaveLength(8);
    expect(s.buckets[0]).toMatchObject({ entered: 0, reached: 0, rate: null, empty: true });
    expect(s.buckets[5]).toMatchObject({ entered: 52, reached: 21, empty: false });
    expect(s.buckets[5].rate).toBeCloseTo(21 / 52);
    expect(isTrendEmpty([s])).toBe(false);
    expect(isTrendEmpty(foldTrend([], p, ctx(), false))).toBe(true);
  });

  it("Sessions: only the bucket holding now is still converting", () => {
    const [s] = foldTrend(rows, p, ctx(), false);
    expect(s.buckets.map((b) => b.stillConverting)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
  });

  it("Users: every bucket newer than the conversion window is still converting", () => {
    const [s] = foldTrend(rows, p, ctx({ windowUs: DAY }), false);
    expect(s.buckets.map((b) => b.stillConverting)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
  });

  it("a bucket that ends before the first data reads as before data", () => {
    const [s] = foldTrend(rows, p, ctx({ dataStartUs: D8 + DAY + HOUR }), false);
    expect(s.buckets[0].beforeData).toBe(true);
    expect(s.buckets[1].beforeData).toBe(false);
  });

  it("a recent bucket after the last ingested event reads as still arriving", () => {
    const now = D8 + 7 * DAY + 10 * HOUR;
    const lagging = ctx({ dataThroughUs: D8 + 6 * DAY - HOUR, nowUs: now });
    const [s] = foldTrend(rows, p, lagging, false);
    expect(s.buckets[6].arriving).toBe(true);
    expect(s.buckets[7].arriving).toBe(false);
    expect(s.buckets[5].arriving).toBe(false);
    const old = ctx({ dataThroughUs: D8 + 2 * DAY, nowUs: D8 + 30 * DAY });
    expect(foldTrend(rows, p, old, false)[0].buckets.some((b) => b.arriving)).toBe(false);
  });

  it(`fewer than ${TREND_LOW_VOLUME} entrants is low volume; none is not`, () => {
    const [s] = foldTrend(rows, p, ctx(), false);
    expect(s.buckets[1].lowVolume).toBe(true);
    expect(s.buckets[5].lowVolume).toBe(false);
    expect(s.buckets[0].lowVolume).toBe(false);
  });

  it("a rolling range's cut first bucket is partial", () => {
    const rolling = periodsOf(D8 + 9 * HOUR, 7, D8 + 7 * DAY + 9 * HOUR);
    const [s] = foldTrend(
      rows,
      rolling,
      ctx({ range: { startUs: D8 + 9 * HOUR, endUs: D8 + 7 * DAY + 9 * HOUR } }),
      false,
    );
    expect(s.buckets[0].partial).toBe(true);
    expect(s.buckets[1].partial).toBe(false);
    expect(s.buckets.at(-1)!.stillConverting).toBe(true);
    expect(s.buckets.at(-1)!.partial).toBe(false);
  });

  it("with a breakdown, each value is a series and the folded rest is Other or (not set)", () => {
    const hits = [
      { dim: "Chrome", un: 0, bk: 1, ca: 5, cb: 1 },
      { dim: "Chrome", un: 0, bk: 5, ca: 26, cb: 8 },
      { dim: "Firefox", un: 0, bk: 5, ca: 4, cb: 4 },
      { dim: null, un: 0, bk: 5, ca: 4, cb: 0 },
      { dim: null, un: 1, bk: 7, ca: 2, cb: 0 },
    ];
    const series = foldTrend(hits, p, ctx(), true);
    expect(series.map((s) => [s.kind, s.value])).toEqual([
      ["value", "Chrome"],
      ["value", "Firefox"],
      ["other", null],
    ]);
    expect(series[2].buckets[5].entered).toBe(4);
    const unnamed = foldTrend([{ dim: "", un: 1, bk: 2, ca: 3, cb: 1 }], p, ctx(), true);
    expect(unnamed.map((s) => s.kind)).toEqual(["notSet"]);
  });

  it("orders breakdown values by the SQL's step-1 rank total, not by step-a entrants", () => {
    const hits = [
      { dim: "Safari", un: 0, tot: 20, bk: 1, ca: 30, cb: 5 },
      { dim: "Chrome", un: 0, tot: 90, bk: 1, ca: 4, cb: 1 },
      { dim: null, un: 0, tot: 500, bk: 1, ca: 50, cb: 1 },
    ];
    expect(foldTrend(hits, p, ctx(), true).map((s) => s.value)).toEqual(["Chrome", "Safari", null]);
  });

  it("a breakdown value's average pools closed buckets and leaves the still-converting one out", () => {
    const hits = [
      { dim: "Chrome", un: 0, bk: 1, ca: 10, cb: 5 },
      { dim: "Chrome", un: 0, bk: 3, ca: 30, cb: 6 },
      { dim: "Chrome", un: 0, bk: 7, ca: 100, cb: 0 },
    ];
    const [chrome] = foldTrend(hits, p, ctx(), true);
    expect(trendAverage(chrome)).toEqual({ entered: 40, reached: 11, rate: 11 / 40 });
    const none = foldTrend([{ dim: "X", un: 0, bk: 7, ca: 3, cb: 1 }], p, ctx(), true)[0];
    expect(trendAverage(none).rate).toBeNull();
  });

  it("lines the previous period up by bucket index", () => {
    const [cur] = foldTrend(rows, p, ctx(), false);
    const prevP = periodsOf(D8 - 8 * DAY, 8, D8 + 7 * DAY);
    const [prev] = foldTrend([{ bk: 0, ca: 4, cb: 1 }], prevP, ctx(), false);
    const aligned = alignPrevious(cur, prev);
    expect(aligned).toHaveLength(8);
    expect(aligned[0]).toEqual({ startUs: D8 - 8 * DAY, entered: 4, rate: 0.25 });
    expect(aligned[1]).toEqual({ startUs: D8 - 7 * DAY, entered: 0, rate: null });
    expect(alignPrevious(cur, null).every((x) => x === null)).toBe(true);
  });
});
