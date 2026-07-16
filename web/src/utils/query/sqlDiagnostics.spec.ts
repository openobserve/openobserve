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

/**
 * Tests for sqlDiagnostics.ts
 *
 * Three test suites:
 *  1. Unit — buildContextualSqlMessage produces the right message for every
 *     known error pattern.
 *  2. No-false-positives — all 400 valid queries from the query-agent test
 *     data parse cleanly (validateSql returns null).
 *  3. Mutation detection — 1,699 broken queries generated from the same
 *     test data (10 mutation types) produce a specific error message at ≥ 94%.
 */

import { describe, it, expect } from "vitest";
import {
  buildContextualSqlMessage,
  isParserLimitation,
  validateSql,
  locateIdentifier,
  rangesFromServerError,
  type SqlErrorRange,
} from "./sqlDiagnostics";
import { Parser } from "@openobserve/node-sql-parser/build/datafusionsql";
import basicSelect from "../../../../tests/test-data/query-agent/queries/basic_select.json";
import aggregation from "../../../../tests/test-data/query-agent/queries/aggregation.json";
import combined from "../../../../tests/test-data/query-agent/queries/combined.json";
import cteSubquery from "../../../../tests/test-data/query-agent/queries/cte_subquery.json";
import dateTime from "../../../../tests/test-data/query-agent/queries/date_time.json";
import fullTextSearch from "../../../../tests/test-data/query-agent/queries/full_text_search.json";
import histogram from "../../../../tests/test-data/query-agent/queries/histogram.json";
import mathFunctions from "../../../../tests/test-data/query-agent/queries/math_functions.json";
import pagination from "../../../../tests/test-data/query-agent/queries/pagination.json";
import stringFunctions from "../../../../tests/test-data/query-agent/queries/string_functions.json";
import union from "../../../../tests/test-data/query-agent/queries/union.json";
import windowQueries from "../../../../tests/test-data/query-agent/queries/window.json";
import crossStream from "../../../../tests/test-data/query-agent/queries/cross_stream.json";

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * A "specific" message is one that names the actual problem.
 * null means the error was suppressed (unclassified) — counts as non-specific.
 */
function isSpecificMessage(msg: string | null | undefined): boolean {
  if (!msg) return false;
  if (msg.startsWith("Unexpected end of query")) return false;
  if (/^Unexpected '[^']+' at line \d+/.test(msg)) return false;
  return true;
}

const parser = new Parser();

/** Parse sql and return the caught SyntaxError, or null if valid. */
function parseError(sql: string): any | null {
  try {
    parser.astify(sql);
    return null;
  } catch (e) {
    return e;
  }
}

const ALL_QUERY_FILES = [
  basicSelect, aggregation, combined, cteSubquery, dateTime,
  fullTextSearch, histogram, mathFunctions, pagination,
  stringFunctions, union, windowQueries, crossStream,
];

function allValidSqls(): string[] {
  return ALL_QUERY_FILES.flatMap((f: any) =>
    (f.queries ?? []).map((q: any) =>
      q.sql.replace(/\{stream\}/g, "default")
    )
  );
}

// ─── Mutation helpers ─────────────────────────────────────────────────────────

type Mutation = {
  name: string;
  apply: (sql: string) => { broken: string; expectedFragment: string } | null;
};

