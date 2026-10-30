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

import { afterEach, describe, expect, it } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import FilterBuilder from "@/components/filterBar/FilterBuilder.vue";
import { FILTER_PROFILES } from "@/components/filterBar/filterProfiles";
import { alertConditionsPayload, loadAlertConditions } from "./alertConditionsLoad";
import { buildConditionsString } from "./conditionsFormatter";

const leaf = (column: string, value: unknown, operator = "=", logicalOperator = "AND") => ({
  filterType: "condition",
  column,
  operator,
  value,
  values: [],
  logicalOperator,
  id: `id-${column}`,
});

// Saved `query_condition.conditions` as the API returns them.
const FIXTURES: Record<string, unknown> = {
  "V2 envelope, nested group, every spelling": {
    version: 2,
    conditions: {
      filterType: "group",
      logicalOperator: "AND",
      groupId: "root",
      conditions: [
        leaf("level", "error"),
        leaf("msg", "timeout", "Contains", "OR"),
        { ...leaf("svc", "API", "contains"), ignore_case: true },
        leaf("code", 500, ">="),
        leaf("host", "", "is_not_null"),
        {
          filterType: "group",
          logicalOperator: "OR",
          groupId: "g1",
          conditions: [leaf("region", "us", "!="), leaf("tier", "gold", "NotContains", "OR")],
        },
        leaf("env", ["prod", "stage"], "in"),
        leaf("path", "^/api", "re_match"),
      ],
    },
  },
  "V2 envelope written by the backend (no ids)": {
    version: 2,
    conditions: {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [
        { filterType: "condition", column: "a", operator: "=", value: "1", logicalOperator: "AND" },
      ],
    },
  },
  "V1 {and: [...]}": {
    and: [
      { column: "level", operator: "=", value: "error", ignore_case: false },
      { or: [{ column: "code", operator: ">", value: 400, ignore_case: false }] },
    ],
  },
  "V1 {label, items}": {
    label: "or",
    items: [{ column: "level", operator: "=", value: "error" }],
  },
  "V0 flat list": [{ column: "level", operator: "=", value: "error" }],
};

let wrapper: VueWrapper | null = null;
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe("alert conditions: saved rules load and save unchanged when untouched", () => {
  for (const [name, saved] of Object.entries(FIXTURES)) {
    it(name, async () => {
      const stored = JSON.stringify(saved);
      const { tree, legacy } = loadAlertConditions(JSON.parse(stored));
      wrapper = mount(FilterBuilder, {
        attachTo: document.body,
        global: { plugins: [i18n] },
        props: { profile: "alert", modelValue: tree, fields: [], dataTest: "alert-conditions" },
      });
      await flushPromises();
      expect(wrapper.emitted("update:modelValue")).toBeUndefined();
      expect(JSON.stringify(alertConditionsPayload(tree, legacy))).toBe(stored);
    });
  }

  it("an edited V1 rule is written as a V2 envelope", () => {
    const { tree, legacy } = loadAlertConditions({
      and: [{ column: "level", operator: "=", value: "error" }],
    });
    const codec = FILTER_PROFILES.alert.codec;
    const parsed = codec.parse(tree, { fields: [] });
    const first = parsed.items[0] as any;
    parsed.items[0] = { ...first, values: ["warn"] };
    const next = codec.serialize(parsed, { fields: [] });
    const payload = alertConditionsPayload(next, legacy) as any;
    expect(payload.version).toBe(2);
    expect(payload.conditions.conditions[0]).toMatchObject({ column: "level", value: "warn" });
  });

  it("an empty or missing rule starts as an empty V2 group", () => {
    for (const saved of [null, undefined, [], {}]) {
      const { tree, legacy } = loadAlertConditions(saved);
      expect(tree).toMatchObject({ filterType: "group", logicalOperator: "AND", conditions: [] });
      expect(legacy).toBeNull();
    }
  });

  it("an unwrapped V2 group is never written back without its envelope", () => {
    const group = { filterType: "group", logicalOperator: "AND", conditions: [leaf("a", "1")] };
    const { tree, legacy } = loadAlertConditions(group);
    expect(alertConditionsPayload(tree, legacy)).toEqual({ version: 2, conditions: group });
  });
});

