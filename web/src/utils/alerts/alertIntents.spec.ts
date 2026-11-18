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
  rankMetricCategory,
  rankMetricGroup,
  rareValue,
  readFieldShapes,
  shapeQuerySql,
  slotFields,
  withCaseVariants,
  type FieldShape,
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

  it("measures shapes from the search's commonest values over the hour, the sample only as a fallback", () => {
    expect(shapeQuerySql("s", ["a"], ["b"])).toBe(
      'SELECT count(*) AS "t", count("a") AS "c0", approx_distinct("a") AS "d0", approx_topk("a", 10) AS "v0", count("b") AS "k0", approx_percentile_cont("b", 0.5) AS "m0", approx_percentile_cont("b", 0.99) AS "q0" FROM "s"',
    );
    const row = {
      t: 100,
      c0: 80,
      d0: 3,
      v0: [
        { value: "", count: 20 },
        { value: "x", count: 60 },
        { value: "y", count: 20 },
      ],
    };
    expect(readFieldShapes(row, ["a"], [])[0]).toMatchObject({
      coverage: 0.8,
      topShare: 0.75,
      wordShare: 1,
    });
    const sample = [{ a: "10.0.0.1" }, { a: "10.0.0.1" }, { a: "x" }];
    expect(readFieldShapes({ t: 3, c0: 3, d0: 2 }, ["a"], [], sample)[0].topShare).toBeCloseTo(
      2 / 3,
    );
  });

  // Shaped like the live misses: an error rate picking a sender label, a count of OOM kills grouped by
  // cluster, a latency grouped by node.
  const shapesOf = (fields: Record<string, [number, number, Record<string, number>]>) => {
    const names = Object.keys(fields);
    const row: Record<string, unknown> = { t: 100 };
    names.forEach((name, i) => {
      const [present, distinct, top] = fields[name];
      row[`c${i}`] = present;
      row[`d${i}`] = distinct;
      row[`v${i}`] = Object.entries(top).map(([value, count]) => ({ value, count }));
    });
    return { names, shapes: readFieldShapes(row, names, []) };
  };
  const even = (prefix: string, n: number, each: number) =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`${prefix}${i}`, each]));
  it.each([
    [
      "a count filters on the field with a small minority",
      {
        svc: [100, 4, even("svc-", 4, 25)],
        level: [100, 3, { INFO: 90, WARN: 7, ERROR: 3 }],
        ip: [100, 4, even("10.0.0.", 4, 25)],
      },
      (n: string[], s: FieldShape[]) => rankCategory(n, s),
      "level",
    ],
    [
      "one kind of event filters on the field naming the most kinds, not the lopsided sender",
      {
        cluster: [100, 3, { dev: 94, prod: 5, edge: 1 }],
        reason: [50, 20, { Scheduled: 10, Pulled: 8, Killing: 2, OOMKilling: 1 }],
        type: [50, 2, { Normal: 35, Warning: 15 }],
      },
      (n: string[], s: FieldShape[]) => rankCategory(n, s, "variety"),
      "reason",
    ],
    [
      "a group never holds most events in one value",
      {
        cluster: [100, 3, { dev: 94, prod: 5, edge: 1 }],
        namespace: [96, 29, even("ns-", 10, 8)],
      },
      (n: string[], s: FieldShape[]) => rankGroup(n, s),
      "namespace",
    ],
    [
      "a group on every event beats a more even one on fewer",
      {
        node: [93, 21, even("node-", 10, 7)],
        service: [100, 5, { querier: 40, ingester: 25, router: 20, compactor: 15 }],
        ip: [100, 21, even("10.0.0.", 10, 9)],
      },
      (n: string[], s: FieldShape[]) => rankGroup(n, s),
      "service",
    ],
  ])("%s", (_, fields, rank, first) => {
    const { names, shapes } = shapesOf(
      fields as Record<string, [number, number, Record<string, number>]>,
    );
    expect(rank(names, shapes)[0]).toBe(first);
  });

  it("never filters a share on a label its group already fixes, which reads 0 or 100 % per group", () => {
    const series = [
      { lib: "aspnet", svc: "cart", route: "/get", node: "a" },
      { lib: "aspnet", svc: "cart", route: "/add", node: "b" },
      { lib: "flagd", svc: "flagd", route: "/eval", node: "a" },
      { lib: "flagd", svc: "flagd", route: "/eval", node: "c" },
    ];
    const profile = labelProfile(series);
    expect(rankMetricCategory(profile)[0]).toBe("lib");
    expect(rankMetricCategory(profile, { group: "svc", series })[0]).toBe("route");
  });

  it("ranks numbers by tail weight, heavy-tailed first", () => {
    const shapes = readFieldShapes(
      { t: 100, k0: 100, m0: 200, q0: 500, k1: 90, m1: 1000, q1: 90000 },
      [],
      ["status", "took"],
    );
    expect(rankMeasure(["status", "took"], shapes)).toEqual(["took", "status"]);
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
