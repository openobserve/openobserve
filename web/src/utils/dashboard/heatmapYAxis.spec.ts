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
  HEATMAP_Y_NON_POSITIVE_LABEL,
  heatmapYBucketCount,
  heatmapYBucketError,
  heatmapYBucketInRange,
  heatmapYBucketLabel,
  heatmapYBucketSql,
  heatmapYBucketing,
  heatmapYRangeOf,
  heatmapYRangeSql,
  isHeatmapYRangeInverted,
  isNumericYField,
  isHeatmapYBucketLowerBound,
  isPlainYField,
  sortHeatmapCategories,
} from "@/utils/dashboard/heatmapYAxis";
import { HEATMAP_MAX_CELLS } from "@/utils/dashboard/heatmapDefaults";

const identity = (value: unknown) => value;

describe("sortHeatmapCategories", () => {
  it.each([undefined, null, "data", "bogus"])("keeps data order for %s", (order) => {
    expect(sortHeatmapCategories(["b", "a", "c"], identity, order)).toEqual(["b", "a", "c"]);
  });

  it("sorts numerically when every key is a finite number, including numeric strings", () => {
    expect(sortHeatmapCategories(["10", 9, "100", -1, " 2 "], identity, "asc")).toEqual([
      -1,
      " 2 ",
      9,
      "10",
      "100",
    ]);
    expect(sortHeatmapCategories([10, 9, 100], identity, "desc")).toEqual([100, 10, 9]);
  });

  it("falls back to string compare when any key is not a number", () => {
    expect(sortHeatmapCategories(["10", "9", "x"], identity, "asc")).toEqual(["10", "9", "x"]);
    expect(sortHeatmapCategories(["b", "a", "c"], identity, "desc")).toEqual(["c", "b", "a"]);
  });

  it("treats an empty string as text, not as 0", () => {
    expect(sortHeatmapCategories(["2", "", "1"], identity, "asc")).toEqual(["", "1", "2"]);
  });

  it("is stable for equal keys and sorts by the key, not the item", () => {
    const items = [
      { name: "b", id: 1 },
      { name: "a", id: 2 },
      { name: "b", id: 3 },
    ];
    expect(sortHeatmapCategories(items, (it) => it.name, "asc").map((it) => it.id)).toEqual([
      2, 1, 3,
    ]);
  });

  it("does not mutate the input", () => {
    const input = [3, 1, 2];
    sortHeatmapCategories(input, identity, "asc");
    expect(input).toEqual([3, 1, 2]);
  });
});

describe("heatmapYBucketing / heatmapYBucketError", () => {
  it("is off when unset or the mode is unknown", () => {
    expect(heatmapYBucketing({})).toBeNull();
    expect(heatmapYBucketing({ heatmap_y_bucket: { mode: "count", count: 5 } })).toBeNull();
    expect(heatmapYBucketError({ heatmap_y_bucket: { mode: "count", count: 5 } })).toBeNull();
  });

  it("validates the size as a finite number > 0", () => {
    for (const size of [0, -1, Infinity, NaN, "", null, "abc"]) {
      const config = { heatmap_y_bucket: { mode: "size", size } };
      expect(heatmapYBucketing(config)).toBeNull();
      expect(heatmapYBucketError(config)).toBe("invalidSize");
    }
    expect(heatmapYBucketing({ heatmap_y_bucket: { mode: "size", size: 2.5 } })).toEqual({
      bucket: { mode: "size", size: 2.5 },
      range: null,
    });
  });

  it("defaults log to base 10 and accepts only 2 or 10", () => {
    expect(heatmapYBucketing({ heatmap_y_bucket: { mode: "log" } })?.bucket).toEqual({
      mode: "log",
      base: 10,
    });
    expect(heatmapYBucketing({ heatmap_y_bucket: { mode: "log", base: 2 } })?.bucket).toEqual({
      mode: "log",
      base: 2,
    });
    expect(heatmapYBucketing({ heatmap_y_bucket: { mode: "log", base: 3 } })).toBeNull();
  });

  it("rejects a size whose known range exceeds the cell budget, and not when an end is open", () => {
    const tooMany = {
      heatmap_y_bucket: { mode: "size", size: 1 },
      heatmap_y_min: 0,
      heatmap_y_max: HEATMAP_MAX_CELLS,
    };
    expect(heatmapYBucketError(tooMany)).toBe("tooManyBuckets");
    expect(heatmapYBucketError({ ...tooMany, heatmap_y_max: HEATMAP_MAX_CELLS - 1 })).toBeNull();
    expect(heatmapYBucketError({ ...tooMany, heatmap_y_min: null })).toBeNull();
  });

  it("counts buckets from the lower bound of each end", () => {
    expect(heatmapYBucketCount({ mode: "size", size: 10 }, { min: 5, max: 25 })).toBe(3);
    expect(heatmapYBucketCount({ mode: "size", size: 10 }, { min: -5, max: 5 })).toBe(2);
    expect(heatmapYBucketCount({ mode: "size", size: 10 }, { max: 5 })).toBeNull();
    expect(heatmapYBucketCount({ mode: "log", base: 2 }, { min: 1, max: 1e300 })).toBeNull();
  });
});

