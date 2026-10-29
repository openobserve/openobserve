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
import { filterTreeToSql, type FilterCondition, type FilterField } from "./filterBar";
import { parseShorthand, parseSqlFilter } from "./filterBarParser";

const fields: FilterField[] = [
  { name: "level", type: "string" },
  { name: "status", type: "number" },
  { name: "ok", type: "boolean" },
  { name: "k8s-pod", type: "string" },
  { name: "duration", type: "number" },
];

const roundTrip = (sql: string) => {
  const tree = parseSqlFilter(sql);
  expect(tree).not.toBeNull();
  return filterTreeToSql(tree!, fields);
};

describe("parseSqlFilter", () => {
  it("parses an empty expression into an empty tree", () => {
    expect(parseSqlFilter("  ")?.items).toEqual([]);
  });

  it("round-trips everything the compiler emits", () => {
    const samples = [
      "level = 'error' AND status >= 500 AND ok = false",
      `"k8s-pod" = 'o''brien'`,
      "str_match(level, 'x')",
      "level NOT LIKE '%x%'",
      "level LIKE 'x%'",
      "level LIKE '%x'",
      "re_match(level, 'x')",
      "re_not_match(level, 'x')",
      "level IN ('a', 'b')",
      "status NOT IN (1, 2)",
      "level IS NULL",
      "level IS NOT NULL",
      "match_all('timeout')",
      "status >= 500 AND (level = 'error' OR level = 'warn')",
    ];
    for (const sql of samples) expect(roundTrip(sql)).toBe(sql);
  });

  it("accepts hand-typed lowercase keywords and <> / ==", () => {
    expect(roundTrip("level='error' and status<>200 or ok==true")).toBe(
      "level = 'error' AND status != 200 OR ok = true",
    );
  });

  it("drops parentheses that wrap a single condition", () => {
    expect(roundTrip("((level = 'error')) AND service = 'cart'")).toBe(
      "level = 'error' AND service = 'cart'",
    );
    expect(roundTrip("status = 1 OR (level = 'a')")).toBe("status = 1 OR level = 'a'");
  });

  it("reads the logs field list's boolean include/exclude as = and != chips", () => {
    const include = parseSqlFilter("ok is true")!.items[0] as FilterCondition;
    expect(include).toMatchObject({ field: "ok", operator: "eq", values: ["true"] });
    const exclude = parseSqlFilter("ok is not false")!.items[0] as FilterCondition;
    expect(exclude).toMatchObject({ field: "ok", operator: "neq", values: ["false"] });
  });

  it("writes a boolean IS test back exactly as typed", () => {
    for (const sql of ["ok is true", "ok is not true", "ok is false", "ok IS NOT FALSE"])
      expect(roundTrip(sql)).toBe(sql);
    expect(roundTrip("level = 'a' AND ok is not true")).toBe("level = 'a' AND ok is not true");
  });

  it("keeps the IS spelling when the chip's value or negation changes", () => {
    const tree = parseSqlFilter("ok is true")!;
    const node = tree.items[0] as FilterCondition;
    expect(filterTreeToSql({ ...tree, items: [{ ...node, values: ["false"] }] }, fields)).toBe(
      "ok is false",
    );
    expect(filterTreeToSql({ ...tree, items: [{ ...node, operator: "neq" }] }, fields)).toBe(
      "ok is not true",
    );
    expect(filterTreeToSql({ ...tree, items: [{ ...node, operator: "gt" }] }, fields)).toBe(
      "ok > true",
    );
  });

  it("parses the traces field list's include/exclude terms", () => {
    expect(roundTrip("service_name='api'")).toBe("service_name = 'api'");
    expect(roundTrip("service_name!='o''brien'")).toBe("service_name != 'o''brien'");
    expect(roundTrip("duration>=1200")).toBe("duration >= 1200");
    expect(roundTrip("(level='a' or level='b')")).toBe("(level = 'a' OR level = 'b')");
    expect(roundTrip("(level!='a' and level!='b')")).toBe("(level != 'a' AND level != 'b')");
  });

  it("keeps the connector of each node", () => {
    const tree = parseSqlFilter("level = 'a' OR level = 'b'")!;
    expect(tree.items.map((item) => item.connector)).toEqual(["AND", "OR"]);
  });

  it("returns null for anything the bar cannot draw", () => {
    expect(parseSqlFilter("level = upper(level)")).toBeNull();
    expect(parseSqlFilter("status + 1 > 2")).toBeNull();
    expect(parseSqlFilter("level = 'a' AND")).toBeNull();
    expect(parseSqlFilter("(level = 'a'")).toBeNull();
    expect(parseSqlFilter("NOT level = 'a'")).toBeNull();
    expect(parseSqlFilter("level LIKE 'a%b'")).toBeNull();
  });
});

describe("parseShorthand", () => {
  it("reads typed field-operator-value text", () => {
    expect(parseShorthand("level=error")).toEqual({
      field: "level",
      operator: "eq",
      value: "error",
    });
    expect(parseShorthand("status >= 500")).toEqual({
      field: "status",
      operator: "gte",
      value: "500",
    });
    expect(parseShorthand("service:'checkout api'")).toEqual({
      field: "service",
      operator: "eq",
      value: "checkout api",
    });
    expect(parseShorthand("path=~^/api")?.operator).toBe<FilterCondition["operator"]>("regex");
  });

  it("ignores plain words", () => {
    expect(parseShorthand("timeout")).toBeNull();
    expect(parseShorthand("level=")).toBeNull();
  });
});
