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
  compareFactor,
  compareFunction,
  compareRule,
  fieldKind,
  fieldsBySamplePresence,
  intentsFor,
  labelPattern,
  patternText,
  labelProfile,
  familyMember,
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
  withCaseVariants,
  type FieldShape,
} from "./alertIntents";

let n = 0;
const id = () => `id${++n}`;

describe("alertIntents", () => {
  it.each([
    ["logs", true, ["countWhere", "percentile", "anyEvent", "unusualVolume", "compareLastWeek"]],
    ["traces", false, ["countWhere", "percentile", "anyEvent", "compareLastWeek"]],
    ["metrics", true, ["metricAbove", "ratio", "unusualChange", "promql"]],
    ["metrics", false, ["metricAbove", "ratio", "promql"]],
  ])("offers %s intents (anomaly %s)", (type, anomaly, ids) => {
    expect(intentsFor(type, { anomaly })).toEqual(ids);
  });

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
    expect(rankMetricCategory(profile).fit[0]).toBe("lib");
    expect(rankMetricCategory(profile, { group: "svc", series }).fit[0]).toBe("code");
    const oneCode = labelProfile([
      { code: "200", node: "a" },
      { code: "200", node: "b" },
    ]);
    expect(rankMetricCategory(oneCode)).toEqual({ fit: [], all: ["code", "node"] });
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
    expect(starterValue(seen, recent)).toBe("WARN");
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
    expect(starterAlternative(seen)).toBe("WARN");
    expect(starterAlternative(seen.filter((v) => v.value !== "WARN"))).toBeUndefined();
    expect(spellingVariants(["WARN"], seen)).toEqual(["Warning"]);
    expect(spellingVariants(["ERROR", "error"], seen)).toEqual([]);
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
      { field: "level", values: ["ERROR", "error"], group: "svc" },
      {
        howItChecks: "false",
        aggregation: true,
        agg: { function: "count", having: { column: "svc", operator: ">", value: "" } },
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
      `SELECT count(*) AS events FROM "app" WHERE "level" = 'it''s'`,
    );
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
    // Only fire once the past window has data: an empty past no longer passes as "0 × factor".
    expect(compareFunction(2, true)).toContain("previous > 0.0 && current > previous * 2.0");
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
      familyMember("code", [{ code: "500" }, { code: "200", status_code: "200" }, { pod: "a" }]),
    ).toEqual({ labels: ["code"], whole: false });

    const fill = buildMetricFill(
      "ratio",
      {
        metric: "http_server_request_duration_count",
        values: ["5.."],
        patterns: ["5.."],
        group: "service_name",
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
    { intent: "metricAbove", counter: true, group: "host", promql: "sum by (host) (rate(m[10m]))" },
    { intent: "metricAbove", counter: true, group: undefined, promql: "rate(m[10m])" },
    { intent: "promql", counter: true, group: undefined, promql: "rate(m[10m])" },
    { intent: "promql", counter: false, group: undefined, promql: "m" },
  ] as const)(
    "$intent on a counter $counter per $group reads $promql",
    ({ intent, counter, group, promql }) => {
      const fill = buildMetricFill(intent, { metric: "m", counter, group }, { periodMinutes: 10 });
      expect(fill.values).toMatchObject({
        "query_condition.type": "promql",
        "query_condition.promql": promql,
        "query_condition.promql_multi_alert": !!group,
      });
    },
  );

  it("a gauge above a value keeps the builder's average", () => {
    const fill = buildMetricFill(
      "metricAbove",
      { metric: "m", counter: false },
      { periodMinutes: 10 },
    );
    expect(fill.values["query_condition.type"]).toBe("custom");
  });

  it("ranks metric labels for grouping by how many series carry them", () => {
    const profile = labelProfile([
      { __name__: "m", host: "a", cpu: "0", job: "x" },
      { __name__: "m", host: "a", cpu: "1", job: "x" },
      { __name__: "m", host: "b", cpu: "2" },
    ]);
    expect(rankMetricGroup(profile).all).toEqual(["cpu", "host", "job"]);
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
