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
 * Integration tests for Builder Toggle behavior.
 *
 * These tests use the REAL SQL parser (@openobserve/node-sql-parser)
 * instead of mocks to verify that SQL queries are correctly parsed
 * into builder fields and filters on toggle.
 *
 * Covers all 9 entry condition cases from the design doc:
 *   builder-tab-behavior.md
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  parseSQL,
  parsedQueryToPanelFields,
  shouldUseCustomMode,
  isQueryParseable,
} from "./sqlQueryParser";
import {
  getFieldsFromQuery,
  parseWhereClauseToFilter,
  extractWhereClause,
  isSimpleSelectAllQuery,
} from "./sqlUtils";

// ============================================================================
// Real parser setup — NO MOCKS
// ============================================================================

let parser: any;

beforeAll(async () => {
  const Parser: any = await import(
    "@openobserve/node-sql-parser/build/datafusionsql"
  );
  parser = new Parser.default.Parser();
});

// ============================================================================
// Helpers
// ============================================================================

/** Shorthand: parse SQL → getFieldsFromQuery with real parser */
const parseFields = async (sql: string) => {
  return getFieldsFromQuery(sql);
};

/** Full pipeline: parseSQL → parsedQueryToPanelFields */
const fullPipeline = async (sql: string) => {
  const parsed = await parseSQL(sql, "logs");
  if (parsed.customQuery) return { ...parsed, panelFields: null };
  const panelFields = parsedQueryToPanelFields(parsed);
  return { ...parsed, panelFields };
};

/** Count total filter conditions recursively */
function countConditions(filter: any): number {
  if (!filter) return 0;
  if (filter.filterType === "condition") return 1;
  if (filter.conditions && Array.isArray(filter.conditions)) {
    return filter.conditions.reduce(
      (sum: number, c: any) => sum + countConditions(c),
      0,
    );
  }
  return 0;
}

/** Flatten all condition nodes from a (possibly nested) filter tree */
function flattenConditions(filter: any): any[] {
  if (!filter) return [];
  if (filter.filterType === "condition") return [filter];
  if (filter.conditions && Array.isArray(filter.conditions)) {
    return filter.conditions.flatMap((c: any) => flattenConditions(c));
  }
  return [];
}

// ============================================================================
// Case 3: SQL ON + Empty / SELECT * — detected correctly
// ============================================================================

describe("Case 3: SQL ON — empty / SELECT * detection", () => {
  const selectStarQueries = [
    'SELECT * FROM "default"',
    "SELECT * FROM \"default\" ",
    '  SELECT  *  FROM  "default"  ',
    'select * from "default"',
    'SELECT * FROM "k8s_logs"',
    'SELECT * FROM "my-stream-name"',
    'SELECT * FROM "default" LIMIT 100',
    'SELECT * FROM "default" ORDER BY _timestamp DESC',
  ];

  it.each(selectStarQueries)(
    "isSimpleSelectAllQuery detects: %s",
    (sql) => {
      expect(isSimpleSelectAllQuery(sql)).toBe(true);
    },
  );

  it("rejects non-SELECT* queries", () => {
    expect(
      isSimpleSelectAllQuery(
        'SELECT count(*) FROM "default"',
      ),
    ).toBe(false);
    expect(
      isSimpleSelectAllQuery(
        'SELECT level, count(*) FROM "default" GROUP BY level',
      ),
    ).toBe(false);
  });
});

// ============================================================================
// Case 3a: SQL ON + SELECT <fields> FROM <stream> (no agg/group)
// — bare-field-select gets default histogram/count
// ============================================================================

describe("Case 3a: SQL ON — bare-field-select queries get default histogram/count", () => {
  it("single field: SELECT method FROM stream → defaults", async () => {
    const r = await fullPipeline('SELECT method FROM "default"');
    expect(r.customQuery).toBe(false);
    expect(r.panelFields!.x.length).toBe(1);
    expect(r.panelFields!.x[0].functionName).toBe("histogram");
    expect(r.panelFields!.x[0].column).toBe("_timestamp");
    expect(r.panelFields!.y.length).toBe(1);
    expect(r.panelFields!.y[0].functionName).toBe("count");
    expect(r.panelFields!.y[0].column).toBe("_timestamp");
    expect(r.panelFields!.breakdown.length).toBe(0);
  });

  it("multiple fields: SELECT method, status FROM stream → defaults", async () => {
    const r = await fullPipeline('SELECT method, status FROM "default"');
    expect(r.customQuery).toBe(false);
    expect(r.panelFields!.x.length).toBe(1);
    expect(r.panelFields!.x[0].functionName).toBe("histogram");
    expect(r.panelFields!.y.length).toBe(1);
    expect(r.panelFields!.y[0].functionName).toBe("count");
    expect(r.panelFields!.breakdown.length).toBe(0);
  });

  it("bare field with WHERE: SELECT method FROM stream WHERE code='200' → defaults + filter", async () => {
    const r = await fullPipeline(
      'SELECT method FROM "default" WHERE code = \'200\'',
    );
    expect(r.customQuery).toBe(false);
    expect(r.panelFields!.x.length).toBe(1);
    expect(r.panelFields!.x[0].functionName).toBe("histogram");
    expect(r.panelFields!.y.length).toBe(1);
    expect(r.panelFields!.y[0].functionName).toBe("count");
    expect(r.panelFields!.breakdown.length).toBe(0);
    const conds = flattenConditions(r.panelFields!.filter);
    expect(conds.length).toBe(1);
    expect(conds[0].column.field).toBe("code");
    expect(conds[0].value).toBe("200");
  });

  it("does NOT apply defaults when aggregation present: SELECT method, count(*) FROM stream GROUP BY method", async () => {
    const r = await fullPipeline(
      'SELECT method, count(_timestamp) as "y_axis_1" FROM "default" GROUP BY method',
    );
    expect(r.customQuery).toBe(false);
    // method should be on x-axis (moved from breakdown since x is empty), count on y-axis
    expect(r.panelFields!.x.length).toBe(1);
    expect(r.panelFields!.x[0].column).toBe("method");
    expect(r.panelFields!.x[0].functionName).toBeNull();
    expect(r.panelFields!.y.length).toBe(1);
    expect(r.panelFields!.y[0].functionName).toBe("count");
  });

  it("does NOT apply defaults when histogram present: SELECT histogram(_timestamp) FROM stream", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" GROUP BY x_axis_1',
    );
    expect(r.customQuery).toBe(false);
    expect(r.panelFields!.x[0].functionName).toBe("histogram");
    expect(r.panelFields!.y[0].functionName).toBe("count");
  });
});

// ============================================================================
// Case 2: SQL OFF — WHERE clause → parseWhereClauseToFilter
// ============================================================================

