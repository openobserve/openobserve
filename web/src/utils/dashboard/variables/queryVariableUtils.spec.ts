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
import { CUSTOM_VALUE, SELECT_ALL_VALUE } from "@/utils/dashboard/constants";
import {
  buildAutoPromqlQuery,
  buildAutoSqlQuery,
  expandMultiValueFilter,
  formatPromSeries,
  getQueryVariableLanguage,
  getQueryVariableMaxRecords,
  getQueryVariableAllValues,
  getQueryVariableQuery,
  getSqlResultColumns,
  getUndefinedQueryVariableNames,
  isExplicitQuerySelection,
  isCustomQueryVariable,
  isQueryVariableAllPending,
  mapSqlRowsToOptions,
  mapValuesToOptions,
  parsePromVariableQuery,
  QUERY_VARIABLE_NO_VALUES,
  reconcileQueryVariableValue,
  resolveQueryVariableValue,
  substituteQueryVariables,
  usesQueryVariableLoader,
} from "./queryVariableUtils";

describe("query_values modes", () => {
  const custom = { type: "query_values", query_data: { custom_query: true } };
  const autoSql = { type: "query_values", query_data: { stream: "default", field: "host" } };
  const autoPromql = { type: "query_values", query_data: { query_type: "promql" } };

  it("treats only a query_values variable with custom_query as custom", () => {
    expect(isCustomQueryVariable(custom)).toBe(true);
    expect(isCustomQueryVariable(autoSql)).toBe(false);
    expect(isCustomQueryVariable(autoPromql)).toBe(false);
    expect(isCustomQueryVariable({ type: "custom", query_data: { custom_query: true } })).toBe(
      false,
    );
    expect(isCustomQueryVariable(undefined)).toBe(false);
  });

  it("loads custom and auto PromQL through the query loader, and leaves auto SQL alone", () => {
    expect(usesQueryVariableLoader(custom)).toBe(true);
    expect(usesQueryVariableLoader(autoPromql)).toBe(true);
    expect(usesQueryVariableLoader(autoSql)).toBe(false);
    expect(
      usesQueryVariableLoader({ type: "constant", query_data: { query_type: "promql" } }),
    ).toBe(false);
  });

  it("runs the custom text for a custom variable and label_values for auto PromQL", () => {
    expect(
      getQueryVariableQuery({
        type: "query_values",
        query_data: { custom_query: true, query: "label_names()" },
      }),
    ).toBe("label_names()");
    expect(
      getQueryVariableQuery({
        type: "query_values",
        query_data: { query_type: "promql", stream: "up", field: "job" },
      }),
    ).toBe("label_values(up, job)");
  });
});

describe("buildAutoPromqlQuery", () => {
  it("turns filter rows into label matchers", () => {
    expect(
      buildAutoPromqlQuery({
        stream: "http_requests_total",
        field: "instance",
        filter: [
          { name: "job", operator: "=", value: "api" },
          { name: "code", operator: "!=", value: "500" },
          { name: "path", operator: "re_match", value: "/api/.*" },
          { name: "env", operator: "re_not_match", value: "dev|qa" },
          { name: "region", operator: "IN", value: "'eu', 'us'" },
          { name: "zone", operator: "NOT IN", value: "a,b" },
          { name: "pod", operator: "Is Not Null", value: "" },
          { name: "node", operator: "Is Null", value: "" },
        ],
      }),
    ).toBe(
      'label_values(http_requests_total{job="api",code!="500",path=~"/api/.*",env!~"dev|qa",region=~"eu|us",zone!~"a|b",pod!="",node=""}, instance)',
    );
  });

  it("uses a regex matcher for a $variable so a multi-value expansion still matches", () => {
    expect(
      buildAutoPromqlQuery({
        stream: "up",
        field: "pod",
        filter: [
          { name: "namespace", operator: "=", value: "$namespace" },
          { name: "job", operator: "!=", value: "${job}" },
        ],
      }),
    ).toBe('label_values(up{namespace=~"$namespace",job!~"${job}"}, pod)');
  });

  it("escapes quotes and skips rows without a label or with an unsupported operator", () => {
    expect(
      buildAutoPromqlQuery({
        stream: "up",
        field: "job",
        filter: [
          { name: "msg", operator: "=", value: 'say "hi"' },
          { name: "", operator: "=", value: "x" },
          { name: "size", operator: ">", value: "3" },
        ],
      }),
    ).toBe('label_values(up{msg="say \\"hi\\""}, job)');
  });

  it("parses back into a label_values lookup scoped by the selector", () => {
    const query = buildAutoPromqlQuery({
      stream: "up",
      field: "job",
      filter: [{ name: "env", operator: "=", value: "prod, eu" }],
    });
    expect(parsePromVariableQuery(query)).toEqual({
      kind: "label_values",
      label: "job",
      match: 'up{env="prod, eu"}',
    });
  });
});

