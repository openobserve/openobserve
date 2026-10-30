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
  heatmapResponsesByValue,
  heatmapStatsByValue,
  histogramQuantile,
  sharedHeatmapRange,
  topValuesByRate,
} from "./breakdownStats";

/** A `sum by (le, az)` range response: one series per [az, le, points]. */
const byAzLe = (...series: [string, string, [number, string][]][]) => ({
  resultType: "matrix",
  result: series.map(([az, le, values]) => ({ metric: { az, le }, values })),
});

const buckets = (...pairs: [number, number][]) =>
  pairs.map(([leValue, count]) => ({ leValue, count }));

describe("histogramQuantile", () => {
  it("interpolates within the bucket the rank falls in, from 0 below the first", () => {
    const h = buckets([0.1, 10], [0.5, 30], [1, 40], [Infinity, 40]);
    // Rank 20 is half-way through (0.1, 0.5]'s 20 observations.
    expect(histogramQuantile(0.5, h)).toBeCloseTo(0.3);
    // Rank 4 is 40% of the first bucket, which starts at 0.
    expect(histogramQuantile(0.1, h)).toBeCloseTo(0.04);
    expect(histogramQuantile(0.9, h)).toBeCloseTo(0.8);
  });

  it("answers the highest finite bound for a rank in the +Inf bucket", () => {
    const h = buckets([0.1, 10], [0.5, 20], [Infinity, 40]);
    expect(histogramQuantile(0.99, h)).toBe(0.5);
  });

  it("is null without observations, or without a +Inf bucket to total them", () => {
    expect(histogramQuantile(0.5, buckets([0.1, 0], [Infinity, 0]))).toBeNull();
    expect(histogramQuantile(0.5, [])).toBeNull();
    expect(histogramQuantile(0.5, buckets([0.1, 3], [0.5, 5]))).toBeNull();
    expect(histogramQuantile(0.5, buckets([Infinity, 5]))).toBeNull();
  });

  it("never lets a count fall below a lower bucket's", () => {
    const h = buckets([0.5, 10], [1, 8], [Infinity, 20]);
    // 0.5 holds 10, so 1 holds 10 too, not 8: the median is the top of (0, 0.5].
    expect(histogramQuantile(0.5, h)).toBe(0.5);
  });
});

