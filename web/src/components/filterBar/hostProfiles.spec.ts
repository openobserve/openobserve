// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it } from "vitest";
import i18n from "@/locales";
import { OPERATORS, type FilterCondition, type FilterGroup } from "@/utils/query/filterBar";
import type { TranslateFn } from "@/types/i18n";
import { encodeProfileRouteFilters, parseProfileFilters } from "@/services/profiles";
import { DASHBOARD_SPELLINGS } from "./codecs";
import { FILTER_PROFILES, type FilterProfileName } from "./filterProfiles";
import { filterIssues } from "./filterValidation";
import { operatorName } from "./useFilterBarEditor";

const t = ((key: string) => key) as unknown as TranslateFn;
const context = { fields: [] };

const codec = (name: FilterProfileName) => FILTER_PROFILES[name].codec;

const firstCondition = (tree: FilterGroup) => tree.items[0] as FilterCondition;

const issuesFor = (name: FilterProfileName, conditions: Partial<FilterCondition>[]) => {
  const tree: FilterGroup = {
    kind: "group",
    id: "root",
    connector: "AND",
    items: conditions.map((c, i) => ({
      kind: "condition",
      id: `n${i}`,
      connector: "AND",
      field: "",
      operator: "eq",
      values: [],
      ...c,
    })),
  };
  const profile = FILTER_PROFILES[name];
  return filterIssues(tree, profile, { t, saved: profile.codec.serialize(tree, context) });
};

// Mirrors SUPPORTED_FILTER_OPERATORS in src/core/src/anomaly_detection.rs, compared lower-cased.
const ANOMALY_ALLOWLIST = [
  "=",
  "equals",
  "eq",
  "!=",
  "<>",
  "not_equals",
  "neq",
  ">=",
  "<=",
  ">",
  "<",
  "contains",
  "not contains",
  "not_contains",
  "starts with",
  "starts_with",
  "ends with",
  "ends_with",
  "is null",
  "is_null",
  "is not null",
  "is_not_null",
  "in",
  "not in",
  "not_in",
  "str_match",
  "str_match_ignore_case",
  "match_all",
  "re_match",
  "re_not_match",
];

describe("anomaly profile", () => {
  it("offers only operators the backend allowlist accepts, in the spelling it writes", () => {
    const offered = FILTER_PROFILES.anomaly.operators.string;
    for (const id of offered) {
      const spelling = DASHBOARD_SPELLINGS[id];
      expect(spelling, id).toBeDefined();
      expect(ANOMALY_ALLOWLIST).toContain(spelling!.toLowerCase());
    }
  });

  it("stays a flat AND-only list", () => {
    expect(FILTER_PROFILES.anomaly.maxDepth).toBe(1);
    expect(FILTER_PROFILES.anomaly.connectors).toBe("and-only");
  });
});

describe("profiles profile", () => {
  it("reads every spelling the API accepts", () => {
    const cases: [Record<string, unknown>, string, string[]][] = [
      [{ key: "pod", op: "=", value: "a" }, "eq", ["a"]],
      [{ key: "pod", op: "<>", value: "a" }, "neq", ["a"]],
      [{ key: "pod", op: "re_match", value: "a.*" }, "regex", ["a.*"]],
      [{ key: "pod", op: "!~", value: "a.*" }, "not_regex", ["a.*"]],
      [{ key: "pod", op: "IN", value: "", values: ["a", "b"] }, "in", ["a", "b"]],
      [{ key: "pod", op: "NOT IN", value: "a, b" }, "not_in", ["a", "b"]],
    ];
    for (const [saved, operator, values] of cases) {
      const tree = codec("profiles").parse([saved], context);
      expect(firstCondition(tree)).toMatchObject({ field: "pod", operator, values });
    }
  });

  it("writes a list as `values` and keeps an untouched filter's own spelling", () => {
    const kept = { key: "env", op: "<>", value: "dev" };
    const tree = codec("profiles").parse([kept], context);
    tree.items.push({
      kind: "condition",
      id: "new",
      connector: "AND",
      field: "pod",
      operator: "in",
      values: ["a", "b"],
    });
    const saved = codec("profiles").serialize(tree, context) as unknown[];
    expect(saved[0]).toBe(kept);
    expect(saved[1]).toEqual({ key: "pod", op: "in", value: "", values: ["a", "b"] });
  });

  it("marks a regex that cannot compile or runs past the server's limit", () => {
    expect(issuesFor("profiles", [{ field: "pod", operator: "regex", values: ["(a"] }])).toEqual([
      { nodeId: "n0", message: "filterBar.validation.regexInvalid" },
    ]);
    const long = "a".repeat(1025);
    expect(
      issuesFor("profiles", [{ field: "pod", operator: "not_regex", values: [long] }]),
    ).toEqual([{ nodeId: "n0", message: "filterBar.validation.regexLength" }]);
    expect(issuesFor("profiles", [{ field: "pod", operator: "regex", values: ["^api-"] }])).toEqual(
      [],
    );
  });

  it("round-trips every operator through the page URL, old links included", () => {
    const filters = [
      { key: "pod", op: "=" as const, value: "a,b" },
      { key: "env", op: "!=" as const, value: "dev" },
      { key: "svc", op: "=~" as const, value: "api|web" },
      { key: "zone", op: "not_in" as const, value: "", values: ["us:1", "eu|2"] },
    ];
    expect(parseProfileFilters(encodeProfileRouteFilters(filters))).toEqual(filters);
    expect(parseProfileFilters("pod=a")).toEqual([{ key: "pod", op: "=", value: "a" }]);
    expect(parseProfileFilters("k8s:pod=x")).toEqual([{ key: "k8s:pod", op: "=", value: "x" }]);
  });
});