describe("expandMultiValueFilter", () => {
  const values: Record<string, unknown> = { cluster: ["eu", "us"], env: "prod" };
  const valueOf = (name: string) => values[name];

  it("turns = and != on a list-valued variable into IN and NOT IN", () => {
    for (const value of ["$cluster", "${cluster}", "{{cluster}}", "'$cluster'"]) {
      expect(expandMultiValueFilter({ operator: "=", value }, valueOf).operator).toBe("IN");
    }
    expect(expandMultiValueFilter({ operator: "!=", value: "$cluster" }, valueOf).operator).toBe(
      "NOT IN",
    );
  });

  it("leaves single values, other operators, formats and mixed text alone", () => {
    const same = (filter: { operator: string; value: string }) =>
      expect(expandMultiValueFilter(filter, valueOf)).toBe(filter);
    same({ operator: "=", value: "$env" });
    same({ operator: "=", value: "$missing" });
    same({ operator: ">", value: "$cluster" });
    same({ operator: "=", value: "${cluster:csv}" });
    same({ operator: "=", value: "eu-$cluster" });
    same({ operator: "=", value: "eu" });
  });
});

describe("buildAutoSqlQuery", () => {
  it("selects the distinct field values of the stream", () => {
    expect(buildAutoSqlQuery({ stream: "default", field: "host" })).toBe(
      'SELECT DISTINCT "host" FROM "default"',
    );
  });

  it("returns the query synchronously, $variable filters included", () => {
    expect(
      buildAutoSqlQuery({
        stream: "up",
        field: "namespace",
        filter: [
          { name: "cluster", operator: "=", value: "$cluster" },
          { name: "", operator: "=", value: "ignored" },
        ],
      }),
    ).toBe(`SELECT DISTINCT "namespace" FROM "up" WHERE "cluster" = '$cluster'`);
  });

  it("writes every auto filter operator the way the auto query does", () => {
    const where = (operator: string, value = "v") =>
      buildAutoSqlQuery({
        stream: "s",
        field: "f",
        filter: [{ name: "c", operator, value }],
      }).split(" WHERE ")[1];
    expect(where("!=", "it's")).toBe(`"c" != 'it''s'`);
    expect(where(">=", "5")).toBe(`"c" >= '5'`);
    expect(where("IN", "'a', 'b'")).toBe(`"c" IN ('a', 'b')`);
    expect(where("NOT IN", "$env")).toBe(`"c" NOT IN ('$env')`);
    expect(where("str_match")).toBe(`str_match("c", 'v')`);
    expect(where("Contains")).toBe(`str_match("c", 'v')`);
    expect(where("str_match_ignore_case")).toBe(`str_match_ignore_case("c", 'v')`);
    expect(where("re_match", "a.*")).toBe(`re_match("c", 'a.*')`);
    expect(where("re_not_match", "a.*")).toBe(`re_not_match("c", 'a.*')`);
    expect(where("match_all", "err")).toBe(`match_all('err')`);
    expect(where("Not Contains")).toBe(`"c" NOT LIKE '%v%'`);
    expect(where("Starts With")).toBe(`"c" LIKE 'v%'`);
    expect(where("Ends With")).toBe(`"c" LIKE '%v'`);
    expect(where("Is Null")).toBe(`"c" IS NULL`);
    expect(where("Is Not Null")).toBe(`"c" IS NOT NULL`);
  });

  it("joins several filters with AND", () => {
    expect(
      buildAutoSqlQuery({
        stream: "s",
        field: "f",
        filter: [
          { name: "a", operator: "=", value: "1" },
          { name: "b", operator: "Is Null" },
        ],
      }),
    ).toBe(`SELECT DISTINCT "f" FROM "s" WHERE "a" = '1' AND "b" IS NULL`);
  });
});

