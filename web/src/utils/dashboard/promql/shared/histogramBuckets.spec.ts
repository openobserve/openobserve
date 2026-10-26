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

import { describe, it, expect } from "vitest";
import {
  parseLe,
  deaccumulateHistogramSeries,
  groupHistogramSeries,
  HistogramSeriesInput,
  limitWholeHistograms,
} from "./histogramBuckets";

describe("limitWholeHistograms", () => {
  const bucket = (pod: string, le: string) => ({ metric: { pod, le } });

  it("keeps the first histograms that fit whole, in input order", () => {
    const series = [bucket("a", "1"), bucket("b", "1"), bucket("a", "+Inf"), bucket("b", "+Inf")];
    expect(limitWholeHistograms(series, 3)).toEqual({
      kept: [series[0], series[2]],
      shown: 1,
      total: 2,
    });
    expect(limitWholeHistograms(series, 4).kept).toEqual(series);
  });

  it("keeps one histogram whole even when it alone passes the limit", () => {
    const series = [bucket("a", "1"), bucket("a", "2"), bucket("a", "+Inf")];
    expect(limitWholeHistograms(series, 2)).toEqual({ kept: series, shown: 1, total: 1 });
  });
});

describe("parseLe", () => {
  it("parses finite bounds", () => {
    expect(parseLe("0.005")).toBe(0.005);
    expect(parseLe("1")).toBe(1);
    expect(parseLe("10.5")).toBe(10.5);
    expect(parseLe("  2.5  ")).toBe(2.5);
    expect(parseLe("1e3")).toBe(1000);
    expect(parseLe("0")).toBe(0);
  });

  it("parses the Prometheus '+Inf' spelling", () => {
    expect(parseLe("+Inf")).toBe(Infinity);
  });

  it("parses OpenObserve's lowercase OTLP 'inf' spelling", () => {
    // src/service/metrics/otlp.rs writes f64::INFINITY.to_string() -> "inf"
    expect(parseLe("inf")).toBe(Infinity);
  });

  it("parses other infinity spellings", () => {
    expect(parseLe("Inf")).toBe(Infinity);
    expect(parseLe("+inf")).toBe(Infinity);
    expect(parseLe("INF")).toBe(Infinity);
    expect(parseLe("Infinity")).toBe(Infinity);
    expect(parseLe("+Infinity")).toBe(Infinity);
    expect(parseLe("  +Inf ")).toBe(Infinity);
    expect(parseLe("-inf")).toBe(-Infinity);
  });

  it("returns NaN for non-numeric or missing values", () => {
    expect(parseLe("")).toBeNaN();
    expect(parseLe("   ")).toBeNaN();
    expect(parseLe("abc")).toBeNaN();
    expect(parseLe("1.5abc")).toBeNaN();
    expect(parseLe(undefined as any)).toBeNaN();
    expect(parseLe(null as any)).toBeNaN();
    expect(parseLe(0.5 as any)).toBeNaN();
  });
});

