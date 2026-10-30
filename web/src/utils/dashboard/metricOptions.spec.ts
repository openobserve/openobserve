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
import { convertMultiSQLData } from "./convertSQLData";
import { convertPromQLData } from "./convertPromQLData";

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
const START = 1704067200000000;
const END = 1704070800000000;

const yField = {
  label: "Latency",
  alias: "y_axis_1",
  column: "latency",
  functionName: "avg",
  aggregationFunction: "avg",
  args: [{ type: "field", value: { field: "latency" } }],
};

const sqlMetric = (config: Record<string, any> = {}, queries = 1) => ({
  id: "m",
  type: "metric",
  queryType: "sql",
  queries: Array.from({ length: queries }, (_, index) => ({
    query: `SELECT ${index}`,
    customQuery: false,
    fields: { stream: "default", stream_type: "logs", x: [], y: [yField], z: [], breakdown: [] },
    config: { time_shift: [] },
  })),
  config: { unit: "default", decimals: 0, ...config },
});

const meta = (seconds: number, panelQueryIndex = 0) => ({
  query: "SELECT 1",
  startTime: START - seconds * 1000,
  endTime: END - seconds * 1000,
  timeRangeGap: { seconds, periodAsStr: seconds ? "1 hour ago" : "" },
  panelQueryIndex,
});

const viaPanel = async (panel: any, data: any[], metadata: any) =>
  (
    (await convertPanelData(
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

const directSQL = async (panel: any, data: any[], metadata: any) =>
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

const promMetric = (config: Record<string, any> = {}) => ({
  id: "pm",
  type: "metric",
  queryType: "promql",
  queries: [
    {
      query: "up",
      customQuery: true,
      fields: { stream: "up", stream_type: "metrics", x: [], y: [], z: [], breakdown: [] },
      config: { promql_legend: "", time_shift: [] },
    },
  ],
  config: { unit: "default", decimals: 0, ...config },
});
const promValue = (value: number) => ({
  resultType: "matrix",
  result: [{ metric: { job: "api" }, values: [[1704067200, String(value)]] }],
});
const directPromQL = async (panel: any, data: any[], metadata: any) =>
  (
    (await convertPromQLData(
      panel,
      data,
      store,
      panelRef(),
      { value: null },
      { value: [] },
      metadata,
      [],
      false,
    )) as any
  ).options;

const textSeries = (options: any) => options.series.find((s: any) => "_metricText" in s);
const rendered = (options: any) =>
  textSeries(options).renderItem({ coordSys: { cx: 400, cy: 200 } }, {});
const texts = (node: any) =>
  (node.type === "group" ? node.children : [node]).filter((child: any) => child.type === "text");

describe("metric settings absent", () => {
  it("SQL single metric renders exactly as today", async () => {
    const metadata = { queries: [meta(0)] };
    const data = [[{ y_axis_1: 120 }]];
    expect(serialize(await viaPanel(sqlMetric(), data, metadata))).toBe(
      serialize(await directSQL(sqlMetric(), data, metadata)),
    );
    expect(texts(rendered(await viaPanel(sqlMetric(), data, metadata)))).toHaveLength(1);
  });

  it("SQL metric grid renders exactly as today", async () => {
    const metadata = { queries: [meta(0, 0), meta(0, 1)] };
    const data = [[{ y_axis_1: 120 }], [{ y_axis_1: 80 }]];
    const panel = () => sqlMetric({}, 2);
    expect(serialize(await viaPanel(panel(), data, metadata))).toBe(
      serialize(await directSQL(panel(), data, metadata)),
    );
  });

  it("PromQL metric renders exactly as today", async () => {
    const metadata = { queries: [meta(0)] };
    const data = [promValue(42)];
    expect(serialize(await viaPanel(promMetric(), data, metadata))).toBe(
      serialize(await directPromQL(promMetric(), data, metadata)),
    );
  });
});

describe("text mode and value size", () => {
  const metadata = { queries: [meta(0)] };
  const data = [[{ y_axis_1: 120 }]];

  it("adds the name under a single value", async () => {
    const options = await viaPanel(sqlMetric({ stat_text_mode: "value_and_name" }), data, metadata);
    expect(texts(rendered(options)).map((line: any) => line.style.text)).toEqual([
      "120",
      "Latency",
    ]);
  });

  it("shows only the name", async () => {
    const options = await viaPanel(sqlMetric({ stat_text_mode: "name" }), data, metadata);
    expect(texts(rendered(options)).map((line: any) => line.style.text)).toEqual(["Latency"]);
  });

  it("names a label-less PromQL result by nothing rather than {}", async () => {
    const bare = { resultType: "matrix", result: [{ metric: {}, values: [[1704067200, "7"]] }] };
    const both = await viaPanel(promMetric({ stat_text_mode: "value_and_name" }), [bare], metadata);
    expect(texts(rendered(both)).map((line: any) => line.style.text)).toEqual(["7"]);
    const name = await viaPanel(promMetric({ stat_text_mode: "name" }), [bare], metadata);
    expect(texts(rendered(name)).map((line: any) => line.style.text)).toEqual(["7"]);
    const labelled = await viaPanel(
      promMetric({ stat_text_mode: "value_and_name" }),
      [promValue(7)],
      metadata,
    );
    expect(texts(rendered(labelled))).toHaveLength(2);
  });

  it("shows a special null mapping for a PromQL metric with no samples", async () => {
    const mappings = [{ type: "special", match: "null", text: "N/A", color: null }];
    const empty = { resultType: "matrix", result: [] };
    const mapped = await viaPanel(promMetric({ mappings }), [empty], metadata);
    expect(textSeries(mapped)._metricText).toBe("N/A");
    const plain = await viaPanel(promMetric(), [empty], metadata);
    expect(textSeries(plain)).toBeUndefined();
  });

  it("drops the grid label in value mode", async () => {
    const options = await viaPanel(
      sqlMetric({ stat_text_mode: "value" }, 2),
      [[{ y_axis_1: 1 }], [{ y_axis_1: 2 }]],
      { queries: [meta(0, 0), meta(0, 1)] },
    );
    const cell = options.series[0].renderItem({}, {});
    expect(texts(cell).map((line: any) => line.style.text)).toEqual(["1"]);
  });

  it("uses a fixed value font size and moves the copy button with it", async () => {
    const options = await viaPanel(sqlMetric({ value_font_size: 40 }), data, metadata);
    expect(texts(rendered(options))[0].style.fontSize).toBe(40);
    expect(textSeries(options)._metricLayout.fontSize).toBe(40);
  });
});
