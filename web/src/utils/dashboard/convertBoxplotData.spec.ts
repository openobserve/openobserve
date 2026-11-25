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
import * as echarts from "echarts";
import { convertPanelData } from "./convertPanelData";
import { buildSQLChartQuery } from "./dashboardAutoQueryBuilder";
import {
  boxStats,
  boxplotDrilldownSeries,
  boxplotDrilldownTime,
  quantile,
} from "./convertBoxplotData";

vi.mock("./convertCustomChartData", () => ({
  prepareCustomChartRun: vi.fn(),
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

const field = (alias: string, column: string, functionName: string | null = null) => ({
  label: "",
  alias,
  column,
  functionName,
  args: [{ type: "field", value: { field: column } }],
  isDerived: false,
  havingConditions: [],
});

const panel = (config: Record<string, any> = {}, x = [field("x_axis_1", "service")]) => ({
  id: "p",
  type: "boxplot",
  queryType: "sql",
  queries: [
    {
      query: "",
      customQuery: false,
      fields: {
        stream: "demo_app",
        stream_type: "logs",
        x,
        y: [{ ...field("y_axis_1", "latency_ms"), label: "Latency" }],
        z: [],
        breakdown: [],
        filter: { filterType: "group", logicalOperator: "AND", conditions: [] },
      },
      config: { limit: 0 },
      joins: [],
    },
  ],
  config: { show_legends: true, unit: "default", decimals: 0, ...config },
});

const convert = async (schema: any, data: any[], width = 800) =>
  (await convertPanelData(
    schema,
    data,
    store,
    { value: { offsetWidth: width, offsetHeight: 400 } },
    { value: null },
    { value: [] },
    { queries: [] },
    { height: "400px" },
    { value: [] },
    false,
  )) as any;

const values = [1, 2, 3, 4, 5, 6, 7, 8, 100];
const rows = [
  ...values.map((value) => ({ x_axis_1: "web", y_axis_1: value })),
  { x_axis_1: "api", y_axis_1: 10 },
  { x_axis_1: "api", y_axis_1: 20 },
  { x_axis_1: "api", y_axis_1: null },
];

describe("box plot", () => {
  it("computes each category's summary in SQL over every matching row", () => {
    const schema = panel();
    const build = () =>
      buildSQLChartQuery({
        queryData: schema.queries[0],
        chartType: "boxplot",
        dashboardPanelData: { data: schema, meta: {} },
      });
    expect(build()).toBe(
      'SELECT service as "x_axis_1", min(latency_ms) as "y_axis_1_min", ' +
        'approx_percentile_cont(latency_ms, 0.25) as "y_axis_1_q1", ' +
        'approx_percentile_cont(latency_ms, 0.5) as "y_axis_1_median", ' +
        'approx_percentile_cont(latency_ms, 0.75) as "y_axis_1_q3", ' +
        'max(latency_ms) as "y_axis_1_max", count(latency_ms) as "y_axis_1_count" ' +
        'FROM "demo_app"  GROUP BY "x_axis_1" LIMIT 10000',
    );
    schema.queries[0].config.limit = 500;
    schema.queries[0].fields.x[0] = { ...schema.queries[0].fields.x[0], sortBy: "ASC" };
    expect(build()).toMatch(/GROUP BY "x_axis_1" ORDER BY "x_axis_1" ASC LIMIT 500$/);
  });

  it("summarises the whole stream in one row without an x field", () => {
    const schema = panel({}, []);
    expect(
      buildSQLChartQuery({
        queryData: schema.queries[0],
        chartType: "boxplot",
        dashboardPanelData: { data: schema, meta: {} },
      }),
    ).toMatch(/^SELECT min\(latency_ms\) as "y_axis_1_min", .* FROM "demo_app"\s*$/);
  });

  it("interpolates quantiles linearly", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75);
    expect(quantile([7], 0.75)).toBe(7);
  });

  it("min-max whiskers reach every value and split off no outliers", () => {
    expect(boxStats(values, "minmax")).toEqual({
      low: 1,
      q1: 3,
      median: 5,
      q3: 7,
      high: 100,
      count: 9,
      outliers: [],
    });
  });

  it("iqr whiskers stop inside the 1.5 IQR fences and the rest are outliers", () => {
    expect(boxStats(values, "iqr")).toMatchObject({ low: 1, high: 8, outliers: [100] });
  });

  it("draws one box per category in name order, min-max by default", async () => {
    const out = await convert(panel(), [rows]);
    const [box, ...rest] = out.options.series;
    expect(out.chartType).toBe("boxplot");
    expect(rest).toEqual([]);
    expect(out.options.xAxis.data).toEqual(["api", "web"]);
    expect(box.type).toBe("boxplot");
    expect(box.data).toEqual([
      [10, 12.5, 15, 17.5, 20],
      [1, 3, 5, 7, 100],
    ]);
  });

  describe("x-axis labels, laid out like a bar chart's", () => {
    const servicesRows = (names: string[]) =>
      names.flatMap((name) => [
        { x_axis_1: name, y_axis_1: 1 },
        { x_axis_1: name, y_axis_1: 3 },
      ]);
    const five = ["alpha", "bravo", "charlie", "delta", "echo"];
    const many = Array.from({ length: 600 }, (_, i) => `trace-${String(i).padStart(4, "0")}`);
    const shownLabels = (options: any, names: string[]) => {
      const chart = echarts.init(null as any, null, {
        renderer: "svg",
        ssr: true,
        width: 800,
        height: 400,
      });
      chart.setOption({ ...options, animation: false });
      const svg = chart.renderToSVGString();
      chart.dispose();
      return names.filter((name) => svg.includes(`>${name}</text>`));
    };

    it("skips overlapping labels without tilting them, unless the panel sets a rotation", async () => {
      const crowded = (await convert(panel(), [servicesRows(many)])).options.xAxis.axisLabel;
      expect(crowded.interval).not.toBe(0);
      expect(crowded).toMatchObject({
        interval: "auto",
        hideOverlap: true,
        rotate: 0,
        width: 120,
        overflow: "none",
      });
      const chosen = (
        await convert(panel({ axis_label_rotate: 30, axis_label_truncate_width: 60 }), [
          servicesRows(five),
        ])
      ).options.xAxis.axisLabel;
      expect(chosen).toMatchObject({ rotate: 30, width: 60 });
      const time = (
        await convert(
          panel({ axis_label_rotate: 30 }, [field("x_axis_1", "_timestamp", "histogram")]),
          [[{ x_axis_1: "2026-10-01T00:00:00", y_axis_1: 1 }]],
        )
      ).options.xAxis.axisLabel;
      expect(time).toMatchObject({ rotate: 0, width: 120 });
    });

    it("draws every label of a few categories and a readable subset of 600", async () => {
      const few = await convert(panel(), [servicesRows(five)]);
      expect(shownLabels(few.options, five)).toEqual(five);
      const crowded = await convert(panel(), [servicesRows(many)]);
      const shown = shownLabels(crowded.options, many);
      expect(shown.length).toBeGreaterThan(0);
      expect(shown.length).toBeLessThan(60);
    });
  });

  it("keeps adjacent y-axis ticks distinct after unit rounding, and exact ticks unchanged", async () => {
    const tick = (await convert(panel({ unit: "milliseconds", decimals: 0 }), [rows])).options.yAxis
      .axisLabel.formatter;
    expect(tick(1000)).toBe("1s");
    expect(tick(1200)).toBe("1.2s");
    expect(tick(800)).toBe("800ms");
  });

  it("adds an outlier scatter series in iqr mode", async () => {
    const out = await convert(panel({ boxplot_whisker: "iqr" }), [rows]);
    expect(out.options.series[0].data[1]).toEqual([1, 3, 5, 7, 8]);
    expect(out.options.series[1]).toMatchObject({ type: "scatter", data: [[1, 100]] });
  });

  it("names the single box after the y field when there is no x field", async () => {
    const out = await convert(panel({}, []), [rows]);
    expect(out.options.xAxis.data).toEqual(["Latency"]);
    expect(out.options.series[0].data).toHaveLength(1);
  });

  it("draws one box per time bucket from the builder's SQL summary rows", async () => {
    const summary = (
      bucket: string,
      low: number,
      q1: number,
      median: number,
      q3: number,
      high: number,
    ) => ({
      x_axis_1: bucket,
      y_axis_1_min: low,
      y_axis_1_q1: q1,
      y_axis_1_median: median,
      y_axis_1_q3: q3,
      y_axis_1_max: high,
      y_axis_1_count: 1000,
    });
    const buckets = [
      summary("2026-10-01T00:00:00", 1, 10, 20, 30, 90),
      summary("2026-10-01T01:00:00", 2, 12, 22, 32, 40),
      summary("2026-10-01T02:00:00", 3, 14, 24, 34, 45),
    ];
    const minmax = await convert(panel(), [buckets]);
    expect(minmax.options.xAxis.data).toHaveLength(3);
    expect(minmax.options.series[0].data[0]).toEqual([1, 10, 20, 30, 90]);
    const iqr = await convert(panel({ boxplot_whisker: "iqr" }), [buckets]);
    expect(iqr.options.series[0].data[0]).toEqual([1, 10, 20, 30, 60]);
    expect(iqr.options.series).toHaveLength(1);
  });

  it("shows time-bucket categories in the dashboard timezone", async () => {
    const bucketRows = [
      { x_axis_1: "2026-10-01T05:00:00", y_axis_1: 10 },
      { x_axis_1: "2026-10-01T05:00:00", y_axis_1: 20 },
    ];
    const schema = panel({}, [field("x_axis_1", "_timestamp", "histogram")]);
    schema.queries[0].customQuery = true;
    const zoned = await convertPanelData(
      schema,
      [bucketRows],
      { state: { ...store.state, timezone: "Asia/Kolkata" } },
      { value: { offsetWidth: 800, offsetHeight: 400 } },
      { value: null },
      { value: [] },
      { queries: [] },
      { height: "400px" },
      { value: [] },
      false,
    );
    expect((zoned as any).options.xAxis.data).toEqual(["2026-10-01 10:30:00"]);
    const plain = await convert(panel(), [[{ x_axis_1: "api", y_axis_1: 5 }]]);
    expect(plain.options.xAxis.data).toEqual(["api"]);
  });

  it("draws only query 1, so a second query cannot merge into its boxes", async () => {
    const schema: any = panel();
    schema.queries.push({ ...schema.queries[0] });
    const result = await convert(schema, [
      [{ x_axis_1: "api", y_axis_1: 10 }],
      [{ x_axis_1: "api", y_axis_1: 999 }],
    ]);
    expect(result.options.xAxis.data).toEqual(["api"]);
    expect(result.options.series[0].data).toEqual([[10, 10, 10, 10, 10]]);
  });

  it("lists the quartiles in the box tooltip with the panel unit", async () => {
    const out = await convert(panel({ unit: "milliseconds", boxplot_whisker: "iqr" }), [rows]);
    const text = out.options.tooltip.formatter({ seriesType: "boxplot", dataIndex: 1 });
    expect(text).toContain("<strong>web</strong>");
    expect(text).toContain("Upper whisker: 8ms");
    expect(text).toContain("Median: 5ms");
    expect(text).toContain("Samples: 9");
  });

  it("hands a drilldown the clicked category with the median or outlier value", async () => {
    const { options } = await convert(panel({ boxplot_whisker: "iqr" }), [rows]);
    expect(boxplotDrilldownSeries(options, { seriesType: "boxplot", dataIndex: 1 })).toEqual({
      __name: "web",
      __value: 5,
      __axisValue: "web",
    });
    expect(boxplotDrilldownSeries(options, { seriesType: "scatter", data: [1, 100] })).toEqual({
      __name: "web",
      __value: 100,
      __axisValue: "web",
    });
  });

  it("skips the query for a value the stream types as text", () => {
    const schema = panel();
    const build = (type: string) =>
      buildSQLChartQuery({
        queryData: schema.queries[0],
        chartType: "boxplot",
        dashboardPanelData: {
          data: schema,
          meta: {
            streamFields: {
              groupedFields: [{ stream_alias: null, schema: [{ name: "latency_ms", type }] }],
            },
          },
        },
      });
    expect(build("Utf8")).toBe("");
    expect(build("Float64")).toContain('min(latency_ms) as "y_axis_1_min"');
  });

  describe("category order", () => {
    const summaryRow = (name: string, low: number) => ({
      x_axis_1: name,
      y_axis_1_min: low,
      y_axis_1_q1: low + 1,
      y_axis_1_median: low + 2,
      y_axis_1_q3: low + 3,
      y_axis_1_max: low + 4,
      y_axis_1_count: 10,
    });
    const descRows = [summaryRow("echo", 5), summaryRow("charlie", 3), summaryRow("alpha", 1)];
    const sorted = (sortBy: string | null) =>
      panel({}, [{ ...field("x_axis_1", "service"), sortBy } as any]);
    const custom = (sql: string, x = [field("x_axis_1", "service")]) => {
      const schema: any = panel({}, x);
      schema.queries[0].customQuery = true;
      schema.queries[0].query = sql;
      return schema;
    };

    it("follows a builder category's sort direction", async () => {
      const desc = await convert(sorted("DESC"), [descRows]);
      expect(desc.options.xAxis.data).toEqual(["echo", "charlie", "alpha"]);
      expect(desc.options.series[0].data[0]).toEqual([5, 6, 7, 8, 9]);
      const asc = await convert(sorted("ASC"), [[...descRows].reverse()]);
      expect(asc.options.xAxis.data).toEqual(["alpha", "charlie", "echo"]);
    });

    it("runs A to Z when the builder category has no sort direction", async () => {
      const none = await convert(sorted(null), [descRows]);
      expect(none.options.xAxis.data).toEqual(["alpha", "charlie", "echo"]);
    });

    it("keeps custom SQL row order only when the SQL has a top-level ORDER BY", async () => {
      const rawRows = [
        { x_axis_1: "web", y_axis_1: 1 },
        { x_axis_1: "api", y_axis_1: 2 },
        { x_axis_1: "web", y_axis_1: 3 },
      ];
      const ordered = await convert(
        custom('SELECT service as "x_axis_1", v as "y_axis_1" FROM t ORDER BY v DESC'),
        [rawRows],
      );
      expect(ordered.options.xAxis.data).toEqual(["web", "api"]);
      const unordered = await convert(
        custom('SELECT service as "x_axis_1", v as "y_axis_1" FROM (SELECT * FROM t ORDER BY v)'),
        [rawRows],
      );
      expect(unordered.options.xAxis.data).toEqual(["api", "web"]);
    });

    it("keeps time buckets chronological whatever the row order", async () => {
      const bucketRows = [
        { x_axis_1: "2026-10-01T02:00:00", y_axis_1: 1 },
        { x_axis_1: "2026-10-01T00:00:00", y_axis_1: 2 },
        { x_axis_1: "2026-10-01T01:00:00", y_axis_1: 3 },
      ];
      const histogram = [field("x_axis_1", "_timestamp", "histogram")];
      const expected = ["2026-10-01 00:00:00", "2026-10-01 01:00:00", "2026-10-01 02:00:00"];
      const ordered = await convert(
        custom("SELECT histogram(_timestamp) as x_axis_1 FROM t ORDER BY x_axis_1 DESC", histogram),
        [bucketRows],
      );
      expect(ordered.options.xAxis.data).toEqual(expected);
      const builder = panel({}, [{ ...histogram[0], sortBy: "DESC" } as any]);
      expect((await convert(builder, [bucketRows])).options.xAxis.data).toEqual(expected);
    });
  });

  describe("custom SQL that kept the builder's summary columns", () => {
    const summaryRows = [
      {
        x_axis_1: "alpha",
        y_axis_1_min: 20,
        y_axis_1_q1: 40,
        y_axis_1_median: 50,
        y_axis_1_q3: 60,
        y_axis_1_max: 80,
        y_axis_1_count: 6000,
      },
      {
        x_axis_1: "bravo",
        y_axis_1_min: 50,
        y_axis_1_q1: 70,
        y_axis_1_median: 80,
        y_axis_1_q3: 90,
        y_axis_1_max: 110,
        y_axis_1_count: 6000,
      },
    ];

    it("draws the same boxes as the builder from the summary columns", async () => {
      const builder = await convert(panel(), [summaryRows]);
      const schema: any = panel();
      schema.queries[0].customQuery = true;
      schema.queries[0].query = buildSQLChartQuery({
        queryData: panel().queries[0],
        chartType: "boxplot",
        dashboardPanelData: { data: panel(), meta: {} },
      });
      const custom = await convert(schema, [summaryRows]);
      expect(custom.options.series[0].data).toEqual(builder.options.series[0].data);
      expect(custom.options.series[0].data[0]).toEqual([20, 40, 50, 60, 80]);
      expect(custom.options.tooltip.formatter({ seriesType: "boxplot", dataIndex: 0 })).toContain(
        "Samples: 6,000",
      );
    });

    it("falls back to raw values when a summary column is missing", async () => {
      const schema: any = panel();
      schema.queries[0].customQuery = true;
      const partial = summaryRows.map(({ y_axis_1_q3: _q3, ...rest }) => ({
        ...rest,
        y_axis_1: 7,
      }));
      const out = await convert(schema, [partial]);
      expect(out.options.series[0].data[0]).toEqual([7, 7, 7, 7, 7]);
    });
  });

  it("draws nothing without numeric rows", async () => {
    expect((await convert(panel(), [[{ x_axis_1: "a", y_axis_1: "x" }]])).options.series).toEqual(
      [],
    );
  });
});

describe("boxplotDrilldownTime", () => {
  const options = {
    xAxis: { data: ["2026-10-30 10:00:00"] },
    series: [{ data: [[1, 2, 3, 4, 5]] }],
  };
  const params = { seriesType: "boxplot", dataIndex: 0, value: [0, 1, 2, 3, 4, 5] };
  const panel = (functionName: string | null) => ({
    queries: [{ fields: { x: [{ alias: "x_axis_1", functionName }] } }],
  });

  it("opens a time-bucket box at its bucket", () => {
    expect(boxplotDrilldownTime(panel("histogram"), options, params)).toBe("2026-10-30 10:00:00");
  });

  it("keeps the panel range for a plain category, never the box's minimum", () => {
    expect(boxplotDrilldownTime(panel(null), options, params)).toBeNull();
  });
});
