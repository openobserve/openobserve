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
import { convertTableData } from "./convertTableData";
import { convertMultiSQLData } from "./convertSQLData";
import { parseOverrideConfigs } from "./tableConfigUtils";

const serialize = (value: unknown) =>
  JSON.stringify(value, (_key, v) =>
    typeof v === "function" ? "[Function]" : v === undefined ? "[undefined]" : v,
  );

// A table entry and a chart entry on the same name, as one panel can hold after a type change.
const tableEntry = {
  field: { matchBy: "name", value: "api" },
  config: [
    { type: "unit", value: { unit: "bytes", customUnit: "" } },
    { type: "alignment", value: "center" },
    { type: "text_color", value: "#111111" },
  ],
};
const seriesEntry = (value: string) => ({
  field: { matchBy: "series", value },
  config: [
    { type: "unit", value: { unit: "seconds", customUnit: "" } },
    { type: "decimals", value: 3 },
    { type: "display_name", value: "Renamed" },
    { type: "series_color", value: "#EF4444" },
  ],
});
const regexEntry = {
  field: { matchBy: "series_regex", value: "/.*/" },
  config: [{ type: "unit", value: { unit: "percent", customUnit: "" } }],
};

describe("tables skip chart series entries", () => {
  it("parseOverrideConfigs builds the same maps with or without series entries", () => {
    const tableOnly = parseOverrideConfigs([tableEntry]);
    const mixed = parseOverrideConfigs([tableEntry, seriesEntry("api"), regexEntry]);
    expect(serialize(mixed)).toBe(serialize(tableOnly));
    expect(serialize(parseOverrideConfigs([seriesEntry("api"), regexEntry]))).toBe(
      serialize(parseOverrideConfigs([])),
    );
  });

  it("a table renders the same with a mixed array as with its table entries alone", () => {
    const panel = (overrideConfig: any[]) => ({
      type: "table",
      queries: [
        {
          fields: {
            x: [{ alias: "service", label: "Service" }],
            y: [{ alias: "api", label: "Api" }],
          },
          customQuery: false,
        },
      ],
      config: { override_config: overrideConfig, unit: "milliseconds", decimals: 2 },
    });
    const data = [
      [
        { service: "a", api: 1200 },
        { service: "b", api: 300 },
      ],
    ];
    const store = { state: { timezone: "UTC" } };
    const tableOnly: any = convertTableData(panel([tableEntry]), data, store);
    const mixed: any = convertTableData(
      panel([tableEntry, seriesEntry("api"), regexEntry]),
      data,
      store,
    );
    expect(serialize(mixed)).toBe(serialize(tableOnly));
    const column = (result: any) => result.columns.find((c: any) => c.alias === "api");
    expect(column(mixed).align).toBe("center");
    expect(column(mixed).textColor).toBe("#111111");
    expect(column(mixed).format(1200)).toBe(column(tableOnly).format(1200));
    expect(column(mixed).format(1200)).toContain("KB");
  });
});

describe("charts apply series entries and skip table entries", () => {
  const store = {
    state: {
      theme: "light",
      timezone: "UTC",
      zoConfig: { timestamp_column: "_timestamp", max_dashboard_series: 1000 },
    },
  };
  const run = async (overrideConfig: any[]) => {
    const panel = {
      id: "p",
      type: "bar",
      queryType: "sql",
      queries: [
        {
          query: "SELECT 1",
          customQuery: false,
          fields: {
            stream: "default",
            stream_type: "logs",
            x: [{ label: "Endpoint", alias: "x_axis_1", column: "endpoint", args: [] }],
            y: [{ label: "Latency", alias: "y_axis_1", column: "latency", args: [] }],
            z: [],
            breakdown: [{ label: "Service", alias: "breakdown_1", column: "service", args: [] }],
          },
          config: {},
        },
      ],
      config: {
        show_legends: true,
        unit: "milliseconds",
        decimals: 0,
        override_config: overrideConfig,
      },
    };
    const rows = [
      { x_axis_1: "/a", breakdown_1: "api", y_axis_1: 1200 },
      { x_axis_1: "/a", breakdown_1: "web", y_axis_1: 900 },
    ];
    const result: any = await convertMultiSQLData(
      panel,
      [rows],
      store,
      { value: { offsetWidth: 800, offsetHeight: 400 } },
      { value: null },
      { value: [] },
      { queries: [{ query: "SELECT 1", startTime: 0, endTime: 0, panelQueryIndex: 0 }] },
      { height: "400px" },
      { value: [] },
      false,
    );
    return result.options;
  };
  const named = (options: any, name: string) => options.series.find((s: any) => s.name === name);

  it("a mixed array: the series entry styles its series, the table entry on another name does nothing", async () => {
    const plain = await run([]);
    const options = await run([
      { ...tableEntry, field: { matchBy: "name", value: "web" } },
      seriesEntry("api"),
    ]);
    expect(named(options, "api").color).toBe("#EF4444");
    expect(named(options, "web").color).toBe(named(plain, "web").color);
    expect(named(options, "web").label.formatter).toBeUndefined();
    expect(options.legend.formatter("api")).toBe("{b|Renamed}");
    expect(options.legend.formatter("web")).toBe("{b|web}");
  });

  it("table entries alone leave chart options unchanged", async () => {
    const plain = await run([]);
    const table = await run([tableEntry, { ...tableEntry, field: { value: "web" } }]);
    expect(serialize(table)).toBe(serialize(plain));
  });
});
