//  Copyright 2026 OpenObserve Inc.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it } from "vitest";
import { sqlSources, sqlSourcesFromAst } from "./sqlSources";

const sorted = (sql: string) => [...sqlSources(sql).sources].sort();

describe("sqlSources (P1 SQL scope rule)", () => {
  it("reads a single FROM", () => {
    expect(sqlSources('SELECT * FROM "k8s_logs"')).toEqual({
      sources: ["k8s_logs"],
      resolved: true,
    });
  });

  it("reads both sides of a join", () => {
    expect(sorted('SELECT * FROM "a" JOIN "b" ON a.x = b.x')).toEqual(["a", "b"]);
  });

  it("reads every branch of a union", () => {
    expect(sorted("SELECT * FROM a UNION ALL SELECT * FROM b UNION SELECT * FROM c")).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("reads the stream inside a CTE and never counts the CTE name as a stream", () => {
    expect(sorted("WITH recent AS (SELECT * FROM a) SELECT * FROM recent")).toEqual(["a"]);
  });

  it("reads a nested subquery in WHERE and in FROM", () => {
    expect(sorted("SELECT * FROM a WHERE x IN (SELECT x FROM b)")).toEqual(["a", "b"]);
    expect(sorted("SELECT * FROM (SELECT * FROM c) t")).toEqual(["c"]);
  });

  it("ignores line comments before parsing", () => {
    expect(sorted('-- FROM "hidden"\nSELECT * FROM "shown"')).toEqual(["shown"]);
  });

  it("is unresolved for empty or unparsable SQL, never an empty allow", () => {
    expect(sqlSources("")).toEqual({ sources: [], resolved: false });
    expect(sqlSources("SELECT FROM WHERE ((")).toEqual({ sources: [], resolved: false });
  });

  it("keeps a nested CTE name inside its own query, so a sibling branch still reads the stream", () => {
    expect(
      sorted(
        "SELECT * FROM (WITH big AS (SELECT * FROM small) SELECT * FROM big) t UNION ALL SELECT * FROM big",
      ),
    ).toEqual(["big", "small"]);
  });

  it("applies a top-level CTE to every branch of its union", () => {
    expect(sorted("WITH r AS (SELECT * FROM a) SELECT * FROM r UNION ALL SELECT * FROM r")).toEqual(
      ["a"],
    );
  });

  it("reads a CTE body against the earlier CTEs only, unless it is recursive", () => {
    expect(sorted("WITH a AS (SELECT * FROM a), b AS (SELECT * FROM a) SELECT * FROM b")).toEqual([
      "a",
    ]);
    expect(
      sorted("WITH RECURSIVE r AS (SELECT * FROM s UNION ALL SELECT * FROM r) SELECT * FROM r"),
    ).toEqual(["s"]);
  });

  it("is unresolved when the AST is deeper than the walk, never a partial allow", () => {
    let node: Record<string, unknown> = { type: "select", from: [{ table: "deep" }] };
    for (let i = 0; i < 300; i++) node = { type: "select", from: [{ expr: { ast: node } }] };
    const ast = { type: "select", from: [{ table: "top" }], where: node };
    expect(sqlSourcesFromAst(ast)).toEqual({ sources: ["top"], resolved: false });
  });

  describe("parse depth guard (SQL_PARSE_MAX_DEPTH)", () => {
    const nestedAnd = (depth: number) => {
      let where = `"c0" = 'v0'`;
      for (let i = 1; i < depth; i++) where = `(${where} AND "c${i}" = 'v${i}')`;
      return where;
    };

    it("reads the FROM of 20 nested ANDs without parsing the predicate", () => {
      const started = performance.now();
      expect(sqlSources(`SELECT * FROM "app" WHERE ${nestedAnd(20)}`)).toEqual({
        sources: ["app"],
        resolved: true,
      });
      expect(performance.now() - started).toBeLessThan(1000);
    });

    it("is unresolved when the deep predicate holds a subquery, which may name a stream", () => {
      const sql = `SELECT * FROM "app" WHERE x IN (SELECT x FROM "other") AND ${nestedAnd(20)}`;
      const started = performance.now();
      expect(sqlSources(sql)).toEqual({ sources: [], resolved: false });
      expect(performance.now() - started).toBeLessThan(1000);
    });

    it("is unresolved when the nesting is deep outside the top-level WHERE", () => {
      const sql = `SELECT * FROM (SELECT * FROM "app" WHERE ${nestedAnd(20)}) t`;
      const started = performance.now();
      expect(sqlSources(sql)).toEqual({ sources: [], resolved: false });
      expect(performance.now() - started).toBeLessThan(1000);
    });

    it("is not fooled by closing parens inside a quoted literal", () => {
      const sql = `SELECT * FROM "app" WHERE "msg" = ')))))))))' AND ${nestedAnd(20)}`;
      const started = performance.now();
      expect(sqlSources(sql)).toEqual({ sources: ["app"], resolved: true });
      expect(performance.now() - started).toBeLessThan(1000);
    });

    it("is not fooled by closing parens in a quoted identifier or a block comment", () => {
      const quoted = `SELECT * FROM "a)))))))))" WHERE ${nestedAnd(20)}`;
      const commented = `SELECT * FROM "app" /* ))))))))) */ WHERE ${nestedAnd(20)}`;
      const started = performance.now();
      expect(sqlSources(quoted)).toEqual({ sources: ["a)))))))))"], resolved: true });
      expect(sqlSources(commented)).toEqual({ sources: ["app"], resolved: true });
      expect(performance.now() - started).toBeLessThan(2000);
    });

    it("fails closed on an unterminated literal instead of parsing it", () => {
      const sql = `SELECT * FROM "app" WHERE "msg" = '))))))))) AND ${nestedAnd(20)}`;
      const started = performance.now();
      expect(sqlSources(sql)).toEqual({ sources: [], resolved: false });
      expect(performance.now() - started).toBeLessThan(1000);
    });

    it("still parses predicate subqueries at the allowed depth", () => {
      expect(sorted(`SELECT * FROM a WHERE x IN (SELECT x FROM b) AND ${nestedAnd(4)}`)).toEqual([
        "a",
        "b",
      ]);
    });
  });

  it("is unresolved for an AST without any stream", () => {
    expect(sqlSourcesFromAst({ type: "select", from: null })).toEqual({
      sources: [],
      resolved: false,
    });
  });
});
