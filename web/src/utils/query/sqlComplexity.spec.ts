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
import { maxParenDepth, stripWherePredicate, SQL_PARSE_MAX_DEPTH } from "./sqlComplexity";

describe("maxParenDepth", () => {
  it("counts the deepest nesting, not the total number of parens", () => {
    expect(maxParenDepth("(a) (b) (c)")).toBe(1);
    expect(maxParenDepth("((( a )))")).toBe(3);
  });

  it("returns 0 when there are no parens", () => {
    expect(maxParenDepth("SELECT a FROM t")).toBe(0);
  });
});

describe("stripWherePredicate", () => {
  it("replaces the predicate and keeps everything around it", () => {
    expect(stripWherePredicate(`SELECT a FROM "t" WHERE x = 1`)).toBe(
      `SELECT a FROM "t" WHERE 1 = 1 `,
    );
  });

  it("stops at each clause that can follow a WHERE", () => {
    for (const tail of [
      "GROUP BY a",
      "ORDER BY a",
      "LIMIT 10",
      "OFFSET 5",
      "HAVING COUNT(*) > 1",
      "WINDOW w AS ()",
    ]) {
      expect(stripWherePredicate(`SELECT a FROM "t" WHERE x = 1 ${tail}`)).toBe(
        `SELECT a FROM "t" WHERE 1 = 1 ${tail}`,
      );
    }
  });

  it("leaves a statement without a WHERE untouched", () => {
    const sql = `SELECT a FROM "t" GROUP BY a ORDER BY a`;
    expect(stripWherePredicate(sql)).toBe(sql);
  });

  it("ignores WHERE inside a string literal", () => {
    const sql = `SELECT a FROM "t" WHERE msg = 'WHERE x = 1'`;
    expect(stripWherePredicate(sql)).toBe(`SELECT a FROM "t" WHERE 1 = 1 `);
  });

  it("does not treat a doubled quote as the end of a literal", () => {
    const sql = `SELECT a FROM "t" WHERE msg = 'it''s here' AND b = 2`;
    expect(stripWherePredicate(sql)).toBe(`SELECT a FROM "t" WHERE 1 = 1 `);
  });

  it("ignores WHERE used as a quoted identifier", () => {
    const sql = `SELECT "where" FROM "t" ORDER BY "where"`;
    expect(stripWherePredicate(sql)).toBe(sql);
  });

  it("does not match identifiers that merely start with where", () => {
    const sql = `SELECT where_clause FROM "t" ORDER BY where_clause`;
    expect(stripWherePredicate(sql)).toBe(sql);
  });

  it("ignores WHERE inside a subquery and strips only the outer one", () => {
    const sql = `SELECT a FROM (SELECT a FROM "t" WHERE inner_col = 1) s WHERE outer_col = 2`;
    expect(stripWherePredicate(sql)).toBe(
      `SELECT a FROM (SELECT a FROM "t" WHERE inner_col = 1) s WHERE 1 = 1 `,
    );
  });

  it("strips the predicate of each branch of a UNION", () => {
    const sql = `SELECT a FROM "t" WHERE x = 1 UNION SELECT a FROM "u" WHERE y = 2`;
    expect(stripWherePredicate(sql)).toBe(
      `SELECT a FROM "t" WHERE 1 = 1 UNION SELECT a FROM "u" WHERE 1 = 1 `,
    );
  });

  it("ignores WHERE inside line and block comments", () => {
    expect(stripWherePredicate(`SELECT a FROM "t" -- WHERE x = 1\nORDER BY a`)).toBe(
      `SELECT a FROM "t" -- WHERE x = 1\nORDER BY a`,
    );
    expect(stripWherePredicate(`SELECT a FROM "t" /* WHERE x = 1 */ ORDER BY a`)).toBe(
      `SELECT a FROM "t" /* WHERE x = 1 */ ORDER BY a`,
    );
  });

  it("handles empty and non-string input", () => {
    expect(stripWherePredicate("")).toBe("");
    expect(stripWherePredicate(undefined as any)).toBe(undefined);
  });

  it("collapses the nesting that makes the parser exponential", () => {
    // The shape the dashboard query builder emits: one paren layer per condition.
    let where = `"c0" = 'v0'`;
    for (let i = 1; i < 22; i++) where = `(${where} AND "c${i}" = 'v${i}')`;
    const sql = `SELECT COUNT(*) AS c FROM "t" WHERE ${where}`;

    expect(maxParenDepth(sql)).toBeGreaterThan(SQL_PARSE_MAX_DEPTH);
    expect(maxParenDepth(stripWherePredicate(sql))).toBeLessThanOrEqual(SQL_PARSE_MAX_DEPTH);
  });

  it("keeps the SELECT list intact so field extraction is unaffected", () => {
    const sql =
      `SELECT AVG("d") AS oo_average, approx_percentile_cont("d", 0.95) AS oo_p95 ` +
      `FROM "s" WHERE ((("a" = 1 AND "b" = 2) AND "c" = 3)) GROUP BY "e"`;
    const stripped = stripWherePredicate(sql);

    expect(stripped).toContain(`AVG("d") AS oo_average`);
    expect(stripped).toContain(`approx_percentile_cont("d", 0.95) AS oo_p95`);
    expect(stripped).toContain(`FROM "s"`);
    expect(stripped).toContain(`GROUP BY "e"`);
    expect(stripped).not.toContain(`"a" = 1`);
  });
});