describe("RUM profiles", () => {
  it("marks attribute names, value lengths and regex patterns the server refuses", () => {
    const funnel = issuesFor("rum-funnel", [
      { field: "Bad-Name", operator: "in", values: ["x"] },
      { field: "usr_email", operator: "in", values: ["a".repeat(1025)] },
      { field: "usr_email", operator: "regex", values: ["(?=x)"] },
      { field: "context_plan", operator: "not_regex", values: ["a".repeat(257)] },
      { field: "geo_info_country", operator: "in", values: ["India"] },
    ]);
    expect(funnel.map((issue) => [issue.nodeId, issue.message])).toEqual([
      ["n0", "filterBar.validation.rumField"],
      ["n1", "filterBar.validation.valueLength"],
      ["n2", "filterBar.validation.regexInvalid"],
      ["n3", "filterBar.validation.regexLength"],
    ]);
  });

  it("accepts the app settings' session fields on an exclusion, page-wide version and env included", () => {
    const exclusion = issuesFor("rum-exclusion", [
      { field: "version", operator: "contains", values: ["e2e"] },
      { field: "env", operator: "in", values: ["prod"] },
      { field: "context_plan", operator: "in", values: ["x"] },
    ]);
    expect(exclusion.map((issue) => [issue.nodeId, issue.message])).toEqual([
      ["n2", "filterBar.validation.rumField"],
    ]);
    const funnel = issuesFor("rum-funnel", [{ field: "version", operator: "in", values: ["1"] }]);
    expect(funnel.map((issue) => issue.message)).toEqual(["filterBar.validation.rumField"]);
  });

  it("keeps exclusions to positive operators and the app settings' 20 rules", () => {
    const profile = FILTER_PROFILES["rum-exclusion"];
    expect(profile.operators.string.some((id) => id.startsWith("not_"))).toBe(false);
    expect(profile.limits.maxConditions).toBe(20);
    expect(profile.limits.maxValues).toBe(20);
  });
});

// Mirrors RuleOp in src/config/src/meta/model_pricing.rs; eq/neq exist only on the usage condition.
const RULE_OPS = ["in", "not_in", "exists", "not_exists", "gt", "gte", "lt", "lte"];

describe("model-pricing profile", () => {
  const profile = FILTER_PROFILES["model-pricing"];

  it("never offers = or != on an attribute rule", () => {
    expect(profile.operators.string).not.toContain("eq");
    expect(profile.operators.string).not.toContain("neq");
    expect(profile.operators.string).toEqual(
      expect.arrayContaining(["in", "not_in", "is_not_null", "is_null"]),
    );
  });

  it("writes every attribute operator as an op the server's RuleOp accepts", () => {
    const usage: FilterCondition = {
      kind: "condition",
      id: "tier-condition",
      connector: "AND",
      field: "input",
      operator: "gt",
      values: ["1"],
    };
    for (const operator of profile.operators.string) {
      const tree: FilterGroup = {
        kind: "group",
        id: "root",
        connector: "AND",
        items: [usage, { ...usage, id: "r", field: "service_tier", operator, values: ["flex"] }],
      };
      const saved = profile.codec.serialize(tree, context) as { rules: { op: string }[] };
      expect(RULE_OPS).toContain(saved.rules[0].op);
    }
  });
});

describe("downtime profile", () => {
  const profile = FILTER_PROFILES.downtime;
  const pair = (id: string, field: string, operator: "eq" | "neq", value: string) =>
    ({ kind: "condition", id, connector: "AND", field, operator, values: [value] }) as const;
  const tree = (groupJoin: "AND" | "OR"): FilterGroup => ({
    kind: "group",
    id: "root",
    connector: "AND",
    items: [
      pair("a", "service", "eq", "checkout"),
      {
        kind: "group",
        id: "g",
        connector: groupJoin,
        items: [
          pair("b", "host", "eq", "db-*"),
          { ...pair("c", "host", "neq", "db-7"), connector: "OR" },
        ],
      },
    ],
  });
  const messages = (t0: FilterGroup) =>
    filterIssues(t0, profile, { t, saved: profile.codec.serialize(t0, context) }).map(
      (issue) => issue.message,
    );

  it("accepts an OR group holding != while the root still ANDs an = pair", () => {
    expect(messages(tree("AND"))).toEqual([]);
  });

  it("reports the requires-= rule as soon as a branch can be satisfied by != alone", () => {
    expect(messages(tree("OR"))).toEqual(["alerts.downtimes.validation.needsEq"]);
  });
});

describe("operator names", () => {
  const en = (key: string) => i18n.global.t(key) as string;
  const tr = ((key: string) => en(key)) as unknown as TranslateFn;

  it("gives every operator a plain-language hint", () => {
    for (const op of Object.values(OPERATORS)) {
      expect(en(op.labelKey)).not.toBe(op.labelKey);
    }
  });

  it("keeps RUM's own readable names instead of the dashboard spellings", () => {
    const funnel = FILTER_PROFILES["rum-funnel"];
    const exclusion = FILTER_PROFILES["rum-exclusion"];
    expect(operatorName("regex", funnel.dialect, tr, funnel.operatorNames)).toBe("matches regex");
    expect(operatorName("not_starts_with", funnel.dialect, tr, funnel.operatorNames)).toBe(
      "does not start with",
    );
    for (const id of exclusion.operators.string) {
      expect(operatorName(id, exclusion.dialect, tr, exclusion.operatorNames)).not.toMatch(/_/);
    }
    expect(operatorName("regex", "sql", tr)).toBe("re_match");
  });
});
