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

describe("applyLineAreaScatterBarChart - area-stacked (Branch A)", () => {
  it("area-stacked: slices xAxis to one element", () => {
    const ctx = makeMockContext({
      panelSchema: {
        type: "area-stacked",
        config: {
          unit: "default",
          unit_custom: "",
          decimals: 2,
          axis_label_rotate: 0,
          axis_label_truncate_width: 120,
          trellis: { layout: null },
          background: { value: { color: "#FFFFFF" } },
        },
        queries: [{ fields: { y: [{ label: "Value" }], breakdown: [] }, customQuery: false }],
      },
    });
    ctx.options.xAxis.push({ data: ["extra"] });
    applyLineAreaScatterBarChart(ctx);
    expect(ctx.options.xAxis).toHaveLength(1);
  });

  it("area-stacked: sets tooltip.axisPointer.label", () => {
    const ctx = makeMockContext({
      panelSchema: {
        type: "area-stacked",
        config: {
          unit: "default",
          unit_custom: "",
          decimals: 2,
          axis_label_rotate: 0,
          axis_label_truncate_width: 120,
          trellis: { layout: null },
          background: { value: { color: "#FFFFFF" } },
        },
        queries: [{ fields: { y: [{ label: "Value" }], breakdown: [] }, customQuery: false }],
      },
    });
    applyLineAreaScatterBarChart(ctx);
    expect(ctx.options.tooltip.axisPointer.label).toBeDefined();
    expect(ctx.options.tooltip.axisPointer.label.show).toBe(true);
  });

  it("area-stacked: sets xAxis[0].data from getAxisDataFromKey", () => {
    const ctx = makeMockContext({
      panelSchema: {
        type: "area-stacked",
        config: {
          unit: "default",
          unit_custom: "",
          decimals: 2,
          axis_label_rotate: 0,
          axis_label_truncate_width: 120,
          trellis: { layout: null },
          background: { value: { color: "#FFFFFF" } },
        },
        queries: [{ fields: { y: [{ label: "Value" }], breakdown: [] }, customQuery: false }],
      },
    });
    applyLineAreaScatterBarChart(ctx);
    expect(ctx.getAxisDataFromKey).toHaveBeenCalledWith("x1");
    expect(ctx.options.xAxis[0].data).toEqual(["Jan", "Feb", "Mar"]);
  });

  it("area-stacked: calls getSeries", () => {
    const ctx = makeMockContext({
      panelSchema: {
        type: "area-stacked",
        config: {
          unit: "default",
          unit_custom: "",
          decimals: 2,
          axis_label_rotate: 0,
          axis_label_truncate_width: 120,
          trellis: { layout: null },
          background: { value: { color: "#FFFFFF" } },
        },
        queries: [{ fields: { y: [{ label: "Value" }], breakdown: [] }, customQuery: false }],
      },
    });
    applyLineAreaScatterBarChart(ctx);
    expect(ctx.getSeries).toHaveBeenCalled();
  });

  it("does not call updateTrellisConfig for area-stacked", () => {
    const ctx = makeMockContext({
      panelSchema: {
        type: "area-stacked",
        config: {
          unit: "default",
          unit_custom: "",
          decimals: 2,
          axis_label_rotate: 0,
          axis_label_truncate_width: 120,
          trellis: { layout: "grid" },
          background: { value: { color: "#FFFFFF" } },
        },
        queries: [{ fields: { y: [{ label: "Value" }], breakdown: [{ label: "Cat" }] }, customQuery: false }],
      },
      breakDownKeys: ["breakdown"],
    });
    applyLineAreaScatterBarChart(ctx);
    expect(ctx.updateTrellisConfig).not.toHaveBeenCalled();
  });
});

