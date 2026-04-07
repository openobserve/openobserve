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

import { describe, expect, it, vi, beforeEach } from "vitest";
import { applyMetricChart } from "@/utils/dashboard/sql/charts/convertSQLMetricChart";

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
      xAxis: [{ data: ["Jan", "Feb", "Mar"], axisLabel: { rotate: 0, width: 120, margin: 5 }, axisTick: {}, nameGap: 25, name: "" }],
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
      queries: [{ fields: { y: [{ label: "Value" }], breakdown: [] }, customQuery: false }],
    },
    store: { state: { theme: "light", zoConfig: { timestamp_column: "_timestamp" } } },
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

describe("applyMetricChart", () => {
  it("sets xAxis to empty array", () => {
    const ctx = makeMockContext();
    applyMetricChart(ctx);
    expect(ctx.options.xAxis).toEqual([]);
  });

  it("sets yAxis to empty array", () => {
    const ctx = makeMockContext();
    applyMetricChart(ctx);
    expect(ctx.options.yAxis).toEqual([]);
  });

  it("sets tooltip.show to false", () => {
    const ctx = makeMockContext();
    applyMetricChart(ctx);
    expect(ctx.options.tooltip.show).toBe(false);
  });

  it("sets dataset to { source: [[]] }", () => {
    const ctx = makeMockContext();
    applyMetricChart(ctx);
    expect(ctx.options.dataset).toEqual({ source: [[]] });
  });

  it("sets polar to {}", () => {
    const ctx = makeMockContext();
    applyMetricChart(ctx);
    expect(ctx.options.polar).toEqual({});
  });

  it("sets angleAxis.show to false", () => {
    const ctx = makeMockContext();
    applyMetricChart(ctx);
    expect(ctx.options.angleAxis).toBeDefined();
    expect(ctx.options.angleAxis.show).toBe(false);
  });

  it("sets radiusAxis.show to false", () => {
    const ctx = makeMockContext();
    applyMetricChart(ctx);
    expect(ctx.options.radiusAxis).toBeDefined();
    expect(ctx.options.radiusAxis.show).toBe(false);
  });

  it("sets series array with one element", () => {
    const ctx = makeMockContext();
    applyMetricChart(ctx);
    expect(Array.isArray(ctx.options.series)).toBe(true);
    expect(ctx.options.series).toHaveLength(1);
  });

  it("series[0] has a renderItem function", () => {
    const ctx = makeMockContext();
    applyMetricChart(ctx);
    expect(typeof ctx.options.series[0].renderItem).toBe("function");
  });

  it("series[0] includes defaultSeriesProps", () => {
    const ctx = makeMockContext({ defaultSeriesProps: { type: "custom", color: "red" } });
    applyMetricChart(ctx);
    expect(ctx.options.series[0].type).toBe("custom");
    expect(ctx.options.series[0].color).toBe("red");
  });

  it("sets backgroundColor from panelSchema.config.background.value.color", () => {
    const ctx = makeMockContext();
    applyMetricChart(ctx);
    expect(ctx.options.backgroundColor).toBe("#FFFFFF");
  });

  it("sets backgroundColor to empty string when background config missing", () => {
    const ctx = makeMockContext({
      panelSchema: {
        type: "metric",
        config: {
          unit: "default",
          unit_custom: "",
          decimals: 2,
          axis_label_truncate_width: 120,
          axis_label_rotate: 0,
          trellis: { layout: null },
          // background intentionally omitted
        },
        queries: [{ fields: { y: [{ label: "Value" }], breakdown: [] }, customQuery: false }],
      },
    });
    applyMetricChart(ctx);
    expect(ctx.options.backgroundColor).toBe("");
  });

  it("renderItem returns a text object with type 'text'", () => {
    const ctx = makeMockContext();
    applyMetricChart(ctx);
    const renderItem = ctx.options.series[0].renderItem;
    const params = { coordSys: { cx: 100, cy: 100 } };
    const result = renderItem(params, null);
    expect(result).toBeDefined();
    expect(result.type).toBe("text");
  });

  it("renderItem result style has text property set to formatted unit value", () => {
    const ctx = makeMockContext();
    applyMetricChart(ctx);
    const renderItem = ctx.options.series[0].renderItem;
    const params = { coordSys: { cx: 200, cy: 150 } };
    const result = renderItem(params, null);
    // getUnitValue mock returns the value as-is; formatUnitValue mock converts to string
    // yAxisValue[0] is 100 from mock
    expect(result.style.text).toBe("100");
  });
});