describe("query variable settings", () => {
  it("defaults the language to SQL", () => {
    expect(getQueryVariableLanguage({ query_data: { query_type: "promql" } })).toBe("promql");
    expect(getQueryVariableLanguage({ query_data: {} })).toBe("sql");
    expect(getQueryVariableLanguage({})).toBe("sql");
  });

  it("reads max records, defaulting to 10", () => {
    expect(getQueryVariableMaxRecords({ query_data: { max_record_size: 25 } })).toBe(25);
    expect(getQueryVariableMaxRecords({ query_data: { max_record_size: "7" } })).toBe(7);
    expect(getQueryVariableMaxRecords({ query_data: { max_record_size: null } })).toBe(10);
    expect(getQueryVariableMaxRecords({ query_data: { max_record_size: 0 } })).toBe(10);
    expect(getQueryVariableMaxRecords({})).toBe(10);
  });
});

describe("parsePromVariableQuery", () => {
  it("parses label_values(label)", () => {
    expect(parsePromVariableQuery("label_values(job)")).toEqual({
      kind: "label_values",
      label: "job",
    });
  });

  it("parses label_values(selector, label) with commas inside the selector", () => {
    expect(
      parsePromVariableQuery('label_values(kube_pod_info{cluster="a",namespace="b, c"}, pod)'),
    ).toEqual({
      kind: "label_values",
      label: "pod",
      match: 'kube_pod_info{cluster="a",namespace="b, c"}',
    });
  });

  it("parses label_values over a function expression", () => {
    expect(parsePromVariableQuery("label_values(rate(http_requests_total[5m]), instance)")).toEqual(
      {
        kind: "label_values",
        label: "instance",
        match: "rate(http_requests_total[5m])",
      },
    );
  });

  it("parses label_names with and without a selector", () => {
    expect(parsePromVariableQuery("label_names()")).toEqual({ kind: "label_names" });
    expect(parsePromVariableQuery('label_names(up{job="api"})')).toEqual({
      kind: "label_names",
      match: 'up{job="api"}',
    });
  });

  it("parses metrics(regex), quoted or not", () => {
    expect(parsePromVariableQuery("metrics(node_.*)")).toEqual({
      kind: "metrics",
      regex: "node_.*",
    });
    expect(parsePromVariableQuery('metrics("^up$")')).toEqual({ kind: "metrics", regex: "^up$" });
  });

  it("parses query_result(expr) with nested parentheses", () => {
    expect(parsePromVariableQuery("  query_result(topk(5, sum by (pod) (rate(x[5m]))))  ")).toEqual(
      {
        kind: "query_result",
        expr: "topk(5, sum by (pod) (rate(x[5m])))",
      },
    );
  });

  it.each([
    "",
    "up",
    "label_values()",
    "label_values(up, )",
    "label_values(, job)",
    "label_values(a, b, c)",
    "label_values(up, not-a-label)",
    "query_result()",
    "series(up)",
    "label_values(job",
  ])("rejects %j", (input) => {
    expect(parsePromVariableQuery(input)).toBeNull();
  });
});

