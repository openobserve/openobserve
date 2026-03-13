// Copyright 2023 OpenObserve Inc.
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

import { describe, expect, it, vi, beforeEach } from "vitest";
import { applyStackedChart } from "@/utils/dashboard/sql/charts/convertSQLStackedChart";

vi.mock("@/utils/dashboard/convertDataIntoUnitValue", () => ({
  formatUnitValue: vi.fn((v) => String(v ?? "")),
  getUnitValue: vi.fn((v) => v),
}));
vi.mock("@/utils/dashboard/chartDimensionUtils", () => ({
  calculateWidthText: vi.fn(() => 60),
  calculateDynamicNameGap: vi.fn(() => 25),
  calculateRotatedLabelBottomSpace: vi.fn(() => 0),
  calculateOptimalFontSize: vi.fn(() => 24),
}));
vi.mock("@/utils/dashboard/chartColorUtils", () => ({
  getContrastColor: vi.fn(() => "#FFFFFF"),
}));
vi.mock("@/utils/dashboard/colorPalette", () => ({
  getSeriesColor: vi.fn(() => "#FF5733"),
  getSQLMinMaxValue: vi.fn(() => ({ min: 0, max: 100 })),
}));
vi.mock("@/utils/dashboard/legendConfiguration", () => ({
  getChartDimensions: vi.fn(() => ({ width: 800, height: 400 })),
}));
vi.mock("@/utils/dashboard/sql/shared/contextBuilder", () => ({
  largestLabel: vi.fn((data) => data?.[0] ?? ""),
}));

function makeMockContext(overrides: Partial<any> = {}): any {
  const getAxisDataFromKey = vi.fn((key: string) => {
    const map: any = {
      y1: [100, 200, 300],
      x1: ["Jan", "Feb", "Mar"],
      breakdown: ["A", "B"],
    };
    return map[key] ?? [];
  });
  const getSeries = vi.fn(() => [{ name: "series1", data: [1, 2, 3] }]);
  const updateTrellisConfig = vi.fn();

  return {
    options: {
      xAxis: [
        {
          data: ["Jan", "Feb", "Mar"],
          axisLabel: { rotate: 0, width: 120, margin: 5 },
          axisTick: {},
          nameGap: 25,
          name: "",
        },
      ],
      yAxis: [{ data: [], axisLabel: { width: 80 }, name: "" }],
      series: [],
      tooltip: { axisPointer: {}, textStyle: {} },
      grid: {},
    },
    panelSchema: {
      type: "bar",
      config: {
        unit: "default",
        unit_custom: "",
        decimals: 2,
        axis_label_truncate_width: 120,
        axis_label_rotate: 0,
        trellis: { layout: null },
        background: { value: { color: "#FFFFFF" } },
      },
      queries: [
        {
          fields: { y: [{ label: "Value" }], breakdown: [] },
          customQuery: false,
        },
      ],
    },
    store: {
      state: { theme: "light", zoConfig: { timestamp_column: "_timestamp" } },
    },
    chartPanelRef: { value: { offsetWidth: 800, offsetHeight: 400 } },
    hoveredSeriesState: { value: null },
    xAxisKeys: ["x1"],
    yAxisKeys: ["y1"],
    breakDownKeys: [],
    dynamicXAxisNameGap: 25,
    hasTimestampField: false,
    defaultSeriesProps: { type: "bar" },
    chartMin: 0,
    chartMax: 100,
    getAxisDataFromKey,
    getSeries,
    updateTrellisConfig,
    ...overrides,
  };
}

