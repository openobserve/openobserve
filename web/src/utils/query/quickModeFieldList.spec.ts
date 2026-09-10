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

import { describe, it, expect } from "vitest";
import { hasSubquery, replaceSelectFieldList } from "./quickModeFieldList";

describe("replaceSelectFieldList", () => {
  describe("queries containing a subquery are left alone", () => {
    // The query from the bug report. Enabling quick mode rewrote only the inner
    // SELECT — the outer one spans a newline, which `.` does not match — turning
    // `select distinct trace_id` into a two-column projection and dropping
    // DISTINCT, so the IN (...) no longer type-checked.
    const reported = `select trace_id,
  array_agg(distinct service_name) as name
from trace_list_index where trace_id in (
    select distinct trace_id
    from trace_list_index
    order by trace_id limit 10000)
group by trace_id
order by trace_id
limit 10`;

    it("returns the reported query byte-for-byte unchanged", () => {
      expect(replaceSelectFieldList(reported, "trace_id,_timestamp")).toBe(reported);
    });

    it("keeps the subquery's DISTINCT", () => {
      const out = replaceSelectFieldList(reported, "trace_id,_timestamp");
      expect(out).toContain("select distinct trace_id");
    });

    it("leaves a single-line subquery alone too", () => {
      const sql = "select a, b from t where a in (select distinct a from t2 order by a limit 10)";
      expect(replaceSelectFieldList(sql, "x,y")).toBe(sql);
    });

    it("leaves a derived table in FROM alone", () => {
      const sql = "select a from (select b from t) x";
      expect(replaceSelectFieldList(sql, "x,y")).toBe(sql);
    });

    it("leaves a CTE alone", () => {
      const sql = "with t as (select a from logs) select a from t";
      expect(replaceSelectFieldList(sql, "x,y")).toBe(sql);
    });

    it("matches a nested SELECT regardless of case or inner spacing", () => {
      expect(hasSubquery("select a from t where a in (  SeLeCt b from t2)")).toBe(true);
    });
  });

  describe("a comment cannot hide a subquery from the check", () => {
    it("sees through a block comment before the nested SELECT", () => {
      const sql = "select a from t where x in (/* pick them */ select b from t2)";
      expect(replaceSelectFieldList(sql, "x,y")).toBe(sql);
    });

    it("sees through a line comment before the nested SELECT", () => {
      const sql = "select a from t where x in ( -- pick them\n select b from t2)";
      expect(replaceSelectFieldList(sql, "x,y")).toBe(sql);
    });
  });

  describe("string literals are never rewritten", () => {
    it("does not touch SQL text stored in a quoted value", () => {
      const sql = `SELECT * FROM "logs" WHERE msg = 'select id from users'`;
      expect(replaceSelectFieldList(sql, "f1,f2")).toBe(
        `SELECT f1,f2 FROM "logs" WHERE msg = 'select id from users'`,
      );
    });

    it("does not treat a parenthesised SELECT inside a literal as a subquery", () => {
      expect(hasSubquery("select a from t where msg = 'x (select y from z)'")).toBe(false);
    });

    it("handles an escaped quote inside the value", () => {
      const sql = `select a from t where msg = 'it''s select b from c'`;
      expect(replaceSelectFieldList(sql, "x")).toBe(
        `SELECT x FROM t where msg = 'it''s select b from c'`,
      );
    });
  });

  describe("ordinary queries are rewritten", () => {
    it("replaces the projection of a simple query", () => {
      expect(replaceSelectFieldList("select a, b from logs", "x,y")).toBe("SELECT x,y FROM logs");
    });

    it("replaces the projection when the query spans lines", () => {
      expect(replaceSelectFieldList("select a, b\nfrom logs", "x,y")).toBe("SELECT x,y FROM logs");
    });

    it("preserves everything after FROM", () => {
      expect(replaceSelectFieldList("select a from logs where code = 200 limit 5", "x,y")).toBe(
        "SELECT x,y FROM logs where code = 200 limit 5",
      );
    });

    it("rewrites every stream of a multi-stream UNION", () => {
      // A multi-stream search is one SELECT per stream joined by UNION, so all
      // of them must take the field list — none of them is nested.
      const out = replaceSelectFieldList(
        'SELECT a FROM "s1" UNION ALL BY NAME SELECT a FROM "s2"',
        "x,y",
      );
      expect(out).toBe('SELECT x,y FROM "s1" UNION ALL BY NAME SELECT x,y FROM "s2"');
    });

    it("treats a field list containing $& literally", () => {
      expect(replaceSelectFieldList("select a from logs", "$&,b")).toBe("SELECT $&,b FROM logs");
    });
  });

  describe("queries with nothing to rewrite", () => {
    it("returns a query with no FROM unchanged", () => {
      expect(replaceSelectFieldList("select 1", "x,y")).toBe("select 1");
    });

    it("returns an empty query unchanged", () => {
      expect(replaceSelectFieldList("", "x,y")).toBe("");
    });
  });
});
