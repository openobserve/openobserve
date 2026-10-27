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

import { afterEach, describe, expect, it, vi } from "vitest";
import * as echarts from "echarts";
import { getECData } from "echarts/lib/util/innerStore";
import { gt } from "@/types/i18n";
import { convertPanelData } from "@/utils/dashboard/convertPanelData";
import { convertStateTimelineData } from "@/utils/dashboard/convertStateTimelineData";
import { usePanelDrilldown } from "./usePanelDrilldown";

vi.mock("@/utils/dashboard/convertCustomChartData", () => ({
  runJavaScriptCode: vi.fn(),
  validateUserCode: vi.fn(() => null),
}));

vi.mock("@/utils/zincutils", () => ({
  b64EncodeUnicode: (v: string) => `b64(${v})`,
  escapeSingleQuotes: (v: string) => v,
  useLocalOrganization: () => null,
  useLocalCurrentUser: () => null,
  useLocalTimezone: () => null,
}));

const WIDTH = 800;
const HEIGHT = 400;
const store = {
  state: {
    theme: "light",
    timezone: "UTC",
    zoConfig: {
      timestamp_column: "_timestamp",
      max_dashboard_series: 1000,
      enable_cross_linking: false,
    },
    selectedOrganization: { identifier: "default" },
  },
  dispatch: vi.fn(),
};
const drilldown = [{ name: "Logs", type: "byUrl", data: { url: "https://example.com" } }];

const field = (alias: string, column: string, functionName: string | null = null) => ({
  label: column,
  alias,
  column,
  functionName,
  args: [{ type: "field", value: { field: column } }],
  isDerived: false,
  havingConditions: [],
});

const panel = (type: string, fields: Record<string, any>) => ({
  id: type,
  type,
  title: type,
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
      config: { limit: 0 },
      joins: [],
    },
  ],
  config: { show_legends: false, unit: "default", decimals: 0, drilldown },
});

const x = field("x_axis_1", "service");
const count = field("y_axis_1", "_timestamp", "count");
const raw = field("y_axis_1", "latency_ms");
const region = field("breakdown_1", "region");
const grouped = [
  { x_axis_1: "checkout", breakdown_1: "eu", y_axis_1: 40 },
  { x_axis_1: "checkout", breakdown_1: "us", y_axis_1: 25 },
  { x_axis_1: "search", breakdown_1: "eu", y_axis_1: 20 },
];
const latencies = [12, 40, 41, 43, 80, 95, 120, 130].flatMap((value) => [
  { x_axis_1: "checkout", y_axis_1: value },
  { x_axis_1: "search", y_axis_1: value / 2 },
]);

const viaPanel = async (schema: any, rows: any[]) =>
  (await convertPanelData(
    schema,
    [rows],
    store,
    { value: { offsetWidth: WIDTH, offsetHeight: HEIGHT } },
    { value: null },
    { value: [] },
    { queries: [] },
    { height: `${HEIGHT}px` },
    { value: [] },
    false,
  )) as any;

const cases: Record<string, () => Promise<{ schema: any; options: any }>> = {
  funnel: async () => {
    const schema = panel("funnel", { x: [x], y: [count] });
    return { schema, options: (await viaPanel(schema, grouped)).options };
  },
  treemap: async () => {
    const schema = panel("treemap", { x: [x], y: [count], breakdown: [region] });
    return { schema, options: (await viaPanel(schema, grouped)).options };
  },
  sunburst: async () => {
    const schema = panel("sunburst", { x: [x], y: [count], breakdown: [region] });
    return { schema, options: (await viaPanel(schema, grouped)).options };
  },
  "bar-gauge": async () => {
    const schema = panel("bar-gauge", { x: [x], y: [count] });
    return { schema, options: (await viaPanel(schema, grouped)).options };
  },
  boxplot: async () => {
    const schema = panel("boxplot", { x: [x], y: [raw] });
    return { schema, options: (await viaPanel(schema, latencies)).options };
  },
  distribution: async () => {
    const schema = panel("distribution", { y: [raw] });
    return { schema, options: (await viaPanel(schema, latencies)).options };
  },
  "node-graph": async () => {
    const schema = panel("node-graph", {
      source: field("source", "source_service"),
      target: field("target", "target_service"),
      value: field("value", "_timestamp", "count"),
    });
    const edges = [
      { source: "web", target: "api", value: 30 },
      { source: "api", target: "db", value: 20 },
    ];
    return { schema, options: (await viaPanel(schema, edges)).options };
  },
  "status-history": async () => {
    const schema = {
      ...panel("status-history", {}),
      queries: [
        {
          fields: {
            x: [{ alias: "x_axis_1" }],
            y: [{ alias: "y_axis_1", label: "errors" }],
            breakdown: [
              { alias: "breakdown_1", args: [{ type: "field", value: { field: "host" } }] },
            ],
          },
        },
      ],
    };
    const rows = [0, 10, 20].map((seconds) => ({
      x_axis_1: new Date(seconds * 1000).toISOString().slice(0, -1),
      breakdown_1: "host-a",
      y_axis_1: seconds,
    }));
    const result: any = convertStateTimelineData(
      schema,
      [rows],
      store,
      { value: { offsetWidth: WIDTH, offsetHeight: HEIGHT } },
      [[{ histogram_interval: 10 }]],
      null,
    );
    return { schema, options: result.options };
  },
};

