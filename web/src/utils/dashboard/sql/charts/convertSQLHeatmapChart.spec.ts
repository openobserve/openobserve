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
          fields: { x: [], y: [{ label: "Value" }] },
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