describe("deaccumulateHistogramSeries", () => {
  it("returns [] for empty / invalid input", () => {
    expect(deaccumulateHistogramSeries([])).toEqual([]);
    expect(deaccumulateHistogramSeries(undefined as any)).toEqual([]);
    expect(deaccumulateHistogramSeries([{ le: "abc", data: {} }])).toEqual([]);
  });

  it("de-accumulates a realistic 5-bucket histogram", () => {
    // Cumulative counts at two timestamps.
    // t=100: 0.1 -> 2, 0.5 -> 5, 1 -> 9, 5 -> 12, +Inf -> 15
    // t=200: 0.1 -> 1, 0.5 -> 1, 1 -> 4, 5 -> 10, +Inf -> 10
    const input: HistogramSeriesInput[] = [
      { le: "0.1", data: { 100: 2, 200: 1 } },
      { le: "0.5", data: { 100: 5, 200: 1 } },
      { le: "1", data: { 100: 9, 200: 4 } },
      { le: "5", data: { 100: 12, 200: 10 } },
      { le: "+Inf", data: { 100: 15, 200: 10 } },
    ];

    const result = deaccumulateHistogramSeries(input);

    expect(result.map((b) => b.le)).toEqual(["0.1", "0.5", "1", "5", "+Inf"]);
    expect(result.map((b) => b.leValue)).toEqual([0.1, 0.5, 1, 5, Infinity]);

    // t=100 diffs: 2, 3, 4, 3, 3   (sum 15 == top cumulative)
    expect(result.map((b) => b.data["100"])).toEqual([2, 3, 4, 3, 3]);
    // t=200 diffs: 1, 0, 3, 6, 0   (sum 10 == top cumulative)
    expect(result.map((b) => b.data["200"])).toEqual([1, 0, 3, 6, 0]);
  });

  it("sorts out-of-order le bounds ascending with +Inf last", () => {
    const input: HistogramSeriesInput[] = [
      { le: "+Inf", data: { 1: 10 } },
      { le: "5", data: { 1: 8 } },
      { le: "0.5", data: { 1: 3 } },
      { le: "1", data: { 1: 6 } },
      { le: "0.1", data: { 1: 1 } },
    ];

    const result = deaccumulateHistogramSeries(input);

    expect(result.map((b) => b.le)).toEqual(["0.1", "0.5", "1", "5", "+Inf"]);
    expect(result.map((b) => b.data["1"])).toEqual([1, 2, 3, 2, 2]);
  });

  it("treats 'inf' and '+Inf' identically when sorting", () => {
    const input: HistogramSeriesInput[] = [
      { le: "inf", data: { 1: 10 } },
      { le: "1", data: { 1: 4 } },
    ];

    const result = deaccumulateHistogramSeries(input);

    expect(result.map((b) => b.le)).toEqual(["1", "inf"]);
    expect(result.map((b) => b.leValue)).toEqual([1, Infinity]);
    expect(result.map((b) => b.data["1"])).toEqual([4, 6]);
  });

  it("keeps the first series when le values are duplicated", () => {
    const input: HistogramSeriesInput[] = [
      { le: "1", data: { 1: 5 } },
      // duplicate bound (e.g. "1" and "1.0", or two series with the same le)
      { le: "1.0", data: { 1: 99 } },
      { le: "+Inf", data: { 1: 8 } },
      // duplicate infinity via the OTLP spelling
      { le: "inf", data: { 1: 42 } },
    ];

    const result = deaccumulateHistogramSeries(input);

    expect(result).toHaveLength(2);
    expect(result.map((b) => b.le)).toEqual(["1", "+Inf"]);
    // 99 / 42 must not leak into the output
    expect(result.map((b) => b.data["1"])).toEqual([5, 3]);
  });

  it("drops series whose le does not parse", () => {
    const input: HistogramSeriesInput[] = [
      { le: "0.5", data: { 1: 3 } },
      { le: "not-a-number", data: { 1: 100 } },
      { le: "", data: { 1: 100 } },
      { le: "+Inf", data: { 1: 5 } },
    ];

    const result = deaccumulateHistogramSeries(input);

    expect(result.map((b) => b.le)).toEqual(["0.5", "+Inf"]);
    expect(result.map((b) => b.data["1"])).toEqual([3, 2]);
  });

  it("leaves a missing bucket and the bucket above it empty, and the rest exact", () => {
    const input: HistogramSeriesInput[] = [
      { le: "0.1", data: { 1: 2, 2: 1 } },
      { le: "0.5", data: { 2: 4 } },
      { le: "1", data: { 1: 5, 2: 7 } },
      { le: "+Inf", data: { 1: 6, 2: 9 } },
    ];

    const result = deaccumulateHistogramSeries(input);

    expect(result.map((b) => b.data["1"])).toEqual([2, undefined, undefined, 1]);
    expect(result.map((b) => "1" in b.data)).toEqual([true, false, false, true]);
    expect(result.map((b) => b.data["2"])).toEqual([1, 3, 3, 2]);
  });

  it("leaves the first bucket and the one above it empty when the first is missing", () => {
    const input: HistogramSeriesInput[] = [
      { le: "0.1", data: {} },
      { le: "1", data: { 1: 4 } },
      { le: "+Inf", data: { 1: 6 } },
    ];

    const result = deaccumulateHistogramSeries(input);

    expect(result.map((b) => b.data["1"])).toEqual([undefined, undefined, 2]);
  });

  it("treats NaN / null / undefined / empty / non-numeric cumulative values as missing", () => {
    const input: HistogramSeriesInput[] = [
      { le: "0.1", data: { 1: 2 } },
      { le: "0.5", data: { 1: NaN } },
      { le: "1", data: { 1: null } },
      { le: "2", data: { 1: undefined } },
      { le: "5", data: { 1: "" } },
      { le: "10", data: { 1: "not-a-number" } },
      { le: "+Inf", data: { 1: "9" } },
    ];

    const result = deaccumulateHistogramSeries(input);

    expect(result.map((b) => "1" in b.data)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(result[0].data["1"]).toBe(2);
  });

  it("accepts string cumulative values (PromQL wire format)", () => {
    const input: HistogramSeriesInput[] = [
      { le: "0.1", data: { 1: "1.5" } },
      { le: "1", data: { 1: "4.5" } },
      { le: "+Inf", data: { 1: "6" } },
    ];

    const result = deaccumulateHistogramSeries(input);

    expect(result.map((b) => b.data["1"])).toEqual([1.5, 3, 1.5]);
  });

  it("clamps negative adjacent differences to 0", () => {
    // Non-monotonic (malformed) cumulative series: 10, 5, 20
    const input: HistogramSeriesInput[] = [
      { le: "0.1", data: { 1: 10 } },
      { le: "1", data: { 1: 5 } },
      { le: "+Inf", data: { 1: 20 } },
    ];

    const result = deaccumulateHistogramSeries(input);

    // 10, max(0, 5-10) = 0, 20-5 = 15
    expect(result.map((b) => b.data["1"])).toEqual([10, 0, 15]);
  });

  it("clamps tiny negative float artifacts to 0", () => {
    const input: HistogramSeriesInput[] = [
      { le: "0.1", data: { 1: 0.30000000000000004 } },
      { le: "1", data: { 1: 0.3 } },
    ];

    const result = deaccumulateHistogramSeries(input);

    expect(result[1].data["1"]).toBe(0);
  });

  it("never fills a timestamp a bucket's bounds did not report with 0", () => {
    const input: HistogramSeriesInput[] = [
      { le: "1", data: { 100: 1 } },
      { le: "+Inf", data: { 200: 3 } },
    ];

    const result = deaccumulateHistogramSeries(input);

    expect(result[0].data).toEqual({ 100: 1 });
    expect(result[1].data).toEqual({});
  });

  it("does not mutate the input series", () => {
    const input: HistogramSeriesInput[] = [
      { le: "+Inf", data: { 1: 10 } },
      { le: "1", data: { 1: 4 } },
    ];
    const snapshot = JSON.parse(JSON.stringify(input));

    deaccumulateHistogramSeries(input);

    expect(input).toEqual(snapshot);
  });
});

describe("groupHistogramSeries", () => {
  const bucket = (metric: Record<string, string>) => ({ metric });

  it("groups by every label except le and __name__, in first-seen order", () => {
    const series = [
      bucket({ __name__: "x_bucket", pod: "b", le: "1" }),
      bucket({ __name__: "x_bucket", pod: "a", le: "1" }),
      bucket({ __name__: "x_bucket", pod: "b", le: "+Inf" }),
      bucket({ __name__: "x_bucket", pod: "a", le: "+Inf" }),
    ];
    const groups = groupHistogramSeries(series);
    expect(groups.map((group) => group.label)).toEqual(['pod="b"', 'pod="a"']);
    expect(groups[0].series).toEqual([series[0], series[2]]);
    expect(groups[1].series).toEqual([series[1], series[3]]);
    expect(groups.map((group) => group.labels)).toEqual([{ pod: "b" }, { pod: "a" }]);
  });

  it("keeps a sum by (le) query as one unlabelled group", () => {
    const series = [bucket({ le: "1" }), bucket({ le: "+Inf" }), { name: 'le="2"' } as any];
    expect(groupHistogramSeries(series)).toEqual([{ label: "", labels: {}, series }]);
  });

  it("orders the labels by name, so label order in the response does not split a group", () => {
    const groups = groupHistogramSeries([
      bucket({ pod: "a", job: "api", le: "1" }),
      bucket({ le: "2", job: "api", pod: "a" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('job="api", pod="a"');
  });

  it("does not merge label sets whose rendered text collides", () => {
    const groups = groupHistogramSeries([
      bucket({ a: 'x", b="y', le: "1" }),
      bucket({ a: "x", b: "y", le: "1" }),
    ]);
    expect(groups).toHaveLength(2);
  });
});