describe("applyLineAreaScatterBarChart - line with breakdown (Branch A)", () => {
  it("line with breakdown: slices xAxis to one element", () => {
    const ctx = makeMockContext({
      panelSchema: {
        type: "line",
        config: {
          unit: "default",
          unit_custom: "",
          decimals: 2,
          axis_label_rotate: 0,
          axis_label_truncate_width: 120,
          trellis: { layout: null },
          background: { value: { color: "#FFFFFF" } },
        },
        queries: [{ fields: { y: [{ label: "Value" }], breakdown: [{ label: "Cat" }] }, customQuery: false }],
      },
      breakDownKeys: ["breakdown"],
    });
    ctx.options.xAxis.push({ data: ["extra"] });
    applyLineAreaScatterBarChart(ctx);
    expect(ctx.options.xAxis).toHaveLength(1);
  });

  it("line with breakdown: sets xAxis[0].nameGap to dynamicXAxisNameGap", () => {
    const ctx = makeMockContext({
      dynamicXAxisNameGap: 42,
      panelSchema: {
        type: "line",
        config: {
          unit: "default",
          unit_custom: "",
          decimals: 2,
          axis_label_rotate: 0,
          axis_label_truncate_width: 120,
          trellis: { layout: null },
          background: { value: { color: "#FFFFFF" } },
        },
        queries: [{ fields: { y: [{ label: "Value" }], breakdown: [{ label: "Cat" }] }, customQuery: false }],
      },
      breakDownKeys: ["breakdown"],
    });
    applyLineAreaScatterBarChart(ctx);
    expect(ctx.options.xAxis[0].nameGap).toBe(42);
  });
});

describe("applyLineAreaScatterBarChart - bar without breakdown", () => {
  it("bar: calls getSeries with barMinHeight: 1", () => {
    const ctx = makeMockContext({
      panelSchema: {
        type: "bar",
        config: {
          unit: "default",
          unit_custom: "",
          decimals: 2,
          axis_label_rotate: 0,
          axis_label_truncate_width: 120,
          trellis: { layout: null },
          background: { value: { color: "#FFFFFF" } },
        },
        queries: [{ fields: { y: [{ label: "Value" }], breakdown: [] }, customQuery: false }],
      },
      breakDownKeys: [],
    });
    applyLineAreaScatterBarChart(ctx);
    expect(ctx.getSeries).toHaveBeenCalledWith({ barMinHeight: 1 });
  });
});

describe("applyLineAreaScatterBarChart - scatter without breakdown (Branch B)", () => {
  it("scatter without breakdown: sets tooltip.formatter function", () => {
    const ctx = makeMockContext({
      panelSchema: {
        type: "scatter",
        config: {
          unit: "default",
          unit_custom: "",
          decimals: 2,
          axis_label_rotate: 0,
          axis_label_truncate_width: 120,
          trellis: { layout: null },
          background: { value: { color: "#FFFFFF" } },
        },
        queries: [{ fields: { y: [{ label: "Value" }], breakdown: [] }, customQuery: false }],
      },
      breakDownKeys: [],
    });
    applyLineAreaScatterBarChart(ctx);
    expect(typeof ctx.options.tooltip.formatter).toBe("function");
  });

  it("scatter: calls getSeries with empty options", () => {
    const ctx = makeMockContext({
      panelSchema: {
        type: "scatter",
        config: {
          unit: "default",
          unit_custom: "",
          decimals: 2,
          axis_label_rotate: 0,
          axis_label_truncate_width: 120,
          trellis: { layout: null },
          background: { value: { color: "#FFFFFF" } },
        },
        queries: [{ fields: { y: [{ label: "Value" }], breakdown: [] }, customQuery: false }],
      },
      breakDownKeys: [],
    });
    applyLineAreaScatterBarChart(ctx);
    expect(ctx.getSeries).toHaveBeenCalledWith({});
  });
});