describe("Case 2: SQL OFF — parseWhereClauseToFilter (15 queries)", () => {
  // -- Single conditions --
  it("Q1: simple equality", async () => {
    const f = await parseWhereClauseToFilter("code = '200'");
    const conds = flattenConditions(f);
    expect(conds.length).toBe(1);
    expect(conds[0].column.field).toBe("code");
    expect(conds[0].operator).toBe("=");
    expect(conds[0].value).toBe("200");
  });

  it("Q2: not-equal", async () => {
    const f = await parseWhereClauseToFilter("status <> 'error'");
    const conds = flattenConditions(f);
    expect(conds.length).toBe(1);
    expect(conds[0].column.field).toBe("status");
    expect(conds[0].operator).toBe("<>");
    expect(conds[0].value).toBe("error");
  });

  it("Q3: greater-than numeric", async () => {
    const f = await parseWhereClauseToFilter("response_time > 500");
    const conds = flattenConditions(f);
    expect(conds.length).toBe(1);
    expect(conds[0].column.field).toBe("response_time");
    expect(conds[0].operator).toBe(">");
  });

  it("Q4: less-than-or-equal", async () => {
    const f = await parseWhereClauseToFilter("duration <= 1000");
    const conds = flattenConditions(f);
    expect(conds.length).toBe(1);
    expect(conds[0].operator).toBe("<=");
  });

  it("Q5: LIKE contains", async () => {
    const f = await parseWhereClauseToFilter("message LIKE '%timeout%'");
    const conds = flattenConditions(f);
    expect(conds.length).toBe(1);
    expect(conds[0].operator).toBe("Contains");
    expect(conds[0].value).toBe("timeout");
  });

  it("Q6: LIKE starts-with", async () => {
    const f = await parseWhereClauseToFilter("path LIKE '/api%'");
    const conds = flattenConditions(f);
    expect(conds.length).toBe(1);
    expect(conds[0].operator).toBe("Starts With");
    expect(conds[0].value).toBe("/api");
  });

  it("Q7: LIKE ends-with", async () => {
    const f = await parseWhereClauseToFilter("filename LIKE '%.log'");
    const conds = flattenConditions(f);
    expect(conds.length).toBe(1);
    expect(conds[0].operator).toBe("Ends With");
    expect(conds[0].value).toBe(".log");
  });

  it("Q8: NOT LIKE", async () => {
    const f = await parseWhereClauseToFilter(
      "message NOT LIKE '%healthcheck%'",
    );
    const conds = flattenConditions(f);
    expect(conds.length).toBe(1);
    expect(conds[0].operator).toBe("Not Contains");
  });

  it("Q9: IN list", async () => {
    const f = await parseWhereClauseToFilter(
      "level IN ('ERROR', 'WARN', 'FATAL')",
    );
    const conds = flattenConditions(f);
    expect(conds.length).toBe(1);
    expect(conds[0].filterType).toBe("condition");
    expect(conds[0].values.length).toBe(3);
  });

  it("Q10: IS NULL", async () => {
    const f = await parseWhereClauseToFilter("trace_id IS NULL");
    const conds = flattenConditions(f);
    expect(conds.length).toBe(1);
    expect(conds[0].operator).toBe("Is Null");
  });

  it("Q11: IS NOT NULL", async () => {
    const f = await parseWhereClauseToFilter("trace_id IS NOT NULL");
    const conds = flattenConditions(f);
    expect(conds.length).toBe(1);
    expect(conds[0].operator).toBe("Is Not Null");
  });

  // -- Compound conditions --
  it("Q12: two ANDs", async () => {
    const f = await parseWhereClauseToFilter(
      "level = 'ERROR' AND code = '500'",
    );
    expect(countConditions(f)).toBe(2);
  });

  it("Q13: three ANDs", async () => {
    const f = await parseWhereClauseToFilter(
      "level = 'ERROR' AND code = '500' AND method = 'POST'",
    );
    expect(countConditions(f)).toBe(3);
  });

  it("Q14: OR condition", async () => {
    const f = await parseWhereClauseToFilter(
      "level = 'ERROR' OR level = 'WARN'",
    );
    expect(countConditions(f)).toBe(2);
  });

  it("Q15: mixed AND/OR with parentheses", async () => {
    const f = await parseWhereClauseToFilter(
      "(level = 'ERROR' OR level = 'WARN') AND code = '500'",
    );
    expect(countConditions(f)).toBeGreaterThanOrEqual(3);
  });
});

// ============================================================================
// Case 4: SQL ON + Simple parseable SQL — fields + filters extracted
// ============================================================================

