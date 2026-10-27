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
import { convertPanelData } from "./convertPanelData";
import {
  bucketCounts,
  DISTRIBUTION_DEFAULT_BUCKETS,
  distributionBuckets,
  niceBucketSize,
} from "./convertDistributionData";

vi.mock("./convertCustomChartData", () => ({
  runJavaScriptCode: vi.fn(),
  validateUserCode: vi.fn(() => null),
}));

const store = {
  state: {
    theme: "light",
    timezone: "UTC",
    zoConfig: { timestamp_column: "_timestamp", max_dashboard_series: 1000 },
    selectedOrganization: { identifier: "default" },
  },
};

const field = (alias: string, label: string, functionName: string | null = null) => ({
  label,
  alias,
  column: alias,
  functionName,
  args: [{ type: "field", value: { field: alias } }],
});

const panel = (type: string, fields: any, config: Record<string, any> = {}) => ({
  id: "p",
  type,
  queryType: "sql",
  queries: [
    {
      query: "SELECT 1",
      customQuery: false,
      fields: {
        stream: "demo_app",
        stream_type: "logs",
        x: [],
        y: [],
        z: [],
        breakdown: [],
        ...fields,
      },
      config: {},
    },
  ],
  config: { show_legends: true, unit: "default", decimals: 0, ...config },
});

const viaPanel = async (schema: any, data: any[]) =>
  (await convertPanelData(
    schema,
    data,
    store,
    { value: { offsetWidth: 800, offsetHeight: 400 } },
    { value: null },
    { value: [] },
    { queries: [] },
    { height: "400px" },
    { value: [] },
    false,
  )) as any;

import { buildSQLChartQuery } from "./dashboardAutoQueryBuilder";

const latency = field("y_axis_1", "Latency");
const service = field("breakdown_1", "Service");

describe("distribution buckets", () => {
  it("rounds the bucket width to 1, 2, 2.5 or 5 times a power of ten", () => {
    expect(niceBucketSize(0.7)).toBe(1);
    expect(niceBucketSize(13)).toBe(20);
    expect(niceBucketSize(21)).toBe(25);
    expect(niceBucketSize(39.6)).toBe(50);
    expect(niceBucketSize(0.03)).toBeCloseTo(0.05);
    expect(niceBucketSize(0)).toBe(1);
  });

  it("aims for about 30 buckets by default", () => {
    const buckets = distributionBuckets([0, 300], {})!;
    expect(DISTRIBUTION_DEFAULT_BUCKETS).toBe(30);
    expect(buckets).toEqual({ start: 0, size: 10, count: 31 });
  });

  it("takes the bucket count, and a bucket size over it, shifted by the offset", () => {
    expect(distributionBuckets([0, 100], { distribution_bucket_count: 5 })).toEqual({
      start: 0,
      size: 20,
      count: 6,
    });
    expect(
      distributionBuckets([3, 18], {
        distribution_bucket_count: 5,
        distribution_bucket_size: 4,
        distribution_bucket_offset: 1,
      }),
    ).toEqual({ start: 1, size: 4, count: 5 });
  });

  it("returns no layout without values and one bucket for a single value", () => {
    expect(distributionBuckets([], {})).toBeNull();
    expect(distributionBuckets([5, 5], {})).toMatchObject({ count: 1 });
  });

  it("counts each value into its bucket and clamps past the last one", () => {
    expect(bucketCounts([0, 9.9, 10, 25, 99], { start: 0, size: 10, count: 3 })).toEqual([2, 1, 2]);
  });
});

