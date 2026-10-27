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
import { applyHeatmapChart } from "@/utils/dashboard/sql/charts/convertSQLHeatmapChart";

vi.mock("date-fns-tz", () => ({
  toZonedTime: vi.fn((v) => v),
}));

vi.mock("@/utils/dashboard/convertDataIntoUnitValue", () => ({
  formatUnitValue: vi.fn((v) => String(v ?? "")),
  getUnitValue: vi.fn((v) => v),
}));

vi.mock("@/utils/dashboard/dateTimeUtils", () => ({
  formatDate: vi.fn(() => "2024-01-15 10:00:00"),
  isTimeSeries: vi.fn(() => false),
}));

vi.mock("@/utils/dashboard/aliasUtils", () => ({
  getDataValue: vi.fn((obj: any, key: string) => obj?.[key]),
}));

function makeMockContext(overrides: Partial<any> = {}): any {
  const rawData = [
    { x: "A", y: "cat1", z: 10 },
    { x: "B", y: "cat1", z: 20 },
    { x: "A", y: "cat2", z: 30 },
    { x: "B", y: "cat2", z: 40 },
  ];
  return {
    options: {
      xAxis: [{ data: [] }],
      yAxis: { data: [] },
      series: [],
      tooltip: {},
      grid: {},
      legend: { show: true },
    },
    panelSchema: {
      type: "heatmap",
      config: { unit: "default", unit_custom: "", decimals: 2 },
      queries: [
        {
          customQuery: true,
          fields: {
            x: [],
            y: [{ label: "Value" }],
            z: [{ label: "Value", alias: "z" }],
          },
        },
      ],
    },
    store: {
      state: {
        theme: "light",
        zoConfig: { timestamp_column: "_timestamp" },
        timezone: "UTC",
      },
    },
    searchQueryData: [rawData],
    xAxisKeys: ["x"],
    yAxisKeys: ["y"],
    zAxisKeys: ["z"],
    hoveredSeriesState: { value: null },
    defaultSeriesProps: { type: "heatmap" },
    ...overrides,
  };
}

describe("applyHeatmapChart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets visualMap on options", () => {
    const ctx = makeMockContext();
    applyHeatmapChart(ctx);
    expect(ctx.options.visualMap).toBeDefined();
  });

  it("sets visualMap.min to 0", () => {
    const ctx = makeMockContext();
    applyHeatmapChart(ctx);
    expect(ctx.options.visualMap.min).toBe(0);
  });

  it("sets visualMap.max from data", () => {
    const ctx = makeMockContext();
    applyHeatmapChart(ctx);
    expect(ctx.options.visualMap.max).toBeGreaterThanOrEqual(40);
  });

  it("sets series array with one element", () => {
    const ctx = makeMockContext();
    applyHeatmapChart(ctx);
    expect(ctx.options.series.length).toBe(1);
  });

  it("series data is flattened matrix", () => {
    const ctx = makeMockContext();
    applyHeatmapChart(ctx);
    expect(Array.isArray(ctx.options.series[0].data)).toBe(true);
  });

  it("sets xAxis as category with unique x values", () => {
    const ctx = makeMockContext();
    applyHeatmapChart(ctx);
    expect(ctx.options.xAxis[0].type).toBe("category");
    expect(ctx.options.xAxis[0].data).toContain("A");
    expect(ctx.options.xAxis[0].data).toContain("B");
  });

  it("sets yAxis with unique y values", () => {
    const ctx = makeMockContext();
    applyHeatmapChart(ctx);
    expect(ctx.options.yAxis.data).toContain("cat1");
    expect(ctx.options.yAxis.data).toContain("cat2");
  });

  it("hides legend", () => {
    const ctx = makeMockContext();
    applyHeatmapChart(ctx);
    expect(ctx.options.legend.show).toBe(false);
  });

  it("sets grid bottom to 60", () => {
    const ctx = makeMockContext();
    applyHeatmapChart(ctx);
    expect(ctx.options.grid.bottom).toBe(60);
  });

  it("tooltip position is top", () => {
    const ctx = makeMockContext();
    applyHeatmapChart(ctx);
    expect(ctx.options.tooltip.position).toBe("top");
  });
});

