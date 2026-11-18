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
import {
  buildEventFill,
  buildMetricFill,
  cardsFolded,
  compareFunction,
  fieldKind,
  fieldsBySamplePresence,
  intentsFor,
  labelProfile,
  matchingLabel,
  metricFamilySiblings,
  rankCategory,
  rankGroup,
  rankMeasure,
  rankMetricGroup,
  rareValue,
  readFieldShapes,
  shapeQuerySql,
  slotFields,
  withCaseVariants,
} from "./alertIntents";

let n = 0;
const id = () => `id${++n}`;

describe("alertIntents", () => {
  it.each([
    ["logs", true, ["countWhere", "percentile", "anyEvent", "unusualVolume", "compareLastWeek"]],
    ["traces", false, ["countWhere", "percentile", "anyEvent", "compareLastWeek"]],
    ["metrics", true, ["metricAbove", "ratio", "unusualChange"]],
    ["metrics", false, ["metricAbove", "ratio"]],
  ])("offers %s intents (anomaly %s)", (type, anomaly, ids) => {
    expect(intentsFor(type, { anomaly })).toEqual(ids);
  });

  it.each([
    ["Utf8", "string"],
    ["Int64", "number"],
    ["UInt64", "number"],
    ["Float64", "number"],
    ["Boolean", "boolean"],
    ["List(Utf8)", "string"],
    [undefined, "other"],
  ])("reads schema type %s as %s", (type, kind) => {
    expect(fieldKind(type)).toBe(kind);
  });

  it("leaves the timestamp, internal columns and excluded fields out of a slot", () => {
    const fields = [
      { name: "_timestamp", type: "Int64" },
      { name: "level", type: "Utf8" },
      { name: "svc", type: "Utf8" },
      { name: "took", type: "Int64" },
    ];
    expect(slotFields(fields, "string", ["svc"])).toEqual(["level"]);
    expect(slotFields(fields, "number")).toEqual(["took"]);
  });

  it("asks the shape search about the fields recent events carry, most carried first", () => {
    const rows = [{ a: "x", c: 1 }, { a: "y", b: "", c: 2 }, { c: 3 }];
    expect(fieldsBySamplePresence(rows, ["a", "b", "c", "d"])).toEqual(["c", "a"]);
  });

  it("ranks slot fields by value shape from one shape search, keeping the rest in schema order", () => {
    expect(shapeQuerySql("s", ["a"], ["b"])).toBe(
      'SELECT count(*) AS "t", count("a") AS "c0", approx_distinct("a") AS "d0", count("b") AS "k0", approx_percentile_cont("b", 0.5) AS "m0", approx_percentile_cont("b", 0.99) AS "q0" FROM "s"',
    );
    const strings = ["body", "node", "level", "svc", "rare", "started"];
    const numbers = ["status", "took"];
    // body: on every event, all distinct · node, level: categories · svc: an entity · rare: on few events
    const row = {
      ...{ t: 100, c0: 100, d0: 95, c1: 100, d1: 3, c2: 100, d2: 4, c3: 98, d3: 30, c4: 10, d4: 3 },
      ...{ c5: 100, d5: 3 }, // started: a time, which names nothing
      // status: flat · took: heavy-tailed
      ...{ k0: 100, m0: 200, q0: 500, k1: 90, m1: 1000, q1: 90000 },
    };
    const sample = Array.from({ length: 10 }, (_, i) => ({
      node: `node-${"abc"[i % 3]}`,
      level: i ? "INFO" : "ERROR",
      svc: `svc-${"abcdefghij"[i]}`,
      started: `2026-11-1${i % 3}T10:00:00Z`,
    }));
    const shapes = readFieldShapes(row, strings, numbers, sample);
    expect(rankCategory(strings, shapes)).toEqual([
      "level",
      "node",
      "body",
      "svc",
      "rare",
      "started",
    ]);
    expect(rankGroup(["body", "started", "node", "svc", "rare"], shapes)).toEqual([
      "svc",
      "node",
      "body",
      "started",
      "rare",
    ]);
    expect(rankMeasure(numbers, shapes)).toEqual(["took", "status"]);
  });

  it("picks the rarest value under 5 % and adds the case variants of a picked value", () => {
    const seen = [
      { value: "INFO", count: 9000 },
      { value: "ERROR", count: 300 },
      { value: "error", count: 40 },
      { value: "WARN", count: 700 },
    ];
    expect(rareValue(seen)).toBe("error");
    expect(
      rareValue([
        { value: "a", count: 5 },
        { value: "b", count: 6 },
      ]),
    ).toBe("a");
    expect(rareValue([])).toBeUndefined();
    expect(withCaseVariants(["ERROR"], seen)).toEqual(["ERROR", "error"]);
  });

  it.each([
    [
      "countWhere",
      { field: "level", values: ["ERROR", "error"], group: "svc" },
      {
        howItChecks: "false",
        aggregation: true,
        agg: { function: "count", having: { column: "svc", operator: ">=", value: 1 } },
        condition: { column: "level", operator: "in", value: ["ERROR", "error"] },
      },
    ],
    [
      "percentile",
      { measure: "took", group: "svc" },
      {
        howItChecks: "false",
        aggregation: true,
        agg: { function: "p95", having: { column: "took", operator: ">", value: "" } },
        condition: undefined,
      },
    ],
    [
      "anyEvent",
      { field: "reason", values: ["OOMKilling"] },
      {
        howItChecks: "true",
        aggregation: false,
        agg: undefined,
        condition: { column: "reason", operator: "=", value: "OOMKilling" },
      },
    ],
  ])("fills %s into the builder", (intent, slots, want) => {
    const fill = buildEventFill(intent as any, slots, { stream: "s", id });
    expect(fill.howItChecks).toBe(want.howItChecks);
    expect(fill.aggregation).toBe(want.aggregation);
    expect(fill.values["query_condition.type"]).toBe("custom");
    const agg = fill.values["query_condition.aggregation"] as any;
    if (want.agg) expect(agg).toMatchObject({ ...want.agg, group_by: ["svc"], multi_alert: true });
    const conditions = (fill.values["query_condition.conditions"] as any).conditions;
    if (want.condition) expect(conditions[0]).toMatchObject(want.condition);
    else expect(conditions).toEqual([]);
  });

  it("writes the query, the week-ago window and the function for a comparison, so no function is typed", () => {
    const fill = buildEventFill(
      "compareLastWeek",
      { field: "level", values: ["it's"], factor: 3 },
      { stream: "app", id },
    );
    expect(fill.vrl).toBe(true);
    expect(fill.values["query_condition.type"]).toBe("sql");
    expect(fill.values["query_condition.sql"]).toBe(
      `SELECT count(*) AS events FROM "app" WHERE "level" = 'it''s'`,
    );
    expect(fill.values["query_condition.multi_time_range"]).toMatchObject([{ offSet: "1w" }]);
    // The server keys the per-window input on a leading marker.
    expect(fill.values["query_condition.vrl_function"]).toBe(compareFunction(3));
    expect(compareFunction(3).startsWith("#ResultArray#\n")).toBe(true);
    expect(compareFunction(3)).toContain("previous * 3.0");
  });

  it("covers every naming generation of a metric, each with its own label, in one share", () => {
    const streams = [
      {
        name: "http_server_duration_count",
        metrics_meta: { metric_type: "histogram", metric_family_name: "http_server_duration" },
      },
      {
        name: "http_server_request_duration_count",
        metrics_meta: {
          metric_type: "histogram",
          metric_family_name: "http_server_request_duration",
        },
      },
      {
        name: "http_server_request_duration_bucket",
        metrics_meta: {
          metric_type: "histogram",
          metric_family_name: "http_server_request_duration",
        },
      },
      {
        name: "http_client_duration_count",
        metrics_meta: { metric_type: "histogram", metric_family_name: "http_client_duration" },
      },
    ];
    expect(metricFamilySiblings(streams[1], streams)).toEqual(["http_server_duration_count"]);
    expect(matchingLabel("http_response_status_code", ["http_status_code", "service_name"])).toBe(
      "http_status_code",
    );
    expect(matchingLabel("service_name", ["service_name"])).toBe("service_name");
    expect(matchingLabel("cpu", ["mode"])).toBeUndefined();

    const fill = buildMetricFill(
      "ratio",
      {
        metric: "http_server_request_duration_count",
        values: ["5.."],
        group: "service_name",
        counter: true,
        family: [
          { metric: "http_server_request_duration_count", label: "http_response_status_code" },
          { metric: "http_server_duration_count", label: "http_status_code" },
        ],
      },
      { periodMinutes: 5 },
    );
    expect(fill.values["query_condition.promql"]).toBe(
      'sum by (service_name) (rate(http_server_request_duration_count{http_response_status_code=~"5.."}[5m]) or rate(http_server_duration_count{http_status_code=~"5.."}[5m])) / sum by (service_name) (rate(http_server_request_duration_count[5m]) or rate(http_server_duration_count[5m])) * 100',
    );
    expect(fill.values["query_condition.promql_condition"]).toMatchObject({
      operator: ">",
      value: "",
    });
    expect(fill.values["query_condition.promql_multi_alert"]).toBe(true);
  });

  it("ranks metric labels for grouping by how many series carry them", () => {
    const profile = labelProfile([
      { __name__: "m", host: "a", cpu: "0", job: "x" },
      { __name__: "m", host: "a", cpu: "1", job: "x" },
      { __name__: "m", host: "b", cpu: "2" },
    ]);
    expect(rankMetricGroup(profile)).toEqual(["cpu", "host", "job"]);
  });

  it.each([
    [undefined, false],
    [9, false],
    [10, true],
  ])("folds the cards for an org with %s alerts: %s", (count, folded) => {
    expect(cardsFolded(count)).toBe(folded);
  });
});
