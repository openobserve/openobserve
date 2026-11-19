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
import { parseShorthand, parseSqlFilter, parseSqlFilterLocking } from "./filterBarParser";

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
      "regexp_like(level, 'x')",
      "NOT regexp_like(level, 'x')",
      "level IN ('a', 'b')",
      "status NOT IN (1, 2)",
      "level IS NULL",
      "level IS NOT NULL",
      "match_all('timeout')",
      "status >= 500 AND (level = 'error' OR level = 'warn')",
    ];
    for (const sql of samples) expect(roundTrip(sql)).toBe(sql);
  });

  it("reads queries saved with re_match, writing them back with regexp_like", () => {
    expect(roundTrip("re_match(level, 'x') AND re_not_match(service, 'y')")).toBe(
      "regexp_like(level, 'x') AND NOT regexp_like(service, 'y')",
    );
    expect(roundTrip("not regexp_like(level, 'x')")).toBe("NOT regexp_like(level, 'x')");
    expect(parseSqlFilter("NOT str_match(level, 'x')")).toBeNull();
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

  it("reads backslash-escaped LIKE wildcards back as the literal value", () => {
    const value = "50%_o'k\\";
    for (const operator of ["starts_with", "ends_with", "not_contains"] as const) {
      const sql = filterTreeToSql(
        {
          kind: "group",
          id: "root",
          connector: "AND",
          items: [
            {
              kind: "condition",
              id: "c",
              connector: "AND",
              field: "level",
              operator,
              values: [value],
            },
          ],
        },
        fields,
      );
      const node = parseSqlFilter(sql)!.items[0] as FilterCondition;
      expect(node).toMatchObject({ field: "level", operator, values: [value] });
      expect(roundTrip(sql)).toBe(sql);
    }
  });

  it("does not turn a LIKE wildcard or unknown escape into chip text", () => {
    expect(parseSqlFilter("level LIKE 'user_service%'")).toBeNull();
    expect(parseSqlFilter("level NOT LIKE '%a_b%'")).toBeNull();
    expect(parseSqlFilter("level LIKE '\\a%'")).toBeNull();
    expect(parseSqlFilter("level LIKE 'abc\\'")).toBeNull();
  });

  it("tokenizes a 5000-value IN list in linear time", () => {
    const values = Array.from({ length: 5000 }, (_, i) => `'value-${i}'`);
    const sql = `level IN (${values.join(", ")})`;
    const start = performance.now();
    const tree = parseSqlFilter(sql);
    const elapsed = performance.now() - start;
    expect((tree!.items[0] as FilterCondition).values).toEqual(values.map((v) => v.slice(1, -1)));
    expect(roundTrip(sql)).toBe(sql);
    expect(elapsed).toBeLessThan(200);
  });

  it("returns null for anything the bar cannot draw", () => {
    expect(parseSqlFilter("level = upper(level)")).toBeNull();
    expect(parseSqlFilter("status + 1 > 2")).toBeNull();
    expect(parseSqlFilter("level = 'a' AND")).toBeNull();
    expect(parseSqlFilter("(level = 'a'")).toBeNull();
    expect(parseSqlFilter("NOT level = 'a'")).toBeNull();
    expect(parseSqlFilter("level LIKE 'a%b'")).toBeNull();
  });

  it("reads only plain SQL identifiers unquoted, so an expression is never taken for a field", () => {
    expect(parseSqlFilter("end_time-start_time > 1000")).toBeNull();
    expect(parseSqlFilter("status-1 > 0")).toBeNull();
    expect(parseSqlFilter("t.level = 'x'")).toBeNull();
    expect(parseSqlFilter("@timestamp > 1")).toBeNull();
    expect(roundTrip(`"k8s.pod" = 'x' AND "@ts" > 1 AND _col9 = 'y'`)).toBe(
      `"k8s.pod" = 'x' AND "@ts" > '1' AND _col9 = 'y'`,
    );
  });

  it("keeps a double-quoted identifier a field even when it spells a keyword or boolean", () => {
    const tree = parseSqlFilter(`"AND" = 'a' OR "NOT" IN ('x')`);
    expect(tree).not.toBeNull();
    expect(tree!.items).toHaveLength(2);
    expect(tree!.items[0]).toMatchObject({ field: "AND", operator: "eq", values: ["a"] });
    expect(tree!.items[1]).toMatchObject({ field: "NOT", operator: "in", connector: "OR" });
    expect(parseSqlFilter(`level = "true"`)).toBeNull();
    expect(parseSqlFilter(`ok IS "NULL"`)).toBeNull();
    expect(parseSqlFilter(`level = 'a' "AND" level = 'b'`)).toBeNull();
    expect(parseSqlFilter(`"re_match"(level, 'x')`)).toBeNull();
    expect(parseSqlFilter("level = TRUE")!.items[0]).toMatchObject({ values: ["true"] });
  });
});

describe("parseSqlFilterLocking", () => {
  const shape = (sql: string) =>
    parseSqlFilterLocking(sql).items.map((item) =>
      item.kind === "raw"
        ? `${item.connector} [${item.sql}]`
        : item.kind === "condition"
          ? `${item.connector} ${item.field} ${item.operator} ${item.values.join(",")}`
          : `${item.connector} group(${item.items.length})`,
    );

  it("draws what it can and locks only the parts it cannot, as typed", () => {
    expect(shape("level = 'error' AND lower(host) = 'x' OR status > 500")).toEqual([
      "AND level eq error",
      "AND [lower(host) = 'x']",
      "OR status gt 500",
    ]);
  });

  it("keeps BETWEEN's AND and a CASE expression inside one locked part", () => {
    expect(shape("status BETWEEN 200 AND 299 AND level = 'a'")).toEqual([
      "AND [status BETWEEN 200 AND 299]",
      "AND level eq a",
    ]);
    expect(shape("CASE WHEN a = 1 AND b = 2 THEN true END OR ok = true")).toEqual([
      "AND [CASE WHEN a = 1 AND b = 2 THEN true END]",
      "OR ok eq true",
    ]);
  });

  it("locks a part with trailing text or an unknown character, and keeps groups drawn", () => {
    expect(shape("status + 1 > 2 AND (level = 'a' OR NOT level = 'b')")).toEqual([
      "AND [status + 1 > 2]",
      "AND group(2)",
    ]);
    const group = parseSqlFilterLocking("(level = 'a' OR NOT level = 'b')").items[0];
    expect(group).toMatchObject({ kind: "group" });
    expect(group.kind === "group" && group.items[1]).toMatchObject({
      kind: "raw",
      connector: "OR",
      sql: "NOT level = 'b'",
    });
  });

  it("locks the whole text when its brackets or quotes do not close", () => {
    expect(shape("(level = 'a'")).toEqual(["AND [(level = 'a']"]);
    expect(shape("level = 'a")).toEqual(["AND [level = 'a]"]);
    expect(shape("level = 'a' AND")).toEqual(["AND [level = 'a' AND]"]);
  });

  it("matches the strict parse wherever that one succeeds, and compiles locked parts back", () => {
    const sql = "level = 'a' AND (status >= 500 OR str_match(level, 'x'))";
    expect(parseSqlFilterLocking(sql).items.length).toBe(parseSqlFilter(sql)!.items.length);
    expect(filterTreeToSql(parseSqlFilterLocking("t.level = 'x' AND ok = true"), fields)).toBe(
      "(t.level = 'x') AND ok = true",
    );
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