describe("Case 4: SQL ON — simple parseable queries (40 queries)", () => {
  // -- Histogram + count (most common) --
  it("Q16: histogram + count basic", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(r.customQuery).toBe(false);
    expect(r.panelFields!.x.length).toBe(1);
    expect(r.panelFields!.x[0].functionName).toBe("histogram");
    expect(r.panelFields!.y.length).toBe(1);
    expect(r.panelFields!.y[0].functionName).toBe("count");
  });

  it("Q17: histogram + count with WHERE", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE level = \'ERROR\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(r.customQuery).toBe(false);
    expect(r.panelFields!.x.length).toBe(1);
    expect(r.panelFields!.y.length).toBe(1);
    const conds = flattenConditions(r.panelFields!.filter);
    expect(conds.length).toBe(1);
    expect(conds[0].column.field).toBe("level");
    expect(conds[0].value).toBe("ERROR");
  });

  it("Q18: histogram + count with multiple WHERE conditions", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE level = \'ERROR\' AND code = \'500\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(r.customQuery).toBe(false);
    expect(countConditions(r.panelFields!.filter)).toBe(2);
  });

  it("Q19: histogram + sum", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", sum(bytes) as "y_axis_1" FROM "default" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(r.panelFields!.y[0].functionName).toBe("sum");
    expect(r.panelFields!.y[0].column).toBe("bytes");
  });

  it("Q20: histogram + avg", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", avg(response_time) as "y_axis_1" FROM "default" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(r.panelFields!.y[0].functionName).toBe("avg");
    expect(r.panelFields!.y[0].column).toBe("response_time");
  });

  it("Q21: histogram + min", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", min(latency) as "y_axis_1" FROM "default" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(r.panelFields!.y[0].functionName).toBe("min");
  });

  it("Q22: histogram + max", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", max(latency) as "y_axis_1" FROM "default" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(r.panelFields!.y[0].functionName).toBe("max");
  });

  it("Q23: histogram + multiple y-axis aggregations", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1", avg(response_time) as "y_axis_2" FROM "default" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(r.panelFields!.x.length).toBe(1);
    expect(r.panelFields!.y.length).toBe(2);
    expect(r.panelFields!.y[0].functionName).toBe("count");
    expect(r.panelFields!.y[1].functionName).toBe("avg");
  });

  // -- With breakdown field --
  it("Q24: histogram + count + breakdown", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1", level as "z_axis_1" FROM "default" GROUP BY x_axis_1, z_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(r.panelFields!.x.length).toBe(1);
    expect(r.panelFields!.y.length).toBe(1);
    expect(r.panelFields!.breakdown.length).toBe(1);
    expect(r.panelFields!.breakdown[0].column).toBe("level");
  });

  it("Q25: histogram + count + breakdown + filter", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1", method as "z_axis_1" FROM "default" WHERE code = \'500\' GROUP BY x_axis_1, z_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(r.panelFields!.x.length).toBe(1);
    expect(r.panelFields!.y.length).toBe(1);
    expect(r.panelFields!.breakdown.length).toBe(1);
    expect(r.panelFields!.breakdown[0].column).toBe("method");
    expect(countConditions(r.panelFields!.filter)).toBe(1);
  });

  // -- Non-histogram x-axis (plain fields) --
  it("Q26: field on x + count on y (no histogram)", async () => {
    const r = await fullPipeline(
      'SELECT k8s_namespace_name as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(r.customQuery).toBe(false);
    // k8s_namespace_name has no aggregation → classified as breakdown → moved to x since x is empty
    expect(r.panelFields!.x.length).toBe(1);
    expect(r.panelFields!.x[0].column).toBe("k8s_namespace_name");
    expect(r.panelFields!.y.length).toBe(1);
    expect(r.panelFields!.y[0].functionName).toBe("count");
  });

  it("Q27: two fields on x + count (table chart)", async () => {
    const r = await fullPipeline(
      'SELECT k8s_namespace_name as "x_axis_1", k8s_pod_name as "x_axis_2", count(_timestamp) as "y_axis_1" FROM "default" GROUP BY x_axis_1, x_axis_2 ORDER BY x_axis_1 ASC',
    );
    // 2 breakdown → 1 moves to x, 1 stays in breakdown → total group = 2 → not table
    expect(r.panelFields!.x.length).toBe(1);
    expect(r.panelFields!.breakdown.length).toBe(1);
    expect(r.panelFields!.useTableChart).toBe(false);
  });

  // -- Various filter operators in full SQL --
  it("Q28: WHERE with !=", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE status != \'healthy\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    const conds = flattenConditions(r.panelFields!.filter);
    expect(conds.length).toBe(1);
    expect(conds[0].column.field).toBe("status");
    expect(conds[0].operator).toBe("<>");
  });

  it("Q29: WHERE with >", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE response_time > 1000 GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    const conds = flattenConditions(r.panelFields!.filter);
    expect(conds.length).toBe(1);
    expect(conds[0].column.field).toBe("response_time");
    expect(conds[0].operator).toBe(">");
  });

  it("Q30: WHERE with <=", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE duration <= 500 GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    const conds = flattenConditions(r.panelFields!.filter);
    expect(conds.length).toBe(1);
    expect(conds[0].operator).toBe("<=");
  });

  it("Q31: WHERE with LIKE contains", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE message LIKE \'%error%\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    const conds = flattenConditions(r.panelFields!.filter);
    expect(conds.length).toBe(1);
    expect(conds[0].operator).toBe("Contains");
    expect(conds[0].value).toBe("error");
  });

  it("Q32: WHERE with NOT LIKE", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE path NOT LIKE \'%health%\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    const conds = flattenConditions(r.panelFields!.filter);
    expect(conds.length).toBe(1);
    expect(conds[0].operator).toBe("Not Contains");
  });

  it("Q33: WHERE with IN", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE level IN (\'ERROR\', \'WARN\') GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    const conds = flattenConditions(r.panelFields!.filter);
    expect(conds.length).toBe(1);
    expect(conds[0].values.length).toBe(2);
  });

  it("Q34: WHERE with IS NULL", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE trace_id IS NULL GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    const conds = flattenConditions(r.panelFields!.filter);
    expect(conds.length).toBe(1);
    expect(conds[0].operator).toBe("Is Null");
  });

  it("Q35: WHERE with IS NOT NULL", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE span_id IS NOT NULL GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    const conds = flattenConditions(r.panelFields!.filter);
    expect(conds.length).toBe(1);
    expect(conds[0].operator).toBe("Is Not Null");
  });

  it("Q36: WHERE with three AND conditions", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE level = \'ERROR\' AND code = \'500\' AND method = \'POST\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(countConditions(r.panelFields!.filter)).toBe(3);
    const conds = flattenConditions(r.panelFields!.filter);
    const fields = conds.map((c) => c.column.field);
    expect(fields).toContain("level");
    expect(fields).toContain("code");
    expect(fields).toContain("method");
  });

  it("Q37: WHERE with OR", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE level = \'ERROR\' OR level = \'FATAL\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(countConditions(r.panelFields!.filter)).toBe(2);
  });

  it("Q38: WHERE with nested AND/OR + parentheses", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE (level = \'ERROR\' OR level = \'WARN\') AND code >= 400 GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(countConditions(r.panelFields!.filter)).toBeGreaterThanOrEqual(3);
  });

  it("Q39: WHERE with str_match function", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE str_match(message, \'timeout\') GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    const conds = flattenConditions(r.panelFields!.filter);
    expect(conds.length).toBe(1);
    expect(conds[0].operator).toBe("str_match");
    expect(conds[0].value).toBe("timeout");
  });

  it("Q40: WHERE with match_all function", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE match_all(\'kubernetes error\') GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    const conds = flattenConditions(r.panelFields!.filter);
    expect(conds.length).toBe(1);
    expect(conds[0].operator).toBe("match_all");
    expect(conds[0].value).toBe("kubernetes error");
  });

  // -- Different stream names --
  it("Q41: quoted stream with dashes", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "k8s-logs-prod" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(r.stream).toBe("k8s-logs-prod");
    expect(r.panelFields!.stream).toBe("k8s-logs-prod");
  });

  it("Q42: quoted stream with underscores", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "nginx_access_logs" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(r.stream).toBe("nginx_access_logs");
  });

  // -- P-value aggregations --
  it("Q43: p50 aggregation", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", p50(latency) as "y_axis_1" FROM "default" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(r.panelFields!.y[0].functionName).toBe("p50");
    expect(r.panelFields!.y[0].column).toBe("latency");
  });

  it("Q44: p95 aggregation", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", p95(response_time) as "y_axis_1" FROM "default" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(r.panelFields!.y[0].functionName).toBe("p95");
  });

  it("Q45: p99 aggregation", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", p99(duration) as "y_axis_1" FROM "default" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(r.panelFields!.y[0].functionName).toBe("p99");
  });

  // -- Histogram with explicit interval --
  it("Q46: histogram with interval '1m'", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp, \'1m\') as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(r.panelFields!.x[0].functionName).toBe("histogram");
    expect(r.panelFields!.x[0].column).toBe("_timestamp");
  });

  // -- Complex WHERE + multiple aggregations + breakdown --
  it("Q47: full query with filter, breakdown, two y-axis", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1", avg(response_time) as "y_axis_2", k8s_namespace_name as "z_axis_1" FROM "default" WHERE level = \'ERROR\' AND code >= 400 GROUP BY x_axis_1, z_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(r.panelFields!.x.length).toBe(1);
    expect(r.panelFields!.y.length).toBe(2);
    expect(r.panelFields!.breakdown.length).toBe(1);
    expect(countConditions(r.panelFields!.filter)).toBe(2);
  });

  it("Q48: WHERE with four conditions", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE level = \'ERROR\' AND code = \'500\' AND method = \'POST\' AND path LIKE \'/api%\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(countConditions(r.panelFields!.filter)).toBe(4);
    const conds = flattenConditions(r.panelFields!.filter);
    expect(conds.find((c) => c.column.field === "path")?.operator).toBe(
      "Starts With",
    );
  });

  it("Q49: WHERE with NOT IN", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE level NOT IN (\'DEBUG\', \'TRACE\') GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    const conds = flattenConditions(r.panelFields!.filter);
    expect(conds.length).toBe(1);
    expect(conds[0].operator).toBe("NOT IN");
  });

  it("Q50: WHERE with mixed operators", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE level = \'ERROR\' AND response_time > 500 AND message LIKE \'%timeout%\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(countConditions(r.panelFields!.filter)).toBe(3);
    const conds = flattenConditions(r.panelFields!.filter);
    const ops = conds.map((c) => c.operator);
    expect(ops).toContain("=");
    expect(ops).toContain(">");
    expect(ops).toContain("Contains");
  });

  it("Q51: three y-axis aggregations", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1", min(latency) as "y_axis_2", max(latency) as "y_axis_3" FROM "default" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(r.panelFields!.y.length).toBe(3);
    expect(r.panelFields!.y[0].functionName).toBe("count");
    expect(r.panelFields!.y[1].functionName).toBe("min");
    expect(r.panelFields!.y[2].functionName).toBe("max");
  });

  it("Q52: breakdown + filter + multiple y-axis", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1", sum(bytes) as "y_axis_2", method as "z_axis_1" FROM "k8s_logs" WHERE code >= 400 GROUP BY x_axis_1, z_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(r.panelFields!.x.length).toBe(1);
    expect(r.panelFields!.y.length).toBe(2);
    expect(r.panelFields!.breakdown.length).toBe(1);
    expect(r.panelFields!.breakdown[0].column).toBe("method");
    expect(countConditions(r.panelFields!.filter)).toBe(1);
    expect(r.stream).toBe("k8s_logs");
  });

  it("Q53: LIKE with special chars in value", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE path LIKE \'/api/v1/%\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    const conds = flattenConditions(r.panelFields!.filter);
    expect(conds[0].operator).toBe("Starts With");
    expect(conds[0].value).toBe("/api/v1/");
  });

  it("Q54: WHERE field with underscores", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE k8s_namespace_name = \'kube-system\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    const conds = flattenConditions(r.panelFields!.filter);
    expect(conds.length).toBe(1);
    expect(conds[0].column.field).toBe("k8s_namespace_name");
    expect(conds[0].value).toBe("kube-system");
  });

  it("Q55: WHERE with five conditions", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE level = \'ERROR\' AND code >= 500 AND method = \'GET\' AND host LIKE \'%.prod.%\' AND trace_id IS NOT NULL GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(countConditions(r.panelFields!.filter)).toBe(5);
  });
});

// ============================================================================
// Case 5: SQL ON + Complex SQL → custom mode
// ============================================================================

