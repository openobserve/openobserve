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
  formatPromSeries,
  getQueryVariableLanguage,
  getQueryVariableMaxRecords,
  getQueryVariableAllValues,
  getSqlResultColumns,
  getUndefinedQueryVariableNames,
  isExplicitQuerySelection,
  isQueryBackedVariable,
  isQueryVariableAllPending,
  isQueryVariable,
  mapSqlRowsToOptions,
  mapValuesToOptions,
  parsePromVariableQuery,
  QUERY_VARIABLE_NO_VALUES,
  reconcileQueryVariableValue,
  resolveQueryVariableValue,
  substituteQueryVariables,
} from "./queryVariableUtils";

describe("isQueryBackedVariable", () => {
  it.each([
    ["query_values", true],
    ["query", true],
    ["custom", false],
    ["constant", false],
    ["textbox", false],
    ["dynamic_filters", false],
  ])("treats %s as query-backed: %s", (type, expected) => {
    expect(isQueryBackedVariable({ type })).toBe(expected);
  });

  it("is false for a missing variable", () => {
    expect(isQueryBackedVariable(undefined)).toBe(false);
    expect(isQueryBackedVariable(null)).toBe(false);
    expect(isQueryBackedVariable({})).toBe(false);
  });

  it("isQueryVariable matches only the query type", () => {
    expect(isQueryVariable({ type: "query" })).toBe(true);
    expect(isQueryVariable({ type: "query_values" })).toBe(false);
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
  const svc = { type: "query", multiSelect: true, value: [SELECT_ALL_VALUE], options };

  it("stands for the listed option values", () => {
    expect(getQueryVariableAllValues(svc)).toEqual(["checkout", "payments"]);
  });

  it("leaves query_values, single-select and explicit picks alone", () => {
    expect(getQueryVariableAllValues({ ...svc, type: "query_values" })).toBeUndefined();
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
    expect(
      resolveQueryVariableValue({ ...svc, type: "query_values", options: [], value: [] }),
    ).toEqual([]);
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
