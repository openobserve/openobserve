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
import { generateSqlQuery } from "./alertQueryBuilder";
import {
  aggsFor,
  buildEventFill,
  buildMetricFill,
  cardsFolded,
  carriedThreshold,
  compareFactor,
  compareFunction,
  compareSql,
  compareRule,
  describeIntent,
  errorRateValues,
  fieldKind,
  intentAlertName,
  fieldsBySamplePresence,
  intentsFor,
  labelPattern,
  patternText,
  labelProfile,
  familyMember,
  labelSpellings,
  metricFamilySiblings,
  rankCategory,
  rankGroup,
  rankMeasure,
  rankMetricCategory,
  rankMetricGroup,
  orgGroupUse,
  pickedValues,
  spellingVariants,
  starterAlternative,
  ratioPromql,
  starterValue,
  readFieldShapes,
  shapeQuerySql,
  slotFields,
  slotsFromForm,
  thresholdPaths,
  withCaseVariants,
  hasCaseVariants,
  type FieldShape,
  type IntentId,
} from "./alertIntents";

let n = 0;
const id = () => `id${++n}`;

describe("alertIntents", () => {
  it.each([
    ["logs", true, ["countWhere", "percentile", "anyEvent", "unusualVolume", "compareLastWeek"]],
    ["traces", false, ["countWhere", "percentile", "anyEvent", "compareLastWeek"]],
    ["metrics", true, ["metricAbove", "percentile", "ratio", "unusualChange", "promql"]],
    ["metrics", false, ["metricAbove", "percentile", "ratio", "promql"]],
    ["metrics", true, ["percentile", "metricAbove", "ratio", "unusualChange", "promql"], true],
  ] as const)(
    "offers %s intents (anomaly %s): %j, histogram buckets %s",
    (type, anomaly, ids, bucket) => {
      expect(intentsFor(type, { anomaly, bucket })).toEqual(ids);
    },
  );

  it("does not offer a per-event intent once When unusual is picked", () => {
    expect(intentsFor("logs", { anomaly: true, howItChecks: "anomaly" })).not.toContain("anyEvent");
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
  // cluster, a latency grouped by node; a slot nothing passes stays empty rather than take a weak pick.
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
    [
      "a count suggests no filter when no field has a majority beside a minority",
      { svc: [100, 4, even("svc-", 4, 25)], node: [100, 3, { a: 34, b: 33, c: 33 }] },
      (n: string[], s: FieldShape[]) => rankCategory(n, s),
      undefined,
    ],
    [
      "no group is suggested when every field holds most events in one value",
      { cluster: [100, 3, { dev: 94, prod: 5, edge: 1 }] },
      (n: string[], s: FieldShape[]) => rankGroup(n, s),
      undefined,
    ],
  ])("%s", (_, fields, rank, first) => {
    const { names, shapes } = shapesOf(
      fields as Record<string, [number, number, Record<string, number>]>,
    );
    const ranked = rank(names, shapes);
    expect(ranked.fit[0]).toBe(first);
    expect(ranked.all).toHaveLength(names.length);
  });

  it("filters a share on a lopsided label its group does not fix, and on none when no label is lopsided", () => {
    const series = [
      { lib: "aspnet", svc: "cart", route: "/get", code: "200", node: "a" },
      { lib: "aspnet", svc: "cart", route: "/get", code: "500", node: "b" },
      { lib: "aspnet", svc: "cart", route: "/add", code: "200", node: "a" },
      { lib: "flagd", svc: "flagd", route: "/eval", code: "200", node: "c" },
    ];
    const profile = labelProfile(series);
    expect(rankMetricCategory(profile).fit).toContain("lib");
    expect(rankMetricCategory(profile, { groups: ["svc"], series }).fit).not.toContain("lib");
    const oneCode = labelProfile([
      { code: "200", node: "a" },
      { code: "200", node: "b" },
    ]);
    expect(rankMetricCategory(oneCode)).toEqual({ fit: [], all: ["code", "node"] });
  });

  it("an error rate filters on the status label, its spellings read together, before any lopsided label", () => {
    const series = [
      ...["a", "b", "c", "d"].map((pod) => ({
        lib: "actix",
        pod,
        http_response_status_code: "200",
      })),
      ...["e", "f"].map((pod) => ({ lib: "flask", pod, http_status_code: "200" })),
    ];
    const profile = labelProfile(series);
    expect(rankMetricCategory(profile, { series }).fit[0]).toBe("lib");
    expect(rankMetricCategory(profile, { series, outcome: true }).fit).toEqual([
      "http_response_status_code",
      "lib",
    ]);
  });

  it.each([
    ["every 5xx code over status codes", ["200", "404"], { values: ["5.."], patterns: ["5.."] }],
    ["the error-like outcomes", ["Ok", "Error", "Unset"], { values: ["Error"], patterns: [] }],
    ["nothing when no value names an error", ["Ok", "Unset"], { values: [], patterns: [] }],
  ])("an error rate matches %s", (_, values, expected) => {
    expect(errorRateValues(values.map((value) => ({ value, count: 1 })))).toEqual(expected);
  });

  const lopsided = (label: string, [major, minor]: string[]) =>
    [major, major, major, minor].map((v, i) => ({ [label]: v, node: `n${i}` }));
  it.each([
    ["status codes over a version", ["flavor", ["1.1", "2"]], ["code", ["200", "500"]], "code"],
    [
      "outcomes over a library",
      ["lib", ["aspnet", "flagd"]],
      ["status", ["Ok", "Error"]],
      "status",
    ],
    ["a plain number over a version", ["flavor", ["1.1", "2.0"]], ["proto", ["3", "2"]], "proto"],
  ])("a share filters on %s", (_, [a, av], [b, bv], first) => {
    const series = lopsided(a as string, av as string[]).map((one, i) => ({
      ...one,
      ...lopsided(b as string, bv as string[])[i],
    }));
    const ranked = rankMetricCategory(labelProfile(series));
    expect(ranked.fit[0]).toBe(first);
    expect(ranked.fit).not.toContain("flavor");
  });

  it("ranks numbers by tail weight, heavy-tailed first", () => {
    const shapes = readFieldShapes(
      { t: 100, k0: 100, m0: 200, q0: 500, k1: 90, m1: 1000, q1: 90000 },
      [],
      ["status", "took"],
    );
    expect(rankMeasure(["status", "took"], shapes)).toEqual({
      fit: ["took"],
      all: ["took", "status"],
    });
    expect(rankMeasure(["status"], shapes).fit).toEqual([]);
  });

  it("starts from the largest minority value seen recently, never a spelling of the majority", () => {
    const seen = [
      { value: "INFO", count: 75172 },
      { value: "Information", count: 3565 },
      { value: "ERROR", count: 1455 },
      { value: "error", count: 40 },
      { value: "WARN", count: 1448 },
      { value: "info", count: 604 },
      { value: "Warning", count: 2 },
    ];
    const recent = seen.filter((v) => v.value !== "ERROR");
    expect(starterValue(seen)).toBe("ERROR");
    expect(starterValue(seen, recent)).toBe("error");
    expect(starterAlternative(seen, recent)).toBe("WARN");
    expect(starterValue(seen, [])).toBe("ERROR");
    for (const none of [
      [
        { value: "a", count: 5 },
        { value: "b", count: 6 },
      ],
      [{ value: "200", count: 9 }],
      [],
    ])
      expect(starterValue(none)).toBeUndefined();
    expect(withCaseVariants(["ERROR"], seen)).toEqual(["ERROR", "error"]);
    expect(hasCaseVariants(seen)).toBe(true);
    expect(hasCaseVariants(seen.filter((v) => !["error", "info"].includes(v.value)))).toBe(false);
    expect(starterAlternative(seen)).toBe("WARN");
    expect(starterAlternative(seen.filter((v) => v.value !== "WARN"))).toBeUndefined();
    expect(spellingVariants(["WARN"], seen)).toEqual(["Warning"]);
    expect(spellingVariants(["ERROR", "error"], seen)).toEqual([]);
  });

  const counts = (pairs: [string, number][]) => pairs.map(([value, count]) => ({ value, count }));
  it.each([
    [
      "an error-like value ahead of a larger warning, which is offered",
      [
        ["INFO", 900],
        ["WARN", 300],
        ["ERROR", 50],
      ],
      "ERROR",
      "WARN",
    ],
    [
      "the largest minority when none is error-like",
      [
        ["INFO", 900],
        ["WARN", 300],
        ["DEBUG", 50],
      ],
      "WARN",
      undefined,
    ],
    [
      "a failure outcome over a larger other one",
      [
        ["ok", 900],
        ["cancelled", 80],
        ["failed", 20],
      ],
      "failed",
      "cancelled",
    ],
  ])("a count starts from %s", (_, pairs, value, alternative) => {
    const seen = counts(pairs as [string, number][]);
    expect(starterValue(seen)).toBe(value);
    expect(starterAlternative(seen)).toBe(alternative);
  });

  it.each([
    ["a first pick replaces the suggestion", ["WARN", "ERROR"], ["WARN"], ["ERROR"], []],
    ["unticking keeps the rest", [], ["WARN"], [], []],
    ["a pick after the user's own joins it", ["WARN", "ERROR"], [], ["WARN", "ERROR"], []],
    ["a re-select keeps the suggestion for the next pick", ["WARN"], ["WARN"], ["WARN"], ["WARN"]],
  ])("value picker: %s", (_, picked, seeded, values, nextSeeded) => {
    expect(pickedValues(picked, ["WARN"], seeded)).toEqual({ values, seeded: nextSeeded });
  });

  it.each([
    [
      "countWhere",
      { field: "level", values: ["ERROR", "error"], groups: ["svc"] },
      {
        howItChecks: "false",
        aggregation: true,
        agg: { function: "count", having: { column: "svc", operator: ">", value: "" } },
        condition: { column: "level", operator: "in", value: ["ERROR", "error"] },
      },
    ],
    [
      "percentile",
      { measure: "took", groups: ["svc"] },
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

  it("checks an unusual volume once per bucket over the recommended window, scoped to the picked value", () => {
    const fill = buildEventFill(
      "unusualVolume",
      { field: "svc", values: ["api"] },
      { stream: "s", id },
    );
    expect(fill.anomaly).toMatchObject({
      filters: [{ field: "svc", operator: "=", value: "api" }],
      schedule_interval_value: 5,
      schedule_interval_unit: "m",
      detection_window_value: 30,
      detection_window_unit: "m",
    });
    expect(buildEventFill("unusualVolume", {}, { stream: "s", id }).anomaly?.filters).toEqual([]);
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
      `SELECT count(*) FILTER (WHERE "level" = 'it''s') AS events, count(*) AS all_events FROM "app"`,
    );
    expect(compareSql("app", {})).toBe(`SELECT count(*) AS events FROM "app"`);
    expect(fill.values["query_condition.multi_time_range"]).toMatchObject([{ offSet: "1w" }]);
    // The server keys the per-window input on a leading marker.
    expect(fill.values["query_condition.vrl_function"]).toBe(compareFunction(3));
    expect(compareFunction(3).startsWith("#ResultArray#\n")).toBe(true);
    expect(compareFunction(3)).toContain("previous * 3.0");
    // Saved as shown: the server appends no `.` line, and the factor reads back from either form.
    expect(compareFunction(3).endsWith("\n.")).toBe(true);
    expect(compareFactor(compareFunction(2.5))).toBe(2.5);
    expect(compareFactor(compareFunction(3).replace(/\n\.$/, ""))).toBe(3);
    expect(compareFactor(compareFunction(3).replace("current > 0.0 && ", ""))).toBeUndefined();
    // Only fire once the past window has data: the stream's whole count, so zero matches is a baseline.
    expect(compareFunction(2, true)).toContain(
      `history = to_float(get(., [1, 0, "all_events"]) ?? 0) ?? 0.0`,
    );
    expect(compareFunction(2, true)).toContain(
      "(previous > 0.0 || history > 0.0) && current > previous * 2.0",
    );
    expect(compareRule(compareFunction(2, true))).toEqual({ factor: 2, needsBaseline: true });
    expect(compareRule(compareFunction(2))).toEqual({ factor: 2, needsBaseline: false });
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
    const series = (status: string, values: string[], service = "svc") =>
      values.map((code) => ({ __name__: "m", service_name: service, [status]: code }));
    const own = familyMember(
      "http_response_status_code",
      series("http_response_status_code", ["200", "500"]),
    );
    // One generation's series spell the label two ways, never both on one series.
    const mixed = [
      ...series("http_response_status_code", ["200"], "shipping"),
      ...series("http_status_code", ["200", "503"], "dashboard"),
    ];
    expect(own).toEqual({ labels: ["http_response_status_code"], whole: true });
    expect(familyMember("http_response_status_code", mixed)).toEqual({
      labels: ["http_response_status_code", "http_status_code"],
      whole: true,
    });
    expect(familyMember("cpu", series("mode", ["idle"]))).toBeUndefined();
    expect(
      labelSpellings(["http_response_status_code", "service_name", "http_status_code"], mixed),
    ).toEqual([["http_response_status_code", "http_status_code"], ["service_name"]]);
    expect(
      familyMember("code", [{ code: "500" }, { code: "200", status_code: "200" }, { pod: "a" }]),
    ).toEqual({ labels: ["code"], whole: false });

    const fill = buildMetricFill(
      "ratio",
      {
        metric: "http_server_request_duration_count",
        values: ["5.."],
        patterns: ["5.."],
        groups: ["service_name"],
        counter: true,
        family: [
          { metric: "http_server_request_duration_count", ...own! },
          {
            metric: "http_server_duration_count",
            labels: ["http_response_status_code", "http_status_code"],
            whole: true,
          },
          { metric: "partial_count", labels: ["code"], whole: false },
        ],
      },
      { periodMinutes: 5 },
    );
    expect(fill.values["query_condition.promql"]).toBe(
      'sum by (service_name) (rate(http_server_request_duration_count{http_response_status_code=~"5.."}[5m]) or rate(http_server_duration_count{http_response_status_code=~"5.."}[5m]) or rate(http_server_duration_count{http_status_code=~"5.."}[5m]) or rate(partial_count{code=~"5.."}[5m])) / sum by (service_name) (rate(http_server_request_duration_count[5m]) or rate(http_server_duration_count[5m]) or rate(partial_count{code=~".+"}[5m])) * 100',
    );
    expect(fill.values["query_condition.promql_condition"]).toMatchObject({
      operator: ">",
      value: "",
    });
    expect(fill.values["query_condition.promql_multi_alert"]).toBe(true);
  });

  it.each([
    {
      intent: "metricAbove",
      counter: true,
      groups: ["host", "dc"],
      promql: "sum by (host, dc) (rate(m[10m]))",
    },
    { intent: "metricAbove", counter: true, groups: undefined, promql: "rate(m[10m])" },
    { intent: "promql", counter: true, groups: undefined, promql: "rate(m[10m])" },
    { intent: "promql", counter: false, groups: undefined, promql: "m" },
    {
      intent: "percentile",
      counter: true,
      groups: ["svc"],
      promql: "histogram_quantile(0.95, sum by (le, svc) (rate(m[10m])))",
    },
    {
      intent: "percentile",
      counter: false,
      groups: undefined,
      promql: "histogram_quantile(0.95, sum by (le) (rate(m[10m])))",
    },
  ] as const)(
    "$intent on a counter $counter per $groups reads $promql",
    ({ intent, counter, groups, promql }) => {
      const fill = buildMetricFill(
        intent,
        { metric: "m", counter, groups, bucket: intent === "percentile" },
        { periodMinutes: 10 },
      );
      expect(fill.values).toMatchObject({
        "query_condition.type": "promql",
        "query_condition.promql": promql,
        "query_condition.promql_multi_alert": !!groups,
      });
    },
  );

  it("a gauge above a value keeps the builder's average unless the sentence picks another", () => {
    const fill = buildMetricFill(
      "metricAbove",
      { metric: "m", counter: false },
      { periodMinutes: 10 },
    );
    expect(fill.values["query_condition.type"]).toBe("custom");
    expect(fill.values["query_condition.aggregation"]).toMatchObject({ function: "avg" });
  });

  // Step 2's function list, each as the builder's query reads it; {c} is the measured column.
  const VALUE_FUNCTIONS = [
    ["count", "count({c})"],
    ["avg", "avg({c})"],
    ["min", "min({c})"],
    ["max", "max({c})"],
    ["sum", "sum({c})"],
    ["median", "median({c})"],
    ["p50", "approx_percentile_cont({c}, 0.5)"],
    ["p75", "approx_percentile_cont({c}, 0.75)"],
    ["p90", "approx_percentile_cont({c}, 0.9)"],
    ["p95", "approx_percentile_cont({c}, 0.95)"],
    ["p99", "approx_percentile_cont({c}, 0.99)"],
  ] as const;
  const builderSql = (values: Record<string, unknown>) =>
    generateSqlQuery(
      {
        stream_name: "s",
        query_condition: {
          conditions: values["query_condition.conditions"] ?? {
            filterType: "group",
            conditions: [],
          },
          aggregation: values["query_condition.aggregation"],
        },
      } as never,
      {},
      true,
    );
  it.each([
    ...VALUE_FUNCTIONS.map(([fn, sql]) => ["logs percentile", fn, sql.replace("{c}", "took")]),
    ...VALUE_FUNCTIONS.map(([fn, sql]) => ["gauge above a value", fn, sql.replace("{c}", "value")]),
  ])("the %s Watch row's %s reads %s", (row, agg, expression) => {
    const fill =
      row === "logs percentile"
        ? ev("percentile", { measure: "took", agg })
        : mt("metricAbove", { counter: false, agg });
    expect(builderSql(fill.values)).toContain(` ${expression} as zo_sql_val`);
  });

  // Every kind offers main's whole list; {q} is the function's quantile, null where main's builder reads it.
  const W = "[10m:1m]";
  const QUANTILES = [
    ["median", 0.5],
    ["p50", 0.5],
    ["p75", 0.75],
    ["p90", 0.9],
    ["p95", 0.95],
    ["p99", 0.99],
  ] as const;
  const histogramQuantiles = Object.fromEntries(
    QUANTILES.map(([fn, q]) => [fn, `histogram_quantile(${q}, sum by (le) (rate(m_bucket[10m])))`]),
  );
  const ROWS: Record<string, Record<string, string | null>> = {
    counter: {
      rate: "rate(m[10m])",
      ...Object.fromEntries(
        ["avg", "min", "max", "sum"].map((fn) => [fn, `${fn}_over_time(rate(m[5m])${W})`]),
      ),
      ...Object.fromEntries(
        QUANTILES.map(([fn, q]) => [fn, `quantile_over_time(${q}, rate(m[5m])${W})`]),
      ),
    },
    bucket: {
      ...histogramQuantiles,
      avg: "sum(rate(m_sum[10m])) / sum(rate(m_count[10m]))",
      count: "sum(rate(m_count[10m]))",
    },
    "bucket without _sum/_count": histogramQuantiles,
  };
  const kindFill = (kind: string, agg: string) =>
    kind === "logs"
      ? ev("percentile", { measure: "took", agg })
      : kind === "gauge"
        ? mt("metricAbove", { agg })
        : kind === "counter"
          ? mt("metricAbove", { agg, counter: true })
          : kind === "bucket above a value"
            ? buildMetricFill(
                "metricAbove",
                { metric: "m_bucket", agg, counter: true, bucket: true },
                { periodMinutes: 10 },
              )
            : buildMetricFill(
                "percentile",
                {
                  metric: "m_bucket",
                  agg,
                  bucket: true,
                  histogram: kind === "bucket" ? { sum: "m_sum", count: "m_count" } : {},
                },
                { periodMinutes: 10 },
              );
  const MAIN_SQL = Object.fromEntries(VALUE_FUNCTIONS);
  it.each(
    [
      "logs",
      "gauge",
      "counter",
      "bucket",
      "bucket without _sum/_count",
      "bucket above a value",
    ].flatMap((kind) => {
      const intent =
        kind === "gauge" || kind.includes("above") || kind === "counter"
          ? "metricAbove"
          : "percentile";
      const own = ROWS[kind] ?? {};
      const fns = aggsFor(
        intent,
        kind === "counter" ? "counter" : kind === "logs" ? "events" : "gauge",
      );
      return fns.map((fn) => [kind, fn, own[fn] ?? null] as const);
    }),
  )(
    "%s offers %s, which reads %s (null: main's builder) and reads back as itself",
    (kind, agg, promql) => {
      const fill = kindFill(kind, agg);
      const read = (path: string) => (fill.values as Record<string, unknown>)[path];
      // A builder function on a metric clears the PromQL an earlier pick wrote, so Save runs one query.
      if (kind !== "logs") expect(read("query_condition.promql")).toBe(promql ?? "");
      if (promql) expect(read("query_condition.type")).toBe("promql");
      else if (agg === "total_events") expect(read("query_condition.aggregation")).toBeNull();
      else {
        const column = kind === "logs" ? "took" : "value";
        expect(builderSql(fill.values)).toContain(
          ` ${MAIN_SQL[agg].replace("{c}", column)} as zo_sql_val`,
        );
      }
      expect(slotsFromForm(fill.intent, read, { agg }).agg).toBe(agg);
    },
  );

  const HAVING = [
    "query_condition.aggregation.having.operator",
    "query_condition.aggregation.having.value",
  ];
  const PROMQL = [
    "query_condition.promql_condition.operator",
    "query_condition.promql_condition.value",
  ];
  const COUNT = ["trigger_condition.operator", "trigger_condition.threshold"];
  const ev = (intent: string, slots: object) =>
    buildEventFill(intent as any, slots, { stream: "s", id });
  const mt = (intent: string, slots: object) =>
    buildMetricFill(intent as any, { metric: "m", ...slots }, { periodMinutes: 10 });
  it.each([
    ["count per group", ev("countWhere", { groups: ["svc"] }), HAVING],
    ["count of all", ev("countWhere", {}), COUNT],
    ["percentile", ev("percentile", { measure: "took" }), HAVING],
    ["gauge above a value", mt("metricAbove", { counter: false }), HAVING],
    ["counter above a value", mt("metricAbove", { counter: true }), PROMQL],
    ["error-rate share", mt("ratio", { label: "code", values: ["5"] }), PROMQL],
    ["histogram percentile", mt("percentile", { bucket: true }), PROMQL],
    ["histogram total events", mt("percentile", { bucket: true, agg: "total_events" }), COUNT],
    ["as it happens", ev("anyEvent", {}), null],
    ["compare with last week", ev("compareLastWeek", {}), null],
    ["unusual volume", ev("unusualVolume", {}), null],
    ["written PromQL", mt("promql", {}), null],
  ])("the %s sentence types its threshold at %j", (_, fill, paths) => {
    const got = thresholdPaths(fill);
    expect(got ? [got.operator, got.value] : null).toEqual(paths);
  });

  it("keeps the typed threshold when a slot of the same intent changes, never across intents", () => {
    const form: Record<string, unknown> = {
      "query_condition.aggregation.having.operator": ">=",
      "query_condition.aggregation.having.value": "50",
    };
    const read = (path: string) => form[path];
    const grouped = ev("countWhere", { groups: ["svc"] });
    expect(carriedThreshold(grouped, ev("countWhere", { groups: ["host"] }), read)).toEqual(form);
    expect(carriedThreshold(grouped, ev("countWhere", {}), read)).toEqual({
      "trigger_condition.operator": ">=",
      "trigger_condition.threshold": "50",
    });
    expect(carriedThreshold(grouped, ev("percentile", { groups: ["svc"] }), read)).toEqual({});
    form["query_condition.aggregation.having.value"] = "";
    expect(carriedThreshold(grouped, ev("countWhere", { groups: ["host"] }), read)).toEqual({});
  });

  it.each([
    ["a builder's group-by", mt("metricAbove", { groups: ["host", "dc"] }), ["host", "dc"]],
    ["a count per group", ev("countWhere", { groups: ["svc", "pod"] }), ["svc", "pod"]],
    [
      "a histogram's by (…) without le",
      mt("percentile", { groups: ["a", "b"], bucket: true }),
      ["a", "b"],
    ],
    ["a share's by (…)", mt("ratio", { label: "c", values: ["5"], groups: ["x"] }), ["x"]],
    ["an ungrouped builder", mt("metricAbove", {}), []],
  ])("step 1 reads its Per back from %s", (_, fill, groups) => {
    const read = (path: string) => (fill.values as Record<string, unknown>)[path];
    expect(slotsFromForm(fill.intent, read).groups).toEqual(groups);
  });

  it("ranks metric labels for grouping by how many series carry them", () => {
    const profile = labelProfile([
      { __name__: "m", host: "a", cpu: "0", job: "x", le: "0.5" },
      { __name__: "m", host: "a", cpu: "1", job: "x", le: "1" },
      { __name__: "m", host: "b", cpu: "2", le: "+Inf" },
    ]);
    expect(rankMetricGroup(profile).all).toEqual(["cpu", "host", "job", "le"]);
  });

  it("groups a metric by the label naming its entity, then by what the org's alerts group by", () => {
    const series = Array.from({ length: 300 }, (_, i) => ({
      k8s_pod_name: `checkout-${String.fromCharCode(97 + (i % 26))}${Math.floor(i / 26)}`,
      k8s_pod_uid: `${1000 + i}-${2000 + i}`,
      k8s_namespace_name: `ns-${["a", "b", "c"][i % 3]}`,
      k8s_cluster_name: `c${i % 2}`,
      service_name: `svc-${["a", "b", "c", "d"][i % 4]}`,
    }));
    const profile = labelProfile(series);
    expect(rankMetricGroup(profile, { metric: "k8s_pod_memory_usage" }).fit[0]).toBe(
      "k8s_pod_name",
    );
    const nodes = Array.from({ length: 300 }, (_, i) => ({
      k8s_node_name: `ip-10-2-${100 + (i % 150)}-${100 + i}.ec2.internal`,
      k8s_node_uid: `b5f932d0-6916-48a2-9f4f-${100000000000 + i}`,
      k8s_cluster: `c${i % 8}`,
    }));
    expect(rankMetricGroup(labelProfile(nodes), { metric: "k8s_node_cpu_usage" }).fit[0]).toBe(
      "k8s_node_name",
    );
    const orgUse = orgGroupUse([
      { condition: { aggregation: { group_by: ["service_name"] } } },
      { condition: { promql: "sum by (service_name) (rate(x[5m]))" } },
    ]);
    expect(orgUse.get("service_name")).toBe(2);
    expect(rankMetricGroup(profile, { metric: "http_server_duration", orgUse }).fit[0]).toBe(
      "service_name",
    );
    const { names, shapes } = shapesOf({
      deployment: [100, 4, { a: 30, b: 30, c: 40 }],
      service: [100, 4, { a: 30, b: 30, c: 40 }],
    });
    expect(rankGroup(names, shapes, orgUse.set("service", 1)).fit[0]).toBe("service");
  });

  it.each([
    [undefined, false],
    [9, false],
    [10, true],
  ])("folds the cards for an org with %s alerts: %s", (count, folded) => {
    expect(cardsFolded(count)).toBe(folded);
  });
});

describe("label value patterns", () => {
  it.each([
    ["5xx", ["200"], "5.."],
    ["5XX", [], "5.."],
    ["50x", [], "50."],
    ["5xx", ["5xx", "200"], "5xx"],
    ["500", [], "500"],
    ["xx", [], "xx"],
    ["OOMKilled", [], "OOMKilled"],
  ])("%s typed beside %j matches %s", (typed, seen, expected) => {
    expect(labelPattern(typed, seen)).toBe(expected);
  });

  it.each([
    ["5..", ["5.."], "5xx"],
    ["50.", ["50."], "50x"],
    ["1.2", [], "1.2"],
    ["500", [], "500"],
  ])("%s with patterns %j reads as %s", (value, patterns, text) => {
    expect(patternText(value, patterns)).toBe(text);
  });

  it.each([
    [["api"], [], "api"],
    [["api.v1"], [], "api\\\\.v1"],
    [["a+b"], [], "a\\\\+b"],
    [["f(x)"], [], "f\\\\(x\\\\)"],
    [["a|b"], [], "a\\\\|b"],
    [["C:\\tmp"], [], "C:\\\\\\\\tmp"],
    [['it"s'], [], 'it\\"s'],
    [["5..", "1.2"], ["5.."], "5..|1\\\\.2"],
  ])("%j with patterns %j matches %s", (values, patterns, matcher) => {
    const promql = ratioPromql({
      members: [{ metric: "m", labels: ["code"], whole: true }],
      values,
      patterns,
      counter: false,
      windowMinutes: 5,
    });
    expect(promql).toBe(`sum (m{code=~"${matcher}"}) / sum (m) * 100`);
  });
});

describe("intentAlertName", () => {
  it.each([
    [
      "ratio",
      { values: ["5.."], patterns: ["5.."], groups: ["service_name"] },
      "http_server_duration_count",
      "metrics",
      "http_5xx_error_rate_per_service",
    ],
    [
      "unusualVolume",
      { field: "service", values: ["payment"] },
      "app",
      "logs",
      "payment_log_volume_unusual",
    ],
    [
      "countWhere",
      { values: ["ERROR", "error"], groups: ["service_name", "k8s_node_name"] },
      "app",
      "logs",
      "error_log_count_per_service_and_k8s_node",
    ],
    [
      "percentile",
      { measure: "duration", groups: ["service_name"] },
      "default",
      "traces",
      "duration_p95_per_service",
    ],
    ["compareLastWeek", { values: ["ERROR"], factor: 3 }, "app", "logs", "error_log_3x_last_week"],
    ["anyEvent", { values: [] }, "k8s_events", "logs", "k8s_events_each_log"],
    [
      "metricAbove",
      { agg: "max", groups: ["host"] },
      "node_cpu",
      "metrics",
      "node_cpu_max_per_host",
    ],
    ["metricAbove", { kind: "counter" }, "reqs_total", "metrics", "reqs_total_per_second"],
    [
      "metricAbove",
      { kind: "counter", agg: "max" },
      "reqs_total",
      "metrics",
      "reqs_total_max_per_second",
    ],
    [
      "percentile",
      { kind: "bucket", agg: "avg", histogram: { sum: "d_sum", count: "d_count" } },
      "d_bucket",
      "metrics",
      "d_avg",
    ],
  ])("%s names what it watches", (intent, slots, stream, streamType, name) => {
    const d = describeIntent(intent as IntentId, slots, {
      stream,
      metrics: streamType === "metrics",
    });
    expect(intentAlertName(d, streamType)).toBe(name);
  });
});
