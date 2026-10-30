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

import { gt } from "@/types/i18n";
import { describe, expect, it, vi } from "vitest";
import { convertPanelData } from "./convertPanelData";
import { convertMultiSQLData } from "./convertSQLData";
import { convertPromQLData } from "./convertPromQLData";
import { applyGaugeOptions, applyHeatmapOptions, applyPieOptions } from "./panelTypeOptions";
import { chartColor } from "@/utils/chartTheme";
import { labelColorOn } from "./chartLabelContrast";
import * as echarts from "echarts";

// jsdom has no canvas to measure text, so labels get the same average-glyph estimate the app's helpers use.
echarts.setPlatformAPI({
  measureText: (text: string, font?: string) => ({
    width: text.length * (parseFloat(String(font).match(/(\d+)px/)?.[1] ?? "12") * 0.6),
  }),
});

// The app's measurement must agree with ECharts', as the browser canvas does for both.
vi.mock("./chartDimensionUtils", async (original) => ({
  ...(await original<any>()),
  calculateWidthText: (text: string, fontSize = "12px") =>
    String(text ?? "").length * parseFloat(fontSize) * 0.6,
}));

vi.mock("./convertCustomChartData", () => ({
  runJavaScriptCode: vi.fn(),
  validateUserCode: vi.fn(() => null),
}));

const serialize = (value: unknown) =>
  JSON.stringify(value, (_key, v) =>
    typeof v === "function" ? "[Function]" : v === undefined ? "[undefined]" : v,
  );

const store = {
  state: {
    theme: "light",
    timezone: "UTC",
    zoConfig: { timestamp_column: "_timestamp", max_dashboard_series: 1000 },
    selectedOrganization: { identifier: "default" },
  },
};
const panelRef = () => ({ value: { offsetWidth: 800, offsetHeight: 400 } });
const metadata = {
  queries: [
    {
      query: "SELECT 1",
      startTime: 1704067200000000,
      endTime: 1704070800000000,
      timeRangeGap: { seconds: 0, periodAsStr: "" },
      panelQueryIndex: 0,
    },
  ],
};

const xField = { label: "Endpoint", alias: "x_axis_1", column: "endpoint", args: [] };
const yField = {
  label: "Requests",
  alias: "y_axis_1",
  column: "requests",
  functionName: "count",
  aggregationFunction: "count",
  args: [{ type: "field", value: { field: "requests" } }],
};

const sqlPanel = (type: string, config: Record<string, any> = {}, fields: any = {}) => ({
  id: "p",
  type,
  queryType: "sql",
  queries: [
    {
      query: "SELECT 1",
      customQuery: false,
      fields: {
        stream: "default",
        stream_type: "logs",
        x: [xField],
        y: [yField],
        z: [],
        breakdown: [],
        ...fields,
      },
      config: { min: 0, max: 100 },
    },
  ],
  config: { show_legends: true, unit: "default", decimals: 0, ...config },
});

const rows = () => [
  { x_axis_1: "/a", y_axis_1: 70 },
  { x_axis_1: "/b", y_axis_1: 25 },
  { x_axis_1: "/c", y_axis_1: 3 },
  { x_axis_1: "/d", y_axis_1: 2 },
];

const viaPanel = async (panel: any, data: any[]) =>
  (
    (await convertPanelData(
      panel,
      data,
      store,
      panelRef(),
      { value: null },
      { value: [] },
      panel.queryType === "promql" ? null : metadata,
      { height: "400px" },
      { value: [] },
      false,
    )) as any
  ).options;

const directSQL = async (panel: any, data: any[]) =>
  (
    (await convertMultiSQLData(
      panel,
      data,
      store,
      panelRef(),
      { value: null },
      { value: [] },
      metadata,
      { height: "400px" },
      { value: [] },
      false,
    )) as any
  ).options;

