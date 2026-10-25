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

import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import { number as echartsNumber } from "echarts";
import { applyPieDonutChart } from "@/utils/dashboard/sql/charts/convertSQLPieDonutChart";

vi.mock("@/utils/dashboard/convertDataIntoUnitValue", () => ({
  formatUnitValue: vi.fn((v) => String(v ?? "")),
  getUnitValue: vi.fn((v) => v),
}));

vi.mock("@/utils/dashboard/colorPalette", () => ({
  getSeriesColor: vi.fn(() => "#FF5733"),
}));

vi.mock("@/utils/dashboard/legendConfiguration", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/dashboard/legendConfiguration")>()),
  getChartDimensions: vi.fn(() => ({ chartWidth: 800, chartHeight: 400 })),
  applyPieDonutChartAlignment: vi.fn(),
  applyPieDonutCenterAdjustment: vi.fn(),
  calculatePieChartContainer: vi.fn(() => ({
    left: "15%",
    right: "15%",
    top: "15%",
    bottom: "15%",
  })),
}));

function makeMockContext(overrides: Partial<any> = {}): any {
  return {
    options: {
      xAxis: [{ data: ["Jan", "Feb", "Mar"] }],
      yAxis: [{ data: [] }],
      series: [],
      tooltip: {},
      grid: {},
    },
    panelSchema: {
      type: "pie",
      config: { unit: "default", unit_custom: "", decimals: 2, color: { mode: "fixed" } },
      queries: [{ fields: { y: [{ label: "Value" }] } }],
    },
    store: {
      state: { theme: "light" },
    },
    chartPanelRef: { value: { offsetWidth: 800, offsetHeight: 400 } },
    hoveredSeriesState: { value: null },
    yAxisKeys: ["y1"],
    chartMin: 0,
    chartMax: 100,
    defaultSeriesProps: { type: "pie" },
    getAxisDataFromKey: vi.fn((key: string) => {
      if (key === "y1") return [100, 200, 300];
      return [];
    }),
    getPieChartRadius: vi.fn(() => 50),
    ...overrides,
  };
}

describe("applyPieDonutChart - pie type", () => {
  it("pie: sets series array", () => {
    const ctx = makeMockContext();
    applyPieDonutChart(ctx);
    expect(Array.isArray(ctx.options.series)).toBe(true);
    expect(ctx.options.series.length).toBeGreaterThan(0);
  });

  it("pie: clears xAxis to empty array", () => {
    const ctx = makeMockContext();
    applyPieDonutChart(ctx);
    expect(ctx.options.xAxis).toEqual([]);
  });

  it("pie: clears yAxis to empty array", () => {
    const ctx = makeMockContext();
    applyPieDonutChart(ctx);
    expect(ctx.options.yAxis).toEqual([]);
  });

  it("pie: series data maps values with xAxis labels as names", () => {
    const ctx = makeMockContext();
    applyPieDonutChart(ctx);
    // getAxisDataFromKey("y1") => [100, 200, 300]; xAxis[0].data => ["Jan","Feb","Mar"]
    expect(ctx.options.series[0].data[0].value).toBe(100);
    expect(ctx.options.series[0].data[0].name).toBe("Jan");
  });

  it("pie: sets grid with containLabel", () => {
    const ctx = makeMockContext();
    applyPieDonutChart(ctx);
    expect(ctx.options.grid.containLabel).toBe(true);
  });

  it("pie: tooltip trigger is item", () => {
    const ctx = makeMockContext();
    applyPieDonutChart(ctx);
    expect(ctx.options.tooltip.trigger).toBe("item");
  });

  it("pie: sets radius on first series", () => {
    const ctx = makeMockContext();
    applyPieDonutChart(ctx);
    // getPieChartRadius returns 50, so radius should be "50%"
    expect(ctx.options.series[0].radius).toBeDefined();
    expect(ctx.options.series[0].radius).toBe("50%");
  });
});

describe("applyPieDonutChart - donut type", () => {
  it("donut: sets series array", () => {
    const ctx = makeMockContext({
      panelSchema: {
        type: "donut",
        config: { unit: "default", unit_custom: "", decimals: 2, color: { mode: "fixed" } },
        queries: [{ fields: { y: [{ label: "Value" }] } }],
      },
    });
    applyPieDonutChart(ctx);
    expect(Array.isArray(ctx.options.series)).toBe(true);
    expect(ctx.options.series.length).toBeGreaterThan(0);
  });

  it("donut: clears xAxis", () => {
    const ctx = makeMockContext({
      panelSchema: {
        type: "donut",
        config: { unit: "default", unit_custom: "", decimals: 2, color: { mode: "fixed" } },
        queries: [{ fields: { y: [{ label: "Value" }] } }],
      },
    });
    applyPieDonutChart(ctx);
    expect(ctx.options.xAxis).toEqual([]);
  });

  it("donut: clears yAxis", () => {
    const ctx = makeMockContext({
      panelSchema: {
        type: "donut",
        config: { unit: "default", unit_custom: "", decimals: 2, color: { mode: "fixed" } },
        queries: [{ fields: { y: [{ label: "Value" }] } }],
      },
    });
    applyPieDonutChart(ctx);
    expect(ctx.options.yAxis).toEqual([]);
  });

  it("donut: sets radius as array [inner, outer]", () => {
    const ctx = makeMockContext({
      panelSchema: {
        type: "donut",
        config: { unit: "default", unit_custom: "", decimals: 2, color: { mode: "fixed" } },
        queries: [{ fields: { y: [{ label: "Value" }] } }],
      },
    });
    applyPieDonutChart(ctx);
    // getPieChartRadius returns 50 (outerRadius), so radius should be array ["20%", "50%"]
    // innterRadius = Math.max(50 - 30, 20) = 20
    const radius = ctx.options.series[0].radius;
    expect(Array.isArray(radius)).toBe(true);
    expect(radius).toHaveLength(2);
    // Both entries should be strings ending in "%"
    expect(typeof radius[0]).toBe("string");
    expect(typeof radius[1]).toBe("string");
  });
});