describe("Case 5: SQL ON — complex queries → custom mode (10 queries)", () => {
  it("Q56: subquery in FROM", () => {
    expect(
      shouldUseCustomMode(
        'SELECT * FROM (SELECT level, count(*) FROM "default" GROUP BY level)',
      ),
    ).toBe(true);
  });

  it("Q57: derived table in JOIN", () => {
    expect(
      shouldUseCustomMode(
        'SELECT a.* FROM "logs" a INNER JOIN (SELECT user_id, count(*) FROM "sessions" GROUP BY user_id) b ON a.user_id = b.user_id',
      ),
    ).toBe(true);
  });

  it("Q58: CTE (WITH clause)", () => {
    expect(
      shouldUseCustomMode(
        'WITH errors AS (\nVALUES (1)\n) SELECT * FROM errors',
      ),
    ).toBe(true);
  });

  it("Q59: UNION", () => {
    expect(
      shouldUseCustomMode(
        'SELECT * FROM "errors" UNION SELECT * FROM "warnings"',
      ),
    ).toBe(true);
  });

  it("Q60: INTERSECT", () => {
    expect(
      shouldUseCustomMode(
        'SELECT user_id FROM "active_users" INTERSECT SELECT user_id FROM "premium_users"',
      ),
    ).toBe(true);
  });

  it("Q61: window function ROW_NUMBER", () => {
    expect(
      shouldUseCustomMode(
        'SELECT *, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY _timestamp) FROM "default"',
      ),
    ).toBe(true);
  });

  it("Q62: RANK window function", () => {
    expect(
      shouldUseCustomMode(
        'SELECT user_id, RANK() OVER (ORDER BY score DESC) FROM "leaderboard"',
      ),
    ).toBe(true);
  });

  it("Q63: DISTINCT ON", () => {
    expect(
      shouldUseCustomMode(
        'SELECT DISTINCT ON (user_id) * FROM "events"',
      ),
    ).toBe(true);
  });

  it("Q64: ARRAY_AGG", () => {
    expect(
      shouldUseCustomMode(
        'SELECT user_id, ARRAY_AGG(tag) FROM "events" GROUP BY user_id',
      ),
    ).toBe(true);
  });

  it("Q65: JSON arrow operator", () => {
    expect(
      shouldUseCustomMode(
        'SELECT data->>\'name\' FROM "events"',
      ),
    ).toBe(true);
  });
});

// ============================================================================
// Case 6: SQL ON + Aggregation only → metric chart
// ============================================================================

describe("Case 6: SQL ON — aggregation only queries (10 queries)", () => {
  it("Q66: count only", async () => {
    const r = await fullPipeline(
      'SELECT count(_timestamp) as "y_axis_1" FROM "default"',
    );
    expect(r.customQuery).toBe(false);
    expect(r.panelFields!.x.length).toBe(0);
    expect(r.panelFields!.y.length).toBe(1);
    expect(r.panelFields!.y[0].functionName).toBe("count");
    expect(r.panelFields!.breakdown.length).toBe(0);
  });

  it("Q67: sum only", async () => {
    const r = await fullPipeline(
      'SELECT sum(bytes) as "y_axis_1" FROM "default"',
    );
    expect(r.panelFields!.y[0].functionName).toBe("sum");
    expect(r.panelFields!.x.length).toBe(0);
  });

  it("Q68: avg only", async () => {
    const r = await fullPipeline(
      'SELECT avg(response_time) as "y_axis_1" FROM "default"',
    );
    expect(r.panelFields!.y[0].functionName).toBe("avg");
    expect(r.panelFields!.x.length).toBe(0);
  });

  it("Q69: min only", async () => {
    const r = await fullPipeline(
      'SELECT min(latency) as "y_axis_1" FROM "default"',
    );
    expect(r.panelFields!.y[0].functionName).toBe("min");
  });

  it("Q70: max only", async () => {
    const r = await fullPipeline(
      'SELECT max(latency) as "y_axis_1" FROM "default"',
    );
    expect(r.panelFields!.y[0].functionName).toBe("max");
  });

  it("Q71: count with filter", async () => {
    const r = await fullPipeline(
      'SELECT count(_timestamp) as "y_axis_1" FROM "default" WHERE level = \'ERROR\'',
    );
    expect(r.panelFields!.y.length).toBe(1);
    expect(countConditions(r.panelFields!.filter)).toBe(1);
  });

  it("Q72: multiple aggregations only", async () => {
    const r = await fullPipeline(
      'SELECT count(_timestamp) as "y_axis_1", avg(response_time) as "y_axis_2" FROM "default"',
    );
    expect(r.panelFields!.y.length).toBe(2);
    expect(r.panelFields!.x.length).toBe(0);
    expect(r.panelFields!.breakdown.length).toBe(0);
  });

  it("Q73: p95 only", async () => {
    const r = await fullPipeline(
      'SELECT p95(duration) as "y_axis_1" FROM "default"',
    );
    expect(r.panelFields!.y[0].functionName).toBe("p95");
  });

  it("Q74: aggregation only with multi-filter", async () => {
    const r = await fullPipeline(
      'SELECT count(_timestamp) as "y_axis_1" FROM "default" WHERE level = \'ERROR\' AND code >= 500 AND method = \'POST\'',
    );
    expect(r.panelFields!.y.length).toBe(1);
    expect(countConditions(r.panelFields!.filter)).toBe(3);
    const conds = flattenConditions(r.panelFields!.filter);
    expect(conds.find((c) => c.column.field === "level")).toBeTruthy();
    expect(conds.find((c) => c.column.field === "code")).toBeTruthy();
    expect(conds.find((c) => c.column.field === "method")).toBeTruthy();
  });

  it("Q75: three aggregations only with filter", async () => {
    const r = await fullPipeline(
      'SELECT count(_timestamp) as "y_axis_1", min(latency) as "y_axis_2", max(latency) as "y_axis_3" FROM "default" WHERE level != \'DEBUG\'',
    );
    expect(r.panelFields!.y.length).toBe(3);
    expect(countConditions(r.panelFields!.filter)).toBe(1);
  });
});

// ============================================================================
// Case 7: SQL ON + >2 GROUP BY → table chart
// ============================================================================

describe("Case 7: SQL ON — >2 GROUP BY → table chart (10 queries)", () => {
  it("Q76: histogram + 2 breakdowns (3 total group by)", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1", level as "z_axis_1", method as "z_axis_2" FROM "default" GROUP BY x_axis_1, z_axis_1, z_axis_2 ORDER BY x_axis_1 ASC',
    );
    expect(r.panelFields!.useTableChart).toBe(true);
    // all group by fields should be on x-axis
    expect(r.panelFields!.x.length).toBe(3);
    expect(r.panelFields!.breakdown.length).toBe(0);
  });

  it("Q77: 3 plain fields + count", async () => {
    const r = await fullPipeline(
      'SELECT level as "x_axis_1", method as "x_axis_2", host as "x_axis_3", count(_timestamp) as "y_axis_1" FROM "default" GROUP BY x_axis_1, x_axis_2, x_axis_3',
    );
    expect(r.panelFields!.useTableChart).toBe(true);
    expect(r.panelFields!.x.length).toBe(3);
    expect(r.panelFields!.y.length).toBe(1);
  });

  it("Q78: 4 group-by fields + sum", async () => {
    const r = await fullPipeline(
      'SELECT level as "x_axis_1", method as "x_axis_2", host as "x_axis_3", path as "x_axis_4", sum(bytes) as "y_axis_1" FROM "default" GROUP BY x_axis_1, x_axis_2, x_axis_3, x_axis_4',
    );
    expect(r.panelFields!.useTableChart).toBe(true);
    expect(r.panelFields!.x.length).toBe(4);
  });

  it("Q79: histogram + 2 breakdowns + filter", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1", k8s_namespace_name as "z_axis_1", k8s_pod_name as "z_axis_2" FROM "default" WHERE level = \'ERROR\' GROUP BY x_axis_1, z_axis_1, z_axis_2 ORDER BY x_axis_1 ASC',
    );
    expect(r.panelFields!.useTableChart).toBe(true);
    expect(countConditions(r.panelFields!.filter)).toBe(1);
  });

  it("Q80: 3 breakdowns + avg", async () => {
    const r = await fullPipeline(
      'SELECT region as "x_axis_1", service as "x_axis_2", endpoint as "x_axis_3", avg(latency) as "y_axis_1" FROM "default" GROUP BY x_axis_1, x_axis_2, x_axis_3',
    );
    expect(r.panelFields!.useTableChart).toBe(true);
    expect(r.panelFields!.y[0].functionName).toBe("avg");
  });

  it("Q81: histogram + 2 breakdowns + two aggregations", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1", avg(response_time) as "y_axis_2", method as "z_axis_1", host as "z_axis_2" FROM "default" GROUP BY x_axis_1, z_axis_1, z_axis_2 ORDER BY x_axis_1 ASC',
    );
    expect(r.panelFields!.useTableChart).toBe(true);
    expect(r.panelFields!.y.length).toBe(2);
  });

  it("Q82: 3 breakdowns + count with complex filter", async () => {
    const r = await fullPipeline(
      'SELECT namespace as "x_axis_1", pod as "x_axis_2", container as "x_axis_3", count(_timestamp) as "y_axis_1" FROM "k8s_logs" WHERE level = \'ERROR\' AND code >= 500 GROUP BY x_axis_1, x_axis_2, x_axis_3',
    );
    expect(r.panelFields!.useTableChart).toBe(true);
    expect(countConditions(r.panelFields!.filter)).toBe(2);
    expect(r.stream).toBe("k8s_logs");
  });

  it("Q83: 5 breakdowns + count", async () => {
    const r = await fullPipeline(
      'SELECT region as "x_axis_1", env as "x_axis_2", service as "x_axis_3", method as "x_axis_4", status as "x_axis_5", count(_timestamp) as "y_axis_1" FROM "default" GROUP BY x_axis_1, x_axis_2, x_axis_3, x_axis_4, x_axis_5',
    );
    expect(r.panelFields!.useTableChart).toBe(true);
    expect(r.panelFields!.x.length).toBe(5);
  });

  it("Q84: exactly 2 group by → NOT table chart", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1", level as "z_axis_1" FROM "default" GROUP BY x_axis_1, z_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(r.panelFields!.useTableChart).toBe(false);
    expect(r.panelFields!.x.length).toBe(1);
    expect(r.panelFields!.breakdown.length).toBe(1);
  });

  it("Q85: exactly 1 group by → NOT table chart", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(r.panelFields!.useTableChart).toBe(false);
    expect(r.panelFields!.x.length).toBe(1);
    expect(r.panelFields!.breakdown.length).toBe(0);
  });
});