const promPanel = (type: string, config: Record<string, any> = {}) => ({
  id: "pq",
  type,
  queryType: "promql",
  queries: [
    {
      query: "sum by (job) (up)",
      customQuery: true,
      fields: { stream: "up", stream_type: "metrics", x: [], y: [], z: [], breakdown: [] },
      config: { promql_legend: "{job}", min: 0, max: 100 },
    },
  ],
  config: { show_legends: true, unit: "default", decimals: 0, ...config },
});
const promData = () => [
  {
    resultType: "matrix",
    result: [
      { metric: { job: "api" }, values: [[1704067200, "70"]] },
      { metric: { job: "web" }, values: [[1704067200, "25"]] },
      { metric: { job: "db" }, values: [[1704067200, "3"]] },
      { metric: { job: "cache" }, values: [[1704067200, "2"]] },
    ],
  },
];
const directPromQL = async (panel: any, data: any[]) =>
  (
    (await convertPromQLData(
      panel,
      data,
      store,
      panelRef(),
      { value: null },
      { value: [] },
      null,
      [],
      false,
    )) as any
  ).options;

const pieSeries = (options: any) => options.series.find((s: any) => s.type === "pie");
const gauges = (options: any) => options.series.filter((s: any) => s.type === "gauge");

describe("absent keys render exactly as today", () => {
  it.each(["gauge", "pie", "donut"])("SQL %s", async (type) => {
    expect(serialize(await viaPanel(sqlPanel(type), [rows()]))).toBe(
      serialize(await directSQL(sqlPanel(type), [rows()])),
    );
  });

  it.each(["gauge", "pie", "donut"])("PromQL %s", async (type) => {
    expect(serialize(await viaPanel(promPanel(type), promData()))).toBe(
      serialize(await directPromQL(promPanel(type), promData())),
    );
  });

  it("each pass leaves options alone without its keys", () => {
    const options = {
      series: [
        { type: "gauge", data: [{ value: 3 }], startAngle: 205 },
        { type: "pie", data: [{ name: "a", value: 1 }], label: { formatter: "{d}%" } },
        { type: "heatmap", data: [[0, 0, 1]], itemStyle: { borderWidth: 1 } },
      ],
    };
    const before = serialize(options);
    applyGaugeOptions(options, { type: "gauge", config: {} });
    applyPieOptions(options, { type: "pie", config: {} });
    applyHeatmapOptions(options, { type: "heatmap", config: {} });
    expect(serialize(options)).toBe(before);
  });
});