describe("applyHeatmapChart pinned colour range", () => {
  const withConfig = (config: Record<string, any>) => {
    const ctx = makeMockContext();
    ctx.panelSchema.config = { ...ctx.panelSchema.config, ...config };
    applyHeatmapChart(ctx);
    return ctx.options;
  };

  it("keeps the automatic [0, max] range when nothing is pinned", () => {
    const { visualMap } = withConfig({ heatmap_color_min: null, heatmap_color_max: null });
    expect(visualMap.min).toBe(0);
    expect(visualMap.max).toBe(40);
  });

  it("pins only the min", () => {
    const { visualMap } = withConfig({ heatmap_color_min: 15 });
    expect([visualMap.min, visualMap.max]).toEqual([15, 40]);
  });

  it("pins only the max", () => {
    const { visualMap } = withConfig({ heatmap_color_max: 25 });
    expect([visualMap.min, visualMap.max]).toEqual([0, 25]);
  });

  it("pins both ends", () => {
    const { visualMap } = withConfig({ heatmap_color_min: 15, heatmap_color_max: 25 });
    expect([visualMap.min, visualMap.max]).toEqual([15, 25]);
  });

  it("ignores an inverted pair and uses the automatic range", () => {
    const { visualMap } = withConfig({ heatmap_color_min: 25, heatmap_color_max: 15 });
    expect([visualMap.min, visualMap.max]).toEqual([0, 40]);
  });

  it("keeps real values in the cells, tooltip and label when a cell exceeds the max", () => {
    const options = withConfig({ heatmap_color_max: 25 });
    const above = options.series[0].data.find((cell: any) => cell[2] === 40);
    expect(above).toEqual([1, 1, 40]);

    const params = { value: above, name: "B", marker: "", seriesName: "Value" };
    expect(options.tooltip.formatter(params)).toContain(": 40");
    expect(options.series[0].label.formatter(params)).toBe("40");
  });
});

describe("applyHeatmapChart palette and colour scale", () => {
  const withConfig = (config: Record<string, any>) => {
    const ctx = makeMockContext();
    ctx.panelSchema.config = { ...ctx.panelSchema.config, ...config };
    applyHeatmapChart(ctx);
    return ctx.options.visualMap;
  };

  it("uses the chosen palette, reversed on request", () => {
    expect(withConfig({ heatmap_palette: "magma" }).inRange.color[0]).toBe("#000004");
    const reversed = withConfig({ heatmap_palette: "magma", heatmap_palette_reverse: true });
    expect(reversed.inRange.color[0]).toBe("#fcfdbf");
  });

  it("keeps the square-root Spectral ramp by default", () => {
    const { inRange } = withConfig({});
    expect(inRange.color[0]).toBe("#5e4fa2");
    expect(inRange.color[1]).toBe("#50aaaf");
  });

  it("starts a log scale at the smallest positive cell", () => {
    const visualMap = withConfig({ heatmap_color_scale: "log" });
    expect(visualMap.min).toBe(10);
    expect(visualMap.max).toBe(40);
    expect(visualMap.inRange.color[1]).not.toBe(withConfig({}).inRange.color[1]);
  });
});