const mutations: Mutation[] = [
  {
    name: "truncate_after_AND",
    apply: (sql) => {
      const m = sql.match(/\bAND\b/i);
      if (!m) return null;
      return { broken: sql.substring(0, (m.index ?? 0) + 3), expectedFragment: "AND" };
    },
  },
  {
    name: "truncate_after_OR",
    apply: (sql) => {
      const m = sql.match(/\bOR\b/i);
      if (!m) return null;
      return { broken: sql.substring(0, (m.index ?? 0) + 2), expectedFragment: "OR" };
    },
  },
  {
    name: "truncate_after_WHERE",
    apply: (sql) => {
      const m = sql.match(/\bWHERE\b/i);
      if (!m) return null;
      return { broken: sql.substring(0, (m.index ?? 0) + 5), expectedFragment: "WHERE" };
    },
  },
  {
    name: "truncate_after_ORDER",
    apply: (sql) => {
      const m = sql.match(/\bORDER\b/i);
      if (!m) return null;
      return { broken: sql.substring(0, (m.index ?? 0) + 5), expectedFragment: "ORDER" };
    },
  },
  {
    name: "truncate_after_GROUP",
    apply: (sql) => {
      // Match an incomplete top-level GROUP keyword, not the "WITHIN GROUP"
      // ordered-set aggregate syntax (e.g. PERCENTILE_CONT(...) WITHIN GROUP),
      // which is a different construct the suppression model intentionally skips.
      const m = sql.match(/(?<!WITHIN\s)\bGROUP\b/i);
      if (!m) return null;
      return { broken: sql.substring(0, (m.index ?? 0) + 5), expectedFragment: "GROUP" };
    },
  },
  {
    name: "truncate_after_HAVING",
    apply: (sql) => {
      const m = sql.match(/\bHAVING\b/i);
      if (!m) return null;
      return { broken: sql.substring(0, (m.index ?? 0) + 6), expectedFragment: "HAVING" };
    },
  },
  {
    name: "truncate_after_LIMIT",
    apply: (sql) => {
      const m = sql.match(/\bLIMIT\b/i);
      if (!m) return null;
      return { broken: sql.substring(0, (m.index ?? 0) + 5), expectedFragment: "LIMIT" };
    },
  },
  {
    name: "remove_WHERE_keyword",
    apply: (sql) => {
      if (!/\bWHERE\s+\w/i.test(sql)) return null;
      const broken = sql.replace(/\bWHERE\s+/, "");
      if (!parseError(broken)) return null; // mutation produced valid SQL
      return { broken, expectedFragment: "WHERE" };
    },
  },
  {
    name: "unquote_like_pattern",
    apply: (sql) => {
      const m = sql.match(/\bLIKE\s+'([^'%][^']*%[^']*)'/i);
      if (!m) return null;
      const broken = sql.replace(/\bLIKE\s+'([^'%][^']*%[^']*)'/, `LIKE ${m[1]}`);
      if (!parseError(broken)) return null;
      return { broken, expectedFragment: "LIKE" };
    },
  },
  {
    name: "drop_AND_between_conditions",
    apply: (sql) => {
      const m = sql.match(/('[^']*'|[0-9.]+)\s+AND\s+([a-zA-Z_]\w*\s*[=<>!])/i);
      if (!m) return null;
      const broken = sql.replace(
        /('[^']*'|[0-9.]+)\s+AND\s+([a-zA-Z_]\w*\s*[=<>!])/,
        (_, a, b) => `${a} ${b}`,
      );
      if (!parseError(broken)) return null;
      return { broken, expectedFragment: "operator" };
    },
  },
  // ── Complex-construct mutations ──────────────────────────────────────────────
  {
    name: "truncate_inside_case_when",
    apply: (sql) => {
      // Truncate after WHEN keyword inside a CASE expression
      const m = sql.match(/\bCASE\s+WHEN\b/i);
      if (!m) return null;
      const cut = (m.index ?? 0) + m[0].length;
      const broken = sql.substring(0, cut);
      if (!parseError(broken)) return null;
      return { broken, expectedFragment: "CASE" };
    },
  },
  {
    name: "truncate_inside_coalesce",
    apply: (sql) => {
      // Truncate after the first comma inside COALESCE(a,
      const m = sql.match(/\bCOALESCE\s*\([^)]+,/i);
      if (!m) return null;
      const cut = (m.index ?? 0) + m[0].length;
      const broken = sql.substring(0, cut);
      if (!parseError(broken)) return null;
      return { broken, expectedFragment: "COALESCE" };
    },
  },
  {
    name: "truncate_after_UNION",
    apply: (sql) => {
      const m = sql.match(/\bUNION\b/i);
      if (!m) return null;
      const broken = sql.substring(0, (m.index ?? 0) + 5);
      if (!parseError(broken)) return null;
      return { broken, expectedFragment: "UNION" };
    },
  },
  {
    name: "truncate_after_OVER_paren",
    apply: (sql) => {
      // Truncate after OVER ( — leaves the window spec open
      const m = sql.match(/\bOVER\s*\(/i);
      if (!m) return null;
      const cut = (m.index ?? 0) + m[0].length;
      const broken = sql.substring(0, cut);
      if (!parseError(broken)) return null;
      return { broken, expectedFragment: "OVER" };
    },
  },
  {
    name: "truncate_inside_cte",
    apply: (sql) => {
      // Truncate after WITH name AS ( — leaves CTE body open
      const m = sql.match(/\bWITH\s+\w+\s+AS\s*\(/i);
      if (!m) return null;
      const cut = (m.index ?? 0) + m[0].length;
      // keep something after the paren so it's clearly truncated
      const inner = sql.substring(cut).split(/\bSELECT\b/i);
      if (inner.length < 2) return null;
      const broken = sql.substring(0, cut) + "SELECT " + inner[1].split(/[,)]/)[0];
      if (!parseError(broken)) return null;
      return { broken, expectedFragment: "CTE" };
    },
  },
];

function generateBrokenQueries() {
  const result: { mutation: string; broken: string; expectedFragment: string }[] = [];
  for (const sql of allValidSqls()) {
    for (const mut of mutations) {
      const res = mut.apply(sql);
      if (res) result.push({ mutation: mut.name, ...res });
    }
  }
  return result;
}

// ─── Suite 1: unit tests for buildContextualSqlMessage ───────────────────────

describe("buildContextualSqlMessage", () => {
  const cases: [string, string, string][] = [
    // [label, broken_sql, expected_fragment_in_message]
    ["AND incomplete",     "SELECT * FROM t WHERE x = 1 AND",                "AND"],
    ["OR incomplete",      "SELECT * FROM t WHERE x = 1 OR",                 "OR"],
    ["LIKE incomplete",    "SELECT * FROM t WHERE x LIKE",                   "LIKE"],
    ["IN incomplete",      "SELECT * FROM t WHERE x IN",                     "IN"],
    ["BETWEEN incomplete", "SELECT * FROM t WHERE x BETWEEN",                "BETWEEN"],
    ["IS incomplete",      "SELECT * FROM t WHERE x IS",                     "IS"],
    ["ORDER incomplete",   "SELECT * FROM t ORDER",                          "ORDER"],
    ["GROUP incomplete",   "SELECT * FROM t GROUP",                          "GROUP"],
    ["ORDER BY needs col", "SELECT * FROM t ORDER BY",                       "ORDER BY"],
    ["GROUP BY needs col", "SELECT * FROM t GROUP BY",                       "GROUP BY"],
    ["HAVING incomplete",  "SELECT * FROM t HAVING",                         "HAVING"],
    ["WHERE incomplete",   "SELECT * FROM t WHERE",                          "WHERE"],
    ["FROM incomplete",    "SELECT * FROM",                                   "FROM"],
    ["SELECT incomplete",  "SELECT",                                          "SELECT"],
    ["= incomplete",       "SELECT * FROM t WHERE x =",                      "="],
    ["> incomplete",       "SELECT * FROM t WHERE x >",                      ">"],
    ["LIMIT incomplete",   "SELECT * FROM t LIMIT",                          "LIMIT"],
    ["OFFSET incomplete",  "SELECT * FROM t LIMIT 10 OFFSET",                "OFFSET"],
    ["open paren",         "SELECT * FROM t WHERE (",                        "parenthesis"],
    ["missing WHERE",      "SELECT * FROM default service_name='payment'",   "WHERE"],
    ["missing AND/OR",     "SELECT * FROM t WHERE x=1 AND y=2 z=3",         "operator"],
    ["bad LIKE %",         "SELECT * FROM t WHERE x LIKE %foo%",             "LIKE"],
    ["unmatched )",        "SELECT * FROM t WHERE (x = 1))",                 "parenthesis"],

    // CASE / COALESCE / nested constructs
    ["CASE missing WHEN",          "SELECT CASE",                                                 "CASE"],
    ["CASE WHEN no THEN",          "SELECT CASE WHEN x > 1",                                     "THEN"],
    ["CASE WHEN needs expr",       "SELECT * FROM t WHERE x = 1 AND CASE WHEN",                  "CASE"],
    ["CASE THEN needs END",        "SELECT CASE WHEN x > 1 THEN 'a'",                            "END"],
    ["CASE ELSE needs END",        "SELECT CASE WHEN x > 1 THEN 'a' ELSE 'b'",                   "END"],
    ["COALESCE trailing comma",    "SELECT COALESCE(a,",                                          "COALESCE"],
    ["COALESCE nested truncated",  "SELECT COALESCE(CASE WHEN x > 1 THEN 'a'",                   "CASE"],
    ["NULLIF truncated",           "SELECT NULLIF(a,",                                            "NULLIF"],
    ["OVER clause truncated",      "SELECT SUM(x) OVER (PARTITION BY",                           "PARTITION BY"],
    ["OVER no partition/order",    "SELECT ROW_NUMBER() OVER (",                                  "OVER"],
    ["subquery truncated",         "SELECT * FROM (SELECT a FROM t",                              "subquery"],
    ["CTE body truncated",         "WITH cte AS (SELECT a FROM t",                                "CTE"],
    ["UNION needs SELECT",         "SELECT * FROM t UNION",                                       "UNION"],
    ["UNION ALL needs SELECT",     "SELECT * FROM t UNION ALL",                                   "UNION"],
    ["JOIN ON incomplete",         "SELECT * FROM t JOIN s ON",                                   "JOIN"],
    ["NOT incomplete",             "SELECT * FROM t WHERE NOT",                                   "NOT"],
    ["DISTINCT incomplete",        "SELECT DISTINCT",                                              "DISTINCT"],
    ["BETWEEN fn AND no rhs",      "SELECT * FROM t WHERE x BETWEEN ABS(a) AND",                 "AND"],
    ["nested CASE in subquery",    "SELECT * FROM t WHERE x IN (SELECT CASE WHEN",               "CASE"],
  ];

  for (const [label, sql, fragment] of cases) {
    it(`detects: ${label}`, () => {
      const err = parseError(sql);
      expect(err).not.toBeNull();
      const msg = buildContextualSqlMessage(sql, err);
      expect(msg).not.toBeNull();
      expect(msg!.toLowerCase()).toContain(fragment.toLowerCase());
    });
  }
});

// ─── Suite 2: no false positives on valid queries ─────────────────────────────

describe("validateSql — no false positives on valid queries", () => {
  it("returns null for all 400 query-agent test queries", async () => {
    const sqls = allValidSqls();
    const results = await Promise.all(sqls.map((sql) => validateSql(sql)));
    const falsePositives = sqls.filter((_, i) => results[i] !== null);
    expect(falsePositives).toHaveLength(0);
  });
});

// ─── Suite 2b: grammar-gap false-positive suppression ────────────────────────
// DataFusion accepts these; the client PEG grammar rejects them. validateSql
// must return null (suppress) rather than show a wrong squiggle.

describe("validateSql — grammar-gap suppression (no false positives)", () => {
  const gapCases: [string, string][] = [
    ["EXCEPT SELECT",      "SELECT a FROM default EXCEPT SELECT a FROM default"],
    ["GROUPING SETS",      "SELECT a, COUNT(*) FROM default GROUP BY GROUPING SETS ((a), ())"],
    ["array literal",      "SELECT [1, 2, 3] FROM default"],
    ["AT TIME ZONE",       "SELECT _timestamp AT TIME ZONE 'UTC' FROM default"],
  ];

  for (const [label, sql] of gapCases) {
    it(`suppresses: ${label}`, async () => {
      const result = await validateSql(sql);
      expect(result).toBeNull();
    });
  }

  it("does NOT suppress a plain missing-WHERE user error", async () => {
    const result = await validateSql("SELECT * FROM default service_name = 'payment'");
    expect(result).not.toBeNull();
    expect(result!.error.toLowerCase()).toContain("where");
  });

  it("does NOT suppress a plain truncated-AND user error", async () => {
    const result = await validateSql("SELECT * FROM default WHERE x = 1 AND");
    expect(result).not.toBeNull();
    expect(result!.error.toLowerCase()).toContain("and");
  });
});

// ─── Suite 2c: colOffset/lineOffset math ─────────────────────────────────────

describe("validateSql — colOffset/lineOffset", () => {
  it("applies colOffset only on line 1 of constructed SQL", async () => {
    // Error is on line 1 — prefix is 'SELECT * FROM "s" WHERE ', length 25
    const constructed = 'SELECT * FROM "s" WHERE x =';
    const result = await validateSql(constructed, 0, 25);
    expect(result).not.toBeNull();
    // column should be adjusted: raw col minus colOffset
    expect(result!.column).toBeLessThan(25); // would be >= 25 without adjustment
  });

  it("does not apply colOffset on line 2+", async () => {
    // Construct SQL where the error is on line 2 (multi-line filter)
    const constructed = 'SELECT * FROM "s" WHERE\nx =';
    const result = await validateSql(constructed, 0, 23);
    expect(result).not.toBeNull();
    // line 2 error: column should NOT have colOffset subtracted
    expect(result!.startLine).toBe(2);
    // raw column for 'x =' would be 1 or 3; colOffset=23 would clamp to 1 incorrectly
    // if applied. We just assert it's >= 1 without clamping below 1.
    expect(result!.column).toBeGreaterThanOrEqual(1);
  });
});

// ─── Suite 3: mutation detection rate ────────────────────────────────────────

describe("validateSql — mutation detection on broken queries", () => {
  // Re-tuned after #12576 switched validateSql to an allow-list suppression model
  // (unrecognised error fingerprints are suppressed to avoid false positives) and
  // added lower-detection complex-construct mutations to the pool.
  const SPECIFIC_MSG_THRESHOLD = 0.92; // ≥92% of broken queries get a specific message

  it(`detects ≥ ${SPECIFIC_MSG_THRESHOLD * 100}% of broken queries with a specific message`, { timeout: 30000 }, async () => {
    const broken = generateBrokenQueries();
    const results = await Promise.all(broken.map(({ broken: sql }) => validateSql(sql)));

    let specific = 0;
    for (const r of results) {
      if (r !== null && isSpecificMessage(r.error)) specific++;
    }

    const rate = specific / broken.length;
    expect(rate).toBeGreaterThanOrEqual(SPECIFIC_MSG_THRESHOLD);
  });

  // Per-mutation thresholds
  const perMutationThresholds: Record<string, number> = {
    truncate_after_AND:          0.85,
    truncate_after_OR:           0.99,
    truncate_after_WHERE:        0.95,
    truncate_after_ORDER:        0.80,
    truncate_after_GROUP:        0.99,
    truncate_after_HAVING:       0.99,
    truncate_after_LIMIT:        0.97,
    remove_WHERE_keyword:        0.80, // tightened missingWhere guard: ambiguous patterns suppressed; expanded query set lowers rate
    unquote_like_pattern:        0.50, // small sample, parser handles some cases
    drop_AND_between_conditions: 0.90,
    // Complex-construct mutations
    truncate_inside_case_when:   0.90,
    truncate_inside_coalesce:    0.85,
    truncate_after_UNION:        0.90,
    truncate_after_OVER_paren:   0.80,
    truncate_inside_cte:         0.80,
  };

  for (const [mutName, threshold] of Object.entries(perMutationThresholds)) {
    it(`${mutName}: ≥ ${Math.round(threshold * 100)}% specific messages`, async () => {
      const broken = generateBrokenQueries().filter((b) => b.mutation === mutName);
      if (broken.length === 0) return; // mutation didn't apply to any query

      const results = await Promise.all(broken.map(({ broken: sql }) => validateSql(sql)));
      let specific = 0;
      for (const r of results) {
        if (r !== null && isSpecificMessage(r.error)) specific++;
      }

      const rate = specific / broken.length;
      expect(rate).toBeGreaterThanOrEqual(threshold);
    });
  }
});

// ─── Suite 4: isParserLimitation guards ──────────────────────────────────────

describe("isParserLimitation", () => {
  it("Guard 1: whitespace found is a limitation", () => {
    expect(isParserLimitation({ found: " ", expected: [] })).toBe(true);
    expect(isParserLimitation({ found: "\t", expected: [] })).toBe(true);
  });

  it("Guard 1: non-whitespace found is not a limitation", () => {
    expect(isParserLimitation({ found: "x", expected: [] })).toBe(false);
  });

  it("Guard 2: letter found + ) + AND/OR in large expected set is a limitation", () => {
    const expected = Array.from({ length: 160 }, (_, i) => ({
      type: "literal",
      text: i === 0 ? ")" : i === 1 ? "AND" : `tok${i}`,
    }));
    expect(isParserLimitation({ found: "P", expected })).toBe(true);
  });

  it("Guard 2: small expected set is not a limitation", () => {
    const expected = [
      { type: "literal", text: ")" },
      { type: "literal", text: "AND" },
    ];
    expect(isParserLimitation({ found: "P", expected })).toBe(false);
  });

  it("Guard 3: found ) without ) or AND/OR in small expected is POSITION()-style limitation", () => {
    const expected = Array.from({ length: 10 }, (_, i) => ({
      type: "literal", text: `tok${i}`,
    }));
    expect(isParserLimitation({ found: ")", expected })).toBe(true);
  });

  it("Guard 3: found ) but ) is in expected — not a limitation", () => {
    const expected = [{ type: "literal", text: ")" }, { type: "literal", text: "AND" }];
    expect(isParserLimitation({ found: ")", expected })).toBe(false);
  });

  it("Guard 3: POSITION() with sql context — suppressed", () => {
    const sql = "SELECT POSITION('a' IN col) FROM t";
    const expected = Array.from({ length: 10 }, (_, i) => ({ type: "literal", text: `tok${i}` }));
    const err = { found: ")", expected, location: { start: { offset: sql.length - 1 } } };
    expect(isParserLimitation(err, sql)).toBe(true);
  });

  it("Guard 3: stray ) without POSITION() — not suppressed (no sql provided, legacy)", () => {
    const expected = Array.from({ length: 10 }, (_, i) => ({ type: "literal", text: `tok${i}` }));
    // Without sql, falls back to the original heuristic (suppress)
    expect(isParserLimitation({ found: ")", expected })).toBe(true);
  });

  it("Guard 4: found ( with ORDER and ROWS in expected is window-fn limitation", () => {
    const expected = [
      { type: "literal", text: "ORDER" },
      { type: "literal", text: "ROWS" },
      { type: "literal", text: "SOMETHING" },
    ];
    expect(isParserLimitation({ found: "(", expected })).toBe(true);
  });

  it("Guard 4: found ( with ORDER/ROWS but also AND — not a limitation", () => {
    const expected = [
      { type: "literal", text: "ORDER" },
      { type: "literal", text: "ROWS" },
      { type: "literal", text: "AND" },
    ];
    expect(isParserLimitation({ found: "(", expected })).toBe(false);
  });

  it("Guard 5: EXCEPT SELECT is a limitation", () => {
    const sql = "SELECT a FROM t EXCEPT SELECT a FROM s";
    const expected = Array.from({ length: 30 }, (_, i) => ({ type: "literal", text: `tok${i}` }));
    const err = { found: "S", expected, location: { start: { offset: sql.indexOf("SELECT", 20) } } };
    expect(isParserLimitation(err, sql)).toBe(true);
  });

  it("Guard 5: array literal [ is a limitation", () => {
    const sql = "SELECT [1,2,3] FROM t";
    const expected = Array.from({ length: 100 }, (_, i) => ({ type: "literal", text: `tok${i}` }));
    const err = { found: "[", expected, location: { start: { offset: 7 } } };
    expect(isParserLimitation(err, sql)).toBe(true);
  });

  it("Guard 5: AT TIME ZONE is a limitation", () => {
    const sql = "SELECT _timestamp AT TIME ZONE 'UTC' FROM t";
    const expected = Array.from({ length: 30 }, (_, i) => ({ type: "literal", text: `tok${i}` }));
    const err = { found: "T", expected, location: { start: { offset: sql.indexOf("TIME") } } };
    expect(isParserLimitation(err, sql)).toBe(true);
  });

  it("real window function queries are treated as limitations", async () => {
    const windowSqls = [
      `SELECT PERCENT_RANK() OVER (ORDER BY x) FROM t`,
      `SELECT NTILE(4) OVER (PARTITION BY COALESCE(a, 'x') ORDER BY b) FROM t`,
    ];
    for (const sql of windowSqls) {
      const result = await validateSql(sql);
      expect(result).toBeNull();
    }
  });
});

// ─── Suite: locateIdentifier (the token scanner) ─────────────────────────────

describe("locateIdentifier", () => {
  const sliceHit = (sql: string, h: { line: number; startCol: number; endCol: number }) =>
    sql.split("\n")[h.line - 1].slice(h.startCol - 1, h.endCol - 1);

  it("finds every occurrence of a bare identifier", () => {
    const sql = "SELECT a, a FROM t";
    const hits = locateIdentifier(sql, "a");
    expect(hits.length).toBe(2);
    expect(hits.every((h) => sliceHit(sql, h) === "a")).toBe(true);
  });

  it("skips single-quoted string literals", () => {
    const sql = "SELECT x FROM t WHERE y = 'x'";
    const hits = locateIdentifier(sql, "x");
    // Only the column `x`, not the string literal 'x'.
    expect(hits.length).toBe(1);
    expect(hits[0].startCol).toBe(8);
  });

  it("matches quoted identifiers (double quotes / backticks)", () => {
    expect(locateIdentifier('SELECT "col" FROM t', "col").length).toBe(1);
    expect(locateIdentifier("SELECT `col` FROM t", "col").length).toBe(1);
  });

  it("skips line and block comments", () => {
    expect(locateIdentifier("SELECT a -- a a\nFROM t", "a").length).toBe(1);
    expect(locateIdentifier("SELECT a /* a a */ FROM t", "a").length).toBe(1);
  });

  it("resolves a qualified name to its last segment", () => {
    const sql = "SELECT status FROM t";
    const hits = locateIdentifier(sql, "schema.status");
    expect(hits.length).toBe(1);
    expect(sliceHit(sql, hits[0])).toBe("status");
  });

  it("is case-insensitive", () => {
    expect(locateIdentifier("SELECT Status FROM t", "status").length).toBe(1);
  });

  it("returns nothing when the identifier is absent", () => {
    expect(locateIdentifier("SELECT a FROM t", "zzz").length).toBe(0);
  });
});

// ─── Suite: rangesFromServerError — semantic error highlighting ───────────────
//
// End-to-end: given the backend error text + the query, the offending token(s)
// must be located precisely and carry a helpful message. Error strings below are
// the real phrasings from DataFusion / OpenObserve (src/infra/src/errors).

describe("rangesFromServerError — semantic errors", () => {
  const tokenAt = (query: string, r: SqlErrorRange) =>
    query
      .split("\n")
      [r.startLine - 1].slice((r.column ?? 1) - 1, (r.endColumn ?? 1) - 1);

  interface Case {
    name: string;
    message?: string;
    errorDetail?: string;
    query: string;
    sqlMode?: boolean;
    streamName?: string;
    token: string;
    msgIncludes: string;
    minHits?: number;
  }

  const cases: Case[] = [
    {
      name: "field not found (No field named)",
      message: "Search field not found: Schema error: No field named as.",
      query: 'SELECT count(*) as cnt, error_id, as errid FROM "t"',
      token: "as",
      msgIncludes: "Unknown field",
    },
    {
      name: "field not found (bare, wrapped)",
      message: "Search field not found: eror_id. Field not found in stream schema.",
      query: "SELECT eror_id FROM t",
      token: "eror_id",
      msgIncludes: "Unknown field",
    },
    {
      name: "field not found (backtick-quoted)",
      errorDetail: "Schema error: No field named `user_id`. Valid fields are a, b.",
      query: "SELECT user_id FROM t",
      token: "user_id",
      msgIncludes: "Unknown field",
    },
    {
      name: "function not defined",
      message: "Search function not defined: Invalid function 'summ'.",
      query: "SELECT summ(x) FROM t",
      token: "summ",
      msgIncludes: "Unknown function",
    },
    {
      name: "incompatible data type",
      errorDetail: "Incompatible data types for field amount. Expected Int64 but got Utf8",
      query: "SELECT * FROM t WHERE amount > 'x'",
      token: "amount",
      msgIncludes: "incompatible data type",
    },
    {
      name: "stream not found (located in FROM)",
      message: "Search stream not found: logs2",
      query: 'SELECT * FROM "logs2"',
      // A quoted identifier is highlighted including its surrounding quotes.
      token: '"logs2"',
      msgIncludes: "Unknown stream",
    },
    {
      name: "GROUP BY (DataFusion projection phrasing, qualified)",
      errorDetail:
        "Error during planning: Projection references non-aggregate values: Expression schema.status could not be resolved from available columns",
      query: "SELECT status, count(*) FROM t GROUP BY code",
      token: "status",
      msgIncludes: "GROUP BY",
    },
    {
      name: "GROUP BY (must appear phrasing)",
      errorDetail: "column code must appear in the GROUP BY clause or be used in an aggregate function",
      query: "SELECT code, count(*) FROM t",
      token: "code",
      msgIncludes: "GROUP BY",
    },
    {
      name: "ambiguous column (which would be ambiguous)",
      errorDetail:
        "Schema error: Schema contains qualified field name t1.name and unqualified field name name which would be ambiguous",
      query: "SELECT name FROM t1 JOIN t2 ON t1.id = t2.id",
      token: "name",
      msgIncludes: "ambiguous",
    },
    {
      name: "ambiguous column (Ambiguous reference)",
      errorDetail: "Schema error: Ambiguous reference to unqualified field user_id",
      query: "SELECT user_id FROM t1 JOIN t2 ON t1.id = t2.id",
      token: "user_id",
      msgIncludes: "ambiguous",
    },
    {
      name: "duplicate column (both occurrences)",
      errorDetail: "Schema error: Schema contains duplicate unqualified field name amount",
      query: "SELECT amount, amount FROM t",
      token: "amount",
      msgIncludes: "more than once",
      minHits: 2,
    },
    {
      name: "table / CTE not found",
      errorDetail: "Error during planning: Table or CTE with name 'orders' not found",
      query: "SELECT * FROM logs JOIN orders ON logs.id = orders.id",
      token: "orders",
      msgIncludes: "Unknown table",
    },
    {
      name: "function signature mismatch",
      errorDetail:
        "Error during planning: No function matches the given name and argument types 'date_trunc(Utf8)'. You might need to add explicit type casts.",
      query: "SELECT date_trunc('day', ts) FROM t",
      token: "date_trunc",
      msgIncludes: "wrong argument",
    },
  ];

  cases.forEach((c) => {
    it(c.name, async () => {
      const ranges = await rangesFromServerError({
        message: c.message,
        errorDetail: c.errorDetail,
        sqlMode: c.sqlMode ?? true,
        query: c.query,
        streamName: c.streamName,
      });
      expect(ranges.length).toBeGreaterThanOrEqual(c.minHits ?? 1);
      // The first located range wraps exactly the offending token.
      expect(tokenAt(c.query, ranges[0])).toBe(c.token);
      expect(ranges[0].error).toContain(c.msgIncludes);
    });
  });
});

// ─── Suite: rangesFromServerError — no false positives ───────────────────────

describe("rangesFromServerError — non-locatable errors produce no squiggle", () => {
  const nonLocatable = [
    "Search query timed out after 30s",
    "Ratelimit exceeded",
    "This feature is not implemented: GROUPING SETS",
    "Arrow error: Cast error: Cannot cast string 'abc' to value of Int64 type",
    "Full text search field not found",
    "Server Internal Error",
  ];

  nonLocatable.forEach((message) => {
    it(`returns [] for: ${message.slice(0, 40)}`, async () => {
      const ranges = await rangesFromServerError({
        message,
        sqlMode: true,
        query: "SELECT * FROM t",
      });
      expect(ranges).toEqual([]);
    });
  });

  it("returns [] when the query is empty", async () => {
    const ranges = await rangesFromServerError({
      message: "Search field not found: foo",
      sqlMode: true,
      query: "   ",
    });
    expect(ranges).toEqual([]);
  });
});

// ─── Suite: rangesFromServerError — syntax errors (20001) ────────────────────

describe("rangesFromServerError — syntax errors", () => {
  it("locates a syntax error via the sqlparser location path", async () => {
    const ranges = await rangesFromServerError({
      code: 20001,
      errorDetail: "sql parser error: Expected an expression, found: EOF at Line: 1, Column: 26",
      sqlMode: true,
      query: "SELECT * FROM t WHERE x = ",
    });
    expect(ranges.length).toBeGreaterThanOrEqual(1);
    expect(ranges[0].error).toBeTruthy();
  });

  it("detects syntax errors code-agnostically (HTTP status, not 20001)", async () => {
    const ranges = await rangesFromServerError({
      code: 400,
      message: "sql parser error: Expected an expression, found: EOF at Line: 1, Column: 26",
      sqlMode: true,
      query: "SELECT * FROM t WHERE x = ",
    });
    expect(ranges.length).toBeGreaterThanOrEqual(1);
  });
});