describe("applyLineAreaScatterBarChart - line without breakdown", () => {
  it("line without breakdown: does not throw", () => {
    const ctx = makeMockContext({
      panelSchema: {
        type: "line",
        config: {
          unit: "default",
          unit_custom: "",
          decimals: 2,
          axis_label_rotate: 0,
          axis_label_truncate_width: 120,
          trellis: { layout: null },
          background: { value: { color: "#FFFFFF" } },
        },
        queries: [{ fields: { y: [{ label: "Value" }], breakdown: [] }, customQuery: false }],
      },
      breakDownKeys: [],
    });
    expect(() => applyLineAreaScatterBarChart(ctx)).not.toThrow();
  });

  it("line without breakdown: calls getSeries with opacity 0.8", () => {
    const ctx = makeMockContext({
      panelSchema: {
        type: "line",
        config: {
          unit: "default",
          unit_custom: "",
          decimals: 2,
          axis_label_rotate: 0,
          axis_label_truncate_width: 120,
          trellis: { layout: null },
          background: { value: { color: "#FFFFFF" } },
        },
        queries: [{ fields: { y: [{ label: "Value" }], breakdown: [] }, customQuery: false }],
      },
      breakDownKeys: [],
    });
    applyLineAreaScatterBarChart(ctx);
    expect(ctx.getSeries).toHaveBeenCalledWith({ opacity: 0.8 });
  });
});

describe("applyLineAreaScatterBarChart - trellis behavior", () => {
  it("calls updateTrellisConfig for line with trellis layout and breakdown", () => {
    const ctx = makeMockContext({
      panelSchema: {
        type: "line",
        config: {
          unit: "default",
          unit_custom: "",
          decimals: 2,
          axis_label_rotate: 0,
          axis_label_truncate_width: 120,
          trellis: { layout: "grid" },
          background: { value: { color: "#FFFFFF" } },
        },
        queries: [{ fields: { y: [{ label: "Value" }], breakdown: [{ label: "Cat" }] }, customQuery: false }],
      },
      breakDownKeys: ["breakdown"],
    });
    applyLineAreaScatterBarChart(ctx);
    expect(ctx.updateTrellisConfig).toHaveBeenCalled();
  });
});

describe("applyLineAreaScatterBarChart - additional coverage", () => {
  it("area without breakdown: calls getSeries with opacity 0.8", () => {
    const ctx = makeMockContext({
      panelSchema: {
        type: "area",
        config: {
          unit: "default",
          unit_custom: "",
          decimals: 2,
          axis_label_rotate: 0,
          axis_label_truncate_width: 120,
          trellis: { layout: null },
          background: { value: { color: "#FFFFFF" } },
        },
        queries: [{ fields: { y: [{ label: "Value" }], breakdown: [] }, customQuery: false }],
      },
      breakDownKeys: [],
    });
    applyLineAreaScatterBarChart(ctx);
    expect(ctx.getSeries).toHaveBeenCalledWith({ opacity: 0.8 });
  });

  it("tooltip.axisPointer.label formatter returns formatted value for y dimension", () => {
    const ctx = makeMockContext({
      panelSchema: {
        type: "area-stacked",
        config: {
          unit: "default",
          unit_custom: "",
          decimals: 2,
          axis_label_rotate: 0,
          axis_label_truncate_width: 120,
          trellis: { layout: null },
          background: { value: { color: "#FFFFFF" } },
        },
        queries: [{ fields: { y: [{ label: "Value" }], breakdown: [] }, customQuery: false }],
      },
    });
    applyLineAreaScatterBarChart(ctx);
    const formatter = ctx.options.tooltip.axisPointer.label.formatter;
    const result = formatter({ axisDimension: "y", value: 100 });
    // formatUnitValue mock returns String(v ?? "")
    expect(typeof result).toBe("string");
  });

  it("scatter tooltip formatter returns empty string for empty name array", () => {
    const ctx = makeMockContext({
      panelSchema: {
        type: "scatter",
        config: {
          unit: "default",
          unit_custom: "",
          decimals: 2,
          axis_label_rotate: 0,
          axis_label_truncate_width: 120,
          trellis: { layout: null },
          background: { value: { color: "#FFFFFF" } },
        },
        queries: [{ fields: { y: [{ label: "Value" }], breakdown: [] }, customQuery: false }],
      },
      breakDownKeys: [],
    });
    applyLineAreaScatterBarChart(ctx);
    const formatter = ctx.options.tooltip.formatter;
    const result = formatter([]);
    expect(result).toBe("");
  });
});
