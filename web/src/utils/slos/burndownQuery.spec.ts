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
  bucketSecsFor,
  budgetUnitsFor,
  buildSloBurndownQuery,
  toBurndownSeries,
} from "./burndownQuery";

const DAY = 86400;

describe("buildSloBurndownQuery", () => {
  const base = { sloId: "slo-1", generation: 2, startSecs: 1_000_000, bucketSecs: 300 };

  it("buckets on slice_start, never on _timestamp", () => {
    const sql = buildSloBurndownQuery(base);
    // `_timestamp` is WRITE time: backfill stamps ninety days of history with
    // "now", so bucketing on it stacks the whole backfill into one column.
    expect(sql).not.toMatch(/histogram\(/i);
    expect(sql).not.toMatch(/_timestamp/);
    expect(sql).toContain("FLOOR(slice_start / 300) * 300");
  });

  it("keeps only the highest rev per slice", () => {
    // Late data and recomputes republish the same slice at a higher rev and the
    // stream keeps both copies — SUM without this counts a revised slice twice.
    const sql = buildSloBurndownQuery(base);
    expect(sql).toContain("ROW_NUMBER() OVER");
    expect(sql).toContain("PARTITION BY slice_start ORDER BY rev DESC");
    expect(sql).toContain("WHERE rn = 1");
  });

  it("scopes to one generation and to the rollup series", () => {
    const sql = buildSloBurndownQuery(base);
    expect(sql).toContain("definition_generation = 2");
    expect(sql).toContain("group_key = ''");
  });

  it("escapes quotes in the SLO id", () => {
    const sql = buildSloBurndownQuery({ ...base, sloId: "a'b" });
    expect(sql).toContain("slo_id = 'a''b'");
  });

  it("repeats the bucket expression in GROUP BY rather than grouping by alias", () => {
    const sql = buildSloBurndownQuery(base);
    expect(sql).toContain("GROUP BY CAST(FLOOR(slice_start / 300) * 300 AS BIGINT)");
  });
});

describe("bucketSecsFor", () => {
  it("never returns less than the slice interval", () => {
    expect(bucketSecsFor(3600, 300)).toBeGreaterThanOrEqual(300);
  });

  it("always returns a whole multiple of the slice interval", () => {
    // A bucket boundary that splits a slice would double-count it across two
    // points.
    for (const [win, slice] of [
      [7 * DAY, 60],
      [30 * DAY, 60],
      [90 * DAY, 300],
    ]) {
      expect(bucketSecsFor(win, slice) % slice).toBe(0);
    }
  });

  it("widens so a long window stays a drawable number of points", () => {
    // 90 days at a 1-minute slice is 129,600 slices — undrawable raw.
    const bucket = bucketSecsFor(90 * DAY, 60);
    expect((90 * DAY) / bucket).toBeLessThanOrEqual(200);
  });
});

describe("toBurndownSeries", () => {
  it("matches math.rs: remaining = 100 - 100 * (100 - sli) / (100 - target)", () => {
    // One bucket, 99 good of 100 → SLI 99%, target 90% → error rate 1, budget
    // width 10 → 10% of the budget consumed → 90% remaining.
    const [p] = toBurndownSeries([{ bucket: 0, good: 99, total: 100 }], 90);
    expect(p.remaining).toBeCloseTo(90, 9);
    expect(p.burn).toBeCloseTo(0.1, 9);
  });

  it("burns the budget cumulatively, but reports burn rate per bucket", () => {
    // A clean bucket, then a total outage, then clean again. Burn rate must
    // spike and recover; the budget must not recover — spent is spent.
    const pts = toBurndownSeries(
      [
        { bucket: 0, good: 100, total: 100 },
        { bucket: 60, good: 0, total: 100 },
        { bucket: 120, good: 100, total: 100 },
      ],
      99,
    );

    expect(pts[0].burn).toBeCloseTo(0, 9);
    expect(pts[1].burn).toBeCloseTo(100, 9); // max burn for a 99% target
    expect(pts[2].burn).toBeCloseTo(0, 9);

    // Budget = 300 events × 1% = 3 allowed bad. Nothing spent yet.
    expect(pts[0].remaining).toBeCloseTo(100, 9);
    // The outage spends 100 bad against a budget of 3 → 3333% of it.
    expect(pts[1].remaining).toBeCloseTo(100 * (1 - 100 / 3), 6);
    // Clean traffic afterwards spends nothing more, and must NOT refund.
    expect(pts[2].remaining).toBeCloseTo(pts[1].remaining!, 9);
  });

  it("never lets the burndown rise — spend is monotonic", () => {
    // THE defining property. An earlier version divided by the events seen so
    // far, so a bad first bucket plunged the line to -49900% and then CLIMBED
    // as later traffic diluted the ratio. A burndown that rises is not one.
    const pts = toBurndownSeries(
      [
        { bucket: 0, good: 500, total: 1000 },
        { bucket: 60, good: 1000, total: 1000 },
        { bucket: 120, good: 1000, total: 1000 },
        { bucket: 180, good: 1000, total: 1000 },
      ],
      99.9,
    );
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i].remaining!).toBeLessThanOrEqual(pts[i - 1].remaining!);
    }
  });

  it("starts full and descends for a service running exactly at target", () => {
    // 1000 events per bucket with exactly 1 bad = precisely the budgeted rate
    // for a 99.9% target. That must spend the budget EVENLY across the window,
    // landing on 0% at the right edge — not read 0% from the first bucket,
    // which is what the partial-window formula did.
    const pts = toBurndownSeries(
      Array.from({ length: 4 }, (_, i) => ({ bucket: i * 60, good: 999, total: 1000 })),
      99.9,
    );
    expect(pts[0].remaining).toBeCloseTo(75, 6);
    expect(pts[1].remaining).toBeCloseTo(50, 6);
    expect(pts[2].remaining).toBeCloseTo(25, 6);
    expect(pts[3].remaining).toBeCloseTo(0, 6);
  });

  it("lands the last point exactly on error_budget_remaining over the window", () => {
    // The chart sits directly under the stat tile the backend derives with
    // `error_budget_remaining(sli_window, target)`. The right-hand end of the
    // line and that tile must be the same number.
    const buckets = [
      { bucket: 0, good: 900, total: 1000 },
      { bucket: 60, good: 980, total: 1000 },
      { bucket: 120, good: 995, total: 1000 },
    ];
    const target = 95;
    const pts = toBurndownSeries(buckets, target);

    const good = buckets.reduce((s, b) => s + b.good, 0);
    const total = buckets.reduce((s, b) => s + b.total, 0);
    const sli = (100 * good) / total; // math.rs: sli
    const expected = 100 - (100 * (100 - sli)) / (100 - target); // error_budget_remaining

    expect(pts[pts.length - 1].remaining).toBeCloseTo(expected, 9);
  });

  it("never clamps a blown budget to zero", () => {
    // S-6: "-80% remaining" is what a user needs to see after burning 180%.
    const [p] = toBurndownSeries([{ bucket: 0, good: 0, total: 1000 }], 99.9);
    expect(p.remaining).toBeLessThan(0);
  });

  it("reports an empty bucket as a gap, not as zero", () => {
    // D34: unmeasured time must never render as a total outage.
    const pts = toBurndownSeries(
      [
        { bucket: 0, good: 10, total: 10 },
        { bucket: 60, good: 0, total: 0 },
      ],
      99,
    );
    expect(pts[1].burn).toBeNull();
  });

  it("carries the cumulative budget across a gap instead of dropping it", () => {
    // The gap has no events of its own, but the budget spent before it is
    // still spent — remaining stays defined.
    const pts = toBurndownSeries(
      [
        { bucket: 0, good: 90, total: 100 },
        { bucket: 60, good: 0, total: 0 },
      ],
      99,
    );
    expect(pts[1].remaining).toBeCloseTo(pts[0].remaining!, 9);
  });

  it("withholds the line across a LEADING gap rather than drawing a full budget", () => {
    // D34: unmeasured time must not read as a healthy budget. Before anything
    // has been observed there is no burndown to draw, so the line starts at
    // the first measured bucket rather than running flat at 100% across time
    // nobody watched.
    const pts = toBurndownSeries(
      [
        { bucket: 0, good: 0, total: 0 },
        { bucket: 60, good: 100, total: 100 },
      ],
      99,
    );
    expect(pts[0].remaining).toBeNull();
    expect(pts[1].remaining).toBeCloseTo(100, 9);
  });

  it("leaves both series undefined until anything has been measured", () => {
    const [p] = toBurndownSeries([{ bucket: 0, good: 0, total: 0 }], 99);
    expect(p.remaining).toBeNull();
    expect(p.burn).toBeNull();
  });

  it("sorts by bucket so out-of-order hits cannot invert the cumulation", () => {
    const pts = toBurndownSeries(
      [
        { bucket: 120, good: 0, total: 100 },
        { bucket: 0, good: 100, total: 100 },
      ],
      99,
    );
    expect(pts.map((p) => p.ts)).toEqual([0, 120]);
    expect(pts[0].burn).toBeCloseTo(0, 9);
  });

  it("draws nothing for a 100% target rather than dividing by a zero budget", () => {
    // Every formula divides by (100 - target); NaN through the series is worse
    // than an empty chart.
    expect(toBurndownSeries([{ bucket: 0, good: 1, total: 1 }], 100)).toEqual([]);
  });
});

describe("budgetUnitsFor", () => {
  // The bug this exists to stop: a time-slice SLO's budget arrives in SECONDS,
  // and labelling those seconds as slices overstates by the whole interval.
  it("converts a whole-slice SLI's seconds into slices", () => {
    // 95% over 7 days = 30,240 s of budget; at 5-minute slices that is 100.8.
    expect(budgetUnitsFor(30_240, "time_slice", 300)).toBeCloseTo(100.8, 6);
    expect(budgetUnitsFor(30_240, "alert", 300)).toBeCloseTo(100.8, 6);
    expect(budgetUnitsFor(30_240, "time_slice", 60)).toBeCloseTo(504, 6);
  });

  it("leaves a count SLI's events alone", () => {
    expect(budgetUnitsFor(58, "count", 300)).toBe(58);
    expect(budgetUnitsFor(58, undefined, 300)).toBe(58);
  });

  it("never divides by zero on a malformed interval", () => {
    expect(budgetUnitsFor(300, "time_slice", 0)).toBe(300);
    expect(budgetUnitsFor(300, "time_slice", Number.NaN)).toBe(300);
  });
});
