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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyHStackedChart } from "@/utils/dashboard/sql/charts/convertSQLHStackedChart";

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
          axisLabel: { rotate: 0, width: 120 },
          name: "",
        },
      ],
      yAxis: [{ data: [], axisLabel: { width: 80 }, name: "" }],
      series: [],
      tooltip: { axisPointer: {}, textStyle: {} },
      grid: {},
    },
    panelSchema: {
      type: "h-bar",
      config: {
        unit: "default",
        unit_custom: "",
        decimals: 2,
        axis_label_truncate_width: 120,
        trellis: { layout: null },
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
    chartPanelStyle: {},
    hoveredSeriesState: { value: null },
    annotations: [],
    metadata: {},
    xAxisKeys: ["x1"],
    yAxisKeys: ["y1"],
    breakDownKeys: [],
    dynamicXAxisNameGap: 25,
    hasTimestampField: false,
    isHorizontalChart: true,
    defaultSeriesProps: { type: "bar", emphasis: { focus: "series" } },
    chartMin: 0,
    chartMax: 100,
    getAxisDataFromKey,
    getSeries,
    updateTrellisConfig,
    ...overrides,
  };
}

describe("applyHStackedChart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls getSeries with barMinHeight: 1", () => {
    const ctx = makeMockContext();
    applyHStackedChart(ctx);
    expect(ctx.getSeries).toHaveBeenCalledWith({ barMinHeight: 1 });
  });

  it("sets series from getSeries result", () => {
    const ctx = makeMockContext();
    applyHStackedChart(ctx);
    expect(ctx.options.series).toEqual([{ name: "series1", data: [1, 2, 3] }]);
  });

  it("sets xAxis[0].data from getAxisDataFromKey before swap", () => {
    // Before the swap, xAxis[0].data is set to the result of getAxisDataFromKey(xAxisKeys[0]).
    // After the swap, this data ends up in yAxis[0].data.
    const ctx = makeMockContext();
    applyHStackedChart(ctx);
    // After swap: yAxis is the original xAxis; yAxis[0].data should be ["Jan","Feb","Mar"]
    expect(ctx.options.yAxis[0].data).toEqual(["Jan", "Feb", "Mar"]);
  });

  it("slices xAxis to one element before swap", () => {
    // The function slices options.xAxis to length 1 before swapping.
    // After swap, that sliced array becomes yAxis.
    const ctx = makeMockContext();
    // Start with two xAxis elements to verify slicing works
    ctx.options.xAxis = [
      {
        data: ["Jan", "Feb", "Mar"],
        axisLabel: { rotate: 0, width: 120 },
        name: "",
      },
      { data: ["X", "Y"], axisLabel: { rotate: 0, width: 80 }, name: "" },
    ];
    applyHStackedChart(ctx);
    // After swap, yAxis is what was the sliced xAxis (length 1)
    expect(ctx.options.yAxis.length).toBe(1);
  });

  it("after swap, xAxis is what was yAxis", () => {
    const ctx = makeMockContext();
    // Capture original yAxis reference before calling
    const originalYAxis = ctx.options.yAxis;
    applyHStackedChart(ctx);
    // After swap, options.xAxis should be the original yAxis object
    expect(ctx.options.xAxis).toBe(originalYAxis);
  });

  it("after swap, xAxis[0].data is from original yAxis", () => {
    const ctx = makeMockContext();
    // Original yAxis[0].data is []
    applyHStackedChart(ctx);
    // After swap, options.xAxis is original yAxis array; xAxis[0].data should be []
    expect(ctx.options.xAxis[0].data).toEqual([]);
  });

  it("after swap, yAxis[0].data is from getAxisDataFromKey", () => {
    const ctx = makeMockContext();
    applyHStackedChart(ctx);
    // After swap, options.yAxis is original xAxis (updated with getAxisDataFromKey result)
    expect(ctx.options.yAxis[0].data).toEqual(["Jan", "Feb", "Mar"]);
  });

  it("sets nameGap on each yAxis element", () => {
    const ctx = makeMockContext();
    applyHStackedChart(ctx);
    // After swap, yAxis is original xAxis (with data ["Jan","Feb","Mar"]).
    // maxYaxisWidth = max axisLabel.width over yAxis = 120
    // largestLabel(["Jan","Feb","Mar"]) = "Jan", calculateWidthText("Jan") = 60
    // nameGap = Math.min(60, 120) + 10 = 70
    ctx.options.yAxis.forEach((axis: any) => {
      expect(typeof axis.nameGap).toBe("number");
      expect(axis.nameGap).toBe(70);
    });
  });

  it("sets xAxis.nameGap to dynamicXAxisNameGap", () => {
    const ctx = makeMockContext();
    applyHStackedChart(ctx);
    // options.xAxis.nameGap is set as a property on the array object after the swap
    expect((ctx.options.xAxis as any).nameGap).toBe(25);
  });

  it("calls getAxisDataFromKey with xAxisKeys[0]", () => {
    const ctx = makeMockContext();
    applyHStackedChart(ctx);
    expect(ctx.getAxisDataFromKey).toHaveBeenCalledWith("x1");
  });

  it("getSeries called before swap occurs", () => {
    // Verify getSeries is called (series is set on the pre-swap xAxis state).
    // We verify getSeries is called exactly once with correct args.
    const ctx = makeMockContext();
    applyHStackedChart(ctx);
    expect(ctx.getSeries).toHaveBeenCalledTimes(1);
    expect(ctx.getSeries).toHaveBeenCalledWith({ barMinHeight: 1 });
  });

  it("deduplicates xAxis data via Set", () => {
    const ctx = makeMockContext();
    // Return duplicate values from getAxisDataFromKey
    ctx.getAxisDataFromKey = vi.fn(() => ["Jan", "Jan", "Feb", "Feb", "Mar"]);
    applyHStackedChart(ctx);
    // After swap, yAxis[0].data should have unique values
    expect(ctx.options.yAxis[0].data).toEqual(["Jan", "Feb", "Mar"]);
  });

  it("handles empty xAxis data gracefully", () => {
    const ctx = makeMockContext();
    ctx.getAxisDataFromKey = vi.fn(() => []);
    applyHStackedChart(ctx);
    expect(ctx.options.yAxis[0].data).toEqual([]);
  });
});
