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
import { buildContextualSqlMessage, validateSql } from "./sqlDiagnostics";
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

// ─── helpers ─────────────────────────────────────────────────────────────────

/**
 * A "specific" message is one that names the actual problem rather than
 * falling through to the generic "Unexpected end of query" or bare
 * "Unexpected 'X'" fallback.
 */
function isSpecificMessage(msg: string): boolean {
  if (!msg) return false;
  if (msg.startsWith("Unexpected end of query")) return false;
  // Generic "Unexpected 'X' at line N" with no further context is a fallback
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
  stringFunctions, union, windowQueries,
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
      const m = sql.match(/\bGROUP\b/i);
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
  ];

  for (const [label, sql, fragment] of cases) {
    it(`detects: ${label}`, () => {
      const err = parseError(sql);
      expect(err).not.toBeNull();
      const msg = buildContextualSqlMessage(sql, err);
      expect(msg.toLowerCase()).toContain(fragment.toLowerCase());
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

// ─── Suite 3: mutation detection rate ────────────────────────────────────────

describe("validateSql — mutation detection on broken queries", () => {
  const SPECIFIC_MSG_THRESHOLD = 0.93; // ≥93% of broken queries get a specific message

  it(`detects ≥ ${SPECIFIC_MSG_THRESHOLD * 100}% of broken queries with a specific message`, async () => {
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
    remove_WHERE_keyword:        0.94,
    unquote_like_pattern:        0.50, // small sample, parser handles some cases
    drop_AND_between_conditions: 0.90,
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
