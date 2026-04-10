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
import { applyGaugeChart } from "@/utils/dashboard/sql/charts/convertSQLGaugeChart";

vi.mock("@/utils/dashboard/convertDataIntoUnitValue", () => ({
  formatUnitValue: vi.fn((v) => String(v ?? "")),
  getUnitValue: vi.fn((v) => v),
}));

vi.mock("@/utils/dashboard/calculateGridForSubPlot", () => ({
  calculateGridPositions: vi.fn(() => ({
    gridArray: [
      { left: "5%", top: "5%", width: "45%", height: "90%" },
      { left: "55%", top: "5%", width: "45%", height: "90%" },
    ],
    gridWidth: 200,
    gridHeight: 200,
  })),
}));

vi.mock("@/utils/dashboard/colorPalette", () => ({
  getSeriesColor: vi.fn(() => "#FF5733"),
}));

function makeMockContext(overrides: Partial<any> = {}): any {
  return {
    options: {
      xAxis: [{ data: [] }],
      yAxis: [{ data: [] }],
      series: [],
      tooltip: {},
      grid: {},
    },
    panelSchema: {
      type: "gauge",
      config: { unit: "default", unit_custom: "", decimals: 2 },
      queries: [{ config: { min: 0, max: 100 }, fields: { y: [{ label: "Value" }] } }],
    },
    store: {
      state: { theme: "light", zoConfig: { timestamp_column: "_timestamp" } },
    },
    chartPanelRef: { value: { offsetWidth: 800, offsetHeight: 400 } },
    xAxisKeys: ["x1"],
    yAxisKeys: ["y1"],
    chartMin: 0,
    chartMax: 100,
    defaultSeriesProps: { type: "gauge" },
    getAxisDataFromKey: vi.fn((key: string) => {
      if (key === "y1") return [75, 90];
      if (key === "x1") return ["Gauge1", "Gauge2"];
      return [];
    }),
    ...overrides,
  };
}

describe("applyGaugeChart", () => {
  it("sets series with one item per yAxisValue", () => {
    const ctx = makeMockContext();
    applyGaugeChart(ctx);
    // getAxisDataFromKey("y1") returns [75, 90] => 2 series items
    expect(ctx.options.series.length).toBe(2);
  });

  it("clears xAxis to empty array", () => {
    const ctx = makeMockContext();
    applyGaugeChart(ctx);
    expect(ctx.options.xAxis).toEqual([]);
  });

  it("clears yAxis to empty array", () => {
    const ctx = makeMockContext();
    applyGaugeChart(ctx);
    expect(ctx.options.yAxis).toEqual([]);
  });

  it("sets dataset", () => {
    const ctx = makeMockContext();
    applyGaugeChart(ctx);
    expect(ctx.options.dataset).toBeDefined();
    expect(ctx.options.dataset).toEqual({ source: [[]] });
  });

  it("sets polar", () => {
    const ctx = makeMockContext();
    applyGaugeChart(ctx);
    expect(ctx.options.polar).toBeDefined();
    expect(ctx.options.polar).toEqual({});
  });

  it("sets angleAxis with show:false", () => {
    const ctx = makeMockContext();
    applyGaugeChart(ctx);
    expect(ctx.options.angleAxis).toBeDefined();
    expect(ctx.options.angleAxis.show).toBe(false);
  });

  it("sets radiusAxis with show:false", () => {
    const ctx = makeMockContext();
    applyGaugeChart(ctx);
    expect(ctx.options.radiusAxis).toBeDefined();
    expect(ctx.options.radiusAxis.show).toBe(false);
  });

  it("tooltip trigger is item", () => {
    const ctx = makeMockContext();
    applyGaugeChart(ctx);
    expect(ctx.options.tooltip.trigger).toBe("item");
  });

  it("uses grid from calculateGridPositions", () => {
    const ctx = makeMockContext();
    applyGaugeChart(ctx);
    // calculateGridPositions mock returns gridArray with two elements (one per gauge)
    expect(Array.isArray(ctx.options.grid)).toBe(true);
    expect(ctx.options.grid[0]).toMatchObject({
      left: "5%",
      top: "5%",
      width: "45%",
      height: "90%",
    });
    expect(ctx.options.grid[1]).toMatchObject({
      left: "55%",
      top: "5%",
      width: "45%",
      height: "90%",
    });
  });

  it("series data values come from yAxisValue", () => {
    const ctx = makeMockContext();
    applyGaugeChart(ctx);
    // First series item should have value 75 (first element of getAxisDataFromKey("y1"))
    expect(ctx.options.series[0].data[0].value).toBe(75);
  });

  it("uses min/max from panelSchema config", () => {
    const ctx = makeMockContext();
    applyGaugeChart(ctx);
    expect(ctx.options.series[0].min).toBe(0);
    expect(ctx.options.series[0].max).toBe(100);
  });

  it("uses custom min/max when provided", () => {
    const ctx = makeMockContext({
      panelSchema: {
        type: "gauge",
        config: { unit: "default", unit_custom: "", decimals: 2 },
        queries: [{ config: { min: 10, max: 500 }, fields: { y: [{ label: "Value" }] } }],
      },
    });
    applyGaugeChart(ctx);
    expect(ctx.options.series[0].min).toBe(10);
    expect(ctx.options.series[0].max).toBe(500);
  });
});
