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
  COMPARE_MAX_US,
  LOW_VOLUME_MIN,
  changeDirection,
  compareAllowed,
  compareBreakdown,
  compareFunnel,
  formatWindow,
  formatWindowExact,
  previousWindow,
  rateChange,
} from "@/utils/rum/funnelCompare";
import { foldBreakdown, funnelResultOf, toFunnelResult } from "@/utils/rum/productAnalyticsModel";
import type { FunnelDef } from "@/utils/rum/productAnalyticsQueries";

const DAY_US = 86_400_000_000;
const HOUR_US = 3_600_000_000;
// 12 Oct 2026 00:00 UTC.
const OCT12 = Date.UTC(2026, 9, 12) * 1000;

const def = (n: number, breakdown: FunnelDef["breakdown"] = null): FunnelDef => ({
  steps: Array.from({ length: n }, (_, i) => ({ kind: "c" as const, key: `s${i + 1}` })),
  unit: "sessions",
  window: "session",
  breakdown,
});

const hit = (counts: number[]): Record<string, number> =>
  Object.fromEntries(
    counts.flatMap((c, i) => [
      [`c${i + 1}`, c],
      [`seen${i + 1}`, 1],
    ]),
  );

const result = (counts: number[]) => toFunnelResult(hit(counts), def(counts.length));

describe("previousWindow", () => {
  it("is the same length and ends exactly where the current window starts", () => {
    const cur = { startUs: OCT12, endUs: OCT12 + 4 * DAY_US };
    expect(previousWindow(cur)).toEqual({ startUs: OCT12 - 4 * DAY_US, endUs: OCT12 });
  });

  it("works for a sub-day window", () => {
    const cur = { startUs: OCT12 + 9 * HOUR_US, endUs: OCT12 + 9 * HOUR_US + 900_000_000 };
    expect(previousWindow(cur)).toEqual({
      startUs: OCT12 + 9 * HOUR_US - 900_000_000,
      endUs: OCT12 + 9 * HOUR_US,
    });
  });
});

describe("compareAllowed", () => {
  it("allows up to 31 days and refuses longer or empty ranges", () => {
    expect(compareAllowed({ startUs: 0, endUs: COMPARE_MAX_US })).toBe(true);
    expect(compareAllowed({ startUs: 0, endUs: COMPARE_MAX_US + 1 })).toBe(false);
    expect(compareAllowed({ startUs: 5, endUs: 5 })).toBe(false);
  });
});

describe("rateChange", () => {
  it("gives the change in points and a 95% interval of the difference", () => {
    const c = rateChange(26, 67, 7, 20);
    expect(c?.pts).toBeCloseTo((26 / 67 - 7 / 20) * 100, 6);
    const se = Math.sqrt(((26 / 67) * (41 / 67)) / 67 + (0.35 * 0.65) / 20);
    expect(c?.ci95).toBeCloseTo(1.96 * se * 100, 6);
    expect(c?.curN).toBe(67);
    expect(c?.prevN).toBe(20);
  });

  it("is null when either period has nobody at the step above", () => {
    expect(rateChange(0, 0, 3, 10)).toBeNull();
    expect(rateChange(3, 10, 0, 0)).toBeNull();
  });

  it("marks low volume below 30 in either period, and not at exactly 30", () => {
    expect(rateChange(10, LOW_VOLUME_MIN, 10, LOW_VOLUME_MIN)?.lowVolume).toBe(false);
    expect(rateChange(10, LOW_VOLUME_MIN - 1, 10, 100)?.lowVolume).toBe(true);
    expect(rateChange(10, 100, 10, LOW_VOLUME_MIN - 1)?.lowVolume).toBe(true);
  });

  it("reads a change that rounds to 0.0 as flat", () => {
    const flat = rateChange(1000, 2000, 1001, 2000);
    expect(flat && changeDirection(flat)).toBe("flat");
    const up = rateChange(60, 100, 50, 100);
    expect(up && changeDirection(up)).toBe("up");
    const down = rateChange(40, 100, 50, 100);
    expect(down && changeDirection(down)).toBe("down");
  });
});