describe("formatPromSeries", () => {
  it("renders metric, labels, value and a millisecond timestamp", () => {
    expect(
      formatPromSeries({
        metric: { __name__: "up", job: "api", instance: "a:9090" },
        value: [1700000000.5, "1"],
      }),
    ).toBe('up{job="api",instance="a:9090"} 1 1700000000500');
  });

  it("renders an aggregate without a metric name", () => {
    expect(formatPromSeries({ metric: { job: "api" }, value: [1700000000, "3"] })).toBe(
      '{job="api"} 3 1700000000000',
    );
  });
});

describe("mapSqlRowsToOptions", () => {
  const rows = [
    { service: "checkout", errors: 12, name: "Checkout" },
    { service: "cart", errors: 7, name: "" },
    { service: "checkout", errors: 3, name: "Checkout again" },
    { service: null, errors: 1, name: "nothing" },
    { service: "search", errors: 1, name: "Search" },
  ];

  it("lists the columns in first-seen order", () => {
    expect(getSqlResultColumns([{ a: 1 }, { b: 2, a: 3 }])).toEqual(["a", "b"]);
  });

  it("defaults the value and label to the first column", () => {
    const result = mapSqlRowsToOptions(rows, {});
    expect(result.columns).toEqual(["service", "errors", "name"]);
    expect(result.options).toEqual([
      { label: "checkout", value: "checkout" },
      { label: "cart", value: "cart" },
      { label: "search", value: "search" },
    ]);
    expect(result.capped).toBe(false);
  });

  it("uses the label column and falls back to the value when the label is empty", () => {
    const result = mapSqlRowsToOptions(rows, { valueField: "service", labelField: "name" });
    expect(result.options).toEqual([
      { label: "Checkout", value: "checkout" },
      { label: "cart", value: "cart" },
      { label: "Search", value: "search" },
    ]);
  });

  it("stringifies numeric values", () => {
    const result = mapSqlRowsToOptions(rows, { valueField: "errors" });
    expect(result.options.map((o) => o.value)).toEqual(["12", "7", "3", "1"]);
  });

  it("falls back to the first column when the saved value column is gone", () => {
    const result = mapSqlRowsToOptions(rows, { valueField: "renamed", labelField: "missing" });
    expect(result.options[0]).toEqual({ label: "checkout", value: "checkout" });
  });

  it("caps after deduping and flags the cap", () => {
    const result = mapSqlRowsToOptions(rows, { maxRecords: 2 });
    expect(result.options.map((o) => o.value)).toEqual(["checkout", "cart"]);
    expect(result.capped).toBe(true);
  });

  it("returns no options for an empty result", () => {
    expect(mapSqlRowsToOptions([], {})).toEqual({ options: [], columns: [], capped: false });
  });
});

describe("mapValuesToOptions", () => {
  it("dedupes, caps and uses the value as the label", () => {
    expect(mapValuesToOptions(["a", "b", "a", null, "c"], 2)).toEqual({
      options: [
        { label: "a", value: "a" },
        { label: "b", value: "b" },
      ],
      capped: true,
    });
  });
});