describe("applyHeatmapChart cell values and categories", () => {
  const render = (rows: any[], overrides: Partial<any> = {}) => {
    const ctx = makeMockContext({ searchQueryData: [rows], extras: {}, ...overrides });
    applyHeatmapChart(ctx);
    return ctx;
  };
  const cellAt = (ctx: any, x: number, y: number) =>
    ctx.options.series[0].data.find((cell: any) => cell[0] === x && cell[1] === y)?.[2];

  it("draws a real z of 0 as 0 and only a missing pair or empty z as '-'", () => {
    const ctx = render([
      { x: "A", y: "r1", z: 0 },
      { x: "B", y: "r1", z: null },
      { x: "C", y: "r1", z: "" },
      { x: "A", y: "r2", z: 5 },
    ]);
    expect(cellAt(ctx, 0, 0)).toBe(0);
    expect(cellAt(ctx, 1, 0)).toBe("-");
    expect(cellAt(ctx, 2, 0)).toBe("-");
    expect(cellAt(ctx, 1, 1)).toBe("-");
  });

  it("keeps 0 and empty-string categories, labels the empty one, and drops null", () => {
    const ctx = render([
      { x: 0, y: "", z: 1 },
      { x: "", y: 0, z: 2 },
      { x: null, y: "r", z: 3 },
      { x: "A", y: undefined, z: 4 },
    ]);
    expect(ctx.options.xAxis[0].data).toEqual([0, "(empty)", "A"]);
    expect(ctx.options.yAxis.data).toEqual(["(empty)", 0, "r"]);
    expect(cellAt(ctx, 0, 0)).toBe(1);
    expect(cellAt(ctx, 1, 1)).toBe(2);
  });

  it("shows a 0 y category in the tooltip instead of the series name", () => {
    const ctx = render([{ x: "A", y: 0, z: 7 }]);
    const params = { value: [0, 0, 7], name: "A", marker: "", seriesName: "Value" };
    expect(ctx.options.tooltip.formatter(params)).toContain("0 <br/>");
    expect(ctx.options.tooltip.formatter(params)).not.toContain("Value");
  });

  it("does not collide values that contain the old key separator", () => {
    const ctx = render([
      { x: "a||b", y: "c", z: 1 },
      { x: "b", y: "c||a", z: 2 },
    ]);
    expect(cellAt(ctx, 0, 0)).toBe(1);
    expect(cellAt(ctx, 1, 1)).toBe(2);
    expect(cellAt(ctx, 1, 0)).toBe("-");
    expect(ctx.extras.limitNumberOfSeriesWarningMessage).toBeUndefined();
  });

  it("keeps the first of duplicate (x, y) rows and warns about them", () => {
    const ctx = render([
      { x: "A", y: "r", z: 1 },
      { x: "A", y: "r", z: 9 },
      { x: "A", y: "r", z: 8 },
    ]);
    expect(cellAt(ctx, 0, 0)).toBe(1);
    expect(ctx.extras.limitNumberOfSeriesWarningMessage).toBe(
      "Duplicate (x, y) rows found: 2; each affected cell shows the first row's value",
    );
  });

  it("colours all-negative data over its own range instead of [0, max]", () => {
    const ctx = render([
      { x: "A", y: "r", z: -30 },
      { x: "B", y: "r", z: -5 },
    ]);
    expect([ctx.options.visualMap.min, ctx.options.visualMap.max]).toEqual([-30, -5]);
  });
});

describe("applyHeatmapChart axis border", () => {
  const axisLines = (axisBorderShow: unknown) => {
    const ctx = makeMockContext();
    ctx.panelSchema.config.axis_border_show = axisBorderShow;
    applyHeatmapChart(ctx);
    return [ctx.options.xAxis[0].axisLine, ctx.options.yAxis.axisLine];
  };

  it("keeps the ECharts default axis lines whatever the stored toggle, so saved panels look unchanged", () => {
    expect(axisLines(true)).toEqual([undefined, undefined]);
    expect(axisLines(false)).toEqual([undefined, undefined]);
    expect(axisLines(undefined)).toEqual([undefined, undefined]);
  });
});