describe("compareFunnel", () => {
  it("never changes the current numbers", () => {
    const cur = result([67, 55, 44]);
    const before = JSON.parse(JSON.stringify(cur));
    compareFunnel(cur, result([20, 14, 10]));
    expect(cur).toEqual(before);
  });

  it("gives step 1 no previous rate or change, and later steps step-to-step changes", () => {
    const c = compareFunnel(result([67, 55, 44]), result([20, 14, 10]));
    expect(c.empty).toBe(false);
    expect(c.steps[0]).toEqual({
      prevUnits: 20,
      prevOfPrevious: null,
      prevOfFirst: 1,
      change: null,
    });
    expect(c.steps[1].prevOfPrevious).toBeCloseTo(0.7, 6);
    expect(c.steps[1].prevOfFirst).toBeCloseTo(0.7, 6);
    expect(c.steps[1].change?.pts).toBeCloseTo((55 / 67 - 0.7) * 100, 6);
    expect(c.steps[2].prevOfPrevious).toBeCloseTo(10 / 14, 6);
    expect(c.overall?.pts).toBeCloseTo((44 / 67 - 0.5) * 100, 6);
    expect(c.prevOverall).toBeCloseTo(0.5, 6);
  });

  it("compares each drop-off with the previous period's, red when the drop rate rose", () => {
    const c = compareFunnel(result([100, 50, 45]), result([100, 80, 30]));
    expect(c.drops[0]).toMatchObject({ prevCount: 20, prevOutOf: 100, rose: true });
    expect(c.drops[0]?.prevRate).toBeCloseTo(0.2, 6);
    expect(c.drops[1]).toMatchObject({ prevCount: 50, prevOutOf: 80, rose: false });
  });

  it("greys a drop-off under the low-volume rule", () => {
    const c = compareFunnel(result([67, 55]), result([20, 14]));
    expect(c.drops[0]?.lowVolume).toBe(true);
  });

  it("an empty previous period gives no previous value anywhere", () => {
    const c = compareFunnel(result([84, 67, 52]), result([0, 0, 0]));
    expect(c.empty).toBe(true);
    expect(c.steps.every((s) => s.prevUnits === null && s.change === null)).toBe(true);
    expect(c.steps.every((s) => s.prevOfFirst === null && s.prevOfPrevious === null)).toBe(true);
    expect(c.drops.every((d) => d === null)).toBe(true);
    expect(c.overall).toBeNull();
    expect(c.prevOverall).toBeNull();
  });

  it("a previous step reaching nobody mid-funnel leaves the steps after it without rates", () => {
    const c = compareFunnel(result([50, 40, 30, 20]), result([10, 0, 0, 0]));
    expect(c.steps[1].prevOfPrevious).toBe(0);
    expect(c.steps[1].prevOfFirst).toBe(0);
    expect(c.steps[2].prevOfPrevious).toBeNull();
    expect(c.steps[2].prevOfFirst).toBeNull();
    expect(c.steps[2].change).toBeNull();
    expect(c.steps[3].prevOfFirst).toBeNull();
    expect(c.drops[1]).toBeNull();
  });
});

describe("funnelResultOf", () => {
  it("reads one row without a breakdown and sums the values with one", () => {
    expect(funnelResultOf([hit([10, 4])], def(2))?.steps.map((s) => s.units)).toEqual([10, 4]);
    expect(funnelResultOf([], def(2))).toBeNull();
    const rows = [
      { dim: "Chrome", c1: 6, c2: 3 },
      { dim: "Firefox", c1: 4, c2: 1 },
    ];
    expect(funnelResultOf(rows, def(2, "browser"))?.steps.map((s) => s.units)).toEqual([10, 4]);
  });
});

