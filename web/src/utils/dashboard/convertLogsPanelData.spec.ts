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
import { convertLogsPanelData, resolveLogsFields, toEpochMillis } from "./convertLogsPanelData";

vi.mock("./convertCustomChartData", () => ({
  runJavaScriptCode: vi.fn(),
  validateUserCode: vi.fn(() => null),
}));

const store = {
  state: {
    theme: "light",
    timezone: "UTC",
    zoConfig: { timestamp_column: "_timestamp", max_dashboard_series: 1000 },
    selectedOrganization: { identifier: "default" },
  },
};

const convert = async (schema: any, data: any[]) =>
  (await convertPanelData(
    schema,
    data,
    store,
    { value: { offsetWidth: 800, offsetHeight: 400 } },
    { value: null },
    { value: [] },
    { queries: [] },
    { height: "400px" },
    { value: [] },
    false,
  )) as any;

const panel = (config: Record<string, any> = {}, query = 'SELECT * FROM "demo_app"') => ({
  id: "p",
  type: "logs",
  queryType: "sql",
  queries: [{ query, customQuery: true, fields: { x: [], y: [] }, config: {} }],
  config,
});

// Rows as the local backend returns them for SELECT * FROM "demo_app" ORDER BY _timestamp DESC.
const rows = [
  {
    _timestamp: 1793057797456037,
    level: "error",
    message: "upstream inventory failed: timeout after 103ms",
    payload: '{"user":"u278","cart_items":5}',
    status: 200,
  },
  {
    _timestamp: 1793057797456039,
    level: "info",
    message: "GET /api/search/update 26ms",
    payload: '{"user":"u138","cart_items":5}',
    status: 200,
  },
  {
    _timestamp: 1793057797456038,
    level: "warn",
    message: "GET /api/inventory/list 323ms",
    payload: '{"user":"u494","cart_items":8}',
    status: 200,
  },
];

describe("convertLogsPanelData", () => {
  it("is routed by convertPanelData and orders newest first with no config", async () => {
    const result = await convert(panel(), [rows]);
    expect(result.chartType).toBe("logs");
    expect(result.rows.map((row: any) => row.level)).toEqual(["info", "warning", "error"]);
    expect(result.fields).toEqual({ time: "_timestamp", level: "level", message: "message" });
    expect(Math.floor(result.rows[0].time)).toBe(Date.parse("2026-10-26T23:36:37.456Z"));
    expect(result.rows[0].source).toBe(rows[1]);
  });

  it("orders oldest first when logs_order is oldest", async () => {
    const result = await convert(panel({ logs_order: "oldest" }), [rows]);
    expect(result.rows.map((row: any) => row.level)).toEqual(["error", "warning", "info"]);
  });

  it("gives every row a unique key even when timestamps repeat", async () => {
    const same = rows.map((row) => ({ ...row, _timestamp: 1 }));
    const result = await convert(panel(), [same]);
    expect(new Set(result.rows.map((row: any) => row.key)).size).toBe(3);
  });

  it("reads the configured columns, whatever they are called", () => {
    const custom = [{ ts: "2026-10-27T03:36:37Z", lvl: "WARN", body_text: "disk 91% full" }];
    const result = convertLogsPanelData(
      panel({ logs_time_field: "ts", logs_level_field: "lvl", logs_message_field: "body_text" }),
      [custom],
      store,
    );
    expect(result.fields).toEqual({ time: "ts", level: "lvl", message: "body_text" });
    expect(result.rows[0]).toMatchObject({
      level: "warning",
      time: Date.parse("2026-10-27T03:36:37Z"),
    });
  });

  it("marks a configured level column with no value as unknown", () => {
    const result = convertLogsPanelData(
      panel({ logs_level_field: "lvl" }),
      [[{ msg: "x" }]],
      store,
    );
    expect(result.rows[0].level).toBe("unknown");
  });

  it("leaves the message field unset when no message column exists", () => {
    const result = convertLogsPanelData(panel(), [[{ _timestamp: 1, code: 7 }]], store);
    expect(result.fields.message).toBeNull();
    expect(result.rows[0].source).toEqual({ _timestamp: 1, code: 7 });
  });

  it("detects well-known names in order of preference", () => {
    expect(
      resolveLogsFields({}, [{ timestamp: 1, severity: "info", msg: "a", log: "b" }], "_timestamp"),
    ).toEqual({ time: "timestamp", level: "severity", message: "msg" });
  });

  it("returns no rows for an empty or missing result", async () => {
    expect((await convert(panel(), [[]])).rows).toEqual([]);
    expect(convertLogsPanelData(panel(), undefined, store).rows).toEqual([]);
  });

  it("reads the first visible query", () => {
    const schema = {
      ...panel(),
      queries: [
        { query: "a", customQuery: true, fields: {}, config: { hide: true } },
        { query: "b", customQuery: true, fields: {}, config: {} },
      ],
    };
    const result = convertLogsPanelData(
      schema,
      [[{ message: "hidden" }], [{ message: "shown" }]],
      store,
    );
    expect(result.rows.map((row) => row.source.message)).toEqual(["shown"]);
  });
});

describe("toEpochMillis", () => {
  it("reads seconds, milliseconds, microseconds, nanoseconds and date strings", () => {
    const ms = 1793057797456;
    expect(toEpochMillis(ms / 1000)).toBe(ms);
    expect(toEpochMillis(ms)).toBe(ms);
    expect(toEpochMillis(ms * 1000)).toBe(ms);
    expect(toEpochMillis(ms * 1e6)).toBe(ms);
    expect(toEpochMillis(String(ms * 1000))).toBe(ms);
    expect(toEpochMillis("2026-10-27 03:36:37")).toBe(Date.UTC(2026, 9, 27, 3, 36, 37));
    expect(toEpochMillis("not a date")).toBeNull();
    expect(toEpochMillis(null)).toBeNull();
  });
});