describe("gauge", () => {
  it("draws the arc and circle shapes", async () => {
    const arc = gauges(await viaPanel(sqlPanel("gauge", { gauge_style: "arc" }), [rows()]))[0];
    expect([arc.startAngle, arc.endAngle]).toEqual([225, -45]);
    const circle = gauges(
      await viaPanel(promPanel("gauge", { gauge_style: "circle" }), promData()),
    )[0];
    expect([circle.startAngle, circle.endAngle]).toEqual([90, -270]);
    const semi = gauges(await viaPanel(sqlPanel("gauge", { gauge_style: "semi" }), [rows()]))[0];
    expect([semi.startAngle, semi.endAngle]).toEqual([205, -25]);
  });

  it("rounds only the bar, never the threshold track", async () => {
    const [gauge] = gauges(await viaPanel(sqlPanel("gauge", { gauge_round_cap: true }), [rows()]));
    expect(gauge.progress.roundCap).toBe(true);
    expect(gauge.axisLine.roundCap).toBeUndefined();
  });

  it.each(["semi", "arc", "circle"])(
    "%s: segments draw as gaps on top of the bar, inside the chart",
    async (style) => {
      const options = await viaPanel(
        sqlPanel("gauge", { gauge_style: style, gauge_segments: 12, gauge_round_cap: true }),
        [rows()],
      );
      const dials = gauges(options).filter((s: any) => s.data.length);
      const overlays = gauges(options).filter((s: any) => !s.data.length);
      expect(overlays).toHaveLength(dials.length);
      overlays.forEach((overlay: any, i: number) => {
        expect(overlay.silent).toBe(true);
        expect(overlay.splitNumber).toBe(12);
        expect(overlay.z).toBeGreaterThan(dials[i].z ?? 2);
        expect([overlay.startAngle, overlay.endAngle]).toEqual([
          dials[i].startAngle,
          dials[i].endAngle,
        ]);
        expect(overlay.center).toEqual(dials[i].center);
      });
      const chart = echarts.init(null as any, null, {
        renderer: "svg",
        ssr: true,
        width: 800,
        height: 400,
      });
      chart.setOption(options);
      const svg = chart.renderToSVGString();
      chart.dispose();
      const gaps = [
        ...svg.matchAll(/<path d="M([-\d.]+) ([-\d.]+)L([-\d.]+) ([-\d.]+)"[^>]*stroke-width="3"/g),
      ];
      expect(gaps.length).toBeGreaterThanOrEqual(12);
      for (const [, ...coords] of gaps) {
        coords.map(Number).forEach((c) => expect(Math.abs(c)).toBeLessThan(800));
      }
    },
  );

  it("adds no overlay without segments", async () => {
    const options = await viaPanel(sqlPanel("gauge", { gauge_round_cap: true }), [rows()]);
    expect(gauges(options).every((s: any) => s.data.length)).toBe(true);
  });

  it("fills from the neutral value to the current value", async () => {
    const [above, below] = gauges(
      await viaPanel(sqlPanel("gauge", { gauge_neutral: 50 }), [rows()]),
    );
    expect(above.progress.show).toBe(false);
    const track = chartColor("--color-border-subtle");
    expect(above.axisLine.lineStyle.color[0]).toEqual([0.5, track]);
    expect(above.axisLine.lineStyle.color[1][0]).toBe(0.7);
    expect(above.axisLine.lineStyle.color[2]).toEqual([1, track]);
    expect(below.axisLine.lineStyle.color.map((stop: any) => stop[0])).toEqual([0.25, 0.5, 1]);
  });
});