describe("heatmapStatsByValue", () => {
  const response = byAzLe(
    [
      "a",
      "0.5",
      [
        [1, "2"],
        [2, "4"],
      ],
    ],
    [
      "a",
      "+Inf",
      [
        [1, "4"],
        [2, "8"],
      ],
    ],
    ["b", "0.5", [[1, "1"]]],
    ["b", "+Inf", [[1, "1"]]],
    ["empty", "+Inf", [[1, "NaN"]]],
  );

  it("averages each value's total rate over the window, and takes its percentiles from all of it", () => {
    const stats = heatmapStatsByValue(response, "az");
    expect([...stats.keys()]).toEqual(["a", "b"]);
    const a = stats.get("a")!;
    expect(a.rate).toBe(6);
    // 6 of 12 observations at or below 0.5: the median is its top.
    expect(a.p50).toBe(0.5);
    // Past 0.5, in +Inf: the highest finite bound.
    expect(a.p90).toBe(0.5);
    // b reported at one of the window's two steps.
    expect(stats.get("b")!.rate).toBe(0.5);
    expect(stats.get("b")!.p50).toBeCloseTo(0.25);
  });

  it("keeps a value whose buckets saw no observations, with no percentiles", () => {
    const stats = heatmapStatsByValue(
      byAzLe(["idle", "0.5", [[1, "0"]]], ["idle", "+Inf", [[1, "0"]]]),
      "az",
    );
    expect(stats.get("idle")).toMatchObject({ rate: 0, p50: null, p90: null, p99: null });
  });

  it("ranks by volume over the whole window, so a brief burst does not outrank a steady value", () => {
    const steady: [number, string][] = [1, 2, 3, 4].map((ts) => [ts, "50"]);
    const stats = heatmapStatsByValue(
      byAzLe(["steady", "+Inf", steady], ["burst", "+Inf", [[1, "100"]]]),
      "az",
    );
    expect(stats.get("steady")!.rate).toBe(50);
    expect(stats.get("burst")!.rate).toBe(25);
    expect(topValuesByRate(stats, 10)).toEqual(["steady", "burst"]);
  });

  it("sums buckets whose bounds are spelled differently, as Prometheus does", () => {
    const stats = heatmapStatsByValue(
      byAzLe(
        ["a", "1", [[1, "2"]]],
        ["a", "1.0", [[1, "2"]]],
        ["a", "+Inf", [[1, "4"]]],
        ["a", "inf", [[1, "4"]]],
      ),
      "az",
    );
    // 4 of 8 at or under 1: without the merge, one "1" series would read as 2 of 8.
    expect(stats.get("a")).toMatchObject({ rate: 8, p50: 1 });
    const split = heatmapResponsesByValue(
      byAzLe(["a", "1", [[1, "2"]]], ["a", "1.0", [[1, "2"]]], ["a", "+Inf", [[1, "4"]]]),
      "az",
      ["a"],
    );
    expect(split.get("a").result.map((r: any) => [r.metric.le, r.values])).toEqual([
      ["1", [[1, "4"]]],
      ["+Inf", [[1, "4"]]],
    ]);
  });

  it("ranks values by volume, most first, keeping the top n", () => {
    const stats = heatmapStatsByValue(
      byAzLe(
        ["low", "+Inf", [[1, "1"]]],
        ["high", "+Inf", [[1, "9"]]],
        ["mid", "+Inf", [[1, "5"]]],
      ),
      "az",
    );
    expect(topValuesByRate(stats, 2)).toEqual(["high", "mid"]);
    expect(topValuesByRate(stats, 10)).toEqual(["high", "mid", "low"]);
  });
});

describe("heatmapResponsesByValue", () => {
  it("gives every value the same buckets and timestamps, filling the gaps with NaN", () => {
    const response = byAzLe(
      ["a", "0.5", [[1, "2"]]],
      ["a", "+Inf", [[1, "3"]]],
      ["b", "1", [[2, "1"]]],
      ["b", "+Inf", [[2, "1"]]],
    );
    const split = heatmapResponsesByValue(response, "az", ["a", "b"]);
    const shape = (value: string) =>
      split.get(value).result.map((s: any) => [s.metric.le, s.values]);

    expect(shape("a")).toEqual([
      [
        "0.5",
        [
          [1, "2"],
          [2, "NaN"],
        ],
      ],
      [
        "1",
        [
          [1, "NaN"],
          [2, "NaN"],
        ],
      ],
      [
        "+Inf",
        [
          [1, "3"],
          [2, "NaN"],
        ],
      ],
    ]);
    expect(shape("b").map(([le]: [string]) => le)).toEqual(["0.5", "1", "+Inf"]);
    expect(split.get("b").result[0].metric).toEqual({ az: "b", le: "0.5" });
  });
});

describe("sharedHeatmapRange", () => {
  it("spans the de-accumulated cells of every heatmap, from 0", () => {
    const response = byAzLe(
      ["a", "0.5", [[1, "2"]]],
      ["a", "+Inf", [[1, "3"]]],
      ["b", "0.5", [[1, "1"]]],
      ["b", "+Inf", [[1, "9"]]],
    );
    const split = heatmapResponsesByValue(response, "az", ["a", "b"]);
    // a's cells are 2 and 1; b's are 1 and 8. One scale covers both.
    expect(sharedHeatmapRange([...split.values()])).toEqual({ min: 0, max: 8 });
    expect(sharedHeatmapRange([split.get("a")])).toEqual({ min: 0, max: 2 });
  });

  it("is [0, 0] with nothing to draw", () => {
    expect(sharedHeatmapRange([])).toEqual({ min: 0, max: 0 });
  });
});