// ============================================================================
// Case 9: SQL ON + Multi-stream JOINs → custom mode
// ============================================================================

describe("Case 9: SQL ON — multi-stream JOINs → custom mode (5 queries)", () => {
  it("Q86: INNER JOIN two streams (subquery pattern)", () => {
    expect(
      shouldUseCustomMode(
        'SELECT a.*, b.status FROM "logs" a INNER JOIN (SELECT id, status FROM "users") b ON a.user_id = b.id',
      ),
    ).toBe(true);
  });

  it("Q87: LEFT JOIN with subquery", () => {
    expect(
      shouldUseCustomMode(
        'SELECT a.* FROM "events" a LEFT JOIN (SELECT user_id, max(ts) as last_seen FROM "sessions" GROUP BY user_id) b ON a.user_id = b.user_id',
      ),
    ).toBe(true);
  });

  it("Q88: UNION of two streams", () => {
    expect(
      shouldUseCustomMode(
        'SELECT level, count(*) FROM "errors" GROUP BY level UNION SELECT level, count(*) FROM "warnings" GROUP BY level',
      ),
    ).toBe(true);
  });

  it("Q89: parenthesized nested JOIN", () => {
    expect(
      shouldUseCustomMode(
        'SELECT * FROM "a" JOIN ("b" JOIN "c" ON b.id = c.b_id) ON a.id = b.a_id',
      ),
    ).toBe(true);
  });

  it("Q90: simple JOIN is parseable (not custom mode)", () => {
    expect(
      shouldUseCustomMode(
        'SELECT a.level, b.name FROM "logs" a JOIN "users" b ON a.user_id = b.id',
      ),
    ).toBe(false);
  });
});

// ============================================================================
// extractWhereClause — verify roundtrip for SQL mode toggle
// ============================================================================

describe("extractWhereClause — SQL mode toggle (5 queries)", () => {
  it("Q91: simple equality WHERE", async () => {
    const clause = await extractWhereClause(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE level = \'ERROR\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(clause).toContain("level");
    expect(clause).toContain("ERROR");
    expect(clause).not.toContain("SELECT");
    expect(clause).not.toContain("FROM");
  });

  it("Q92: compound AND WHERE", async () => {
    const clause = await extractWhereClause(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE level = \'ERROR\' AND code = \'500\' GROUP BY x_axis_1',
    );
    expect(clause).toContain("level");
    expect(clause).toContain("code");
    expect(clause).toContain("AND");
  });

  it("Q93: no WHERE clause → empty string", async () => {
    const clause = await extractWhereClause(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" GROUP BY x_axis_1',
    );
    expect(clause).toBe("");
  });

  it("Q94: WHERE with LIKE", async () => {
    const clause = await extractWhereClause(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE message LIKE \'%error%\' GROUP BY x_axis_1',
    );
    expect(clause).toContain("message");
    expect(clause).toContain("LIKE");
  });

  it("Q95: WHERE with IS NOT NULL", async () => {
    const clause = await extractWhereClause(
      'SELECT count(_timestamp) as "y_axis_1" FROM "default" WHERE trace_id IS NOT NULL',
    );
    expect(clause).toContain("trace_id");
    expect(clause).toContain("IS NOT NULL");
  });
});

// ============================================================================
// Edge cases — ensure no fields or filters are lost
// ============================================================================

describe("Edge cases — no fields or filters lost (5 queries)", () => {
  it("Q96: WHERE with str_match_ignore_case", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE str_match_ignore_case(message, \'error\') GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    const conds = flattenConditions(r.panelFields!.filter);
    expect(conds.length).toBe(1);
    expect(conds[0].operator).toBe("str_match_ignore_case");
    expect(conds[0].value).toBe("error");
  });

  it("Q97: multiple y-axis with complex filter", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1", sum(bytes) as "y_axis_2", avg(response_time) as "y_axis_3" FROM "default" WHERE level = \'ERROR\' AND code >= 500 GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(r.panelFields!.y.length).toBe(3);
    expect(countConditions(r.panelFields!.filter)).toBe(2);
    // Verify all y-axis columns
    expect(r.panelFields!.y[0].column).toBe("_timestamp");
    expect(r.panelFields!.y[1].column).toBe("bytes");
    expect(r.panelFields!.y[2].column).toBe("response_time");
  });

  it("Q98: breakdown preserved with filter", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1", k8s_namespace_name as "z_axis_1" FROM "default" WHERE k8s_pod_name = \'nginx\' AND level IN (\'ERROR\', \'WARN\') GROUP BY x_axis_1, z_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(r.panelFields!.breakdown.length).toBe(1);
    expect(r.panelFields!.breakdown[0].column).toBe("k8s_namespace_name");
    expect(countConditions(r.panelFields!.filter)).toBe(2);
    const conds = flattenConditions(r.panelFields!.filter);
    expect(conds.find((c) => c.column.field === "k8s_pod_name")).toBeTruthy();
    expect(
      conds.find(
        (c) => c.column.field === "level" && c.values?.length === 2,
      ),
    ).toBeTruthy();
  });

  it("Q99: all operators in one query preserved", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE level = \'ERROR\' AND response_time > 100 AND method != \'OPTIONS\' AND path LIKE \'/api%\' AND trace_id IS NOT NULL GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(countConditions(r.panelFields!.filter)).toBe(5);
    const conds = flattenConditions(r.panelFields!.filter);
    const ops = conds.map((c) => c.operator);
    expect(ops).toContain("=");
    expect(ops).toContain(">");
    expect(ops).toContain("<>");
    expect(ops).toContain("Starts With");
    expect(ops).toContain("Is Not Null");
  });

  it("Q100: all field types in one query preserved", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1", avg(response_time) as "y_axis_2", max(bytes) as "y_axis_3", method as "z_axis_1" FROM "default" WHERE level = \'ERROR\' GROUP BY x_axis_1, z_axis_1 ORDER BY x_axis_1 ASC',
    );
    // x-axis: histogram
    expect(r.panelFields!.x.length).toBe(1);
    expect(r.panelFields!.x[0].functionName).toBe("histogram");
    // y-axis: 3 aggregations
    expect(r.panelFields!.y.length).toBe(3);
    expect(r.panelFields!.y[0].functionName).toBe("count");
    expect(r.panelFields!.y[1].functionName).toBe("avg");
    expect(r.panelFields!.y[2].functionName).toBe("max");
    // breakdown: method
    expect(r.panelFields!.breakdown.length).toBe(1);
    expect(r.panelFields!.breakdown[0].column).toBe("method");
    // filter: 1 condition
    expect(countConditions(r.panelFields!.filter)).toBe(1);
  });
});

// ============================================================================
// Simple JOINs — parseable, fields + joins extracted
// ============================================================================