describe("applyHeatmapChart cell budget", () => {
  it("keeps every column and the largest rows when rows overflow the budget", () => {
    const rows = Array.from({ length: 25_001 }, (_unused, i) => [
      { x: "A", y: `r${i}`, z: i },
      { x: "B", y: `r${i}`, z: i },
    ]).flat();
    const ctx = makeMockContext({ searchQueryData: [rows], extras: {} });
    applyHeatmapChart(ctx);

    expect(ctx.options.xAxis[0].data).toEqual(["A", "B"]);
    expect(ctx.options.yAxis.data).toHaveLength(25_000);
    expect(ctx.options.yAxis.data[0]).toBe("r1");
    expect(ctx.options.series[0].data).toHaveLength(50_000);
    expect(ctx.extras.limitNumberOfSeriesWarningMessage).toBe(
      "Showing 25,000 of 25,001 rows to stay within the heatmap cell limit",
    );
  });

  it("keeps the last columns and the largest row when columns alone overflow it", () => {
    const rows = Array.from({ length: 50_002 }, (_unused, i) => [
      { x: `c${i}`, y: "small", z: 1 },
      { x: `c${i}`, y: "big", z: 2 },
    ]).flat();
    const ctx = makeMockContext({ searchQueryData: [rows], extras: {} });
    applyHeatmapChart(ctx);

    expect(ctx.options.xAxis[0].data).toHaveLength(50_000);
    expect(ctx.options.xAxis[0].data[0]).toBe("c2");
    expect(ctx.options.yAxis.data).toEqual(["big"]);
    expect(ctx.options.series[0].data).toHaveLength(50_000);
  });

  it("ranks rows by magnitude, so all-negative data keeps its strongest rows", () => {
    const rows = Array.from({ length: 25_001 }, (_unused, i) => [
      { x: "A", y: `r${i}`, z: i === 0 ? -1 : -100 },
      { x: "B", y: `r${i}`, z: i === 0 ? -1 : -100 },
    ]).flat();
    const ctx = makeMockContext({ searchQueryData: [rows], extras: {} });
    applyHeatmapChart(ctx);

    expect(ctx.options.yAxis.data).toHaveLength(25_000);
    expect(ctx.options.yAxis.data).not.toContain("r0");
  });

  it("uses the smaller budget a multi-query panel hands each tile", () => {
    const rows = Array.from({ length: 101 }, (_unused, i) => [
      { x: "A", y: `r${i}`, z: i },
      { x: "B", y: `r${i}`, z: i },
    ]).flat();
    const ctx = makeMockContext({ searchQueryData: [rows], extras: {} });
    ctx.panelSchema.heatmapCellBudget = 200;
    applyHeatmapChart(ctx);

    expect(ctx.options.series[0].data).toHaveLength(200);
    expect(ctx.options.yAxis.data[0]).toBe("r1");
  });
});

describe("applyHeatmapChart histogram time axis", () => {
  const histogramContext = (rows: any[], startIso: string, endIso: string, interval = 60) =>
    makeMockContext({
      searchQueryData: [rows],
      extras: {},
      resultMetaData: [{ histogram_interval: interval }],
      metadata: {
        queries: [{ startTime: Date.parse(startIso) * 1000, endTime: Date.parse(endIso) * 1000 }],
      },
      panelSchema: {
        type: "heatmap",
        config: {},
        queries: [
          {
            customQuery: false,
            fields: {
              x: [
                {
                  alias: "x",
                  functionName: "histogram",
                  args: [{ value: { field: "_timestamp" } }],
                },
              ],
              y: [{ alias: "y" }],
              z: [{ alias: "z" }],
            },
          },
        ],
      },
    });

  it("sorts buckets by time and adds an empty column for every missing bucket in the range", () => {
    const ctx = histogramContext(
      [
        { x: "2024-01-15T10:03:00", y: "r", z: 3 },
        { x: "2024-01-15T10:00:00", y: "r", z: 1 },
      ],
      "2024-01-15T10:00:30Z",
      "2024-01-15T10:04:30Z",
    );
    applyHeatmapChart(ctx);

    expect(ctx.options.xAxis[0].data).toHaveLength(5);
    expect(ctx.options.series[0].data.map((cell: any) => cell[2])).toEqual([1, "-", "-", 3, "-"]);
  });

  it("keeps the returned order without a server interval", () => {
    const ctx = histogramContext(
      [
        { x: "2024-01-15T10:03:00", y: "r", z: 3 },
        { x: "2024-01-15T10:00:00", y: "r", z: 1 },
      ],
      "2024-01-15T10:00:00Z",
      "2024-01-15T10:04:00Z",
      0,
    );
    applyHeatmapChart(ctx);

    expect(ctx.options.series[0].data.map((cell: any) => cell[2])).toEqual([3, 1]);
  });

  it("generates no more columns than the cell budget for a fine interval over a long range", () => {
    const ctx = histogramContext(
      [{ x: "2024-01-15T10:00:00", y: "r", z: 1 }],
      "2024-01-01T00:00:00Z",
      "2024-01-31T00:00:00Z",
      1,
    );
    applyHeatmapChart(ctx);

    expect(ctx.options.xAxis[0].data).toHaveLength(50_000);
    // The window ends at the newest returned bucket, so data early in the range is still drawn.
    expect(ctx.extras.heatmapTimeAxis.columns.at(-1).x).toBe(Date.parse("2024-01-15T10:00:00Z"));
    expect(ctx.options.series[0].data.at(-1)[2]).toBe(1);
  });

  it("ends the window at the range end when data reaches it", () => {
    const ctx = histogramContext(
      [
        { x: "2024-01-15T10:00:00", y: "r", z: 1 },
        { x: "2024-01-31T00:00:00", y: "r", z: 2 },
      ],
      "2024-01-01T00:00:00Z",
      "2024-01-31T00:00:00Z",
      1,
    );
    applyHeatmapChart(ctx);

    expect(ctx.options.xAxis[0].data).toHaveLength(50_000);
    expect(ctx.extras.heatmapTimeAxis.columns.at(-1).x).toBe(Date.parse("2024-01-31T00:00:00Z"));
  });
});