describe("applyStackedChart", () => {
  it("sets xAxis[0].data from getAxisDataFromKey", () => {
    const ctx = makeMockContext();
    applyStackedChart(ctx);
    expect(ctx.getAxisDataFromKey).toHaveBeenCalledWith("x1");
    expect(ctx.options.xAxis[0].data).toEqual(["Jan", "Feb", "Mar"]);
  });

  it("deduplicates xAxis data using Set", () => {
    const getAxisDataFromKey = vi.fn((key: string) => {
      if (key === "x1") return ["Jan", "Feb", "Jan", "Mar", "Feb"];
      return [];
    });
    const ctx = makeMockContext({ getAxisDataFromKey });
    applyStackedChart(ctx);
    expect(ctx.options.xAxis[0].data).toEqual(["Jan", "Feb", "Mar"]);
  });

  it("slices xAxis to one element", () => {
    const ctx = makeMockContext();
    // Add extra axes to verify slicing
    ctx.options.xAxis.push({ data: ["extra"] });
    applyStackedChart(ctx);
    expect(ctx.options.xAxis).toHaveLength(1);
  });

  it("calls getSeries with barMinHeight: 1", () => {
    const ctx = makeMockContext();
    applyStackedChart(ctx);
    expect(ctx.getSeries).toHaveBeenCalledWith({ barMinHeight: 1 });
  });

  it("sets series from getSeries result", () => {
    const ctx = makeMockContext();
    applyStackedChart(ctx);
    expect(ctx.options.series).toEqual([{ name: "series1", data: [1, 2, 3] }]);
  });

  it("sets tooltip.axisPointer.label with show: true", () => {
    const ctx = makeMockContext();
    applyStackedChart(ctx);
    expect(ctx.options.tooltip.axisPointer.label).toBeDefined();
    expect(ctx.options.tooltip.axisPointer.label.show).toBe(true);
  });

  it("sets tooltip axisPointer label backgroundColor for dark theme", () => {
    const ctx = makeMockContext({
      store: {
        state: { theme: "dark", zoConfig: { timestamp_column: "_timestamp" } },
      },
    });
    applyStackedChart(ctx);
    expect(ctx.options.tooltip.axisPointer.label.backgroundColor).toBe("#333");
  });

  it("sets tooltip axisPointer label backgroundColor to empty string for light theme", () => {
    const ctx = makeMockContext({
      store: {
        state: { theme: "light", zoConfig: { timestamp_column: "_timestamp" } },
      },
    });
    applyStackedChart(ctx);
    expect(ctx.options.tooltip.axisPointer.label.backgroundColor).toBe("");
  });

  it("sets xAxis[0].axisTick to empty object", () => {
    const ctx = makeMockContext();
    applyStackedChart(ctx);
    expect(ctx.options.xAxis[0].axisTick).toEqual({});
  });

  it("calls calculateDynamicNameGap to set xAxis[0].nameGap", async () => {
    const { calculateDynamicNameGap } = vi.mocked(
      await import("@/utils/dashboard/chartDimensionUtils"),
    );
    const ctx = makeMockContext();
    applyStackedChart(ctx);
    expect(calculateDynamicNameGap).toHaveBeenCalled();
  });

  it("sets xAxis[0].nameGap from calculateDynamicNameGap result", () => {
    const ctx = makeMockContext();
    applyStackedChart(ctx);
    // calculateDynamicNameGap mock returns 25
    expect(ctx.options.xAxis[0].nameGap).toBe(25);
  });

  it("uses 0 rotation when hasTimestampField is true", () => {
    const ctx = makeMockContext({
      hasTimestampField: true,
      panelSchema: {
        type: "bar",
        config: {
          unit: "default",
          unit_custom: "",
          decimals: 2,
          axis_label_truncate_width: 120,
          axis_label_rotate: 45,
          trellis: { layout: null },
          background: { value: { color: "#FFFFFF" } },
        },
        queries: [
          {
            fields: { y: [{ label: "Value" }], breakdown: [] },
            customQuery: false,
          },
        ],
      },
    });
    // Override xAxis axisLabel rotate to 45 to verify it gets overridden to 0
    ctx.options.xAxis[0].axisLabel.rotate = 45;
    applyStackedChart(ctx);
    expect(ctx.options.xAxis[0].axisLabel.rotate).toBe(0);
  });

  it("tooltip axisPointer label formatter is a function", () => {
    const ctx = makeMockContext();
    applyStackedChart(ctx);
    expect(typeof ctx.options.tooltip.axisPointer.label.formatter).toBe(
      "function",
    );
  });

  it("tooltip formatter returns value string for x dimension", () => {
    const ctx = makeMockContext();
    applyStackedChart(ctx);
    const formatter = ctx.options.tooltip.axisPointer.label.formatter;
    const result = formatter({ axisDimension: "x", value: "TestLabel" });
    expect(result).toBe("TestLabel");
  });
});
