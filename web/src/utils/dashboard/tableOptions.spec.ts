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
import { convertMultiQueryTableData, convertTableData } from "./convertTableData";
import {
  applyTableOptions,
  computeFooterCalc,
  parseSparklineValue,
  tableRowHeight,
} from "./tableOptions";
import { resolveIsNumber } from "./tableConfigUtils";

vi.mock("./convertCustomChartData", () => ({
  runJavaScriptCode: vi.fn(),
  validateUserCode: vi.fn(() => null),
}));

const serialize = (value: unknown) =>
  JSON.stringify(value, (_key, v) =>
    typeof v === "function" ? "[Function]" : v === undefined ? "[undefined]" : v,
  );

const store = { state: { theme: "light", timezone: "UTC" } };

const fieldType = (alias: string, value: string) => ({
  field: { matchBy: "name", value: alias },
  config: [{ type: "field_type", value }],
});

const tablePanel = (config: Record<string, any> = {}) => ({
  id: "t",
  type: "table",
  queryType: "sql",
  queries: [
    {
      query: "SELECT 1",
      customQuery: false,
      fields: {
        x: [{ label: "Service", alias: "service", column: "service", args: [] }],
        y: [
          { label: "Requests", alias: "requests", column: "requests", args: [] },
          { label: "Trend", alias: "trend", column: "trend", args: [] },
        ],
        breakdown: [],
      },
      config: {},
    },
  ],
  config: { unit: "default", decimals: 0, ...config },
});

const rows = () => [
  { service: "api", requests: 30, trend: "[1,2,3]" },
  { service: "web", requests: 10, trend: "[3,2,1]" },
  { service: "db", requests: 20, trend: "n/a" },
];

const viaPanel = async (panel: any, data: any[]) =>
  (await convertPanelData(panel, data, store, null, null, null, null, null, null)) as any;

describe("absent keys render exactly as today", () => {
  it("single SQL table", async () => {
    const { chartType, ...converted } = await viaPanel(tablePanel(), [rows()]);
    expect(chartType).toBe("table");
    expect(serialize(converted)).toBe(serialize(convertTableData(tablePanel(), [rows()], store)));
    expect(converted.stickyTotalRow).toBeUndefined();
  });

  it("multi-query SQL table", async () => {
    const data = [rows(), rows()];
    const { chartType: _type, ...converted } = await viaPanel(tablePanel(), data);
    expect(serialize(converted)).toBe(
      serialize(convertMultiQueryTableData(tablePanel(), data, store)),
    );
  });

  it("keeps today's row height without a density", () => {
    expect(tableRowHeight(undefined)).toBe(22);
    expect(tableRowHeight("compact")).toBe(22);
    expect(tableRowHeight("standard")).toBe(28);
    expect(tableRowHeight("comfortable")).toBe(36);
    expect(tableRowHeight("bogus")).toBe(22);
  });
});

describe("footer calculations", () => {
  it("computes each calculation over numeric cells", () => {
    const values = [3, "1", null, "x", 5];
    expect(computeFooterCalc("sum", values)).toBe(9);
    expect(computeFooterCalc("mean", values)).toBe(3);
    expect(computeFooterCalc("min", values)).toBe(1);
    expect(computeFooterCalc("max", values)).toBe(5);
    expect(computeFooterCalc("count", values)).toBe(3);
    expect(computeFooterCalc("last", values)).toBe(5);
    expect(computeFooterCalc("sum", [])).toBeNull();
    expect(computeFooterCalc("count", [])).toBe(0);
  });

  it("adds one labelled sticky footer row per calculation", async () => {
    const result = await viaPanel(tablePanel({ table_footer_calcs: ["sum", "max"] }), [rows()]);
    expect(result.stickyRowTotals).toBe(true);
    expect(result.stickyTotalRow).toHaveLength(2);
    const [sum, max] = result.stickyTotalRow;
    expect([sum.service, sum.requests]).toEqual(["Sum", "60"]);
    expect([max.service, max.requests]).toEqual(["Max", "30"]);
    expect(sum.trend).toBeUndefined();
    const requests = result.columns.find((column: any) => column.field === "requests");
    expect(requests.format("60", sum)).toBe("60");
    expect(requests.format(1234, rows()[0])).toBe("1234");
  });

  it("works on a multi-query table", async () => {
    const result = await viaPanel(tablePanel({ table_footer_calcs: ["count"] }), [rows(), rows()]);
    expect(result.stickyTotalRow[0].requests).toBe("6");
  });

  it("skips transposed tables", () => {
    const result = { columns: [{ field: "a", isNumeric: true }], rows: [{ a: 1 }] };
    applyTableOptions(result, { config: { table_transpose: true, table_footer_calcs: ["sum"] } });
    expect((result as any).stickyTotalRow).toBeUndefined();
  });
});

describe("cell types", () => {
  it("forces numeric for bar gauge and text for sparkline and JSON", () => {
    expect(resolveIsNumber(false, "bar_gauge")).toBe(true);
    expect(resolveIsNumber(true, "sparkline")).toBe(false);
    expect(resolveIsNumber(true, "json")).toBe(false);
  });

  it("marks bar gauge columns with their range and threshold colour", async () => {
    const result = await viaPanel(
      tablePanel({
        override_config: [fieldType("requests", "bar_gauge")],
        thresholds: {
          mode: "absolute",
          baseColor: "#00ff00",
          steps: [{ value: 25, color: "#ff0000" }],
        },
      }),
      [rows()],
    );
    const requests = result.columns.find((column: any) => column.field === "requests");
    expect(requests.cellType).toBe("bar_gauge");
    expect(requests.barRange).toEqual({ min: 0, max: 30 });
    expect(requests.barColor(30)).toBe("#ff0000");
    expect(requests.barColor(10)).toBe("#00ff00");
  });

  it("leaves the bar colour to the cell without thresholds", async () => {
    const result = await viaPanel(
      tablePanel({ override_config: [fieldType("requests", "bar_gauge")] }),
      [rows()],
    );
    const requests = result.columns.find((column: any) => column.field === "requests");
    expect(requests.barColor(30)).toBeNull();
  });

  it("marks sparkline and JSON columns", async () => {
    const result = await viaPanel(
      tablePanel({
        override_config: [fieldType("trend", "sparkline"), fieldType("service", "json")],
      }),
      [rows()],
    );
    expect(result.columns.find((c: any) => c.field === "trend").cellType).toBe("sparkline");
    expect(result.columns.find((c: any) => c.field === "service").showFieldAsJson).toBe(true);
  });

  it("parses numeric arrays and their JSON text", () => {
    expect(parseSparklineValue([1, 2, 3])).toEqual([1, 2, 3]);
    expect(parseSparklineValue("[1, 2.5]")).toEqual([1, 2.5]);
    expect(parseSparklineValue("[1]")).toBeNull();
    expect(parseSparklineValue('["a", 2]')).toBeNull();
    expect(parseSparklineValue("n/a")).toBeNull();
    expect(parseSparklineValue(5)).toBeNull();
  });
});
