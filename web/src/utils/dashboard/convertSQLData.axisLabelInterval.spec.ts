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
    zoConfig: { timestamp_column: "_timestamp", max_dashboard_series: 100 },
    selectedOrganization: { identifier: "default" },
  },
};

const panelQuery = {
  query: "SELECT 1",
  customQuery: false,
  fields: {
    stream: "default",
    stream_type: "logs",
    x: [{ label: "Service", alias: "svc", column: "svc", args: [] }],
    y: [{ label: "v1", alias: "v1", column: "v1", aggregationFunction: "count", args: [] }],
    z: [],
    breakdown: [],
    filter: { conditions: [] },
  },
  config: {},
};

const categoryAxisLabel = async (config: Record<string, any>) => {
  const data = [
    ["frontend", "cart", "checkout", "payment", "shipping"].map((svc) => ({ svc, v1: 10 })),
  ];
  const result: any = await convertMultiSQLData(
    { id: "p", type: "bar", queryType: "sql", queries: [panelQuery], config },
    data,
    store,
    { value: { offsetWidth: 320, offsetHeight: 300 } },
    { value: null },
    { value: [[]] },
    {
      queries: [
        {
          query: "SELECT 1",
          startTime: 1704067200000000,
          endTime: 1704068400000000,
          timeRangeGap: { seconds: 0, periodAsStr: "" },
          panelQueryIndex: 0,
        },
      ],
    },
    { height: "300px" },
    { value: [] },
    false,
  );
  return [result.options.xAxis].flat()[0].axisLabel;
};

describe("SQL bar category axis label interval", () => {
  it("keeps the automatic interval by default", async () => {
    expect((await categoryAxisLabel({})).interval).toBe("auto");
  });

  it("shows every category label when axis_label_show_all is on", async () => {
    expect((await categoryAxisLabel({ axis_label_show_all: true })).interval).toBe(0);
  });
});
