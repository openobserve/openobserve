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
import { applyHBarChart } from "@/utils/dashboard/sql/charts/convertSQLHBarChart";

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
      xAxis: [{ data: ["Jan", "Feb", "Mar"], axisLabel: { rotate: 0, width: 120 }, name: "" }],
      yAxis: [{ data: [], axisLabel: { width: 80 }, name: "" }],
      series: [],
      tooltip: { axisPointer: {}, textStyle: {} },
      grid: {},
    },
    panelSchema: {
      type: "h-bar",
      config: { unit: "default", unit_custom: "", decimals: 2, axis_label_truncate_width: 120, trellis: { layout: null } },
      queries: [{ fields: { y: [{ label: "Value" }], breakdown: [] }, customQuery: false }],
    },
    store: { state: { theme: "light", zoConfig: { timestamp_column: "_timestamp" } } },
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

describe("applyHBarChart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls getSeries with barMinHeight: 1", () => {
    const ctx = makeMockContext();
    applyHBarChart(ctx);
    expect(ctx.getSeries).toHaveBeenCalledWith({ barMinHeight: 1 });
  });

  it("sets series from getSeries result", () => {
    const ctx = makeMockContext();
    applyHBarChart(ctx);
    expect(ctx.options.series).toEqual([{ name: "series1", data: [1, 2, 3] }]);
  });

  it("swaps xAxis and yAxis", () => {
    const ctx = makeMockContext();
    // Capture originals before calling
    const originalXAxis = ctx.options.xAxis;
    const originalYAxis = ctx.options.yAxis;
    applyHBarChart(ctx);
    // After swap: options.xAxis should be what was yAxis, options.yAxis should be what was xAxis
    expect(ctx.options.xAxis).toBe(originalYAxis);
    expect(ctx.options.yAxis).toBe(originalXAxis);
  });

  it("sets yAxis axisLabel.overflow to truncate", () => {
    const ctx = makeMockContext();
    applyHBarChart(ctx);
    // After swap, yAxis is the original xAxis
    ctx.options.yAxis.forEach((axis: any) => {
      expect(axis.axisLabel.overflow).toBe("truncate");
    });
  });

  it("sets nameGap on yAxis elements", () => {
    const ctx = makeMockContext();
    applyHBarChart(ctx);
    // After swap, yAxis is original xAxis; nameGap = Math.min(Math.max(xMax, bMax), width) + 10
    // calculateWidthText returns 60, so xAxisMaxLabel = 60 + 16 = 76, breakDownMaxLabel = 60 + 16 = 76
    // Math.max(76, 76) = 76; Math.min(76, 120) = 76; 76 + 10 = 86
    ctx.options.yAxis.forEach((axis: any) => {
      expect(typeof axis.nameGap).toBe("number");
      expect(axis.nameGap).toBe(86);
    });
  });

  it("sets xAxis.name from first y field label", () => {
    const ctx = makeMockContext();
    applyHBarChart(ctx);
    // After swap, options.xAxis is what was options.yAxis (an array).
    // The source sets options.xAxis.name as a property on the array object.
    expect((ctx.options.xAxis as any).name).toBe("Value");
  });

  it("sets xAxis.nameGap to dynamicXAxisNameGap", () => {
    const ctx = makeMockContext();
    applyHBarChart(ctx);
    // options.xAxis.nameGap is set as a property on the array object after the swap
    expect((ctx.options.xAxis as any).nameGap).toBe(25);
  });

  it("calls updateTrellisConfig when trellis layout is set and breakdown keys exist", () => {
    const ctx = makeMockContext();
    // Apply trellis layout and breakdown key overrides
    ctx.breakDownKeys = ["breakdown"];
    ctx.panelSchema = {
      ...ctx.panelSchema,
      config: { ...ctx.panelSchema.config, trellis: { layout: "vertical" } },
    };
    applyHBarChart(ctx);
    expect(ctx.updateTrellisConfig).toHaveBeenCalledTimes(1);
  });

  it("does NOT call updateTrellisConfig when no trellis layout", () => {
    const ctx = makeMockContext();
    // trellis.layout is null by default
    applyHBarChart(ctx);
    expect(ctx.updateTrellisConfig).not.toHaveBeenCalled();
  });

  it("does NOT call updateTrellisConfig when trellis layout set but no breakdown keys", () => {
    const ctx = makeMockContext();
    ctx.panelSchema = {
      ...ctx.panelSchema,
      config: { ...ctx.panelSchema.config, trellis: { layout: "vertical" } },
    };
    // breakDownKeys is [] by default
    applyHBarChart(ctx);
    expect(ctx.updateTrellisConfig).not.toHaveBeenCalled();
  });

  it("sets xAxis.name to empty string when no y fields", () => {
    const ctx = makeMockContext();
    ctx.panelSchema = {
      ...ctx.panelSchema,
      queries: [{ fields: { y: [], breakdown: [] }, customQuery: false }],
    };
    applyHBarChart(ctx);
    expect((ctx.options.xAxis as any).name).toBe("");
  });

  it("getAxisDataFromKey is called for each xAxisKey when no trellis layout", () => {
    const ctx = makeMockContext();
    applyHBarChart(ctx);
    // Should be called with xAxisKeys[0] = "x1" during xAxisMaxLabel calculation
    expect(ctx.getAxisDataFromKey).toHaveBeenCalledWith("x1");
  });
});