describe("distribution through convertPanelData", () => {
  const rows = [
    { y_axis_1: 5, breakdown_1: "api" },
    { y_axis_1: 15, breakdown_1: "api" },
    { y_axis_1: 16, breakdown_1: "web" },
    { y_axis_1: "n/a", breakdown_1: "web" },
    { y_axis_1: null, breakdown_1: "web" },
  ];

  it("stacks one series per breakdown value over the numeric buckets", async () => {
    const { options } = await viaPanel(
      panel(
        "distribution",
        { y: [latency], breakdown: [service] },
        { distribution_bucket_size: 10 },
      ),
      [rows],
    );
    expect(options.series.map((s: any) => s.name)).toEqual(["api", "web"]);
    expect(options.series.every((s: any) => s.type === "bar" && s.stack === "distribution")).toBe(
      true,
    );
    expect(options.series[0].data).toEqual([
      [5, 1],
      [15, 1],
    ]);
    expect(options.series[1].data).toEqual([
      [5, 0],
      [15, 1],
    ]);
    expect(options.xAxis).toMatchObject({ type: "value", min: 0, max: 20 });
    expect(options.legend.show).toBe(true);
    const tooltip = options.tooltip.formatter([
      { dataIndex: 1, color: "#000", seriesName: "api", value: [15, 1] },
      { dataIndex: 1, color: "#111", seriesName: "web", value: [15, 0] },
    ]);
    expect(tooltip).toContain("10 – 20");
    expect(tooltip).toContain("api: 1");
    expect(tooltip).not.toContain("web");
  });

  it("names series by y field without a breakdown, and by both with several y fields", async () => {
    const size = field("y_axis_2", "Size");
    const single = await viaPanel(panel("distribution", { y: [latency] }), [rows]);
    expect(single.options.series.map((s: any) => s.name)).toEqual(["Latency"]);
    expect(single.options.legend.show).toBe(false);
    const both = await viaPanel(
      panel("distribution", { y: [latency, size], breakdown: [service] }),
      [rows.map((row) => ({ ...row, y_axis_2: 1 }))],
    );
    expect(both.options.series.map((s: any) => s.name)).toEqual([
      "api · Latency",
      "web · Latency",
      "api · Size",
      "web · Size",
    ]);
  });

  it("keeps adjacent x-axis ticks distinct after unit rounding, and exact ticks unchanged", async () => {
    const { options } = await viaPanel(
      panel("distribution", { y: [latency] }, { unit: "milliseconds", decimals: 0 }),
      [rows],
    );
    const tick = options.xAxis.axisLabel.formatter;
    expect(tick(1000)).toBe("1s");
    expect(tick(1500)).toBe("1.5s");
    expect(tick(1500)).not.toBe(tick(1000));
    expect(tick(200)).toBe("200ms");
  });

  it("shows round bucket edges of a plain number without a zero fraction", async () => {
    for (const unit of [null, "default"]) {
      const { options } = await viaPanel(
        panel("distribution", { y: [latency] }, { unit, decimals: 2 }),
        [rows],
      );
      const tick = options.xAxis.axisLabel.formatter;
      expect([tick(0), tick(20000), tick(2.5), tick(0.125), tick(-40)]).toEqual([
        "0",
        "20000",
        "2.5",
        "0.125",
        "-40",
      ]);
    }
    const bytes = await viaPanel(
      panel("distribution", { y: [latency] }, { unit: "bytes", decimals: 2 }),
      [rows],
    );
    expect(bytes.options.xAxis.axisLabel.formatter(0)).toBe("0.00B");
  });

  it("returns an empty series list when no value is numeric", async () => {
    const { options } = await viaPanel(panel("distribution", { y: [latency] }), [
      [{ y_axis_1: "x" }],
    ]);
    expect(options.series).toEqual([]);
  });
});

describe("distribution builder SQL", () => {
  it("selects raw values with no GROUP BY and asks for more rows than the default cap", () => {
    const schema = panel("distribution", { y: [latency], breakdown: [service] });
    const fields = {
      ...schema.queries[0].fields,
      y: [{ ...latency, args: [{ type: "field", value: { field: "latency_ms" } }] }],
      breakdown: [{ ...service, args: [{ type: "field", value: { field: "service" } }] }],
      filter: { filterType: "group", logicalOperator: "AND", conditions: [] },
    };
    const queryData = { ...schema.queries[0], fields, joins: [] };
    const sql = buildSQLChartQuery({
      queryData,
      chartType: "distribution",
      dashboardPanelData: { data: schema },
    });
    expect(sql).toBe(
      'SELECT latency_ms as "y_axis_1", service as "breakdown_1" FROM "demo_app"  LIMIT 10000',
    );
    const limited = buildSQLChartQuery({
      queryData: { ...queryData, config: { limit: 500 } },
      chartType: "distribution",
      dashboardPanelData: { data: schema },
    });
    expect(limited.endsWith(" LIMIT 500")).toBe(true);
    const bar = buildSQLChartQuery({
      queryData,
      chartType: "bar",
      dashboardPanelData: { data: schema },
    });
    expect(bar).not.toContain("LIMIT");
  });
});