describe.each(["pie", "donut"])("applyPieDonutChart - %s slice percent precision", (type) => {
  const contextWithDecimals = (decimals: unknown, values = [100, 200, 300]) =>
    makeMockContext({
      options: {
        xAxis: [{ data: values.map((_, i) => `slice-${i}`) }],
        yAxis: [{ data: [] }],
        series: [],
        tooltip: {},
        grid: {},
      },
      getAxisDataFromKey: vi.fn(() => values),
      panelSchema: {
        type,
        config: { unit: "default", unit_custom: "", decimals, color: { mode: "fixed" } },
        queries: [{ fields: { y: [{ label: "Value" }] } }],
      },
    });

  it.each([4, 13])("uses panel decimals %i as the label precision", (decimals) => {
    const ctx = contextWithDecimals(decimals);
    applyPieDonutChart(ctx);
    expect(ctx.options.series[0].percentPrecision).toBe(decimals);
  });

  it.each([undefined, null])(
    "defaults the label precision to 2 when decimals is %s",
    (decimals) => {
      const ctx = contextWithDecimals(decimals);
      applyPieDonutChart(ctx);
      expect(ctx.options.series[0].percentPrecision).toBe(2);
    },
  );

  // ECharts' percent rounding never ends on these values at precision 14.
  const loopingValues = [3, 5, 7, 11, 13, 17, 19];

  it.each([14, 20, 100])("caps decimals %i at 13 so the percent rounding ends", (decimals) => {
    const ctx = contextWithDecimals(decimals, loopingValues);
    applyPieDonutChart(ctx);
    const precision = ctx.options.series[0].percentPrecision;
    expect(precision).toBe(13);
    const values = ctx.options.series[0].data.map((item: any) => item.value);
    expect(echartsNumber.getPercentWithPrecision(values, 0, precision)).toBeCloseTo(4, 10);
  });
});

const echartsEntry = createRequire(import.meta.url).resolve("echarts");

// Renders in a worker: ECharts' percent rounding is synchronous, so only a worker can stop a run that never ends.
const renderPieLabels = (series: any, ms: number) =>
  new Promise<string[] | "timeout">((resolve, reject) => {
    const worker = new Worker(
      `const { parentPort, workerData } = require("node:worker_threads");
      const echarts = require(workerData.entry);
      const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width: 400, height: 300 });
      chart.setOption({ animation: false, series: [workerData.series] });
      const labels = chart.renderToSVGString().match(/>[^<]*%</g) || [];
      chart.dispose();
      parentPort.postMessage(labels.map((label) => label.slice(1, -1)));`,
      { eval: true, workerData: { entry: echartsEntry, series } },
    );
    const timer = setTimeout(() => {
      void worker.terminate();
      resolve("timeout");
    }, ms);
    worker.once("message", (labels) => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(labels);
    });
    worker.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

describe.each(["pie", "donut"])(
  "applyPieDonutChart - %s near-cancelling negative slices",
  (type) => {
    // ECharts' percent rounding on these raw values never ends at precision 13; its pie drops negative slices first.
    const nearCancelling = [1e15, -999999999999999];

    it("renders at decimals 13 with the real values, labelling the positive slice 100%", async () => {
      const ctx = makeMockContext({
        options: {
          xAxis: [{ data: ["gain", "loss"] }],
          yAxis: [{ data: [] }],
          series: [],
          tooltip: {},
          grid: {},
        },
        getAxisDataFromKey: vi.fn(() => nearCancelling),
        panelSchema: {
          type,
          config: { unit: "default", unit_custom: "", decimals: 13, color: { mode: "fixed" } },
          queries: [{ fields: { y: [{ label: "Value" }] } }],
        },
      });
      applyPieDonutChart(ctx);
      const { data, percentPrecision, label, radius } = ctx.options.series[0];
      expect(data.map((item: any) => item.value)).toEqual(nearCancelling);
      expect(percentPrecision).toBe(13);
      const labels = await renderPieLabels(
        { type: "pie", data, percentPrecision, label, radius },
        5000,
      );
      expect(labels).toEqual(["100%"]);
    }, 10000);
  },
);
