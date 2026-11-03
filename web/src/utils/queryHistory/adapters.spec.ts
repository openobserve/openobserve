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
import type { QueryHistoryEntry } from "@/services/query_history";
import { decodeMetricsConfig } from "@/composables/metrics/metricsUrlState";
import { b64DecodeUnicode } from "@/utils/formatters";
import { buildTracesRecord, tracesRestore, tracesRouteQuery } from "./traces";
import {
  buildMetricsRecord,
  metricsEditorIsEmpty,
  metricsEditorIsEmptyWith,
  metricsRestore,
  metricsRouteQuery,
  metricsRunError,
} from "./metrics";
import { recentSearchRoute } from "./routes";
import { recentCompletionItems } from "./recentCompletions";

const entry = (overrides: Partial<QueryHistoryEntry>): QueryHistoryEntry => ({
  id: "e",
  source: "metrics",
  query: "up",
  query_key: null,
  streams: [],
  context: {},
  status: "ok",
  starred: false,
  run_count: 1,
  created_at: 1,
  updated_at: 1,
  ...overrides,
});

describe("Traces rows", () => {
  const time = { type: "relative" as const, period: "1h", start_time: 10, end_time: 20 };

  it("keys a run by stream, mode and filter", () => {
    const body = buildTracesRecord({
      stream: "default",
      searchMode: "spans",
      query: " service_name = 'cart' ",
      time,
      result: { status: "error", error: "unknown field" },
    });
    expect(body).toMatchObject({
      source: "traces",
      query: "service_name = 'cart'",
      query_key: '[["default"],"traces","spans","service_name = \'cart\'",""]',
      streams: ["default"],
      status: "error",
      context: { page: { stream: "default", tab: "spans" }, time, error: "unknown field" },
    });
  });

  it("records nothing without a filter or stream", () => {
    const input = { searchMode: "traces", time, result: { status: "ok" as const } };
    expect(buildTracesRecord({ ...input, stream: "default", query: "" })).toBeNull();
    expect(buildTracesRecord({ ...input, stream: "", query: "a = 1" })).toBeNull();
  });

  it("restores now over the period and at original time over the window", () => {
    const row = entry({
      source: "traces",
      query: "a = 1",
      streams: ["default"],
      context: { page: { stream: "default", tab: "spans" }, time },
    });
    expect(tracesRestore(row, "now")).toEqual({
      stream: "default",
      searchMode: "spans",
      query: "a = 1",
      window: { type: "relative", period: "1h" },
    });
    const link = tracesRouteQuery(row, "original", "org1");
    expect(link).toMatchObject({ stream: "default", tab: "spans", from: "10", to: "20" });
    expect(b64DecodeUnicode(link.query)).toBe("a = 1");
    expect(recentSearchRoute(row, "original", "org1", "run")).toMatchObject({
      path: "/traces",
      query: { reload: "true" },
    });
  });
});

describe("Metrics rows", () => {
  const panel = {
    data: {
      type: "line",
      queryType: "promql",
      config: { step_value: "30s" },
      queries: [{ query: "up", fields: { stream: "up" } }],
    },
    layout: { hiddenQueries: [] as number[] },
  };

  it("keeps the v1.1.x context and adds the resolved window", () => {
    const body = buildMetricsRecord({
      panel,
      selectedDate: { valueType: "relative", relativeTimePeriod: "6h" },
      window: { startUs: 100, endUs: 200 },
    });
    expect(body).toMatchObject({
      source: "metrics",
      query: "up",
      query_key: '[["up"],"metrics","promql","up",""]',
      streams: ["up"],
      context: {
        time_range: { period: "6h" },
        step: "30s",
        chart_type: "line",
        time: { type: "relative", period: "6h", start_time: 100, end_time: 200 },
      },
    });
    expect(decodeMetricsConfig(body!.context.metrics_data)?.data.queries[0].query).toBe("up");
  });

  it("reopens a v1.1.x row (no time, no key) at its stored range either way", () => {
    const legacy = entry({
      context: { metrics_data: "blob", time_range: { period: "6h" }, chart_type: "bar" },
    });
    for (const when of ["now", "original"] as const) {
      expect(metricsRestore(legacy, when)).toMatchObject({
        metricsData: "blob",
        timeRange: { valueType: "relative", relativeTimePeriod: "6h" },
      });
    }
    const absolute = entry({
      context: { metrics_data: "blob", time_range: { from: 1000, to: 2000 } },
    });
    expect(metricsRestore(absolute, "original")?.timeRange).toMatchObject({
      valueType: "absolute",
      startTime: 1000,
      endTime: 2000,
    });
    expect(metricsRestore(entry({ context: {} }), "now")).toBeNull();
  });

  it("reopens a new row at its own window at original time", () => {
    const row = entry({
      context: {
        metrics_data: "blob",
        time_range: { period: "6h" },
        time: { type: "relative", period: "6h", start_time: 5_000_000, end_time: 9_000_000 },
      },
    });
    expect(metricsRestore(row, "original")?.timeRange).toMatchObject({
      valueType: "absolute",
      startTime: 5_000_000,
      endTime: 9_000_000,
    });
    expect(metricsRestore(row, "now")?.timeRange).toMatchObject({ relativeTimePeriod: "6h" });
    expect(metricsRouteQuery(row, "original", "org1")).toEqual({
      org_identifier: "org1",
      metrics_data: "blob",
      from: "5000",
      to: "9000",
    });
  });
});

