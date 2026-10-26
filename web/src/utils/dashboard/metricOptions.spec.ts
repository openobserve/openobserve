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
import {
  buildMetricChange,
  effectiveTimeShifts,
  isStatChangeOn,
  splitStatChangeResults,
} from "./metricOptions";
import { checkIfConfigChangeRequiredApiCallOrNot } from "./checkConfigChangeApiCall";
import { chartColor } from "@/utils/chartTheme";

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

  it("stat change off keeps every result on screen", async () => {
    const metadata = { queries: [meta(0), meta(3_600_000)] };
    const data = [[{ y_axis_1: 120 }], [{ y_axis_1: 100 }]];
    const panel = () => sqlMetric({ stat_change: "off" });
    expect(serialize(await viaPanel(panel(), data, metadata))).toBe(
      serialize(await directSQL(panel(), data, metadata)),
    );
  });
});

describe("stat change", () => {
  it("is on only for a metric with percent or absolute", () => {
    expect(isStatChangeOn(sqlMetric({ stat_change: "percent" }))).toBe(true);
    expect(isStatChangeOn(sqlMetric({ stat_change: "absolute" }))).toBe(true);
    expect(isStatChangeOn(sqlMetric({ stat_change: "off" }))).toBe(false);
    expect(isStatChangeOn(sqlMetric())).toBe(false);
    expect(isStatChangeOn({ type: "gauge", config: { stat_change: "percent" } })).toBe(false);
  });

  it("runs the previous period when the query has no time shift of its own", () => {
    const panel = sqlMetric({ stat_change: "percent" });
    expect(effectiveTimeShifts(panel, panel.queries[0], START, END)).toEqual([{ offSet: "3600s" }]);
    const own = { config: { time_shift: [{ offSet: "1d" }] } };
    expect(effectiveTimeShifts(panel, own, START, END)).toEqual([{ offSet: "1d" }]);
    expect(effectiveTimeShifts(sqlMetric(), panel.queries[0], START, END)).toEqual([]);
  });

  it("pairs each current result with the first shift of the same query", () => {
    const split = splitStatChangeResults({
      queries: [meta(0, 0), meta(0, 1), meta(3_600_000, 0), meta(86_400_000, 0)],
    });
    expect(split).toEqual({ primary: [0, 1], reference: [2, -1] });
    expect(splitStatChangeResults({ queries: [] })).toBeNull();
  });

  it("asks for a new query when it is switched on or off", () => {
    const off = sqlMetric();
    const on = sqlMetric({ stat_change: "percent" });
    expect(checkIfConfigChangeRequiredApiCallOrNot(off, on)).toBe(true);
    expect(checkIfConfigChangeRequiredApiCallOrNot(on, off)).toBe(true);
    const absolute = sqlMetric({ stat_change: "absolute" });
    expect(checkIfConfigChangeRequiredApiCallOrNot(on, absolute)).toBe(false);
  });

  it("formats percent and absolute changes with their colours", () => {
    const up = chartColor("--color-status-positive");
    const down = chartColor("--color-status-negative");
    const neutral = chartColor("--color-text-secondary");
    expect(buildMetricChange(120, 100, { stat_change: "percent", decimals: 0 })).toEqual({
      text: "▲ 20%",
      color: up,
    });
    expect(buildMetricChange(80, 100, { stat_change: "percent", decimals: 1 })).toEqual({
      text: "▼ 20%",
      color: down,
    });
    expect(
      buildMetricChange(80, 100, { stat_change: "percent", stat_change_color: "inverted" })?.color,
    ).toBe(up);
    expect(
      buildMetricChange(120, 100, { stat_change: "absolute", stat_change_color: "neutral" }),
    ).toEqual({ text: "▲ 20.00", color: neutral });
    expect(buildMetricChange(100, 100, { stat_change: "percent" })).toEqual({
      text: "0%",
      color: neutral,
    });
    expect(buildMetricChange(5, 0, { stat_change: "percent" })).toBeNull();
    expect(buildMetricChange(5, null, { stat_change: "percent" })).toBeNull();
  });

  it("draws the change under a SQL metric and hides the comparison result", async () => {
    const metadata = { queries: [meta(0), meta(3_600_000)] };
    const data = [[{ y_axis_1: 120 }], [{ y_axis_1: 100 }]];
    const options = await viaPanel(sqlMetric({ stat_change: "percent" }), data, metadata);
    expect(options.series.filter((s: any) => "_metricText" in s)).toHaveLength(1);
    const lines = texts(rendered(options));
    expect(lines.map((line: any) => line.style.text)).toEqual(["120", "▲ 20%"]);
    expect(lines[1].style.fill).toBe(chartColor("--color-status-positive"));
    expect(lines[1].style.y).toBeGreaterThan(lines[0].style.y);
  });

  it("compares every cell of a SQL metric grid with its own query", async () => {
    const metadata = {
      queries: [meta(0, 0), meta(3_600_000, 0), meta(0, 1), meta(3_600_000, 1)],
    };
    const data = [
      [{ y_axis_1: 120 }],
      [{ y_axis_1: 100 }],
      [{ y_axis_1: 50 }],
      [{ y_axis_1: 100 }],
    ];
    const options = await viaPanel(sqlMetric({ stat_change: "absolute" }, 2), data, metadata);
    const cells = options.series.filter((s: any) => "_metricText" in s);
    expect(cells).toHaveLength(2);
    expect(cells.map((cell: any) => cell._metricChange.text)).toEqual(["▲ 20", "▼ 50"]);
    const grid = cells[1].renderItem({}, {});
    expect(texts(grid).map((line: any) => line.style.text)).toEqual(["50", "Latency", "▼ 50"]);
  });

  it("draws the change under a PromQL metric", async () => {
    const metadata = { queries: [meta(0), meta(3_600_000)] };
    const options = await viaPanel(
      promMetric({ stat_change: "percent" }),
      [promValue(150), promValue(100)],
      metadata,
    );
    expect(texts(rendered(options)).map((line: any) => line.style.text)).toEqual(["150", "▲ 50%"]);
  });

  it("shows no change line while the comparison has no data", async () => {
    const metadata = { queries: [meta(0)] };
    const options = await viaPanel(
      sqlMetric({ stat_change: "percent" }),
      [[{ y_axis_1: 120 }]],
      metadata,
    );
    expect(texts(rendered(options))).toHaveLength(1);
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
