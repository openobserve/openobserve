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
import { convertPanelData } from "./convertPanelData";

vi.mock("./convertCustomChartData", () => ({
  runJavaScriptCode: vi.fn(),
  validateUserCode: vi.fn(() => null),
}));

const store = {
  state: {
    theme: "dark",
    timezone: "UTC",
    zoConfig: { timestamp_column: "_timestamp", max_dashboard_series: 1000 },
    selectedOrganization: { identifier: "default" },
  },
};
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

const sqlGauge = (config: Record<string, any>) => ({
  id: "g",
  type: "gauge",
  queryType: "sql",
  queries: [
    {
      query: "SELECT avg(cpu_pct) AS y_axis_1 FROM demo_app",
      customQuery: false,
      fields: {
        stream: "demo_app",
        stream_type: "logs",
        x: [],
        y: [{ label: "CPU", alias: "y_axis_1", column: "cpu_pct", functionName: "avg", args: [] }],
        z: [],
        breakdown: [],
      },
      config: { min: 0, max: 100 },
    },
  ],
  config: { show_legends: true, decimals: 0, unit: "percent", ...config },
});

const promGauge = () => ({
  id: "pg",
  type: "gauge",
  queryType: "promql",
  queries: [
    {
      query: "avg(cpu)",
      customQuery: true,
      fields: { stream: "cpu", stream_type: "metrics", x: [], y: [], z: [], breakdown: [] },
      config: { promql_legend: "", min: 0, max: 100 },
    },
  ],
  config: { show_legends: true, decimals: 0, unit: "percent" },
});

const convert = async (panel: any, data: any, width: number) =>
  (
    (await convertPanelData(
      panel,
      data,
      store,
      { value: { offsetWidth: width, offsetHeight: 300 } },
      { value: null },
      { value: [] },
      panel.queryType === "promql" ? null : metadata,
      { height: "300px" },
      { value: [] },
      false,
    )) as any
  ).options;

const detailTexts = (chart: echarts.ECharts) =>
  chart
    .getZr()
    .storage.getDisplayList(true)
    .map((el: any) => el.style?.text)
    .filter((text: unknown) => typeof text === "string" && text.endsWith("%"));

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

// Frames are stepped by hand, as a throttled background tab runs them: one now and then.
const renderTwiceThenStepOneFrame = async (first: any, second: any) => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  const el = document.createElement("div");
  document.body.appendChild(el);
  const chart = echarts.init(el, "dark", { renderer: "svg", width: 300, height: 300 });
  const animation = chart.getZr().animation;
  animation.stop();
  chart.setOption(first, { notMerge: true });
  animation.update();
  vi.advanceTimersByTime(16);
  chart.resize({ width: 260, height: 300 });
  chart.setOption(second, { notMerge: true });
  vi.advanceTimersByTime(16);
  animation.update();
  const texts = detailTexts(chart);
  chart.dispose();
  return texts;
};

describe("gauge value text", () => {
  it.each([
    ["semi", {}],
    ["arc with segments", { gauge_style: "arc", gauge_segments: 12, gauge_round_cap: true }],
  ])(
    "SQL %s: the number matches the dial when a resize re-renders it mid-animation",
    async (_name, config) => {
      const rows = [[{ y_axis_1: 51.36 }]];
      const texts = await renderTwiceThenStepOneFrame(
        await convert(sqlGauge(config), rows, 300),
        await convert(sqlGauge(config), rows, 260),
      );
      expect(texts).toEqual(["51%"]);
    },
  );

  it("SQL: a new value shows at once, not counted up frame by frame", async () => {
    const texts = await renderTwiceThenStepOneFrame(
      await convert(sqlGauge({}), [[{ y_axis_1: 0.67 }]], 300),
      await convert(sqlGauge({}), [[{ y_axis_1: 51.36 }]], 300),
    );
    expect(texts).toEqual(["51%"]);
  });

  it("PromQL: the number matches the dial when a resize re-renders it mid-animation", async () => {
    const data = [
      { resultType: "matrix", result: [{ metric: {}, values: [[1704067200, "51.36"]] }] },
    ];
    const texts = await renderTwiceThenStepOneFrame(
      await convert(promGauge(), data, 300),
      await convert(promGauge(), data, 260),
    );
    expect(texts).toEqual(["51%"]);
  });
});
