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
  DISTRIBUTION_MAX_BUCKETS,
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

  it("widens a bucket size too small for the range, so the buckets still cover every value", () => {
    const buckets = distributionBuckets([200, 300, 401], { distribution_bucket_size: 0.1 })!;
    expect(buckets.size).toBe(0.25);
    expect(buckets.widenedFrom).toBe(0.1);
    expect(buckets.count).toBeLessThanOrEqual(DISTRIBUTION_MAX_BUCKETS);
    expect(buckets.start).toBeLessThanOrEqual(200);
    expect(buckets.start + buckets.count * buckets.size).toBeGreaterThan(401);
    const counts = bucketCounts([200, 401], buckets);
    expect(counts[0]).toBe(1);
    expect(counts[counts.length - 1]).toBe(1);
    expect(distributionBuckets([0, 10], { distribution_bucket_size: 0.1 })).not.toHaveProperty(
      "widenedFrom",
    );
  });

  it("keeps a full bucket count of the cap within the cap without a warning", () => {
    const buckets = distributionBuckets([0.3, 997.7], {
      distribution_bucket_count: DISTRIBUTION_MAX_BUCKETS,
      distribution_bucket_offset: 0.5,
    })!;
    expect(buckets.count).toBeLessThanOrEqual(DISTRIBUTION_MAX_BUCKETS);
    expect(buckets.start + buckets.count * buckets.size).toBeGreaterThan(997.7);
    expect(buckets).not.toHaveProperty("widenedFrom");
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

  it("names an empty breakdown value so its series has a legend entry", async () => {
    const size = field("y_axis_2", "Size");
    const blanks = [
      { y_axis_1: 5, breakdown_1: "api" },
      { y_axis_1: 6, breakdown_1: null },
      { y_axis_1: 7, breakdown_1: "" },
    ];
    const one = await viaPanel(panel("distribution", { y: [latency], breakdown: [service] }), [
      blanks,
    ]);
    expect(one.options.series.map((s: any) => s.name)).toEqual(["api", "(empty)"]);
    expect(one.options.series[1].data.reduce((sum: number, [, n]: number[]) => sum + n, 0)).toBe(2);
    const two = await viaPanel(
      panel("distribution", { y: [latency, size], breakdown: [service] }),
      [blanks.map((row) => ({ ...row, y_axis_2: 1 }))],
    );
    expect(two.options.series.map((s: any) => s.name)).toContain("(empty) · Size");
  });

  it("gives stacked series distinct palette colors when no color mode is set", async () => {
    // These two names hash to the same default palette color.
    const clash = [
      [
        { y_axis_1: 1, breakdown_1: "svc7" },
        { y_axis_1: 2, breakdown_1: "svc10" },
      ],
    ];
    for (const color of [undefined, { mode: "palette-classic-by-series", colorBySeries: [] }]) {
      const { options } = await viaPanel(
        panel("distribution", { y: [latency], breakdown: [service] }, { color }),
        clash,
      );
      const colors = options.series.map((s: any) => s.itemStyle.color);
      expect(new Set(colors).size).toBe(colors.length);
    }

    const mapped = await viaPanel(
      panel(
        "distribution",
        { y: [latency], breakdown: [service] },
        { color: { colorBySeries: [{ value: "web", color: "#123456" }] } },
      ),
      [rows],
    );
    expect(mapped.options.series[1].itemStyle.color).toBe("#123456");
    const fixed = await viaPanel(
      panel(
        "distribution",
        { y: [latency], breakdown: [service] },
        { color: { mode: "fixed", fixedColor: ["#abcdef"] } },
      ),
      [rows],
    );
    expect(fixed.options.series.map((s: any) => s.itemStyle.color)).toEqual(["#abcdef", "#abcdef"]);
  });

  it("shows the real bucket edges in the tooltip even when Decimals rounds them", async () => {
    const { options } = await viaPanel(
      panel(
        "distribution",
        { y: [latency] },
        {
          unit: "milliseconds",
          decimals: 0,
          distribution_bucket_size: 1,
          distribution_bucket_offset: 0.5,
        },
      ),
      [[{ y_axis_1: 199.7 }, { y_axis_1: 200.7 }]],
    );
    const tooltip = options.tooltip.formatter([
      { dataIndex: 0, color: "#000", seriesName: "Latency", value: [200, 1] },
    ]);
    expect(tooltip).toContain("199.5ms – 200.5ms");
    const plain = await viaPanel(
      panel("distribution", { y: [latency] }, { decimals: 0, distribution_bucket_size: 10 }),
      [rows],
    );
    expect(
      plain.options.tooltip.formatter([
        { dataIndex: 0, color: "#000", seriesName: "Latency", value: [5, 1] },
      ]),
    ).toContain("0 – 10");
  });

  it("keeps tooltip edges exact when the unit rescales, without trailing zeros on plain numbers", async () => {
    const tooltipAt = async (config: Record<string, any>, values: number[], index: number) => {
      const { options } = await viaPanel(panel("distribution", { y: [latency] }, config), [
        values.map((y_axis_1) => ({ y_axis_1 })),
      ]);
      return options.tooltip.formatter([
        { dataIndex: index, color: "#000", seriesName: "Latency", value: [0, 1] },
      ]);
    };
    const ms = { unit: "milliseconds", decimals: 0, distribution_bucket_size: 1 };
    expect(
      await tooltipAt({ ...ms, distribution_bucket_offset: 0.5 }, [1499.7, 1500.2], 0),
    ).toContain("1.4995s – 1.5005s");
    expect(await tooltipAt({ ...ms, distribution_bucket_size: 200 }, [1000, 1500], 0)).toContain(
      "1s – 1.2s",
    );
    expect(await tooltipAt({ distribution_bucket_size: 25 }, [30, 60], 0)).toContain("25 – 50");
  });

  it("counts a value on a bucket edge into the bucket that starts there, and shows no -0 edge", () => {
    const buckets = distributionBuckets([0.1, 0.3], { distribution_bucket_size: 0.1 })!;
    expect(bucketCounts([0.1, 0.3], buckets)).toEqual([1, 0, 1]);
  });

  it("warns when the bucket size is widened, and keeps room for the Count title", async () => {
    const values = [[{ y_axis_1: 200 }, { y_axis_1: 401 }]];
    const widened = await viaPanel(
      panel("distribution", { y: [latency] }, { distribution_bucket_size: 0.1 }),
      values,
    );
    expect(widened.extras.seriesLimit.displayCapMessage).toBe(
      "Bucket size 0.1 is too small for this range, so 0.25 is used",
    );
    expect(widened.extras).not.toHaveProperty("limitNumberOfSeriesWarningMessage");
    expect(widened.options.xAxis.max).toBeGreaterThan(401);
    expect(widened.options.grid.top).toBe(28);
    const normal = await viaPanel(panel("distribution", { y: [latency] }), values);
    expect(normal.extras.seriesLimit).toBeUndefined();
    expect(normal.options.graphic).toEqual([]);
    expect(normal.options.grid.top).toBe(28);
    expect(normal.options.yAxis.name).toBe("Count");
  });

  it("returns an empty series list when no value is numeric", async () => {
    const { options } = await viaPanel(panel("distribution", { y: [latency] }), [
      [{ y_axis_1: "x" }],
    ]);
    expect(options.series).toEqual([]);
  });

  it("notes the sample size when a builder query reaches the row cap, and not otherwise", async () => {
    const capped = Array.from({ length: 10000 }, (_, index) => ({ y_axis_1: index % 50 }));
    const sampled = await viaPanel(panel("distribution", { y: [latency] }), [capped]);
    expect(sampled.options.graphic).toHaveLength(1);
    expect(sampled.options.graphic[0].style.text).toContain("10,000");

    const short = await viaPanel(panel("distribution", { y: [latency] }), [capped.slice(0, 20)]);
    expect(short.options.graphic).toEqual([]);

    const limited = panel("distribution", { y: [latency] });
    limited.queries[0].config = { limit: 10000 };
    expect((await viaPanel(limited, [capped])).options.graphic).toEqual([]);
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
      'SELECT latency_ms as "y_axis_1", service as "breakdown_1" FROM "demo_app"  WHERE latency_ms IS NOT NULL LIMIT 10000',
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
    expect(bar).not.toContain("IS NOT NULL");
  });

  it("adds no null filter when a y field is an aggregate or raw SQL, which WHERE cannot hold", () => {
    const schema = panel("distribution", { y: [latency] });
    const build = (y: any[]) =>
      buildSQLChartQuery({
        queryData: {
          ...schema.queries[0],
          fields: { ...schema.queries[0].fields, y, filter: { conditions: [] } },
          joins: [],
        },
        chartType: "distribution",
        dashboardPanelData: { data: schema },
      });
    const column = { ...latency, args: [{ type: "field", value: { field: "latency_ms" } }] };
    expect(build([{ ...column, functionName: "avg" }])).not.toContain("IS NOT NULL");
    expect(build([{ ...latency, type: "raw", rawQuery: "avg(latency_ms)" }])).not.toContain(
      "IS NOT NULL",
    );
    expect(build([column, { ...column, alias: "y_axis_2", functionName: "count" }])).not.toContain(
      "IS NOT NULL",
    );
  });

  it("keeps rows with any y value, ANDed with the user's filters", () => {
    const schema = panel("distribution", { y: [latency] });
    const yField = (alias: string, column: string) => ({
      ...field(alias, column),
      args: [{ type: "field", value: { field: column } }],
    });
    const fields = {
      ...schema.queries[0].fields,
      y: [yField("y_axis_1", "code"), yField("y_axis_2", "floatvalue")],
      filter: {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [
          {
            type: "condition",
            values: [],
            column: { field: "method" },
            operator: "=",
            value: "'GET'",
            logicalOperator: "AND",
            filterType: "condition",
          },
        ],
      },
    };
    const sql = buildSQLChartQuery({
      queryData: { ...schema.queries[0], fields, joins: [] },
      chartType: "distribution",
      dashboardPanelData: {
        data: schema,
        layout: { currentQueryIndex: 0 },
        meta: { stream: { selectedStreamFields: [] } },
      },
    });
    expect(sql).toContain("AND (code IS NOT NULL OR floatvalue IS NOT NULL) LIMIT 10000");
    expect(sql).toMatch(/WHERE \(.*method.*\) AND \(code IS NOT NULL/);
  });
});