describe("preview SQL for the new operators", () => {
  const sql = (item: Record<string, unknown>, types: Record<string, string> = {}) =>
    buildConditionsString(
      {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [{ ...item, logicalOperator: "AND" }],
      },
      {
        sqlMode: true,
        formatValues: true,
        streamFieldsMap: Object.fromEntries(
          Object.entries(types).map(([name, type]) => [name, { type }]),
        ) as any,
      },
    );
  const c = (column: string, operator: string, value: unknown, extra = {}) => ({
    filterType: "condition",
    column,
    operator,
    value,
    ...extra,
  });

  it.each([
    [c("env", "in", ["prod", "it's"]), "env IN ('prod', 'it''s')"],
    [c("env", "not_in", '["a","b"]'), "env NOT IN ('a', 'b')"],
    [c("env", "in", "solo"), "env IN ('solo')"],
    [c("path", "starts_with", "/api"), "path LIKE '/api%'"],
    [c("path", "Ends With", ".js"), "path LIKE '%.js'"],
    [c("msg", "re_match", "time(out)?"), "re_match(msg, 'time(out)?')"],
    [c("msg", "re_not_match", "x'y"), "re_not_match(msg, 'x''y')"],
    [c("msg", "regex", "err", { ignore_case: true }), "re_match(msg, '(?i)err')"],
    [c("msg", "regex", "(?i)err", { case_insensitive: true }), "re_match(msg, '(?i)(?i)err')"],
    [c("msg", "Contains", "Err", { case_insensitive: true }), "str_match_ignore_case(msg, 'Err')"],
    [c("msg", "NotContains", "Err", { case_insensitive: true }), "lower(msg) NOT LIKE '%err%'"],
    [c("msg", "=", "Err", { case_insensitive: true }), "lower(msg) = 'err'"],
    [c("env", "in", ["A", "B"], { case_insensitive: true }), "lower(env) IN ('a', 'b')"],
    [c("env", "in", ["A", "B"], { ignore_case: true }), "lower(env) IN ('a', 'b')"],
    [c("msg", "is_empty", ""), "(msg IS NULL OR msg = '')"],
    [c("path", "starts_with", "50%_a\\"), "path LIKE '50\\%\\_a\\\\%'"],
    [c("path", "ends_with", "_x"), "path LIKE '%\\_x'"],
    [
      c("msg", "NotContains", "5%_A", { case_insensitive: true }),
      "lower(msg) NOT LIKE '%5\\%\\_a%'",
    ],
    [c("msg", "NotContains", "50%_x"), "msg NOT LIKE '%50%_x%'"],
  ])("%j", (item, expected) => {
    expect(sql(item)).toBe(expected);
  });

  it("leaves numbers unquoted in a list on a numeric column", () => {
    expect(sql(c("code", "in", [500, "503"]), { code: "Int64" })).toBe("code IN (500, 503)");
  });

  it("does not case-fold a numeric column", () => {
    expect(sql(c("code", "=", 5, { case_insensitive: true }), { code: "Int64" })).toBe("code = 5");
  });

  it("ignores the legacy ignore_case on the original operators, as scheduled SQL does", () => {
    for (const operator of ["Contains", "NotContains", "=", ">"]) {
      expect(sql(c("msg", operator, "Err", { ignore_case: true }))).toBe(
        sql(c("msg", operator, "Err")),
      );
    }
  });

  it("writes no SQL for a text operator on a non-text column, as the backend refuses it", () => {
    expect(sql(c("code", "starts_with", "5"), { code: "Int64" })).toBe("");
    expect(sql(c("code", "re_match", "5"), { code: "Int64" })).toBe("");
    expect(sql(c("code", "in", [5]), { code: "Int64" })).toBe("code IN (5)");
  });

  it("drops an empty list instead of writing invalid SQL", () => {
    expect(sql(c("env", "in", []))).toBe("");
  });
});