describe("heatmapYRangeOf", () => {
  it("reads either end and ignores an inverted pair", () => {
    expect(heatmapYRangeOf({})).toBeNull();
    expect(heatmapYRangeOf({ heatmap_y_min: 5 })).toEqual({ min: 5, max: undefined });
    expect(heatmapYRangeOf({ heatmap_y_max: "7" })).toEqual({ min: undefined, max: 7 });
    expect(heatmapYRangeOf({ heatmap_y_min: 10, heatmap_y_max: 10 })).toBeNull();
    expect(isHeatmapYRangeInverted({ heatmap_y_min: 10, heatmap_y_max: 10 })).toBe(true);
    expect(isHeatmapYRangeInverted({ heatmap_y_min: 1, heatmap_y_max: 10 })).toBe(false);
    expect(isHeatmapYRangeInverted({ heatmap_y_min: 10 })).toBe(false);
  });
});

describe("heatmapYBucketSql / heatmapYRangeSql", () => {
  it("floors a double-cast value to the bucket size", () => {
    expect(heatmapYBucketSql("latency", { mode: "size", size: 10 })).toBe(
      "floor(CAST(latency AS DOUBLE) / 10) * 10",
    );
  });

  it("uses the exact log function of the base and keeps null y null", () => {
    expect(heatmapYBucketSql("t.latency", { mode: "log", base: 10 })).toBe(
      "CASE WHEN t.latency > 0 THEN pow(10, floor(log10(CAST(t.latency AS DOUBLE)))) WHEN t.latency <= 0 THEN 0 END",
    );
    expect(heatmapYBucketSql("latency", { mode: "log", base: 2 })).toContain("log2(");
  });

  it("builds the range condition from the set ends only", () => {
    expect(heatmapYRangeSql("latency", { min: -5, max: 500 })).toBe(
      "latency >= -5 AND latency <= 500",
    );
    expect(heatmapYRangeSql("latency", { min: 1 })).toBe("latency >= 1");
    expect(heatmapYRangeSql("latency", null)).toBe("");
  });
});

describe("heatmapYBucketLabel / heatmapYBucketInRange", () => {
  it("labels a size bucket as its range without float noise", () => {
    expect(heatmapYBucketLabel(10, { mode: "size", size: 10 })).toBe("10–20");
    expect(heatmapYBucketLabel(0.30000000000000004, { mode: "size", size: 0.1 })).toBe("0.3–0.4");
    expect(heatmapYBucketLabel(-10, { mode: "size", size: 10 })).toBe("-10–0");
  });

  it("labels a log bucket up to the next power, and the 0 bucket as <= 0", () => {
    expect(heatmapYBucketLabel(100, { mode: "log", base: 10 })).toBe("100–1000");
    expect(heatmapYBucketLabel(0.5, { mode: "log", base: 2 })).toBe("0.5–1");
    expect(heatmapYBucketLabel(0, { mode: "log", base: 10 })).toBe(HEATMAP_Y_NON_POSITIVE_LABEL);
  });

  it("keeps buckets that overlap the range", () => {
    const size = { mode: "size", size: 10 } as const;
    expect(heatmapYBucketInRange(0, size, { min: 5, max: 25 })).toBe(true);
    expect(heatmapYBucketInRange(20, size, { min: 5, max: 25 })).toBe(true);
    expect(heatmapYBucketInRange(-10, size, { min: 0 })).toBe(false);
    expect(heatmapYBucketInRange(30, size, { min: 5, max: 25 })).toBe(false);
    expect(heatmapYBucketInRange(30, size, null)).toBe(true);
  });

  it("keeps the log <= 0 bucket only while the range reaches 0", () => {
    const log = { mode: "log", base: 10 } as const;
    expect(heatmapYBucketInRange(0, log, { min: 0 })).toBe(true);
    expect(heatmapYBucketInRange(0, log, { min: -1 })).toBe(true);
    expect(heatmapYBucketInRange(0, log, { min: 1 })).toBe(false);
    expect(heatmapYBucketInRange(1, log, { min: 5 })).toBe(true);
    expect(heatmapYBucketInRange(1, log, { min: 10 })).toBe(false);
  });

  it("keeps the log <= 0 bucket for a negative max, whose values the SQL puts there", () => {
    const log = { mode: "log", base: 10 } as const;
    expect(heatmapYBucketInRange(0, log, { max: -5 })).toBe(true);
    expect(heatmapYBucketInRange(0, log, { min: -50, max: -5 })).toBe(true);
    expect(heatmapYBucketInRange(1, log, { max: -5 })).toBe(false);
  });
});