describe("pie and donut", () => {
  it("builds the label from the chosen parts", async () => {
    const series = pieSeries(
      await viaPanel(sqlPanel("pie", { pie_label_content: ["name", "percent"] }), [rows()]),
    );
    expect(series.label.formatter({ name: "/a", value: 70, percent: 70 })).toBe("/a · 70%");
    const valueOnly = pieSeries(
      await viaPanel(promPanel("donut", { pie_label_content: ["value"] }), promData()),
    );
    expect(valueOnly.label.formatter({ name: "api", value: 70, percent: 70 })).toBe("70");
  });

  it.each(["pie", "donut"])(
    "%s inside labels carry no slice-colour halo, in dark or light mode",
    async (type) => {
      const labelStrokes = async (theme: string) => {
        store.state.theme = theme;
        try {
          const options = await viaPanel(sqlPanel(type), [rows()]);
          const chart = echarts.init(null as any, null, {
            renderer: "svg",
            ssr: true,
            width: 800,
            height: 400,
          });
          chart.setOption({
            ...options,
            backgroundColor: theme === "dark" ? "#16181d" : "#ffffff",
            animation: false,
          });
          const svg = chart.renderToSVGString();
          chart.dispose();
          return [...svg.matchAll(/<text[^>]*>[\d.]+%<\/text>/g)].map(([tag]) =>
            /stroke="(?!none)[^"]+"/.test(tag),
          );
        } finally {
          store.state.theme = "light";
        }
      };
      const dark = await labelStrokes("dark");
      expect(dark.length).toBeGreaterThan(0);
      expect(dark.every((stroked) => !stroked)).toBe(true);
      const light = await labelStrokes("light");
      expect(light.length).toBeGreaterThan(0);
      expect(light.every((stroked) => !stroked)).toBe(true);
    },
  );

  it("orders the parts name, value, percent whatever order they were picked in", async () => {
    const series = pieSeries(
      await viaPanel(sqlPanel("pie", { pie_label_content: ["percent", "name", "value"] }), [
        rows(),
      ]),
    );
    expect(series.label.formatter({ name: "/a", value: 70, percent: 70 })).toBe("/a · 70 · 70%");
  });

  it("hides labels when no part is chosen", async () => {
    const series = pieSeries(await viaPanel(sqlPanel("pie", { pie_label_content: [] }), [rows()]));
    expect(series.label.show).toBe(false);
  });

  it("colours percent labels inside each slice by the slice's luminance", () => {
    const options = {
      series: [
        {
          type: "pie",
          label: { show: true, position: "inside" },
          data: [
            { name: "pale", value: 1, itemStyle: { color: "#fde68a" } },
            { name: "deep", value: 1, itemStyle: { color: "#1e3a8a" } },
          ],
        },
      ],
    };
    applyPieOptions(options, { type: "donut", config: { pie_label_content: ["percent"] } });
    const [pale, deep] = options.series[0].data as any[];
    expect(options.series[0].label.position).toBe("inside");
    expect(pale.label.color).toBe(chartColor("--color-black"));
    expect(deep.label.color).toBe(chartColor("--color-white"));
  });

  const regionRows = ["eu-west", "us-west", "sa-east", "ap-south", "us-east"].map((name, i) => ({
    x_axis_1: name,
    y_axis_1: 3500 + i * 40,
  }));

  const renderDonut = async (width: number, height: number, config: Record<string, any> = {}) => {
    const panel = sqlPanel("donut", {
      pie_label_content: ["name", "percent"],
      donut_inner_radius: 55,
      show_legends: false,
      ...config,
    });
    const options = (
      (await convertPanelData(
        panel,
        [regionRows],
        store,
        { value: { offsetWidth: width, offsetHeight: height } },
        { value: null },
        { value: [] },
        metadata,
        { height: `${height}px` },
        { value: [] },
        false,
      )) as any
    ).options;
    const chart = echarts.init(null as any, null, { renderer: "svg", ssr: true, width, height });
    chart.setOption({ ...options, animation: false });
    const labels = (chart.getZr() as any).storage
      .getDisplayList(true)
      .filter((el: any) => typeof el.style?.text === "string" && el.style.text !== "")
      .map((label: any) => {
        const box = label.getBoundingRect().clone();
        box.applyTransform(label.getComputedTransform());
        return { text: label.style.text as string, box };
      });
    const data = (chart.getModel() as any).getSeriesByIndex(0).getData();
    const fills = regionRows.map((_, i) => data.getItemVisual(i, "style").fill);
    chart.dispose();
    return { series: pieSeries(options), labels, fills };
  };

  it("keeps whole name labels outside, in the theme text colour, where the panel has room", async () => {
    const { series, labels } = await renderDonut(800, 400);
    expect(series.label.position).toBe("outside");
    expect(series.label.color).toBe(chartColor("--color-text-body"));
    expect(series.avoidLabelOverlap).toBe(true);
    expect(labels.length).toBe(regionRows.length);
    labels.forEach(({ text, box }) => {
      expect(text).toMatch(/^[a-z]+-[a-z]+ · \d+%$/);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(800);
    });
  });

  it("falls back to whole percents inside the slices when names would be cut", async () => {
    for (const [width, height] of [
      [146, 190],
      [246, 220],
    ]) {
      const { series, labels, fills } = await renderDonut(width, height);
      expect(series.label.position).toBe("inside");
      expect(labels.length).toBeGreaterThan(0);
      labels.forEach(({ text }) => expect(text, `${width}px`).toMatch(/^\d+%$/));
      series.data.forEach((slice: any, index: number) =>
        expect(slice.label.color).toBe(labelColorOn(fills[index])),
      );
    }
  });

  it("buckets small slices into Other and keeps it last", async () => {
    const series = pieSeries(
      await viaPanel(sqlPanel("pie", { pie_other_threshold: 5, sort_order: "asc" }), [rows()]),
    );
    expect(series.data.map((slice: any) => [slice.name, slice.value])).toEqual([
      ["/b", 25],
      ["/a", 70],
      ["Other", 5],
    ]);
  });

  it("leaves a single small slice alone", () => {
    const options = {
      series: [
        {
          type: "pie",
          data: [
            { name: "a", value: 99 },
            { name: "b", value: 1 },
          ],
        },
      ],
    };
    applyPieOptions(options, { type: "pie", config: { pie_other_threshold: 5 } });
    expect(options.series[0].data).toHaveLength(2);
  });

  it("sorts slices descending on PromQL", async () => {
    const series = pieSeries(await viaPanel(promPanel("pie", { sort_order: "desc" }), promData()));
    expect(series.data.map((slice: any) => slice.value)).toEqual([70, 25, 3, 2]);
  });

  it("sizes the donut hole as a share of the outer radius", async () => {
    const series = pieSeries(
      await viaPanel(sqlPanel("donut", { donut_inner_radius: 50 }), [rows()]),
    );
    const outer = parseFloat(series.radius[1]);
    expect(parseFloat(series.radius[0])).toBeCloseTo(outer / 2, 1);
    const pie = pieSeries(await viaPanel(sqlPanel("pie", { donut_inner_radius: 50 }), [rows()]));
    expect(Array.isArray(pie.radius)).toBe(false);
  });
});