describe("applyHeatmapChart y-axis order and buckets", () => {
  const plainY = {
    alias: "y",
    functionName: null,
    args: [{ type: "field", value: { field: "age" } }],
  };
  const contextOf = (rows: any[], config: Record<string, unknown>, customQuery: boolean) =>
    makeMockContext({
      searchQueryData: [rows],
      panelSchema: {
        type: "heatmap",
        config,
        queries: [{ customQuery, fields: { x: [], y: [plainY], z: [{ alias: "z" }] } }],
      },
    });
  const rowsOf = (ys: any[]) => ys.map((y, index) => ({ x: "A", y, z: index + 1 }));
  const zByLabel = (ctx: any) =>
    Object.fromEntries(
      ctx.options.series[0].data.map(([, row, z]: any[]) => [ctx.options.yAxis.data[row], z]),
    );

  it("keeps data order when heatmap_y_sort is unset", () => {
    const ctx = contextOf(rowsOf(["b", "c", "a"]), {}, true);
    applyHeatmapChart(ctx);
    expect(ctx.options.yAxis.data).toEqual(["b", "c", "a"]);
  });

  it("puts the smallest value at index 0, the bottom of the axis, for ascending", () => {
    const ctx = contextOf(rowsOf(["10", "9", "100"]), { heatmap_y_sort: "asc" }, true);
    applyHeatmapChart(ctx);
    expect(ctx.options.yAxis.data).toEqual(["9", "10", "100"]);
    expect(zByLabel(ctx)).toEqual({ "10": 1, "9": 2, "100": 3 });
  });

  it("sorts text descending with a locale compare", () => {
    const ctx = contextOf(rowsOf(["b", "c", "a"]), { heatmap_y_sort: "desc" }, true);
    applyHeatmapChart(ctx);
    expect(ctx.options.yAxis.data).toEqual(["c", "b", "a"]);
  });

  it("labels builder buckets with their range in ascending numeric order", () => {
    const ctx = contextOf(
      rowsOf([20, 0, 10]),
      { heatmap_y_bucket: { mode: "size", size: 10 } },
      false,
    );
    applyHeatmapChart(ctx);
    expect(ctx.options.yAxis.data).toEqual(["0–10", "10–20", "20–30"]);
    expect(zByLabel(ctx)).toEqual({ "20–30": 1, "0–10": 2, "10–20": 3 });
  });

  it("reverses buckets for descending", () => {
    const ctx = contextOf(
      rowsOf([20, 0, 10]),
      { heatmap_y_bucket: { mode: "size", size: 10 }, heatmap_y_sort: "desc" },
      false,
    );
    applyHeatmapChart(ctx);
    expect(ctx.options.yAxis.data).toEqual(["20–30", "10–20", "0–10"]);
  });

  it("labels log buckets and the <= 0 bucket", () => {
    const ctx = contextOf(rowsOf([100, 0, 1]), { heatmap_y_bucket: { mode: "log" } }, false);
    applyHeatmapChart(ctx);
    expect(ctx.options.yAxis.data).toEqual(["≤ 0", "1–10", "10–100", "100–1000"]);
  });

  it("fills empty buckets between returned ones so adjacent rows are adjacent ranges", () => {
    const ctx = contextOf(rowsOf([90, 0]), { heatmap_y_bucket: { mode: "size", size: 10 } }, false);
    applyHeatmapChart(ctx);
    expect(ctx.options.yAxis.data).toEqual([
      "0–10",
      "10–20",
      "20–30",
      "30–40",
      "40–50",
      "50–60",
      "60–70",
      "70–80",
      "80–90",
      "90–100",
    ]);
    expect(zByLabel(ctx)).toMatchObject({ "0–10": 2, "50–60": "-", "90–100": 1 });
  });

  it("keeps one unbroken run of buckets when the cell budget cuts rows", () => {
    const ctx = makeMockContext({
      searchQueryData: [
        [
          { x: "A", y: 0, z: 1 },
          { x: "A", y: 10, z: 1 },
          { x: "A", y: 20, z: 50 },
          { x: "A", y: 30, z: 1 },
          { x: "A", y: 40, z: 40 },
          { x: "A", y: 50, z: 40 },
        ],
      ],
      panelSchema: {
        type: "heatmap",
        config: { heatmap_y_bucket: { mode: "size", size: 10 } },
        heatmapCellBudget: 2,
        queries: [{ customQuery: false, fields: { x: [], y: [plainY], z: [{ alias: "z" }] } }],
      },
    });
    applyHeatmapChart(ctx);
    expect(ctx.options.yAxis.data).toEqual(["40–50", "50–60"]);
  });

  it("hands drilldowns the raw row values, not their range or empty labels", () => {
    const bucketed = contextOf(
      rowsOf([20, 0]),
      { heatmap_y_bucket: { mode: "size", size: 10 } },
      false,
    );
    bucketed.extras = {};
    applyHeatmapChart(bucketed);
    expect(bucketed.extras.heatmapRowValues).toEqual([[0, 10, 20]]);
    const empty = contextOf(rowsOf(["", "api"]), {}, true);
    empty.extras = {};
    applyHeatmapChart(empty);
    expect(empty.options.yAxis.data[0]).not.toBe("");
    expect(empty.extras.heatmapRowValues).toEqual([["", "api"]]);
  });

  it("drops buckets outside the y range", () => {
    const ctx = contextOf(
      rowsOf([20, 0, 10, 30]),
      { heatmap_y_bucket: { mode: "size", size: 10 }, heatmap_y_min: 5, heatmap_y_max: 15 },
      false,
    );
    applyHeatmapChart(ctx);
    expect(ctx.options.yAxis.data).toEqual(["0–10", "10–20"]);
    expect(ctx.options.series[0].data).toHaveLength(2);
  });

  it("ignores an inverted y range", () => {
    const ctx = contextOf(
      rowsOf([20, 0]),
      { heatmap_y_bucket: { mode: "size", size: 10 }, heatmap_y_min: 15, heatmap_y_max: 5 },
      false,
    );
    applyHeatmapChart(ctx);
    expect(ctx.options.yAxis.data).toEqual(["0–10", "10–20", "20–30"]);
  });

  it("keeps plain categories when a y value is not a bucket lower bound, as an unbucketed stored query returns", () => {
    const sized = contextOf(
      rowsOf([20, 7, 10]),
      { heatmap_y_bucket: { mode: "size", size: 10 } },
      false,
    );
    applyHeatmapChart(sized);
    expect(sized.options.yAxis.data).toEqual([20, 7, 10]);
    const logged = contextOf(rowsOf([100, 50]), { heatmap_y_bucket: { mode: "log" } }, false);
    applyHeatmapChart(logged);
    expect(logged.options.yAxis.data).toEqual([100, 50]);
    const fractional = contextOf(
      rowsOf([0.30000000000000004, 0.1, 0.001]),
      { heatmap_y_bucket: { mode: "size", size: 0.1 } },
      false,
    );
    applyHeatmapChart(fractional);
    expect(fractional.options.yAxis.data).toEqual([0.30000000000000004, 0.1, 0.001]);
  });

  it("accepts float-noisy lower bounds from the generated SQL as buckets", () => {
    const ctx = contextOf(
      rowsOf([0.30000000000000004, 0.1]),
      { heatmap_y_bucket: { mode: "size", size: 0.1 } },
      false,
    );
    applyHeatmapChart(ctx);
    expect(ctx.options.yAxis.data).toEqual(["0.1–0.2", "0.2–0.3", "0.3–0.4"]);
    expect(zByLabel(ctx)).toEqual({ "0.1–0.2": 2, "0.2–0.3": "-", "0.3–0.4": 1 });
    const log = contextOf(rowsOf([0.001, 1000]), { heatmap_y_bucket: { mode: "log" } }, false);
    applyHeatmapChart(log);
    expect(log.options.yAxis.data).toEqual([
      "0.001–0.01",
      "0.01–0.1",
      "0.1–1",
      "1–10",
      "10–100",
      "100–1000",
      "1000–10000",
    ]);
  });

  it("does not treat custom SQL, an aggregated y or text values as buckets", () => {
    const config = { heatmap_y_bucket: { mode: "size", size: 10 } };
    const custom = contextOf(rowsOf([20, 0]), config, true);
    applyHeatmapChart(custom);
    expect(custom.options.yAxis.data).toEqual([20, 0]);

    const text = contextOf(rowsOf(["20", "0"]), config, false);
    applyHeatmapChart(text);
    expect(text.options.yAxis.data).toEqual(["20", "0"]);

    const aggregated = contextOf(rowsOf([20, 0]), config, false);
    aggregated.panelSchema.queries[0].fields.y = [{ ...plainY, functionName: "max" }];
    applyHeatmapChart(aggregated);
    expect(aggregated.options.yAxis.data).toEqual([20, 0]);
  });
});