describe("Simple JOINs — parseable with fields, filters, join conditions (15 queries)", () => {
  it("Q101: INNER JOIN two streams — fields from both", async () => {
    const r = await fullPipeline(
      'SELECT a.level as "x_axis_1", count(a._timestamp) as "y_axis_1" FROM "logs" a INNER JOIN "users" b ON a.user_id = b.id GROUP BY x_axis_1',
    );
    expect(r.customQuery).toBe(false);
    expect(r.panelFields!.x.length).toBe(1);
    expect(r.panelFields!.y.length).toBe(1);
    expect(r.panelFields!.joins.length).toBe(1);
    expect(r.panelFields!.joins[0].stream).toBe("users");
    expect(r.panelFields!.joins[0].joinType).toBe("inner");
    expect(r.panelFields!.joins[0].conditions.length).toBe(1);
    expect(r.panelFields!.joins[0].conditions[0].operation).toBe("=");
  });

  it("Q102: LEFT JOIN — join type preserved", async () => {
    const r = await fullPipeline(
      'SELECT a.method as "x_axis_1", count(a._timestamp) as "y_axis_1" FROM "requests" a LEFT JOIN "responses" b ON a.req_id = b.req_id GROUP BY x_axis_1',
    );
    expect(r.customQuery).toBe(false);
    expect(r.panelFields!.joins.length).toBe(1);
    expect(r.panelFields!.joins[0].joinType).toBe("left");
    expect(r.panelFields!.joins[0].stream).toBe("responses");
  });

  it("Q103: RIGHT JOIN — join type preserved", async () => {
    const r = await fullPipeline(
      'SELECT b.name as "x_axis_1", count(a._timestamp) as "y_axis_1" FROM "events" a RIGHT JOIN "users" b ON a.user_id = b.id GROUP BY x_axis_1',
    );
    expect(r.customQuery).toBe(false);
    expect(r.panelFields!.joins[0].joinType).toBe("right");
  });

  it("Q104: JOIN with alias — streamAlias preserved", async () => {
    const r = await fullPipeline(
      'SELECT a.level as "x_axis_1", count(a._timestamp) as "y_axis_1" FROM "logs" a JOIN "metadata" m ON a.trace_id = m.trace_id GROUP BY x_axis_1',
    );
    expect(r.panelFields!.joins[0].streamAlias).toBe("m");
    expect(r.panelFields!.joins[0].stream).toBe("metadata");
  });

  it("Q105: JOIN with WHERE filter — both join + filter preserved", async () => {
    const r = await fullPipeline(
      'SELECT a.method as "x_axis_1", count(a._timestamp) as "y_axis_1" FROM "logs" a JOIN "users" b ON a.user_id = b.id WHERE a.level = \'ERROR\' GROUP BY x_axis_1',
    );
    expect(r.panelFields!.joins.length).toBe(1);
    expect(countConditions(r.panelFields!.filter)).toBe(1);
    const conds = flattenConditions(r.panelFields!.filter);
    expect(conds[0].column.field).toBe("level");
  });

  it("Q106: JOIN with multiple ON conditions", async () => {
    const r = await fullPipeline(
      'SELECT a.level as "x_axis_1", count(a._timestamp) as "y_axis_1" FROM "logs" a JOIN "traces" b ON a.trace_id = b.trace_id AND a.span_id = b.span_id GROUP BY x_axis_1',
    );
    expect(r.panelFields!.joins[0].conditions.length).toBe(2);
    expect(r.panelFields!.joins[0].conditions[0].leftField.field).toBe(
      "trace_id",
    );
    expect(r.panelFields!.joins[0].conditions[1].leftField.field).toBe(
      "span_id",
    );
  });

  it("Q107: multiple JOINs (a JOIN b JOIN c) — all extracted", async () => {
    const r = await fullPipeline(
      'SELECT a.level as "x_axis_1", count(a._timestamp) as "y_axis_1" FROM "logs" a JOIN "users" b ON a.user_id = b.id JOIN "sessions" c ON b.id = c.user_id GROUP BY x_axis_1',
    );
    expect(r.customQuery).toBe(false);
    expect(r.panelFields!.joins.length).toBe(2);
    expect(r.panelFields!.joins[0].stream).toBe("users");
    expect(r.panelFields!.joins[1].stream).toBe("sessions");
  });

  it("Q108: JOIN + histogram + count + breakdown + filter", async () => {
    const r = await fullPipeline(
      'SELECT histogram(a._timestamp) as "x_axis_1", count(a._timestamp) as "y_axis_1", a.method as "z_axis_1" FROM "logs" a JOIN "metadata" b ON a.trace_id = b.trace_id WHERE a.level = \'ERROR\' GROUP BY x_axis_1, z_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(r.panelFields!.x.length).toBe(1);
    expect(r.panelFields!.x[0].functionName).toBe("histogram");
    expect(r.panelFields!.y.length).toBe(1);
    expect(r.panelFields!.breakdown.length).toBe(1);
    expect(r.panelFields!.joins.length).toBe(1);
    expect(countConditions(r.panelFields!.filter)).toBe(1);
  });

  it("Q109: JOIN with stream field streamAlias on fields", async () => {
    const r = await parseFields(
      'SELECT a.level, b.name FROM "logs" a JOIN "users" b ON a.user_id = b.id',
    );
    expect(r.fields.length).toBe(2);
    expect(r.fields[0].column).toBe("level");
    expect(r.fields[0].streamAlias).toBe("a");
    expect(r.fields[1].column).toBe("name");
    expect(r.fields[1].streamAlias).toBe("b");
    expect(r.joins.length).toBe(1);
  });

  it("Q110: JOIN with aggregation referencing both streams", async () => {
    const r = await fullPipeline(
      'SELECT a.method as "x_axis_1", count(a._timestamp) as "y_axis_1", sum(b.response_size) as "y_axis_2" FROM "requests" a JOIN "responses" b ON a.req_id = b.req_id GROUP BY x_axis_1',
    );
    expect(r.panelFields!.y.length).toBe(2);
    expect(r.panelFields!.y[0].functionName).toBe("count");
    expect(r.panelFields!.y[1].functionName).toBe("sum");
    expect(r.panelFields!.y[1].column).toBe("response_size");
    expect(r.panelFields!.joins.length).toBe(1);
  });

  it("Q111: LEFT JOIN with complex filter on joined table field", async () => {
    const r = await fullPipeline(
      'SELECT a.level as "x_axis_1", count(a._timestamp) as "y_axis_1" FROM "logs" a LEFT JOIN "alerts" b ON a.alert_id = b.id WHERE a.level = \'ERROR\' AND b.severity = \'critical\' GROUP BY x_axis_1',
    );
    expect(r.panelFields!.joins.length).toBe(1);
    expect(r.panelFields!.joins[0].joinType).toBe("left");
    expect(countConditions(r.panelFields!.filter)).toBe(2);
    const conds = flattenConditions(r.panelFields!.filter);
    expect(conds.find((c) => c.column.field === "level")).toBeTruthy();
    expect(conds.find((c) => c.column.field === "severity")).toBeTruthy();
  });

  it("Q112: three JOINs with filter — all join conditions + filter preserved", async () => {
    const r = await fullPipeline(
      'SELECT a.method as "x_axis_1", count(a._timestamp) as "y_axis_1" FROM "logs" a JOIN "users" b ON a.user_id = b.id JOIN "sessions" c ON b.id = c.user_id JOIN "devices" d ON c.device_id = d.id WHERE a.level = \'ERROR\' GROUP BY x_axis_1',
    );
    expect(r.customQuery).toBe(false);
    expect(r.panelFields!.joins.length).toBe(3);
    expect(r.panelFields!.joins[0].stream).toBe("users");
    expect(r.panelFields!.joins[1].stream).toBe("sessions");
    expect(r.panelFields!.joins[2].stream).toBe("devices");
    expect(countConditions(r.panelFields!.filter)).toBe(1);
  });

  it("Q113: CROSS JOIN", async () => {
    const r = await fullPipeline(
      'SELECT a.level as "x_axis_1", count(a._timestamp) as "y_axis_1" FROM "logs" a CROSS JOIN "config" b GROUP BY x_axis_1',
    );
    expect(r.customQuery).toBe(false);
    expect(r.panelFields!.joins.length).toBe(1);
    expect(r.panelFields!.joins[0].joinType).toBe("cross");
  });

  it("Q114: FULL JOIN with filter", async () => {
    const r = await fullPipeline(
      'SELECT a.level as "x_axis_1", count(a._timestamp) as "y_axis_1" FROM "logs" a FULL JOIN "metrics" b ON a.trace_id = b.trace_id WHERE a.level = \'ERROR\' GROUP BY x_axis_1',
    );
    expect(r.panelFields!.joins[0].joinType).toBe("full");
    expect(countConditions(r.panelFields!.filter)).toBe(1);
  });

  it("Q115: JOIN preserves field streamAlias in aggregation args", async () => {
    const r = await fullPipeline(
      'SELECT histogram(a._timestamp) as "x_axis_1", count(b.request_id) as "y_axis_1" FROM "logs" a JOIN "requests" b ON a.req_id = b.request_id GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(r.panelFields!.y[0].column).toBe("request_id");
    // The args should reference the field from the joined stream
    expect(r.panelFields!.y[0].args[0].value.field).toBe("request_id");
  });
});

// ============================================================================
// CASE/WHEN — parseable as raw fields
// ============================================================================

describe("CASE/WHEN expressions — parseable as raw fields (8 queries)", () => {
  it("Q116: CASE/WHEN in breakdown", async () => {
    const r = await parseFields(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1", CASE WHEN level = \'ERROR\' THEN \'Bad\' ELSE \'Good\' END as "z_axis_1" FROM "default" GROUP BY x_axis_1, z_axis_1 ORDER BY x_axis_1 ASC',
    );
    // Should have 3 fields: histogram, count, CASE
    expect(r.fields.length).toBe(3);
    const caseField = r.fields.find((f: any) => f.type === "raw");
    expect(caseField).toBeTruthy();
    expect(caseField.rawQuery).toContain("CASE");
    expect(caseField.rawQuery).toContain("WHEN");
    expect(caseField.rawQuery).toContain("END");
    expect(caseField.alias).toBe("z_axis_1");
  });

  it("Q117: CASE/WHEN in y-axis", async () => {
    const r = await parseFields(
      'SELECT histogram(_timestamp) as "x_axis_1", CASE WHEN status = \'success\' THEN 1 ELSE 0 END as "y_axis_1" FROM "default" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    const caseField = r.fields.find((f: any) => f.type === "raw");
    expect(caseField).toBeTruthy();
    expect(caseField.rawQuery).toContain("CASE");
  });

  it("Q118: CASE with multiple WHEN branches", async () => {
    const r = await parseFields(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1", CASE WHEN code >= 500 THEN \'5xx\' WHEN code >= 400 THEN \'4xx\' WHEN code >= 300 THEN \'3xx\' ELSE \'2xx\' END as "z_axis_1" FROM "default" GROUP BY x_axis_1, z_axis_1 ORDER BY x_axis_1 ASC',
    );
    const caseField = r.fields.find((f: any) => f.type === "raw");
    expect(caseField).toBeTruthy();
    expect(caseField.rawQuery).toContain("CASE");
    // All branches should be in the raw query
    expect(caseField.rawQuery).toContain("5xx");
    expect(caseField.rawQuery).toContain("4xx");
    expect(caseField.rawQuery).toContain("3xx");
    expect(caseField.rawQuery).toContain("2xx");
  });

  it("Q119: CASE/WHEN with filter — filter preserved alongside raw field", async () => {
    const r = await parseFields(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1", CASE WHEN level = \'ERROR\' THEN \'Bad\' ELSE \'Good\' END as "z_axis_1" FROM "default" WHERE code >= 400 GROUP BY x_axis_1, z_axis_1 ORDER BY x_axis_1 ASC',
    );
    // Fields
    expect(r.fields.length).toBe(3);
    expect(r.fields.find((f: any) => f.type === "raw")).toBeTruthy();
    // Filter
    const conds = flattenConditions(r.filters);
    expect(conds.length).toBe(1);
    expect(conds[0].column.field).toBe("code");
    expect(conds[0].operator).toBe(">=");
  });

  it("Q120: CASE/WHEN — full pipeline classifies as breakdown", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1", CASE WHEN level = \'ERROR\' THEN \'Bad\' ELSE \'Good\' END as "z_axis_1" FROM "default" GROUP BY x_axis_1, z_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(r.customQuery).toBe(false);
    expect(r.panelFields!.x.length).toBe(1);
    expect(r.panelFields!.y.length).toBe(1);
    // CASE/WHEN has no aggregation function → classified as breakdown
    expect(r.panelFields!.breakdown.length).toBe(1);
    expect(r.panelFields!.breakdown[0].type).toBe("raw");
    expect(r.panelFields!.breakdown[0].rawQuery).toContain("CASE");
  });

  it("Q121: CASE/WHEN is NOT detected as custom mode", () => {
    expect(
      shouldUseCustomMode(
        'SELECT CASE WHEN level = \'ERROR\' THEN 1 ELSE 0 END as flag FROM "default"',
      ),
    ).toBe(false);
  });

  it("Q122: CASE/WHEN with string comparison", async () => {
    const r = await parseFields(
      'SELECT CASE WHEN method = \'GET\' THEN \'read\' WHEN method = \'POST\' THEN \'write\' WHEN method = \'DELETE\' THEN \'delete\' ELSE \'other\' END as "op_type" FROM "default"',
    );
    const caseField = r.fields.find((f: any) => f.type === "raw");
    expect(caseField).toBeTruthy();
    expect(caseField.rawQuery).toContain("GET");
    expect(caseField.rawQuery).toContain("POST");
    expect(caseField.rawQuery).toContain("DELETE");
  });

  it("Q123: multiple CASE/WHEN expressions in one query", async () => {
    const r = await parseFields(
      'SELECT CASE WHEN level = \'ERROR\' THEN \'Bad\' ELSE \'Good\' END as "severity", CASE WHEN code >= 500 THEN \'server\' ELSE \'client\' END as "error_type" FROM "default"',
    );
    const rawFields = r.fields.filter((f: any) => f.type === "raw");
    expect(rawFields.length).toBe(2);
  });
});

// ============================================================================
// Custom mode — full pipeline for complex queries
// ============================================================================

describe("Custom mode — full pipeline for unparseable queries (15 queries)", () => {
  // --- Nested functions ---
  it("Q124: nested function ceil(count(field)) → custom mode", async () => {
    const r = await fullPipeline(
      'SELECT ceil(count(_timestamp)) as total FROM "default"',
    );
    expect(r.customQuery).toBe(true);
    expect(r.panelFields).toBeNull();
  });

  it("Q125: nested function round(avg(latency)) → custom mode", async () => {
    const r = await fullPipeline(
      'SELECT round(avg(latency)) as avg_latency FROM "default"',
    );
    expect(r.customQuery).toBe(true);
  });

  it("Q126: nested function floor(sum(bytes)) → custom mode", async () => {
    const r = await fullPipeline(
      'SELECT floor(sum(bytes)) as total_bytes FROM "default"',
    );
    expect(r.customQuery).toBe(true);
  });

  // --- UNION ---
  it("Q127: UNION ALL two streams → custom mode", async () => {
    const r = await fullPipeline(
      'SELECT level, count(*) as cnt FROM "errors" GROUP BY level UNION ALL SELECT level, count(*) as cnt FROM "warnings" GROUP BY level',
    );
    expect(r.customQuery).toBe(true);
  });

  it("Q128: UNION two different aggregations → custom mode", async () => {
    const r = await fullPipeline(
      'SELECT \'errors\' as source, count(*) as cnt FROM "errors" UNION SELECT \'warnings\' as source, count(*) as cnt FROM "warnings"',
    );
    expect(r.customQuery).toBe(true);
  });

  it("Q129: EXCEPT → custom mode", async () => {
    const r = await fullPipeline(
      'SELECT user_id FROM "active_users" EXCEPT SELECT user_id FROM "banned_users"',
    );
    expect(r.customQuery).toBe(true);
  });

  // --- CTE ---
  it("Q130: CTE with simple body → custom mode", async () => {
    const r = await fullPipeline(
      'WITH error_counts AS (\nVALUES (1)\n) SELECT * FROM error_counts',
    );
    expect(r.customQuery).toBe(true);
  });

  it("Q131: CTE with multiple CTEs → custom mode", async () => {
    const result = isQueryParseable(
      'WITH errors AS (\nVALUES (1)\n), warnings AS (\nVALUES (2)\n) SELECT * FROM errors',
    );
    expect(result.isParseable).toBe(false);
  });

  // --- Subqueries ---
  it("Q132: subquery in WHERE → custom mode", async () => {
    const r = await fullPipeline(
      'SELECT * FROM "logs" WHERE user_id IN (SELECT id FROM "admins")',
    );
    expect(r.customQuery).toBe(true);
  });

  it("Q133: subquery in FROM → custom mode", async () => {
    const r = await fullPipeline(
      'SELECT level, cnt FROM (SELECT level, count(*) as cnt FROM "default" GROUP BY level)',
    );
    expect(r.customQuery).toBe(true);
  });

  it("Q134: correlated subquery → custom mode", async () => {
    const r = await fullPipeline(
      'SELECT * FROM "logs" a WHERE EXISTS (SELECT 1 FROM "alerts" b WHERE a.trace_id = b.trace_id)',
    );
    expect(r.customQuery).toBe(true);
  });

  // --- Window functions ---
  it("Q135: ROW_NUMBER() OVER → custom mode", async () => {
    const r = await fullPipeline(
      'SELECT *, ROW_NUMBER() OVER (ORDER BY _timestamp DESC) as rn FROM "default"',
    );
    expect(r.customQuery).toBe(true);
  });

  it("Q136: RANK() OVER PARTITION BY → custom mode", async () => {
    const r = await fullPipeline(
      'SELECT user_id, level, RANK() OVER (PARTITION BY user_id ORDER BY _timestamp DESC) as rnk FROM "default"',
    );
    expect(r.customQuery).toBe(true);
  });

  it("Q137: LAG window function → custom mode", async () => {
    const r = await fullPipeline(
      'SELECT _timestamp, value, LAG(value) OVER (ORDER BY _timestamp) as prev_value FROM "metrics"',
    );
    expect(r.customQuery).toBe(true);
  });

  it("Q138: DENSE_RANK → custom mode", async () => {
    const r = await fullPipeline(
      'SELECT user_id, score, DENSE_RANK() OVER (ORDER BY score DESC) as rank FROM "leaderboard"',
    );
    expect(r.customQuery).toBe(true);
  });
});

// ============================================================================
// Complex nested WHERE — deep filter trees preserved
// ============================================================================

describe("Complex nested WHERE filters — no conditions lost (10 queries)", () => {
  it("Q139: (A OR B) AND C — 3 conditions", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE (level = \'ERROR\' OR level = \'FATAL\') AND code >= 500 GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(countConditions(r.panelFields!.filter)).toBe(3);
  });

  it("Q140: A AND (B OR C) — 3 conditions", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE method = \'POST\' AND (code = \'500\' OR code = \'503\') GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(countConditions(r.panelFields!.filter)).toBe(3);
  });

  it("Q141: (A AND B) OR (C AND D) — 4 conditions", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE (level = \'ERROR\' AND code = \'500\') OR (level = \'WARN\' AND code = \'429\') GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(countConditions(r.panelFields!.filter)).toBe(4);
  });

  it("Q142: A AND B AND C AND D — 4 flat conditions", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE level = \'ERROR\' AND code = \'500\' AND method = \'POST\' AND path = \'/api\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(countConditions(r.panelFields!.filter)).toBe(4);
    const conds = flattenConditions(r.panelFields!.filter);
    expect(conds.map((c) => c.column.field).sort()).toEqual([
      "code",
      "level",
      "method",
      "path",
    ]);
  });

  it("Q143: deeply nested (A OR (B AND C)) AND D — 4 conditions", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE (level = \'ERROR\' OR (code >= 500 AND method = \'POST\')) AND host = \'prod\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(countConditions(r.panelFields!.filter)).toBe(4);
  });

  it("Q144: mixed operators in nested groups", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE level = \'ERROR\' AND (message LIKE \'%timeout%\' OR response_time > 5000) GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(countConditions(r.panelFields!.filter)).toBe(3);
    const conds = flattenConditions(r.panelFields!.filter);
    const ops = conds.map((c) => c.operator);
    expect(ops).toContain("=");
    expect(ops).toContain("Contains");
    expect(ops).toContain(">");
  });

  it("Q145: IS NULL + equality in group", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE (trace_id IS NULL OR span_id IS NOT NULL) AND level = \'ERROR\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(countConditions(r.panelFields!.filter)).toBe(3);
    const conds = flattenConditions(r.panelFields!.filter);
    expect(conds.find((c) => c.operator === "Is Null")).toBeTruthy();
    expect(conds.find((c) => c.operator === "Is Not Null")).toBeTruthy();
    expect(conds.find((c) => c.operator === "=")).toBeTruthy();
  });

  it("Q146: five flat AND conditions — all preserved", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE a = \'1\' AND b = \'2\' AND c = \'3\' AND d = \'4\' AND e = \'5\' GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(countConditions(r.panelFields!.filter)).toBe(5);
  });

  it("Q147: six flat AND conditions — all preserved", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE level = \'ERROR\' AND code = \'500\' AND method = \'POST\' AND path LIKE \'/api%\' AND trace_id IS NOT NULL AND response_time > 1000 GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(countConditions(r.panelFields!.filter)).toBe(6);
  });

  it("Q148: (A OR B OR C) AND D — all preserved", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE (level = \'ERROR\' OR level = \'WARN\' OR level = \'FATAL\') AND code >= 400 GROUP BY x_axis_1 ORDER BY x_axis_1 ASC',
    );
    expect(countConditions(r.panelFields!.filter)).toBe(4);
  });
});

