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

import { describe, expect, it } from "vitest";
import { convertMultiSQLData } from "./convertSQLData";

const store = {
  state: {
    theme: "light",
    timezone: "UTC",
    zoConfig: { timestamp_column: "_timestamp", max_dashboard_series: 1000 },
    selectedOrganization: { identifier: "default" },
  },
};
const serviceX = { label: "Service", alias: "x_axis_1", column: "service", args: [] };
const yField = (label = "Requests") => ({
  label,
  alias: "y_axis_1",
  column: "requests",
  functionName: "count",
  aggregationFunction: "count",
  args: [{ type: "field", value: { field: "requests" } }],
});
const sqlQuery = (config: Record<string, any> = {}, label?: string) => ({
  query: "SELECT 1",
  customQuery: false,
  fields: { stream: "default", stream_type: "logs", x: [serviceX], y: [yField(label)], z: [] },
  config: { min: 0, max: 100, ...config },
});
const gaugePanel = (config: Record<string, any>, queries: any[]) => ({
  id: "p",
  type: "gauge",
  queryType: "sql",
  queries,
  config: { unit: "default", decimals: 0, ...config },
});

const runSQL = async (panel: any, data: any[], size = { offsetWidth: 800, offsetHeight: 400 }) => {
  const result: any = await convertMultiSQLData(
    panel,
    data,
    store,
    { value: size },
    { value: null },
    { value: [] },
    {
      queries: data.map((_, i) => ({
        query: "SELECT 1",
        startTime: 1704067200000000,
        endTime: 1704068400000000,
        timeRangeGap: { seconds: 0, periodAsStr: "" },
        panelQueryIndex: i,
      })),
    },
    { height: "400px" },
    { value: [] },
    false,
  );
  return result.options.series.filter((s: any) => s?.type === "gauge" && !s.silent);
};

const rows = [
  { x_axis_1: "api", y_axis_1: 640 },
  { x_axis_1: "web", y_axis_1: 1500 },
];

describe("SQL gauge range", () => {
  it("keeps the fixed range when range_mode is unset", async () => {
    const gauges = await runSQL(gaugePanel({}, [sqlQuery()]), [rows]);
    expect(gauges.map((g: any) => [g.min, g.max])).toEqual([
      [0, 100],
      [0, 100],
    ]);
  });

  it("keeps an explicit max of 0", async () => {
    const [gauge] = await runSQL(gaugePanel({}, [sqlQuery({ min: -10, max: 0 })]), [
      [{ x_axis_1: "api", y_axis_1: -4 }],
    ]);
    expect([gauge.min, gauge.max]).toEqual([-10, 0]);
  });

  it("derives the range from the data in auto mode", async () => {
    const gauges = await runSQL(gaugePanel({}, [sqlQuery({ range_mode: "auto" })]), [rows]);
    expect(gauges.map((g: any) => [g.min, g.max])).toEqual([
      [0, 1500],
      [0, 1500],
    ]);
  });

  it("multi-query: auto queries share a range taken across every dial", async () => {
    const panel = gaugePanel({}, [sqlQuery({ range_mode: "auto" }), sqlQuery({}, "Other")]);
    const gauges = await runSQL(panel, [[rows[0]], [rows[1]]]);
    expect(gauges.map((g: any) => [g.min, g.max])).toEqual([
      [0, 1500],
      [0, 100],
    ]);
  });
});

describe("SQL gauge display", () => {
  const mappings = [{ type: "value", value: "640", text: "Busy", color: "#ff0000" }];
  const thresholds = {
    mode: "absolute",
    baseColor: "#00ff00",
    steps: [{ value: 1, color: "#0000ff" }],
  };

  it("shows mapped text and colour; the mapping colour beats a threshold step", async () => {
    const [api, web] = await runSQL(gaugePanel({ mappings, thresholds }, [sqlQuery()]), [rows]);
    expect(api.data[0].detail.formatter(api.data[0].value)).toBe("Busy");
    expect(api.data[0].itemStyle.color).toBe("#ff0000");
    expect(web.data[0].detail.formatter(web.data[0].value)).toBe("1500");
    expect(web.data[0].itemStyle.color).toBe("#0000ff");
  });

  it("multi-query: the mapping colour survives the merged threshold pass", async () => {
    const panel = gaugePanel({ mappings, thresholds }, [sqlQuery(), sqlQuery({}, "Other")]);
    const [api, web] = await runSQL(panel, [[rows[0]], [rows[1]]]);
    expect(api.data[0].itemStyle.color).toBe("#ff0000");
    expect(web.data[0].itemStyle.color).toBe("#0000ff");
  });

  it("labels min and max only when enabled", async () => {
    const [off] = await runSQL(gaugePanel({}, [sqlQuery()]), [rows]);
    expect(off.axisLabel.show).toBe(false);
    const [on] = await runSQL(gaugePanel({ show_gauge_end_labels: true }, [sqlQuery()]), [rows]);
    expect(on.splitNumber).toBe(1);
    expect(on.axisLabel.show).toBe(true);
    expect(on.axisLabel.formatter(100)).toBe("100");
  });

  it("scales the text with the dial, also after the multi-query regrid", async () => {
    const [single] = await runSQL(gaugePanel({}, [sqlQuery()]), [[rows[0]]]);
    expect(single.detail.fontSize).toBeGreaterThan(40);
    expect(single.title.fontSize).toBe(24);
    const panel = gaugePanel({}, [sqlQuery(), sqlQuery({}, "Other")]);
    const merged = await runSQL(panel, [[rows[0]], [rows[1]]], {
      offsetWidth: 80,
      offsetHeight: 40,
    });
    expect(merged.map((g: any) => [g.detail.fontSize, g.title.fontSize])).toEqual([
      [12, 10],
      [12, 10],
    ]);
  });
});