describe("isPlainYField / isNumericYField", () => {
  const fieldOf = (field: string, extra: Record<string, unknown> = {}) => ({
    alias: "y_axis_1",
    functionName: null,
    args: [{ type: "field", value: { field } }],
    ...extra,
  });
  const panelWith = (schema: any[], streamAlias: string | null = null) => ({
    meta: { streamFields: { groupedFields: [{ stream_alias: streamAlias, schema }] } },
  });

  it("accepts only a bare column", () => {
    expect(isPlainYField(fieldOf("latency"))).toBe(true);
    expect(isPlainYField(fieldOf("latency", { functionName: "count" }))).toBe(false);
    expect(isPlainYField(fieldOf("latency", { isDerived: true }))).toBe(false);
    expect(isPlainYField({ args: [{ type: "string", value: "x" }] })).toBe(false);
    expect(isPlainYField(undefined)).toBe(false);
  });

  it.each(["Int64", "UInt32", "Float64", "Int8"])("treats %s as numeric", (type) => {
    expect(isNumericYField(fieldOf("latency"), panelWith([{ name: "latency", type }]))).toBe(true);
  });

  it.each(["Utf8", "Boolean", undefined])("treats %s as not numeric", (type) => {
    expect(isNumericYField(fieldOf("latency"), panelWith([{ name: "latency", type }]))).toBe(false);
  });

  it("looks the column up in the stream its alias names", () => {
    const field = {
      ...fieldOf("latency"),
      args: [{ type: "field", value: { field: "latency", streamAlias: "b" } }],
    };
    expect(isNumericYField(field, panelWith([{ name: "latency", type: "Int64" }], "b"))).toBe(true);
    expect(isNumericYField(field, panelWith([{ name: "latency", type: "Int64" }]))).toBe(false);
  });
});

describe("isHeatmapYBucketLowerBound", () => {
  it("accepts multiples of the size, within float noise", () => {
    expect(isHeatmapYBucketLowerBound(20, { mode: "size", size: 10 })).toBe(true);
    expect(isHeatmapYBucketLowerBound(-10, { mode: "size", size: 10 })).toBe(true);
    expect(isHeatmapYBucketLowerBound(0.30000000000000004, { mode: "size", size: 0.1 })).toBe(true);
    expect(isHeatmapYBucketLowerBound(25, { mode: "size", size: 10 })).toBe(false);
  });

  it("accepts 0 and powers of the base", () => {
    expect(isHeatmapYBucketLowerBound(0, { mode: "log", base: 10 })).toBe(true);
    expect(isHeatmapYBucketLowerBound(0.001, { mode: "log", base: 10 })).toBe(true);
    expect(isHeatmapYBucketLowerBound(1024, { mode: "log", base: 2 })).toBe(true);
    expect(isHeatmapYBucketLowerBound(50, { mode: "log", base: 10 })).toBe(false);
    expect(isHeatmapYBucketLowerBound(-10, { mode: "log", base: 10 })).toBe(false);
    expect(isHeatmapYBucketLowerBound(NaN, { mode: "size", size: 1 })).toBe(false);
  });
});
