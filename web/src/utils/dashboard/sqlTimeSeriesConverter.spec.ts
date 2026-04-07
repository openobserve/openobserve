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

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  applyAutoSQLTimeSeries,
  applyCustomSQLTimeSeries,
} from "@/utils/dashboard/sqlTimeSeriesConverter";

vi.mock("date-fns-tz", () => ({
  toZonedTime: vi.fn((v) => v),
}));

vi.mock("@/utils/dashboard/convertDataIntoUnitValue", () => ({
  formatUnitValue: vi.fn((v) => String(v ?? "")),
  getUnitValue: vi.fn((v) => v),
}));

vi.mock("@/utils/dashboard/chartDimensionUtils", () => ({
  calculateDynamicNameGap: vi.fn(() => 25),
}));

vi.mock("@/utils/dashboard/dateTimeUtils", () => ({
  formatDate: vi.fn(() => "2024-01-15 10:00:00"),
  isTimeSeries: vi.fn(() => false),
  isTimeStamp: vi.fn(() => false),
}));

// Import the mocked module so we can control return values per test
import * as dateTimeUtils from "@/utils/dashboard/dateTimeUtils";

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

function makeOptions(xAxisData: any[] = ["2024-01-15 10:00:00", "2024-01-15 11:00:00"]): any {
  return {
    xAxis: [
      {
        data: xAxisData,
        type: "category",
        axisLabel: { rotate: 30, overflow: "truncate", width: 80 },
        name: "",
      },
    ],
    series: [{ name: "s1", data: [10, 20] }],
    tooltip: {},
  };
}

function makeStore(): any {
  return {
    state: {
      theme: "light",
      zoConfig: { timestamp_column: "_timestamp" },
      timezone: "UTC",
    },
  };
}

function makeMetadata(): any {
  return {
    queries: [{ timeRangeGap: { seconds: 0 } }],
  };
}

function makePanelSchema(
  type = "line",
  customQuery = false,
  xFields: any[] = [],
): any {
  return {
    type,
    id: "panel1",
    config: {
      unit: "default",
      unit_custom: "",
      decimals: 2,
      trellis: { layout: null },
    },
    queries: [{ customQuery, fields: { x: xFields, y: [{ label: "Value" }] } }],
  };
}

function makeHistogramField(): any {
  return {
    functionName: "histogram",
    args: [{ value: { field: "_timestamp" } }],
  };
}

function makeTimestampField(): any {
  return {
    functionName: null,
    args: [{ value: { field: "_timestamp" } }],
  };
}

// ────────────────────────────────────────────────────────────
// applyAutoSQLTimeSeries
// ────────────────────────────────────────────────────────────

