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
  exemplarBaseUnit,
  exemplarPlacement,
  interpolateParsed,
  interpolateSeriesValue,
  isWholeHistogramQuantile,
  parseSeries,
  selectorMetricNames,
} from "./exemplarPlacement";

const P99 =
  'histogram_quantile(0.99, sum by (le) (rate(http_latency_seconds_bucket{job="api"}[5m])))';

describe("selectorMetricNames", () => {
  it("finds bare selectors and skips functions, keywords and label values", () => {
    expect(selectorMetricNames(P99)).toEqual(["http_latency_seconds_bucket"]);
    expect(selectorMetricNames('sum(rate(a_total{x="b_total"}[1m])) / on(job) c')).toEqual([
      "a_total",
      "c",
    ]);
  });

  it("never reads the letter tail of a numeric literal or duration as a metric", () => {
    expect(selectorMetricNames("1e3 * sum(rate(x_seconds_count[1m] offset 5m))")).toEqual([
      "x_seconds_count",
    ]);
    expect(selectorMetricNames("x_total offset 5m + 2.5e-3")).toEqual(["x_total"]);
  });

  it("reads __name__ matchers the metrics explorer writes", () => {
    expect(selectorMetricNames('sum(rate({__name__="lat_seconds_count"}[1m]))')).toEqual([
      "lat_seconds_count",
    ]);
  });
});

describe("exemplarBaseUnit", () => {
  it("uses the family's observed unit even on a count rate", () => {
    expect(exemplarBaseUnit("sum(rate(http_latency_seconds_count[1m]))").unit).toBe("seconds");
    expect(exemplarBaseUnit(P99).unit).toBe("seconds");
  });

  it("prefers a declared unit", () => {
    expect(exemplarBaseUnit("sum(rate(x_count[1m]))", "ms").unit).toBe("milliseconds");
  });
});

describe("isWholeHistogramQuantile", () => {
  it("accepts a lone histogram_quantile call", () => {
    expect(isWholeHistogramQuantile(P99)).toBe(true);
  });

  it("rejects arithmetic around it", () => {
    expect(isWholeHistogramQuantile(`${P99} * 1000`)).toBe(false);
    expect(isWholeHistogramQuantile("sum(rate(x_bucket[5m]))")).toBe(false);
  });
});

describe("exemplarPlacement", () => {
  const seconds = { unit: "seconds", unitCustom: null };

  it("places by value on a quantile panel in the metric's unit or no unit", () => {
    expect(exemplarPlacement(P99, "seconds", seconds)).toBe("value");
    expect(exemplarPlacement(P99, undefined, seconds)).toBe("value");
  });

  it("rides the line when the panel unit differs from the metric's", () => {
    expect(exemplarPlacement(P99, "milliseconds", seconds)).toBe("line");
  });

  it.each([
    "sum(rate(http_latency_seconds_count[1m]))",
    "sum(rate(http_latency_seconds_sum[5m])) / sum(rate(http_latency_seconds_count[5m]))",
    "sum(rate(requests_total[5m]))",
  ])("rides the line for %s", (query) => {
    expect(exemplarPlacement(query, "seconds", seconds)).toBe("line");
  });
});

describe("interpolateParsed", () => {
  it("binary-searches unsorted input once parsed", () => {
    const parsed = parseSeries([
      [280, "100"],
      [100, "10"],
      [160, "40"],
    ]);
    expect(Array.from(parsed.ts)).toEqual([100, 160, 280]);
    expect(interpolateParsed(parsed, 130)).toBe(25);
    expect(interpolateParsed(parsed, 220)).toBe(70);
    expect(interpolateParsed(parsed, 160)).toBe(40);
  });

  it("matches the one-off form on a long series", () => {
    const values: [unknown, unknown][] = Array.from({ length: 2000 }, (_, i) => [
      i * 15,
      String(i),
    ]);
    const parsed = parseSeries(values);
    for (const ts of [0, 7, 14_999, 29_985, 40_000]) {
      expect(interpolateParsed(parsed, ts)).toBe(interpolateSeriesValue(values, ts));
    }
  });
});

describe("interpolateSeriesValue", () => {
  const values: [unknown, unknown][] = [
    [100, "10"],
    [160, "40"],
    [220, "NaN"],
    [280, "100"],
  ];

  it("interpolates between neighbours", () => {
    expect(interpolateSeriesValue(values, 130)).toBe(25);
  });

  it("returns an exact point", () => {
    expect(interpolateSeriesValue(values, 160)).toBe(40);
  });

  it("skips non-finite points", () => {
    expect(interpolateSeriesValue(values, 220)).toBe(70);
  });

  it("holds the edge value outside the series", () => {
    expect(interpolateSeriesValue(values, 50)).toBe(10);
    expect(interpolateSeriesValue(values, 999)).toBe(100);
  });

  it("returns null for an empty series", () => {
    expect(interpolateSeriesValue([], 10)).toBeNull();
  });
});