describe("Metrics editor and panel errors", () => {
  it("treats a panel as empty only when no visible query or formula has text", () => {
    expect(metricsEditorIsEmpty({ data: { queries: [{ query: " " }] } })).toBe(true);
    expect(metricsEditorIsEmpty({ data: { queries: [{ query: "" }, { query: "up" }] } })).toBe(
      false,
    );
    expect(
      metricsEditorIsEmpty({
        data: { queries: [{ query: "" }, { query: "up" }] },
        layout: { hiddenQueries: [1] },
      }),
    ).toBe(true);
    expect(metricsEditorIsEmpty({ data: { queries: [{ config: { formula: "A / B" } }] } })).toBe(
      false,
    );
  });

  it("reads a panel error code as a search code or an HTTP status", () => {
    expect(metricsRunError({ message: "bad", code: 400 })).toEqual({
      httpStatus: 400,
      message: "bad",
    });
    expect(metricsRunError({ message: "slow", code: "20010" })).toEqual({
      code: 20010,
      message: "slow",
    });
    expect(metricsRunError({ message: "odd", code: "" })).toEqual({ message: "odd" });
    expect(metricsRunError({ message: "", code: "" })).toBeNull();
    expect(metricsRunError(null)).toBeNull();
  });
});

describe("autocomplete clock rows", () => {
  const model = (text: string) => {
    const lines = text.split("\n");
    return {
      getValue: () => text,
      getLineCount: () => lines.length,
      getLineMaxColumn: (n: number) => lines[n - 1].length + 1,
      getLineContent: (n: number) => lines[n - 1],
    };
  };

  it("replaces the whole editor text with a matching recent query", () => {
    const items = recentCompletionItems(
      ["level = 'error' and ns = 'checkout'"],
      model("lev"),
      { lineNumber: 1, column: 4 },
      18,
      "Recent search",
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      insertText: "level = 'error' and ns = 'checkout'",
      filterText: "lev",
      kind: 18,
      range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 4 },
      additionalTextEdits: [],
    });
    expect(items[0].sortText < "a").toBe(true);
  });

  it("clears the other lines of a multi-line editor", () => {
    const items = recentCompletionItems(
      ["SELECT * FROM a WHERE b = 1"],
      model("SELECT *\nFROM a"),
      { lineNumber: 2, column: 7 },
      18,
      "Recent search",
    );
    expect(items[0].additionalTextEdits).toEqual([
      {
        range: { startLineNumber: 1, startColumn: 1, endLineNumber: 2, endColumn: 1 },
        text: "",
      },
    ]);
  });

  it("offers nothing when no recent query matches", () => {
    expect(
      recentCompletionItems(["up"], model("rate"), { lineNumber: 1, column: 5 }, 18, "x"),
    ).toEqual([]);
  });
});

describe("metrics editor emptiness while typing", () => {
  const panel = (
    queries: { query?: string; formula?: string }[],
    current = 0,
    hidden: number[] = [],
  ) => ({
    data: { queries: queries.map((q) => ({ query: q.query, config: { formula: q.formula } })) },
    layout: { currentQueryIndex: current, hiddenQueries: hidden },
  });

  it("reads the edited query from the editor text, not the debounced panel", () => {
    expect(metricsEditorIsEmptyWith(panel([{ query: "up" }]), true)).toBe(true);
    expect(metricsEditorIsEmptyWith(panel([{ query: "" }]), false)).toBe(false);
  });

  it("still needs every other visible query and formula empty", () => {
    expect(metricsEditorIsEmptyWith(panel([{ query: "" }, { query: "rate(x[5m])" }]), true)).toBe(
      false,
    );
    expect(
      metricsEditorIsEmptyWith(panel([{ query: "" }, { query: "rate(x[5m])" }], 0, [1]), true),
    ).toBe(true);
    expect(metricsEditorIsEmptyWith(panel([{ query: "" }, { formula: "A+B" }]), true)).toBe(false);
  });

  it("treats the editor text as the whole active entry, so clearing the active formula counts", () => {
    expect(metricsEditorIsEmptyWith(panel([{ query: "x", formula: "A+B" }]), true)).toBe(true);
    expect(metricsEditorIsEmptyWith(panel([{ query: "" }, { formula: "A*2" }], 1), true)).toBe(
      true,
    );
    expect(metricsEditorIsEmptyWith(panel([{ query: "" }, { formula: "A*2" }], 1), false)).toBe(
      false,
    );
  });
});
