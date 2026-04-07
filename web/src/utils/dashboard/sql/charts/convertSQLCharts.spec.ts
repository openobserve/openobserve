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
import { applyStackedChart } from "@/utils/dashboard/sql/charts/convertSQLStackedChart";
import { applyHStackedChart } from "@/utils/dashboard/sql/charts/convertSQLHStackedChart";
import { applyHBarChart } from "@/utils/dashboard/sql/charts/convertSQLHBarChart";
import { applyLineAreaScatterBarChart } from "@/utils/dashboard/sql/charts/convertSQLLineAreaChart";

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
  applyPieDonutChartAlignment: vi.fn(),
  applyPieDonutCenterAdjustment: vi.fn(),
  calculatePieChartContainer: vi.fn(() => ({ left: "15%", right: "15%", top: "15%", bottom: "15%" })),
}));

vi.mock("@/utils/dashboard/sql/shared/contextBuilder", () => ({
  largestLabel: vi.fn((data) => data?.[0] ?? ""),
}));

/**
 * Builds a minimal SQLContext mock that provides the fields required by chart
 * converters without pulling in the full application bootstrap.
 */
function makeMockContext(overrides: Partial<any> = {}): any {
  const getAxisDataFromKey = vi.fn((key: string) => {
    const map: any = {
      y1: [100, 200, 300],
      x1: ["Jan", "Feb", "Mar"],
      breakdown: ["A", "B"],
    };
    return map[key] ?? [];
  });

  const getSeries = vi.fn(() => [
    { name: "series1", data: [1, 2, 3] },
  ]);

  const updateTrellisConfig = vi.fn();

  return {
    options: {
      xAxis: [{ data: ["Jan", "Feb", "Mar"], axisLabel: { rotate: 0, width: 120 }, name: "" }],
      yAxis: [{ data: [], axisLabel: { width: 80 }, name: "" }],
      series: [],
      tooltip: {
        axisPointer: {},
        textStyle: {},
      },
      grid: {},
    },
    panelSchema: {
      type: "bar",
      config: {
        unit: "default",
        unit_custom: "",
        decimals: 2,
        axis_label_truncate_width: 120,
        trellis: { layout: null },
      },
      queries: [
        {
          fields: {
            y: [{ label: "Value" }],
            breakdown: [],
          },
          customQuery: false,
        },
      ],
    },
    store: {
      state: {
        theme: "light",
        zoConfig: { timestamp_column: "_timestamp" },
      },
    },
    chartPanelRef: { value: { offsetWidth: 800, offsetHeight: 400 } },
    chartPanelStyle: {},
    hoveredSeriesState: { value: null },
    annotations: [],
    metadata: {},
    resultMetaData: [],
    xAxisKeys: ["x1"],
    yAxisKeys: ["y1"],
    zAxisKeys: [],
    breakDownKeys: [],
    missingValueData: [],
    extras: {},
    showGridlines: true,
    hasTimestampField: false,
    isHorizontalChart: false,
    dynamicXAxisNameGap: 25,
    convertedTimeStampToDataFormat: "",
    defaultSeriesProps: { type: "bar", emphasis: { focus: "series" } },
    chartMin: 0,
    chartMax: 100,
    defaultGrid: { containLabel: true },
    getAxisDataFromKey,
    getSeries,
    getAnnotationMarkLine: vi.fn(() => null),
    getSeriesMarkArea: vi.fn(() => null),
    getPieChartRadius: vi.fn(() => "50%"),
    updateTrellisConfig,
    ...overrides,
  };
}