describe("substituteQueryVariables", () => {
  const variables = [
    { name: "service", value: "check'out", isVariablePartialLoaded: true },
    { name: "regions", value: ["eu", "us"], isVariablePartialLoaded: true },
    { name: "pending", value: "x", isVariablePartialLoaded: false },
    { name: "empty", value: null, isVariablePartialLoaded: true },
    { name: "all", value: [SELECT_ALL_VALUE], isVariablePartialLoaded: true },
    { name: "typed", value: `mine${CUSTOM_VALUE}`, isVariablePartialLoaded: true },
    { name: "Dynamic filters", type: "dynamic_filters", value: [] },
  ];

  it("escapes a single SQL value in $var, ${var} and {{var}}", () => {
    expect(
      substituteQueryVariables(
        "WHERE a = '$service' AND b = '${service}' AND c = '{{ service }}'",
        variables,
        "sql",
      ),
    ).toBe("WHERE a = 'check''out' AND b = 'check''out' AND c = 'check''out'");
  });

  it("expands a multi-select SQL value inside or outside quotes", () => {
    expect(substituteQueryVariables("region IN ($regions)", variables, "sql")).toBe(
      "region IN ('eu', 'us')",
    );
    expect(substituteQueryVariables("region IN ('$regions')", variables, "sql")).toBe(
      "region IN ('eu', 'us')",
    );
    expect(substituteQueryVariables("'${regions:csv}'", variables, "sql")).toBe("'eu,us'");
  });

  it("joins a PromQL multi-select with | and turns all into .*", () => {
    expect(
      substituteQueryVariables('label_values(up{region=~"$regions"}, job)', variables, "promql"),
    ).toBe('label_values(up{region=~"eu|us"}, job)');
    expect(substituteQueryVariables('up{a=~"$all"}', variables, "promql")).toBe('up{a=~".*"}');
  });

  it("keeps the placeholder of an unloaded, empty or unknown variable", () => {
    expect(substituteQueryVariables("$pending $empty $unknown", variables, "sql")).toBe(
      "$pending $empty $unknown",
    );
  });

  it("strips the custom-value marker", () => {
    expect(substituteQueryVariables("'$typed'", variables, "sql")).toBe("'mine'");
  });
});

describe("query variable 'All'", () => {
  const options = [
    { label: "Checkout", value: "checkout" },
    { label: "Payments", value: "payments" },
  ];
  const svc = {
    type: "query_values",
    query_data: { custom_query: true },
    multiSelect: true,
    value: [SELECT_ALL_VALUE],
    options,
  };

  it("stands for the listed option values", () => {
    expect(getQueryVariableAllValues(svc)).toEqual(["checkout", "payments"]);
  });

  it("leaves query_values, single-select and explicit picks alone", () => {
    expect(getQueryVariableAllValues({ ...svc, query_data: {} })).toBeUndefined();
    expect(getQueryVariableAllValues({ ...svc, multiSelect: false })).toBeUndefined();
    expect(getQueryVariableAllValues({ ...svc, value: ["checkout"] })).toBeUndefined();
  });

  it("matches nothing once loaded with an empty list, and waits while still loading", () => {
    expect(getQueryVariableAllValues({ ...svc, options: [] })).toEqual([QUERY_VARIABLE_NO_VALUES]);
    expect(
      getQueryVariableAllValues({ ...svc, options: [], isVariablePartialLoaded: false }),
    ).toBeUndefined();
    expect(getQueryVariableAllValues({ ...svc, options: undefined })).toBeUndefined();
  });

  it("resolves an empty list to no match for every selection shape", () => {
    expect(resolveQueryVariableValue({ ...svc, options: [] })).toEqual([QUERY_VARIABLE_NO_VALUES]);
    expect(resolveQueryVariableValue({ ...svc, options: [], value: [] })).toEqual([
      QUERY_VARIABLE_NO_VALUES,
    ]);
    expect(
      resolveQueryVariableValue({ ...svc, multiSelect: false, options: [], value: null }),
    ).toBe(QUERY_VARIABLE_NO_VALUES);
    expect(
      resolveQueryVariableValue({
        ...svc,
        multiSelect: false,
        options: [],
        value: SELECT_ALL_VALUE,
      }),
    ).toBe(QUERY_VARIABLE_NO_VALUES);
    expect(resolveQueryVariableValue({ ...svc, options: [], value: ["kept"] })).toEqual(["kept"]);
    expect(resolveQueryVariableValue({ ...svc, query_data: {}, options: [], value: [] })).toEqual(
      [],
    );
  });

  it("filters a child query to nothing when the parent lists nothing", () => {
    const parents = [{ name: "svc", ...svc, options: [], isVariablePartialLoaded: true }];
    expect(substituteQueryVariables("WHERE s IN ($svc)", parents, "sql")).toBe(
      `WHERE s IN ('${QUERY_VARIABLE_NO_VALUES}')`,
    );
  });

  it("treats only a non-empty, non-All value as the user's own pick", () => {
    expect(isExplicitQuerySelection(["a"])).toBe(true);
    expect(isExplicitQuerySelection("a")).toBe(true);
    expect(isExplicitQuerySelection([SELECT_ALL_VALUE])).toBe(false);
    expect(isExplicitQuerySelection(SELECT_ALL_VALUE)).toBe(false);
    expect(isExplicitQuerySelection([])).toBe(false);
    expect(isExplicitQuerySelection(null)).toBe(false);
  });

  it("is pending only until the variable has loaded", () => {
    expect(isQueryVariableAllPending({ ...svc, isVariablePartialLoaded: false })).toBe(true);
    expect(isQueryVariableAllPending({ ...svc, isVariablePartialLoaded: true })).toBe(false);
  });

  it("expands a parent's 'All' in a child query", () => {
    const parents = [{ name: "svc", ...svc, isVariablePartialLoaded: true }];
    expect(substituteQueryVariables("WHERE s IN ($svc)", parents, "sql")).toBe(
      "WHERE s IN ('checkout', 'payments')",
    );
    expect(substituteQueryVariables('up{s=~"$svc"}', parents, "promql")).toBe(
      'up{s=~"checkout|payments"}',
    );
  });
});

