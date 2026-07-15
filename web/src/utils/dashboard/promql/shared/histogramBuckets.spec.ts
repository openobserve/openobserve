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
  HistogramSeriesInput,
} from "./histogramBuckets";

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

  it("carries the previous cumulative forward for missing buckets", () => {
    // The 0.5 bucket has no sample at t=1: carrying 0.5's cumulative forward
    // from 0.1 (=2) means 0.5 contributes 0 and 1's diff stays correct (5-2=3).
    const input: HistogramSeriesInput[] = [
      { le: "0.1", data: { 1: 2, 2: 1 } },
      { le: "0.5", data: { 2: 4 } },
      { le: "1", data: { 1: 5, 2: 7 } },
      { le: "+Inf", data: { 1: 6, 2: 9 } },
    ];

    const result = deaccumulateHistogramSeries(input);

    // t=1: 0.1 -> 2, 0.5 missing -> 0, 1 -> 5-2 = 3, +Inf -> 6-5 = 1
    expect(result.map((b) => b.data["1"])).toEqual([2, 0, 3, 1]);
    // t=2: everything present -> 1, 3, 3, 2
    expect(result.map((b) => b.data["2"])).toEqual([1, 3, 3, 2]);
  });

  it("carries forward when the FIRST bucket is missing (implicit lower bound 0)", () => {
    const input: HistogramSeriesInput[] = [
      { le: "0.1", data: {} },
      { le: "1", data: { 1: 4 } },
      { le: "+Inf", data: { 1: 6 } },
    ];

    const result = deaccumulateHistogramSeries(input);

    // Missing bucket 0 carries the implicit 0 forward, so it contributes 0 and
    // bucket "1" gets the whole 4.
    expect(result.map((b) => b.data["1"])).toEqual([0, 4, 2]);
  });

  it("treats NaN / null / undefined / empty cumulative values as missing", () => {
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

    // Every intermediate bucket carries 2 forward and contributes 0;
    // +Inf sees 9 - 2 = 7.
    expect(result.map((b) => b.data["1"])).toEqual([2, 0, 0, 0, 0, 0, 7]);
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

  it("populates every timestamp of the union on every bucket", () => {
    const input: HistogramSeriesInput[] = [
      { le: "1", data: { 100: 1 } },
      { le: "+Inf", data: { 200: 3 } },
    ];

    const result = deaccumulateHistogramSeries(input);

    expect(Object.keys(result[0].data).sort()).toEqual(["100", "200"]);
    expect(Object.keys(result[1].data).sort()).toEqual(["100", "200"]);
    // t=100: le 1 -> 1, +Inf missing -> carries 1 -> 0
    expect(result.map((b) => b.data["100"])).toEqual([1, 0]);
    // t=200: le 1 missing -> 0, +Inf -> 3
    expect(result.map((b) => b.data["200"])).toEqual([0, 3]);
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