/** The centre of the largest drawn element that belongs to a data item, in chart pixels. */
const dataItemPoint = (chart: echarts.ECharts) => {
  const zr = chart.getZr();
  zr.flush();
  let best: { x: number; y: number; area: number } | null = null;
  zr.storage.getDisplayList(true).forEach((el: any) => {
    const ecData = getECData(el);
    if (el.silent || el.ignore || ecData?.dataIndex == null || el.type === "text") return;
    const rect = el.getBoundingRect().clone();
    const transform = el.getComputedTransform();
    if (transform) rect.applyTransform(transform);
    const area = rect.width * rect.height;
    if (!best || area > best.area) {
      best = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, area };
    }
  });
  return best as { x: number; y: number; area: number } | null;
};

const charts: echarts.ECharts[] = [];
afterEach(() => {
  charts.splice(0).forEach((chart) => chart.dispose());
});

describe("drilldown on the new chart types", () => {
  it.each(Object.keys(cases))(
    "a click on a %s data item opens the drilldown menu and hides the tooltip",
    async (type) => {
      const { schema, options } = await cases[type]();
      const element = document.createElement("div");
      document.body.appendChild(element);
      const chart = echarts.init(element, null, { renderer: "svg", width: WIDTH, height: HEIGHT });
      charts.push(chart);
      chart.setOption({ ...options, animation: false });

      const popup = {
        style: { display: "none", top: "", left: "" },
        offsetHeight: 20,
        offsetWidth: 40,
      };
      const hideChartTooltip = vi.fn();
      const api = usePanelDrilldown({
        panelSchema: { value: schema },
        variablesData: { value: { values: [] } },
        selectedTimeObj: { value: { start_time: new Date(0), end_time: new Date(3_600_000) } },
        metadata: { value: { queries: [] } },
        data: { value: [] },
        panelData: { value: { options } },
        filteredData: { value: [] },
        resultMetaData: { value: [] },
        store,
        route: { query: {} },
        router: { push: vi.fn() },
        emit: vi.fn(),
        allowAnnotationsAdd: { value: false },
        isAddAnnotationMode: { value: false },
        editAnnotation: vi.fn(),
        handleAddAnnotation: vi.fn(),
        chartPanelRef: {
          value: {
            offsetHeight: HEIGHT,
            offsetWidth: WIDTH,
            getBoundingClientRect: () => ({ left: 0, top: 0 }),
          },
        },
        drilldownPopUpRef: { value: popup },
        annotationPopupRef: { value: { style: {} } },
        selectedAnnotationData: { value: null },
        isCursorOverPanel: { value: true },
        showErrorNotification: vi.fn(),
        hideChartTooltip,
        t: gt,
      } as any);
      const clicked = new Promise<any>((resolve) =>
        chart.on("click", async (params: any) => {
          await api.onChartClick(params);
          resolve(params);
        }),
      );

      const point = dataItemPoint(chart);
      expect(point, `${type} draws a clickable data item`).not.toBeNull();
      const event = {
        zrX: point!.x,
        zrY: point!.y,
        offsetX: point!.x,
        offsetY: point!.y,
        stop: () => {},
        preventDefault: () => {},
      };
      // ECharts counts a click only after a press and release on the same element.
      const handler = chart.getZr().handler as any;
      ["mousedown", "mouseup", "click"].forEach((name) => handler.dispatch(name, event));
      const params = await clicked;

      expect(params.componentType).toBe("series");
      expect(params.dataIndex).not.toBeUndefined();
      expect(popup.style.display).toBe("block");
      expect(api.drilldownArray.value.map((item: any) => item.name)).toEqual(["Logs"]);
      expect(hideChartTooltip).toHaveBeenCalledTimes(1);
    },
  );
});
