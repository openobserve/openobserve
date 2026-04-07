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
import { convertSQLChartData } from "@/utils/dashboard/sql/convertSQLChartData";
import { buildSQLContext } from "@/utils/dashboard/sql/shared/contextBuilder";
import {
  applyAutoSQLTimeSeries,
  applyCustomSQLTimeSeries,
} from "@/utils/dashboard/sqlTimeSeriesConverter";
import { applyLineAreaScatterBarChart } from "@/utils/dashboard/sql/charts/convertSQLLineAreaChart";
import { applyHBarChart } from "@/utils/dashboard/sql/charts/convertSQLHBarChart";
import { applyStackedChart } from "@/utils/dashboard/sql/charts/convertSQLStackedChart";
import { applyHStackedChart } from "@/utils/dashboard/sql/charts/convertSQLHStackedChart";
import { applyPieDonutChart } from "@/utils/dashboard/sql/charts/convertSQLPieDonutChart";
import { applyHeatmapChart } from "@/utils/dashboard/sql/charts/convertSQLHeatmapChart";
import { applyMetricChart } from "@/utils/dashboard/sql/charts/convertSQLMetricChart";
import { applyGaugeChart } from "@/utils/dashboard/sql/charts/convertSQLGaugeChart";

vi.mock("@/utils/dashboard/sql/shared/contextBuilder", () => ({
  buildSQLContext: vi.fn(),
}));

vi.mock("@/utils/dashboard/sqlTimeSeriesConverter", () => ({
  applyAutoSQLTimeSeries: vi.fn(() => false),
  applyCustomSQLTimeSeries: vi.fn(() => false),
}));

vi.mock("@/utils/dashboard/query/sqlUtils", () => ({
  isGivenFieldInOrderBy: vi.fn(async () => null),
}));

vi.mock("@/utils/dashboard/legendConfiguration", () => ({
  applyLegendConfiguration: vi.fn(),
}));

vi.mock("@/utils/dashboard/chartColorUtils", () => ({
  applySeriesColorMappings: vi.fn(),
}));

vi.mock("@/utils/dashboard/sql/charts/convertSQLLineAreaChart", () => ({
  applyLineAreaScatterBarChart: vi.fn(),
}));

vi.mock("@/utils/dashboard/sql/charts/convertSQLHBarChart", () => ({
  applyHBarChart: vi.fn(),
}));

vi.mock("@/utils/dashboard/sql/charts/convertSQLStackedChart", () => ({
  applyStackedChart: vi.fn(),
}));

vi.mock("@/utils/dashboard/sql/charts/convertSQLHStackedChart", () => ({
  applyHStackedChart: vi.fn(),
}));

vi.mock("@/utils/dashboard/sql/charts/convertSQLPieDonutChart", () => ({
  applyPieDonutChart: vi.fn(),
}));

vi.mock("@/utils/dashboard/sql/charts/convertSQLHeatmapChart", () => ({
  applyHeatmapChart: vi.fn(),
}));

vi.mock("@/utils/dashboard/sql/charts/convertSQLMetricChart", () => ({
  applyMetricChart: vi.fn(),
}));