describe("applyHeatmapChart time columns for zoom and cursor sync", () => {
  const builder = (resultMetaData: any[]) =>
    makeMockContext({
      searchQueryData: [
        [
          { x: "2024-01-15T10:03:00", y: "r", z: 3 },
          { x: "2024-01-15T10:00:00", y: "r", z: 1 },
        ],
      ],
      extras: {},
      resultMetaData,
      metadata: {
        queries: [
          {
            startTime: Date.parse("2024-01-15T10:00:30Z") * 1000,
            endTime: Date.parse("2024-01-15T10:04:30Z") * 1000,
          },
        ],
      },
      panelSchema: {
        type: "heatmap",
        config: {},
        queries: [
          {
            customQuery: false,
            fields: {
              x: [
                {
                  alias: "x",
                  functionName: "histogram",
                  args: [{ value: { field: "_timestamp" } }],
                },
              ],
              y: [{ alias: "y" }],
              z: [{ alias: "z" }],
            },
          },
        ],
      },
    });
  const at = (iso: string) => new Date(iso.replace("Z", "")).getTime();

  it("gives every drawn column its bucket's span, clipped to the query range", () => {
    const ctx = builder([{ histogram_interval: 60 }]);
    applyHeatmapChart(ctx);
    const columns = ctx.extras.heatmapTimeAxis.columns;
    expect(columns).toHaveLength(5);
    expect([columns[0].start, columns[0].end]).toEqual([
      at("2024-01-15T10:00:30Z"),
      at("2024-01-15T10:01:00Z"),
    ]);
    expect([columns[4].start, columns[4].end]).toEqual([
      at("2024-01-15T10:04:00Z"),
      at("2024-01-15T10:04:30Z"),
    ]);
  });

  it("draws the hover cursor on the time axis only, without the tooltip cross", () => {
    const ctx = builder([{ histogram_interval: 60 }]);
    applyHeatmapChart(ctx);
    expect(ctx.options.tooltip.axisPointer).toBeUndefined();
    expect(ctx.options.xAxis[0].axisPointer).toMatchObject({ show: true, triggerTooltip: false });
  });

  it("hides the y pointer label of a categorical heatmap, so only the tooltip names the row", () => {
    const ctx = makeMockContext({ extras: {} });
    applyHeatmapChart(ctx);
    expect(ctx.options.tooltip.axisPointer.type).toBe("cross");
    expect(ctx.options.yAxis.axisPointer).toEqual({ label: { show: false } });
  });

  it("has no time columns without a server interval", () => {
    const ctx = builder([{}]);
    applyHeatmapChart(ctx);
    expect(ctx.extras.heatmapTimeAxis).toBeUndefined();
  });

  it("has no time columns for a categorical x", () => {
    const ctx = makeMockContext({ extras: {} });
    applyHeatmapChart(ctx);
    expect(ctx.extras.heatmapTimeAxis).toBeUndefined();
  });
});