describe("compareBreakdown", () => {
  const cur = foldBreakdown(
    [
      { dim: "card", c1: 17, c2: 17 },
      { dim: "upi", c1: 8, c2: 8 },
      { dim: "cod", c1: 7, c2: 7 },
    ],
    2,
  );

  it("compares each value's overall conversion and the total", () => {
    const res = compareBreakdown(
      cur,
      [
        { dim: "card", c1: 40, c2: 20 },
        { dim: "upi", c1: 10, c2: 10 },
      ],
      2,
    );
    const card = res.rows.find((r) => r.value === "card");
    expect(card?.prev?.conversion).toBeCloseTo(0.5, 6);
    expect(card?.prev?.change?.pts).toBeCloseTo(50, 6);
    expect(res.total?.first).toBe(50);
    expect(res.total?.last).toBe(30);
    expect(res.total?.change?.pts).toBeCloseTo((32 / 32 - 30 / 50) * 100, 6);
  });

  it("keeps a value seen only this period with no previous side", () => {
    const res = compareBreakdown(cur, [{ dim: "card", c1: 10, c2: 5 }], 2);
    const cod = res.rows.find((r) => r.value === "cod");
    expect(cod?.prev).toBeNull();
    expect(cod?.prevOnly).toBe(false);
  });

  it("gives a value seen only last period a row of its own", () => {
    const res = compareBreakdown(cur, [{ dim: "paypal", c1: 4, c2: 2 }], 2);
    const paypal = res.rows.find((r) => r.value === "paypal");
    expect(paypal?.prevOnly).toBe(true);
    expect(paypal?.counts).toEqual([0, 0]);
    expect(paypal?.prev?.conversion).toBeCloseTo(0.5, 6);
    expect(paypal?.prev?.change).toBeNull();
  });

  it("folds unmatched previous values into this period's Other row when it has one", () => {
    const many = foldBreakdown(
      ["a", "b", "c", "d", "e", "f"].map((dim, i) => ({ dim, c1: 20 - i, c2: 10 })),
      2,
    );
    const res = compareBreakdown(
      many,
      [
        { dim: "f", c1: 5, c2: 1 },
        { dim: "z", c1: 5, c2: 4 },
      ],
      2,
    );
    const other = res.rows.find((r) => r.other);
    expect(other?.prev).toMatchObject({ first: 10, last: 5 });
    expect(res.rows.some((r) => r.prevOnly)).toBe(false);
  });

  it("an empty previous period gives no previous conversion or change, Total included", () => {
    const res = compareBreakdown(cur, [], 2);
    expect(res.rows.every((r) => r.prev === null)).toBe(true);
    expect(res.total?.conversion).toBeNull();
    expect(res.total?.change).toBeNull();
  });

  it("applies the 30 rule to each value", () => {
    const res = compareBreakdown(cur, [{ dim: "card", c1: 30, c2: 15 }], 2);
    expect(res.rows.find((r) => r.value === "card")?.prev?.change?.lowVolume).toBe(true);
  });
});

describe("formatWindow", () => {
  it("prints whole days with an exclusive end", () => {
    expect(formatWindow({ startUs: OCT12 - 4 * DAY_US, endUs: OCT12 }, "UTC")).toBe("8–11 Oct");
  });

  it("names both months when the window crosses one", () => {
    const start = Date.UTC(2026, 8, 28) * 1000;
    expect(formatWindow({ startUs: start, endUs: start + 7 * DAY_US }, "UTC")).toBe(
      "28 Sep – 4 Oct",
    );
  });

  it("prints times for a window under a day", () => {
    const start = OCT12 + 9 * HOUR_US;
    expect(formatWindow({ startUs: start, endUs: start + 4 * HOUR_US }, "UTC")).toBe(
      "12 Oct, 09:00–13:00",
    );
  });

  it("follows the viewer's time zone", () => {
    expect(formatWindow({ startUs: OCT12, endUs: OCT12 + DAY_US }, "Asia/Kolkata")).toBe(
      "12–13 Oct",
    );
    expect(formatWindowExact({ startUs: OCT12, endUs: OCT12 + DAY_US }, "UTC")).toBe(
      "12 Oct 2026, 00:00 – 13 Oct 2026, 00:00",
    );
  });
});