vi.mock("@/utils/dashboard/sql/charts/convertSQLGaugeChart", () => ({
  applyGaugeChart: vi.fn(),
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

const makeMinimalCtx = () => ({
  options: {
    xAxis: [{ data: [] }],
    yAxis: [{ data: [] }],
    series: [{ data: [1, 2, 3] }],
    tooltip: {},
    grid: {},
    toolbox: { show: true },
    legend: {},
  },
  extras: {},
  yAxisKeys: ["y1"],
  convertedTimeStampToDataFormat: "",
  getAnnotationMarkLine: vi.fn(() => null),
  getSeriesMarkArea: vi.fn(() => null),
  panelSchema: {
    type: "bar",
    config: { trellis: { layout: null } },
  },
});

const store = {
  state: {
    theme: "light",
    zoConfig: { timestamp_column: "_timestamp" },
  },
};

const chartPanelRef = { value: { offsetWidth: 800, offsetHeight: 400 } };

// metadata with queries array to avoid optional-chaining TypeError in
// the stacked/h-stacked sort-by-y-axis post-processing path
const metadata = { queries: [{ query: "" }] };

/**
 * Helper that calls convertSQLChartData with a given panelSchema type,
 * after setting up buildSQLContext to return a ctx with that type.
 */
async function callWithType(type: string) {
  const ctx = makeMinimalCtx();
  ctx.panelSchema = { ...ctx.panelSchema, type };
  vi.mocked(buildSQLContext).mockReturnValue(ctx as any);

  const panelSchema = { type, config: { trellis: { layout: null } } };
  return convertSQLChartData(
    panelSchema,
    [],
    store,
    chartPanelRef,
    null,
    [],
    metadata,
    {},
    [],
  );
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("convertSQLChartData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset time series mocks to return false by default
    vi.mocked(applyAutoSQLTimeSeries).mockReturnValue(false);
    vi.mocked(applyCustomSQLTimeSeries).mockReturnValue(false);
  });

  it("returns { options: null } when buildSQLContext returns null", async () => {
    vi.mocked(buildSQLContext).mockReturnValue(null as any);
    const panelSchema = { type: "bar", config: { trellis: { layout: null } } };
    const result = await convertSQLChartData(
      panelSchema,
      [],
      store,
      chartPanelRef,
      null,
      [],
      metadata,
      {},
      [],
    );
    expect(result).toEqual({ options: null });
  });

  it("returns options object when buildSQLContext returns context", async () => {
    const result = await callWithType("bar");
    expect(result).toHaveProperty("options");
    expect(result.options).not.toBeNull();
  });

  it("calls applyLineAreaScatterBarChart for bar type", async () => {
    await callWithType("bar");
    expect(applyLineAreaScatterBarChart).toHaveBeenCalledTimes(1);
  });

  it("calls applyLineAreaScatterBarChart for line type", async () => {
    await callWithType("line");
    expect(applyLineAreaScatterBarChart).toHaveBeenCalledTimes(1);
  });

  it("calls applyHBarChart for h-bar type", async () => {
    await callWithType("h-bar");
    expect(applyHBarChart).toHaveBeenCalledTimes(1);
  });

  it("calls applyPieDonutChart for pie type", async () => {
    await callWithType("pie");
    expect(applyPieDonutChart).toHaveBeenCalledTimes(1);
  });

  it("calls applyPieDonutChart for donut type", async () => {
    await callWithType("donut");
    expect(applyPieDonutChart).toHaveBeenCalledTimes(1);
  });

  it("calls applyStackedChart for stacked type", async () => {
    await callWithType("stacked");
    expect(applyStackedChart).toHaveBeenCalledTimes(1);
  });

  it("calls applyHeatmapChart for heatmap type", async () => {
    await callWithType("heatmap");
    expect(applyHeatmapChart).toHaveBeenCalledTimes(1);
  });

  it("calls applyHStackedChart for h-stacked type", async () => {
    await callWithType("h-stacked");
    expect(applyHStackedChart).toHaveBeenCalledTimes(1);
  });

  it("calls applyMetricChart for metric type", async () => {
    const ctx = makeMinimalCtx();
    ctx.panelSchema = { ...ctx.panelSchema, type: "metric" };
    // metric type is excluded from series filter in post-processing
    ctx.options.series = [];
    vi.mocked(buildSQLContext).mockReturnValue(ctx as any);
    const panelSchema = { type: "metric", config: { trellis: { layout: null } } };
    await convertSQLChartData(panelSchema, [], store, chartPanelRef, null, [], metadata, {}, []);
    expect(applyMetricChart).toHaveBeenCalledTimes(1);
  });

  it("calls applyGaugeChart for gauge type", async () => {
    const ctx = makeMinimalCtx();
    ctx.panelSchema = { ...ctx.panelSchema, type: "gauge" };
    ctx.options.series = [];
    vi.mocked(buildSQLContext).mockReturnValue(ctx as any);
    const panelSchema = { type: "gauge", config: { trellis: { layout: null } } };
    await convertSQLChartData(panelSchema, [], store, chartPanelRef, null, [], metadata, {}, []);
    expect(applyGaugeChart).toHaveBeenCalledTimes(1);
  });

  it("calls applyAutoSQLTimeSeries and applyCustomSQLTimeSeries", async () => {
    await callWithType("bar");
    expect(applyAutoSQLTimeSeries).toHaveBeenCalledTimes(1);
    expect(applyCustomSQLTimeSeries).toHaveBeenCalledTimes(1);
  });

  it("extras.isTimeSeries is true when applyAutoSQLTimeSeries returns true", async () => {
    vi.mocked(applyAutoSQLTimeSeries).mockReturnValue(true);
    const result = await callWithType("bar");
    expect((result as any).extras?.isTimeSeries).toBe(true);
  });

  it("extras.isTimeSeries is false when both time series functions return false", async () => {
    vi.mocked(applyAutoSQLTimeSeries).mockReturnValue(false);
    vi.mocked(applyCustomSQLTimeSeries).mockReturnValue(false);
    const result = await callWithType("bar");
    expect((result as any).extras?.isTimeSeries).toBe(false);
  });
});
