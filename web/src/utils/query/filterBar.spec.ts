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
import {
  applyPromMatchers,
  filterTreeToPromMatchers,
  filterTreeToSql,
  operatorsFor,
  toFilterFieldType,
  type FilterCondition,
  type FilterField,
  type FilterGroup,
  type FilterNode,
} from "./filterBar";

const fields: FilterField[] = [
  { name: "level", type: "string" },
  { name: "status", type: "number" },
  { name: "ok", type: "boolean" },
  { name: "k8s-pod", type: "string" },
];

const cond = (
  field: string,
  operator: FilterCondition["operator"],
  values: string[] = [],
  connector: FilterCondition["connector"] = "AND",
): FilterCondition => ({ kind: "condition", id: field, connector, field, operator, values });

const root = (...items: FilterNode[]): FilterGroup => ({
  kind: "group",
  id: "root",
  connector: "AND",
  items,
});

describe("toFilterFieldType", () => {
  it("maps arrow schema types onto the three kinds", () => {
    expect(toFilterFieldType("Utf8")).toBe("string");
    expect(toFilterFieldType("Int64")).toBe("number");
    expect(toFilterFieldType("Float64")).toBe("number");
    expect(toFilterFieldType("UInt32")).toBe("number");
    expect(toFilterFieldType("Boolean")).toBe("boolean");
    expect(toFilterFieldType(undefined)).toBe("string");
  });
});

describe("operatorsFor", () => {
  it("offers comparisons only for numbers and text matching only for strings", () => {
    const numberOps = operatorsFor("number", "sql").map((op) => op.id);
    const stringOps = operatorsFor("string", "sql").map((op) => op.id);
    expect(numberOps).toContain("gt");
    expect(numberOps).not.toContain("contains");
    expect(stringOps).toContain("contains");
    expect(stringOps).not.toContain("gt");
  });

  it("limits PromQL to label matchers", () => {
    expect(operatorsFor("number", "promql").map((op) => op.id)).toEqual([
      "eq",
      "neq",
      "regex",
      "not_regex",
      "in",
      "not_in",
    ]);
  });
});

describe("filterTreeToSql", () => {
  it("returns an empty string for no conditions", () => {
    expect(filterTreeToSql(root(), fields)).toBe("");
  });

  it("ANDs basic conditions and types literals by field", () => {
    const sql = filterTreeToSql(
      root(
        cond("level", "eq", ["error"]),
        cond("status", "gte", ["500"]),
        cond("ok", "eq", ["false"]),
      ),
      fields,
    );
    expect(sql).toBe("level = 'error' AND status >= 500 AND ok = false");
  });

  it("quotes a number field value that is not numeric instead of injecting it", () => {
    expect(filterTreeToSql(root(cond("status", "eq", ["1 OR 1=1"])), fields)).toBe(
      "status = '1 OR 1=1'",
    );
  });

  it("escapes single quotes and quotes identifiers that need it", () => {
    expect(filterTreeToSql(root(cond("k8s-pod", "eq", ["o'brien"])), fields)).toBe(
      `"k8s-pod" = 'o''brien'`,
    );
  });

  it("compiles every text operator", () => {
    const sql = (operator: FilterCondition["operator"], values: string[] = ["x"]) =>
      filterTreeToSql(root(cond("level", operator, values)), fields);
    expect(sql("contains")).toBe("str_match(level, 'x')");
    expect(sql("not_contains")).toBe("level NOT LIKE '%x%'");
    expect(sql("starts_with")).toBe("level LIKE 'x%'");
    expect(sql("ends_with")).toBe("level LIKE '%x'");
    expect(sql("regex")).toBe("re_match(level, 'x')");
    expect(sql("not_regex")).toBe("re_not_match(level, 'x')");
    expect(sql("in", ["a", "b"])).toBe("level IN ('a', 'b')");
    expect(sql("not_in", ["a"])).toBe("level NOT IN ('a')");
    expect(sql("is_null", [])).toBe("level IS NULL");
    expect(sql("is_not_null", [])).toBe("level IS NOT NULL");
  });

  it("skips incomplete conditions", () => {
    expect(
      filterTreeToSql(root(cond("level", "eq", []), cond("status", "eq", ["1"])), fields),
    ).toBe("status = 1");
  });

  it("keeps OR connectors and parenthesises groups", () => {
    const group: FilterGroup = {
      kind: "group",
      id: "g",
      connector: "AND",
      items: [cond("level", "eq", ["error"]), cond("level", "eq", ["warn"], "OR")],
    };
    expect(filterTreeToSql(root(cond("status", "gte", ["500"]), group), fields)).toBe(
      "status >= 500 AND (level = 'error' OR level = 'warn')",
    );
  });

  it("drops parentheses around a group with a single condition", () => {
    const group: FilterGroup = {
      kind: "group",
      id: "g",
      connector: "OR",
      items: [cond("ok", "eq", ["true"])],
    };
    expect(filterTreeToSql(root(cond("status", "eq", ["1"]), group), fields)).toBe(
      "status = 1 OR ok = true",
    );
  });
});

describe("PromQL", () => {
  it("builds label matchers and escapes in-lists as a regex alternation", () => {
    expect(
      filterTreeToPromMatchers(
        root(
          cond("job", "eq", ['a"b']),
          cond("env", "in", ["prod", "us.east"]),
          cond("x", "eq", []),
        ),
      ),
    ).toEqual(['job="a\\"b"', 'env=~"prod|us\\\\.east"']);
  });

  it("merges matchers into a selector", () => {
    expect(applyPromMatchers("up", ['job="api"'])).toBe('up{job="api"}');
    expect(applyPromMatchers('up{env="p"}', ['job="api"'])).toBe('up{env="p", job="api"}');
    expect(applyPromMatchers("up{}", ['job="api"'])).toBe('up{job="api"}');
    expect(applyPromMatchers("up", [])).toBe("up");
  });
});