describe("SQL Chart Converters", () => {
  describe("applyMetricChart", () => {
    it("sets series array on options", () => {
      const ctx = makeMockContext({
        panelSchema: {
          type: "metric",
          config: {
            unit: "default",
            unit_custom: "",
            decimals: 2,
            background: { value: { color: "#FFFFFF" } },
          },
          queries: [{ fields: { y: [{ label: "Value" }] }, customQuery: false }],
        },
      });
      applyMetricChart(ctx);
      expect(Array.isArray(ctx.options.series)).toBe(true);
      expect(ctx.options.series.length).toBeGreaterThan(0);
    });

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

    it("disables tooltip", () => {
      const ctx = makeMockContext();
      applyMetricChart(ctx);
      expect(ctx.options.tooltip.show).toBe(false);
    });

    it("sets dataset", () => {
      const ctx = makeMockContext();
      applyMetricChart(ctx);
      expect(ctx.options.dataset).toBeDefined();
    });

    it("sets polar coordinate", () => {
      const ctx = makeMockContext();
      applyMetricChart(ctx);
      expect(ctx.options.polar).toBeDefined();
    });
  });

  describe("applyStackedChart", () => {
    it("sets series using getSeries", () => {
      const ctx = makeMockContext({ panelSchema: { type: "stacked", config: { decimals: 2, trellis: { layout: null } }, queries: [{ fields: { y: [{ label: "Value" }] }, customQuery: false }] } });
      applyStackedChart(ctx);
      expect(ctx.getSeries).toHaveBeenCalled();
      expect(Array.isArray(ctx.options.series)).toBe(true);
    });

    it("slices xAxis to one element", () => {
      const ctx = makeMockContext();
      // Give it two xAxis elements
      ctx.options.xAxis = [
        { data: ["Jan", "Feb"], axisLabel: { rotate: 0, margin: 5 }, axisTick: {}, nameGap: 25 },
        { data: ["A", "B"], axisLabel: { rotate: 0, margin: 5 }, axisTick: {}, nameGap: 25 },
      ];
      ctx.panelSchema = {
        ...ctx.panelSchema,
        type: "stacked",
        config: { ...ctx.panelSchema.config, axis_label_truncate_width: 120, decimals: 2 },
      };
      applyStackedChart(ctx);
      expect(ctx.options.xAxis).toHaveLength(1);
    });

    it("sets tooltip axisPointer label", () => {
      const ctx = makeMockContext();
      ctx.panelSchema = { ...ctx.panelSchema, type: "stacked", config: { ...ctx.panelSchema.config, decimals: 2 } };
      applyStackedChart(ctx);
      expect(ctx.options.tooltip.axisPointer.label).toBeDefined();
    });
  });

  describe("applyHStackedChart", () => {
    it("swaps xAxis and yAxis", () => {
      const ctx = makeMockContext();
      ctx.options.xAxis = [{ data: ["A", "B"], axisLabel: { width: 80 }, name: "X" }];
      ctx.options.yAxis = [{ data: ["1", "2"], axisLabel: { width: 60 }, name: "Y" }];
      applyHStackedChart(ctx);
      // The function overwrites xAxis[0].data with getAxisDataFromKey(xAxisKeys[0]) before swapping
      // xAxisKeys[0] = "x1", getAxisDataFromKey("x1") = ["Jan", "Feb", "Mar"]
      // After swap: xAxis = original yAxis, yAxis = sliced (updated) xAxis
      expect(ctx.options.xAxis[0].data).toEqual(["1", "2"]);
      expect(ctx.options.yAxis[0].data).toEqual(["Jan", "Feb", "Mar"]);
    });

    it("calls getSeries", () => {
      const ctx = makeMockContext();
      ctx.options.xAxis = [{ data: [], axisLabel: { width: 80 }, name: "" }];
      ctx.options.yAxis = [{ data: [], axisLabel: { width: 60 }, name: "" }];
      applyHStackedChart(ctx);
      expect(ctx.getSeries).toHaveBeenCalled();
    });

    it("sets nameGap on yAxis elements", () => {
      const ctx = makeMockContext();
      ctx.options.xAxis = [{ data: ["A", "B"], axisLabel: { width: 100 }, name: "" }];
      ctx.options.yAxis = [{ data: ["Jan", "Feb"], axisLabel: { width: 100 }, name: "" }];
      applyHStackedChart(ctx);
      // After swap, yAxis is original xAxis which should have nameGap set
      ctx.options.yAxis.forEach((axis: any) => {
        expect(axis.nameGap).toBeDefined();
      });
    });
  });

  describe("applyHBarChart", () => {
    it("swaps xAxis and yAxis", () => {
      const ctx = makeMockContext();
      ctx.options.xAxis = [{ data: ["A", "B"], axisLabel: { width: 80 }, name: "" }];
      ctx.options.yAxis = [{ data: ["1", "2"], axisLabel: { width: 60 }, name: "" }];
      ctx.panelSchema = {
        ...ctx.panelSchema,
        type: "h-bar",
        config: { ...ctx.panelSchema.config, trellis: { layout: null } },
      };
      applyHBarChart(ctx);
      // series should be set
      expect(ctx.getSeries).toHaveBeenCalled();
    });

    it("sets xAxis name from query fields", () => {
      const ctx = makeMockContext();
      ctx.options.xAxis = [{ data: ["A"], axisLabel: { width: 80, overflow: "" }, nameGap: 0, name: "" }];
      ctx.options.yAxis = [{ data: [], axisLabel: { width: 60 }, name: "" }];
      ctx.panelSchema = {
        ...ctx.panelSchema,
        type: "h-bar",
        config: { ...ctx.panelSchema.config, trellis: { layout: null } },
        queries: [{ fields: { y: [{ label: "Metrics" }] }, customQuery: false }],
      };
      applyHBarChart(ctx);
      // After swap, original yAxis (now xAxis) should have name set
      expect(ctx.options.xAxis.name).toBe("Metrics");
    });
  });

  describe("applyLineAreaScatterBarChart", () => {
    it("sets series when area-stacked type", () => {
      const ctx = makeMockContext();
      ctx.panelSchema = {
        ...ctx.panelSchema,
        type: "area-stacked",
        config: { ...ctx.panelSchema.config, decimals: 2 },
        queries: [{ fields: { x: [], y: [{ label: "Value" }], breakdown: [{ alias: "cat" }] }, customQuery: false }],
      };
      applyLineAreaScatterBarChart(ctx);
      expect(ctx.getSeries).toHaveBeenCalled();
    });

    it("does not crash for line chart without breakdown", () => {
      const ctx = makeMockContext();
      ctx.panelSchema = {
        ...ctx.panelSchema,
        type: "line",
        queries: [{ fields: { x: [], y: [{ label: "Value" }], breakdown: [] }, customQuery: false }],
      };
      expect(() => applyLineAreaScatterBarChart(ctx)).not.toThrow();
    });
  });
});