describe("applyAutoSQLTimeSeries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false for h-bar type", () => {
    const options = makeOptions();
    const panelSchema = makePanelSchema("h-bar", false, [makeHistogramField()]);
    const result = applyAutoSQLTimeSeries(options, panelSchema, makeStore(), makeMetadata(), { value: null });
    expect(result).toBe(false);
  });

  it("returns false for h-stacked type", () => {
    const options = makeOptions();
    const panelSchema = makePanelSchema("h-stacked", false, [makeHistogramField()]);
    const result = applyAutoSQLTimeSeries(options, panelSchema, makeStore(), makeMetadata(), { value: null });
    expect(result).toBe(false);
  });

  it("returns false for pie type", () => {
    const options = makeOptions();
    const panelSchema = makePanelSchema("pie", false, [makeHistogramField()]);
    const result = applyAutoSQLTimeSeries(options, panelSchema, makeStore(), makeMetadata(), { value: null });
    expect(result).toBe(false);
  });

  it("returns false when customQuery is true", () => {
    const options = makeOptions();
    const panelSchema = makePanelSchema("line", true, [makeHistogramField()]);
    const result = applyAutoSQLTimeSeries(options, panelSchema, makeStore(), makeMetadata(), { value: null });
    expect(result).toBe(false);
  });

  it("returns false when xAxis is empty array", () => {
    const options = makeOptions();
    options.xAxis = [];
    const panelSchema = makePanelSchema("line", false, [makeHistogramField()]);
    const result = applyAutoSQLTimeSeries(options, panelSchema, makeStore(), makeMetadata(), { value: null });
    expect(result).toBe(false);
  });

  it("returns false when xAxis[0].data is empty", () => {
    const options = makeOptions([]);
    const panelSchema = makePanelSchema("line", false, [makeHistogramField()]);
    const result = applyAutoSQLTimeSeries(options, panelSchema, makeStore(), makeMetadata(), { value: null });
    expect(result).toBe(false);
  });

  it("returns false when no histogram or timestamp field", () => {
    const options = makeOptions();
    const panelSchema = makePanelSchema("line", false, [{ functionName: "count", args: [] }]);
    const result = applyAutoSQLTimeSeries(options, panelSchema, makeStore(), makeMetadata(), { value: null });
    expect(result).toBe(false);
  });

  it("returns true and sets xAxis.type to time when histogram field present", () => {
    const options = makeOptions();
    const panelSchema = makePanelSchema("line", false, [makeHistogramField()]);
    const result = applyAutoSQLTimeSeries(options, panelSchema, makeStore(), makeMetadata(), { value: null });
    expect(result).toBe(true);
    expect(options.xAxis[0].type).toBe("time");
  });

  it("converts series data to [x, y] tuples when histogram field present", () => {
    const options = makeOptions(["2024-01-15 10:00:00", "2024-01-15 11:00:00"]);
    options.series = [{ name: "s1", data: [10, 20] }];
    const panelSchema = makePanelSchema("line", false, [makeHistogramField()]);
    applyAutoSQLTimeSeries(options, panelSchema, makeStore(), makeMetadata(), { value: null });
    expect(Array.isArray(options.series[0].data[0])).toBe(true);
    expect(options.series[0].data[0]).toHaveLength(2);
    expect(options.series[0].data[1]).toHaveLength(2);
  });

  it("clears xAxis[0].data after conversion", () => {
    const options = makeOptions(["2024-01-15 10:00:00"]);
    const panelSchema = makePanelSchema("line", false, [makeHistogramField()]);
    applyAutoSQLTimeSeries(options, panelSchema, makeStore(), makeMetadata(), { value: null });
    expect(options.xAxis[0].data).toEqual([]);
  });

  it("sets tooltip.formatter function when histogram field present", () => {
    const options = makeOptions();
    const panelSchema = makePanelSchema("line", false, [makeHistogramField()]);
    applyAutoSQLTimeSeries(options, panelSchema, makeStore(), makeMetadata(), { value: null });
    expect(typeof options.tooltip.formatter).toBe("function");
  });

  it("sets tooltip.axisPointer when histogram field present", () => {
    const options = makeOptions();
    const panelSchema = makePanelSchema("line", false, [makeHistogramField()]);
    applyAutoSQLTimeSeries(options, panelSchema, makeStore(), makeMetadata(), { value: null });
    expect(options.tooltip.axisPointer).toBeDefined();
    expect(options.tooltip.axisPointer.type).toBe("cross");
  });

  it("returns true when timestampField present (no functionName)", () => {
    const options = makeOptions(["1705320000000", "1705323600000"]);
    const panelSchema = makePanelSchema("line", false, [makeTimestampField()]);
    const result = applyAutoSQLTimeSeries(options, panelSchema, makeStore(), makeMetadata(), { value: null });
    expect(result).toBe(true);
  });

  it("converts series data to [x, y] tuples when timestamp field present", () => {
    const options = makeOptions(["1705320000000", "1705323600000"]);
    options.series = [{ name: "s1", data: [5, 15] }];
    const panelSchema = makePanelSchema("bar", false, [makeTimestampField()]);
    applyAutoSQLTimeSeries(options, panelSchema, makeStore(), makeMetadata(), { value: null });
    expect(Array.isArray(options.series[0].data[0])).toBe(true);
    expect(options.series[0].data[0]).toHaveLength(2);
  });
});

// ────────────────────────────────────────────────────────────
// applyCustomSQLTimeSeries
// ────────────────────────────────────────────────────────────