describe("heatmap", () => {
  const options = () => ({
    series: [
      {
        type: "heatmap",
        itemStyle: { borderColor: "#fff", borderWidth: 1 },
        data: [[0, 0, 1], [1, 0, 5], { value: [2, 0, 9] }, [3, 0, null]],
      },
    ],
  });

  it("sets the cell gap", () => {
    const converted = options();
    applyHeatmapOptions(converted, { type: "heatmap", config: { heatmap_cell_gap: 4 } });
    expect(converted.series[0].itemStyle).toEqual({ borderColor: "#fff", borderWidth: 4 });
  });

  it("hides cells below the value and keeps empty ones", () => {
    const converted = options();
    applyHeatmapOptions(converted, { type: "heatmap", config: { heatmap_hide_below: 5 } });
    expect(converted.series[0].data).toEqual([[1, 0, 5], { value: [2, 0, 9] }, [3, 0, null]]);
  });

  it("names the hidden range in a corner note and moves the plot down for it", () => {
    const converted: any = { ...options(), grid: { top: 30 } };
    applyHeatmapOptions(converted, {
      type: "heatmap",
      config: { heatmap_hide_below: 1500, unit: "bytes", decimals: 1 },
    });
    expect(converted.graphic).toHaveLength(1);
    expect(converted.graphic[0]).toMatchObject({ type: "text", right: 8, top: 4, silent: true });
    expect(converted.graphic[0].style.text).toBe(
      gt("dashboard.heatmapHideBelowNote", { value: "1.5KB" }),
    );
    expect(converted.grid.top).toBe(46);
  });

  it("adds no note while nothing is hidden", () => {
    const converted: any = { ...options(), grid: { top: 30 } };
    applyHeatmapOptions(converted, { type: "heatmap", config: { heatmap_cell_gap: 2 } });
    expect(converted.graphic).toBeUndefined();
    expect(converted.grid.top).toBe(30);
  });

  it("applies both on a converted SQL heatmap", async () => {
    const panel = sqlPanel(
      "heatmap",
      { heatmap_cell_gap: 3, heatmap_hide_below: 10 },
      {
        x: [{ label: "X", alias: "x", column: "x", args: [] }],
        y: [{ label: "Y", alias: "y", column: "y", args: [] }],
        z: [{ label: "Z", alias: "z", column: "z", args: [] }],
      },
    );
    panel.queries[0].customQuery = true;
    const converted = await viaPanel(panel, [
      [
        { x: "a", y: "r", z: 5 },
        { x: "b", y: "r", z: 20 },
      ],
    ]);
    const heatmap = converted.series.find((s: any) => s.type === "heatmap");
    expect(heatmap.itemStyle.borderWidth).toBe(3);
    expect(
      heatmap.data.map((point: any) => (Array.isArray(point) ? point : point.value)[2]),
    ).toEqual([20]);
  });
});