// ============================================================================
// Parseable complex — HAVING clause, LIMIT, multiple aggregations
// ============================================================================

describe("Parseable complex patterns — HAVING, LIMIT (7 queries)", () => {
  it("Q149: HAVING is parseable (not custom mode)", () => {
    expect(
      shouldUseCustomMode(
        'SELECT level, COUNT(*) as cnt FROM "default" GROUP BY level HAVING COUNT(*) > 10',
      ),
    ).toBe(false);
  });

  it("Q150: HAVING with full pipeline — fields extracted", async () => {
    const r = await fullPipeline(
      'SELECT level as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" GROUP BY x_axis_1 HAVING count(_timestamp) > 100',
    );
    expect(r.customQuery).toBe(false);
    expect(r.panelFields!.x.length).toBe(1);
    expect(r.panelFields!.y.length).toBe(1);
  });

  it("Q151: LIMIT does not affect field parsing", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC LIMIT 100',
    );
    expect(r.customQuery).toBe(false);
    expect(r.panelFields!.x.length).toBe(1);
    expect(r.panelFields!.y.length).toBe(1);
  });

  it("Q152: query with HAVING + WHERE — both preserved", async () => {
    const r = await fullPipeline(
      'SELECT level as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" WHERE code >= 400 GROUP BY x_axis_1 HAVING count(_timestamp) > 10',
    );
    expect(r.customQuery).toBe(false);
    expect(countConditions(r.panelFields!.filter)).toBe(1);
  });

  it("Q153: ORDER BY DESC does not affect fields", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "default" GROUP BY x_axis_1 ORDER BY x_axis_1 DESC',
    );
    expect(r.customQuery).toBe(false);
    expect(r.panelFields!.x.length).toBe(1);
    expect(r.panelFields!.y.length).toBe(1);
  });

  it("Q154: multiple aggregations + HAVING + WHERE + breakdown", async () => {
    const r = await fullPipeline(
      'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1", avg(response_time) as "y_axis_2", method as "z_axis_1" FROM "default" WHERE level = \'ERROR\' GROUP BY x_axis_1, z_axis_1 HAVING count(_timestamp) > 5 ORDER BY x_axis_1 ASC',
    );
    expect(r.customQuery).toBe(false);
    expect(r.panelFields!.x.length).toBe(1);
    expect(r.panelFields!.y.length).toBe(2);
    expect(r.panelFields!.breakdown.length).toBe(1);
    expect(countConditions(r.panelFields!.filter)).toBe(1);
  });

  it("Q155: LATERAL JOIN → custom mode", () => {
    expect(
      shouldUseCustomMode(
        'SELECT * FROM "logs" a, LATERAL (SELECT * FROM "events" WHERE events.user_id = a.user_id LIMIT 1) b',
      ),
    ).toBe(true);
  });
});