describe("applyCustomSQLTimeSeries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: not time series, not timestamp
    vi.mocked(dateTimeUtils.isTimeSeries).mockReturnValue(false as any);
    vi.mocked(dateTimeUtils.isTimeStamp).mockReturnValue(false as any);
  });

  it("returns false for heatmap type", () => {
    vi.mocked(dateTimeUtils.isTimeSeries).mockReturnValue(true as any);
    const options = makeOptions();
    const panelSchema = makePanelSchema("heatmap", true);
    const result = applyCustomSQLTimeSeries(options, panelSchema, makeStore(), makeMetadata(), { value: null });
    expect(result).toBe(false);
  });

  it("returns false when customQuery is false", () => {
    vi.mocked(dateTimeUtils.isTimeSeries).mockReturnValue(true as any);
    const options = makeOptions();
    const panelSchema = makePanelSchema("line", false);
    const result = applyCustomSQLTimeSeries(options, panelSchema, makeStore(), makeMetadata(), { value: null });
    expect(result).toBe(false);
  });

  it("returns false when xAxis data is not time series and not timestamp", () => {
    const options = makeOptions(["A", "B", "C"]);
    const panelSchema = makePanelSchema("line", true);
    const result = applyCustomSQLTimeSeries(options, panelSchema, makeStore(), makeMetadata(), { value: null });
    expect(result).toBe(false);
  });

  it("returns true and sets xAxis.type to time when data is time series", () => {
    vi.mocked(dateTimeUtils.isTimeSeries).mockReturnValue(true as any);
    const options = makeOptions(["2024-01-15 10:00:00", "2024-01-15 11:00:00"]);
    const panelSchema = makePanelSchema("line", true);
    const result = applyCustomSQLTimeSeries(options, panelSchema, makeStore(), makeMetadata(), { value: null });
    expect(result).toBe(true);
    expect(options.xAxis[0].type).toBe("time");
  });

  it("converts series data to [x, y] tuples when isTimeSeries is true", () => {
    vi.mocked(dateTimeUtils.isTimeSeries).mockReturnValue(true as any);
    const options = makeOptions(["2024-01-15 10:00:00", "2024-01-15 11:00:00"]);
    options.series = [{ name: "custom", data: [100, 200] }];
    const panelSchema = makePanelSchema("line", true);
    applyCustomSQLTimeSeries(options, panelSchema, makeStore(), makeMetadata(), { value: null });
    expect(Array.isArray(options.series[0].data[0])).toBe(true);
    expect(options.series[0].data[0]).toHaveLength(2);
  });

  it("returns true and sets xAxis.type to time when data is timestamp", () => {
    vi.mocked(dateTimeUtils.isTimeStamp).mockReturnValue(true as any);
    const options = makeOptions(["1705320000000", "1705323600000"]);
    const panelSchema = makePanelSchema("bar", true);
    const result = applyCustomSQLTimeSeries(options, panelSchema, makeStore(), makeMetadata(), { value: null });
    expect(result).toBe(true);
    expect(options.xAxis[0].type).toBe("time");
  });

  it("clears xAxis[0].data after conversion", () => {
    vi.mocked(dateTimeUtils.isTimeSeries).mockReturnValue(true as any);
    const options = makeOptions(["2024-01-15 10:00:00"]);
    const panelSchema = makePanelSchema("line", true);
    applyCustomSQLTimeSeries(options, panelSchema, makeStore(), makeMetadata(), { value: null });
    expect(options.xAxis[0].data).toEqual([]);
  });

  it("sets tooltip.formatter when time series detected", () => {
    vi.mocked(dateTimeUtils.isTimeSeries).mockReturnValue(true as any);
    const options = makeOptions();
    const panelSchema = makePanelSchema("line", true);
    applyCustomSQLTimeSeries(options, panelSchema, makeStore(), makeMetadata(), { value: null });
    expect(typeof options.tooltip.formatter).toBe("function");
  });

  it("returns false when xAxis is empty array", () => {
    vi.mocked(dateTimeUtils.isTimeSeries).mockReturnValue(true as any);
    const options = makeOptions();
    options.xAxis = [];
    const panelSchema = makePanelSchema("line", true);
    const result = applyCustomSQLTimeSeries(options, panelSchema, makeStore(), makeMetadata(), { value: null });
    expect(result).toBe(false);
  });
});