describe("reconcileQueryVariableValue", () => {
  const options = [
    { label: "A", value: "a" },
    { label: "B", value: "b" },
  ];

  it("keeps picks that are still listed", () => {
    expect(reconcileQueryVariableValue({ value: "b" }, options)).toBe("b");
    expect(
      reconcileQueryVariableValue({ multiSelect: true, value: ["b", "gone"] }, options),
    ).toEqual(["b"]);
  });

  it("falls back to the first option, or nothing when the range has no values", () => {
    expect(reconcileQueryVariableValue({ value: "gone" }, options)).toBe("a");
    expect(reconcileQueryVariableValue({ value: "gone" }, [])).toBeNull();
    expect(reconcileQueryVariableValue({ multiSelect: true, value: ["gone"] }, [])).toEqual([]);
  });

  it("falls back to the configured all or custom default", () => {
    expect(
      reconcileQueryVariableValue(
        { multiSelect: true, value: ["gone"], selectAllValueForMultiSelect: "all" },
        options,
      ),
    ).toEqual([SELECT_ALL_VALUE]);
    expect(
      reconcileQueryVariableValue(
        {
          multiSelect: true,
          value: ["gone"],
          selectAllValueForMultiSelect: "custom",
          customMultiSelectValue: ["x"],
        },
        options,
      ),
    ).toEqual(["x"]);
  });

  it("keeps 'All' and typed custom values", () => {
    expect(reconcileQueryVariableValue({ value: SELECT_ALL_VALUE }, [])).toBe(SELECT_ALL_VALUE);
    expect(reconcileQueryVariableValue({ value: `typed${CUSTOM_VALUE}` }, options)).toBe(
      `typed${CUSTOM_VALUE}`,
    );
  });
});

describe("getUndefinedQueryVariableNames", () => {
  it("names placeholders that are not dashboard variables", () => {
    expect(
      getUndefinedQueryVariableNames('label_values(up{job="$job", ns="${ns}"}, $pod)', ["pod"]),
    ).toEqual(["job", "ns"]);
  });

  it("ignores built-ins and defined variables", () => {
    expect(getUndefinedQueryVariableNames("rate(x[$__interval]) $svc", ["svc"])).toEqual([]);
  });
});
