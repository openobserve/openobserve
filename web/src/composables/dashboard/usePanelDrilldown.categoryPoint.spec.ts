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

// The point menu on SQL category charts, with the axis built by the real converter.
import { describe, expect, it, vi } from "vitest";
import { gt } from "@/types/i18n";
import { convertMultiSQLData } from "@/utils/dashboard/convertSQLData";
import { filtersWhere } from "@/utils/dashboard/chartPointExplore";
import { usePanelDrilldown } from "./usePanelDrilldown";

vi.mock("@/aws-exports", () => ({ default: { isEnterprise: "false" } }));

const START_US = 1704067200000000;
const END_US = 1704068400000000;
const SQL = 'SELECT svc, count(*) AS cnt FROM "default" GROUP BY svc';

const store = {
  state: {
    theme: "light",
    timezone: "UTC",
    selectedOrganization: { identifier: "default" },
    zoConfig: { timestamp_column: "_timestamp", max_dashboard_series: 100, features: {} },
  },
  dispatch: vi.fn(),
};

const fieldOf = (name: string) => ({
  label: name,
  alias: name,
  args: [{ type: "field", value: { field: name } }],
});
const svc = fieldOf("svc");

const panelOf = (type: string, x: any[]) => ({
  id: "p",
  type,
  queryType: "sql",
  config: { drilldown: [] },
  queries: [
    {
      query: SQL,
      customQuery: false,
      fields: {
        stream: "default",
        stream_type: "logs",
        x,
        y: [{ label: "cnt", alias: "cnt", column: "cnt", aggregationFunction: "count", args: [] }],
        z: [],
        breakdown: [],
        filter: { conditions: [] },
      },
      config: {},
    },
  ],
});

const metadata = {
  queries: [
    {
      query: SQL,
      startTime: START_US,
      endTime: END_US,
      timeRangeGap: { seconds: 0, periodAsStr: "" },
      panelQueryIndex: 0,
    },
  ],
};

const drilldown = async (type: string, rows: Record<string, unknown>[], x: any[] = [svc]) => {
  const schema = panelOf(type, x);
  const data = [rows];
  const result: any = await convertMultiSQLData(
    schema,
    data,
    store,
    { value: { offsetWidth: 800, offsetHeight: 400 } },
    { value: null },
    { value: [[]] },
    metadata,
    { height: "400px" },
    { value: [] },
    false,
  );
  const api = usePanelDrilldown({
    panelSchema: { value: schema },
    variablesData: { value: { values: [] } },
    selectedTimeObj: { value: { start_time: new Date(START_US), end_time: new Date(END_US) } },
    metadata: { value: metadata },
    data: { value: data },
    panelData: { value: result },
    filteredData: { value: data },
    resultMetaData: { value: [[]] },
    store,
    route: { query: {} },
    router: { push: vi.fn(), resolve: vi.fn(() => ({ href: "" })) },
    emit: vi.fn(),
    allowAnnotationsAdd: { value: false },
    isAddAnnotationMode: { value: false },
    editAnnotation: vi.fn(),
    handleAddAnnotation: vi.fn(),
    chartPanelRef: { value: { offsetHeight: 300, offsetWidth: 300 } },
    drilldownPopUpRef: { value: { style: {}, offsetHeight: 20, offsetWidth: 40 } },
    annotationPopupRef: { value: { style: {}, offsetHeight: 20, offsetWidth: 40 } },
    selectedAnnotationData: { value: null },
    isCursorOverPanel: { value: true },
    showErrorNotification: vi.fn(),
    t: gt,
    onExemplarClick: vi.fn(),
    findRelatedTelemetry: vi.fn(),
    allowPointExplore: { value: true },
  } as any);
  return { api, options: result.options };
};

// The category labels the chart drew, from its own axis (an h-bar draws them on y, a pie as slices).
const labelsOf = (options: any, type: string): string[] => {
  if (type === "pie" || type === "donut") return options.series[0].data.map((s: any) => s.name);
  const axes = type.startsWith("h-") ? options.yAxis : options.xAxis;
  return (Array.isArray(axes) ? axes[0] : axes).data;
};

const clickCategory = async (api: any, options: any, type: string, label: string) => {
  const dataIndex = labelsOf(options, type).indexOf(label);
  expect(dataIndex).toBeGreaterThanOrEqual(0);
  const slice = type === "pie" || type === "donut" ? options.series[0].data[dataIndex] : 10;
  await api.explorePoint({
    componentType: "series",
    seriesIndex: 0,
    dataIndex,
    name: label,
    value: slice,
    data: slice,
    event: { offsetX: 1, offsetY: 1 },
  });
  return filtersWhere("", api.pointExplore.value?.target.filters ?? []);
};

const rows = [
  { svc: null, cnt: 10 },
  { svc: "", cnt: 10 },
  { svc: "checkout", cnt: 5 },
];

describe("point menu on SQL category charts", () => {
  it.each(["bar", "h-bar", "line", "area", "stacked", "pie", "donut"])(
    "%s: the (null) and (empty) categories filter their own raw values",
    async (type) => {
      const { api, options } = await drilldown(type, rows);
      expect(await clickCategory(api, options, type, "(null)")).toBe("svc IS NULL");
      expect(await clickCategory(api, options, type, "(empty)")).toBe("svc = ''");
      expect(await clickCategory(api, options, type, "checkout")).toBe("svc = 'checkout'");
    },
  );

  it("a real value spelled (null) still filters itself", async () => {
    const { api, options } = await drilldown("bar", [
      { svc: "(null)", cnt: 3 },
      { svc: "checkout", cnt: 5 },
    ]);
    expect(await clickCategory(api, options, "bar", "(null)")).toBe("svc = '(null)'");
  });

  it("the x part of a two-field chart reads raw values too", async () => {
    const { api, options } = await drilldown(
      "bar",
      [
        { svc: null, level: "info", cnt: 10 },
        { svc: "", level: "warn", cnt: 10 },
      ],
      [svc, fieldOf("level")],
    );
    const axes = options.xAxis;
    const dataIndex = axes[0].data.indexOf("(null)");
    expect(dataIndex).toBeGreaterThanOrEqual(0);
    await api.explorePoint({
      componentType: "series",
      seriesIndex: 0,
      dataIndex,
      name: "(null)",
      value: 10,
      event: { offsetX: 1, offsetY: 1 },
    });
    expect(api.pointExplore.value?.target.filters).toEqual([
      { field: "svc", value: null },
      { field: "level", value: "info" },
    ]);
  });
});
