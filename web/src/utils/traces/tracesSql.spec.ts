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

import { beforeAll, describe, expect, it } from "vitest";
import {
  analyzeTracesSql,
  buildTracesSql,
  canAddTraceId,
  deriveSpanSet,
  histogramLosesSpans,
  insertTraceIdColumn,
  matchAllToStrMatch,
  missingStreamAfterFrom,
  replaceSqlIdentifier,
  sqlJoinKeyword,
  strayKeywordBeforeWhere,
  withFieldUnits,
  isRowQuery,
  parseTracesSql,
  resultKeys,
  resultShape,
  sqlPaging,
  tracesFilterFromSql,
} from "./tracesSql";

let parser: unknown;

beforeAll(async () => {
  const mod = await import("@openobserve/node-sql-parser/build/datafusionsql");
  parser = new mod.default.Parser();
});

const info = (sql: string) => analyzeTracesSql(sql, parser);

describe("analyzeTracesSql: top-level WHERE slice", () => {
  it("slices the WHERE of a plain query", () => {
    expect(info(`SELECT * FROM "default" WHERE service_name = 'api'`).where).toBe(
      "service_name = 'api'",
    );
  });

  it("returns an empty WHERE when the query has none", () => {
    expect(info(`SELECT * FROM "default" ORDER BY start_time DESC`).where).toBe("");
  });

  it("stops at ORDER BY and LIMIT after the WHERE", () => {
    expect(info(`SELECT * FROM "default" WHERE a = 1 ORDER BY b DESC LIMIT 10`).where).toBe(
      "a = 1",
    );
    expect(info(`select * from "default" where a = 1 limit 5`).where).toBe("a = 1");
  });

  it("stops at GROUP BY and HAVING", () => {
    expect(
      info(`SELECT x, count(*) FROM "default" WHERE a > 2 GROUP BY x HAVING count(*) > 1`).where,
    ).toBe("a > 2");
  });

  it("keeps keywords inside strings", () => {
    expect(
      info(`SELECT * FROM "default" WHERE msg = 'x ORDER BY y LIMIT 3' AND b = 1 ORDER BY c`).where,
    ).toBe("msg = 'x ORDER BY y LIMIT 3' AND b = 1");
  });

  it("keeps an escaped quote inside a string", () => {
    expect(info(`SELECT * FROM "default" WHERE name = 'it''s where' ORDER BY a`).where).toBe(
      "name = 'it''s where'",
    );
  });

  it("drops comments from the slice and ignores keywords inside them", () => {
    expect(
      info(`SELECT * FROM "default" WHERE a = 1 -- ORDER BY nothing\n AND b = 2 /* LIMIT 9 */`)
        .where,
    ).toBe("a = 1  \n AND b = 2");
  });

  it("keeps a nested subquery's own WHERE inside the outer WHERE", () => {
    const sql = `SELECT * FROM "default" WHERE trace_id IN (SELECT trace_id FROM "default" WHERE duration > 100 GROUP BY trace_id) ORDER BY start_time`;
    expect(info(sql).where).toBe(
      `trace_id IN (SELECT trace_id FROM "default" WHERE duration > 100 GROUP BY trace_id)`,
    );
  });

  it("keeps the original quoting of a stream inside a subquery", () => {
    expect(
      info(`SELECT * FROM "default" WHERE x IN (SELECT x FROM "default" WHERE y = 1)`).where,
    ).toContain(`FROM "default"`);
  });

  it("does not take a WHERE from a subquery in FROM", () => {
    expect(info(`SELECT * FROM (SELECT * FROM "default" WHERE a = 1) ORDER BY b`).where).toBe("");
  });

  it("treats CASE WHEN in the select list and the WHERE as part of the text", () => {
    const sql = `SELECT sum(CASE WHEN span_status = 'ERROR' THEN 1 ELSE 0 END) AS errors FROM "default" WHERE CASE WHEN a = 1 THEN true ELSE false END ORDER BY errors`;
    expect(info(sql).where).toBe("CASE WHEN a = 1 THEN true ELSE false END");
  });

  it("stops at a trailing semicolon", () => {
    expect(info(`SELECT * FROM "default" WHERE a = 1;`).where).toBe("a = 1");
  });
});

describe("analyzeTracesSql: query features", () => {
  it("reads the stream named in FROM", () => {
    expect(info(`SELECT * FROM "my stream" WHERE a = 1`).stream).toBe("my stream");
    expect(info(`SELECT * FROM default`).stream).toBe("default");
  });

  it("keeps the typed FROM clause with its alias, up to the next clause", () => {
    expect(info(`SELECT * FROM "default" AS d WHERE d.duration > 1`).fromClause).toBe(
      `"default" AS d`,
    );
    expect(info(`SELECT * FROM "default" d /* x */ ORDER BY d.start_time`).fromClause).toBe(
      `"default" d`,
    );
    expect(info(`SELECT * FROM default;`).fromClause).toBe("default");
    expect(info(`SELECT 1`).fromClause).toBe("");
  });

  it("flags GROUP BY and aggregates", () => {
    const grouped = info(`SELECT x, count(*) FROM "default" GROUP BY x`);
    expect(grouped.groupBy).toBe(true);
    expect(grouped.aggregate).toBe(true);
    expect(info(`SELECT approx_percentile_cont(duration, 0.95) FROM "default"`).aggregate).toBe(
      true,
    );
    expect(info(`SELECT count(*) * 100.0 / 3 AS pct FROM "default"`).aggregate).toBe(true);
    expect(info(`SELECT * FROM "default" WHERE a = 1`).aggregate).toBe(false);
  });

  it("flags JOIN, WITH, UNION, LIMIT and DISTINCT", () => {
    expect(info(`SELECT * FROM "a" JOIN "b" ON a.x = b.x`).join).toBe(true);
    expect(info(`WITH t AS (SELECT * FROM "a") SELECT * FROM t`).with).toBe(true);
    expect(info(`SELECT x FROM "a" UNION SELECT x FROM "b"`).union).toBe(true);
    expect(info(`SELECT * FROM "a" LIMIT 7`).limit).toBe(7);
    expect(info(`SELECT DISTINCT service_name FROM "a"`).distinct).toBe(true);
  });

  it("does not take a function's DISTINCT or a nested LIMIT for the query's", () => {
    const sql = `SELECT count(DISTINCT trace_id) FROM "a" WHERE x IN (SELECT x FROM "a" LIMIT 3)`;
    expect(info(sql).distinct).toBe(false);
    expect(info(sql).limit).toBeNull();
  });

  it("lists the select names in order, aliases first", () => {
    expect(
      info(`SELECT service_name, count(*) AS spans, max(duration) d FROM "a" GROUP BY service_name`)
        .selectNames,
    ).toEqual(["service_name", "spans", "d"]);
  });

  it("marks a select list as explicit only when every item has a name", () => {
    const explicit = (sql: string) => info(sql).selectExplicit;
    expect(explicit(`SELECT service_name, count(*) AS n FROM "a" GROUP BY service_name`)).toBe(
      true,
    );
    expect(explicit(`SELECT * FROM "a"`)).toBe(false);
    expect(explicit(`SELECT t.*, x FROM "a" t`)).toBe(false);
    expect(explicit(`SELECT service_name, count(*) FROM "a" GROUP BY service_name`)).toBe(false);
  });

  it("is not a statement for filter text", () => {
    expect(info(`service_name = 'select'`).isStatement).toBe(false);
  });
});

describe("isRowQuery", () => {
  it("is a row query only when each row is one span", () => {
    expect(isRowQuery(info(`SELECT * FROM "a" WHERE b = 1`))).toBe(true);
    expect(isRowQuery(info(`SELECT x, count(*) FROM "a" GROUP BY x`))).toBe(false);
    expect(isRowQuery(info(`SELECT * FROM (SELECT * FROM "a")`))).toBe(false);
  });
});

describe("deriveSpanSet: the RED span-set ladder", () => {
  const traces = (name: string) => name === "default";
  const derive = (sql: string) => deriveSpanSet(sql, parser, { isTracesStream: traces });
  const set = (sql: string) => {
    const result = derive(sql);
    if (result.kind !== "set") throw new Error(`no span set for ${sql}: ${result.reason}`);
    return result;
  };

  it("rule 2: slices the top-level WHERE and drops ORDER BY, LIMIT and OFFSET", () => {
    const s = set(
      `SELECT * FROM "default" WHERE service_name = 'q' ORDER BY duration DESC LIMIT 10 OFFSET 5`,
    );
    expect(s).toMatchObject({
      subject: "matched",
      with: "",
      from: `"default"`,
      where: "service_name = 'q'",
      keepsSubquery: false,
    });
    expect(s.dropped).toEqual(["orderBy", "limit", "offset"]);
  });

  it("rule 2: drops a window function and QUALIFY, which the parser cannot read", () => {
    const s = set(
      `SELECT *, row_number() OVER (PARTITION BY operation_name ORDER BY duration DESC) AS rn FROM "default" WHERE service_name = 'q' QUALIFY rn = 1`,
    );
    expect(s.where).toBe("service_name = 'q'");
    expect(s.dropped).toEqual(["window", "qualify"]);
  });

  it("rule 2: a plain WHERE drops nothing", () => {
    expect(set(`SELECT * FROM "default" WHERE a = 1`).dropped).toEqual([]);
  });

  it("keeps comments and strings in the WHERE out of the clause detection", () => {
    const s = set(
      `SELECT * FROM "default" WHERE note = 'group by x limit 1' -- order by y\n AND b = 2`,
    );
    expect(s.where).toMatch(/^note = 'group by x limit 1'\s+AND b = 2$/);
    expect(s.dropped).toEqual([]);
  });

  it("rule 3: GROUP BY and HAVING are not applied", () => {
    const s = set(
      `SELECT service_name, count(*) AS spans FROM "default" WHERE span_status = 'ERROR' GROUP BY service_name HAVING count(*) > 100 ORDER BY spans DESC LIMIT 3`,
    );
    expect(s.where).toBe("span_status = 'ERROR'");
    expect(s.dropped).toEqual(["groupBy", "having", "orderBy", "limit"]);
  });

  it("rule 4: DISTINCT is not applied", () => {
    const s = set(`SELECT DISTINCT service_name FROM "default" WHERE span_status = 'ERROR'`);
    expect(s.dropped).toEqual(["distinct"]);
  });

  it("rule 6: a final SELECT over a CTE keeps the WITH and reads FROM the CTE", () => {
    const s = set(
      `WITH slow AS (SELECT * FROM "default" WHERE duration > 1000000) SELECT service_name, count(*) AS c FROM slow WHERE service_name <> 'x' GROUP BY service_name`,
    );
    expect(s).toMatchObject({
      subject: "cte",
      cte: "slow",
      with: `WITH slow AS (SELECT * FROM "default" WHERE duration > 1000000)`,
      from: "slow",
      where: "service_name <> 'x'",
      keepsSubquery: true,
    });
    expect(s.dropped).toEqual(["groupBy"]);
  });

  it("rule 6: a CTE body that aggregates gives the body's WHERE on its stream", () => {
    const s = set(
      `WITH per AS (SELECT service_name, count(*) AS c FROM "default" WHERE duration > 5 GROUP BY service_name) SELECT * FROM per WHERE c > 10`,
    );
    expect(s).toMatchObject({
      subject: "cte",
      cte: "per",
      with: "",
      from: `"default"`,
      where: "duration > 5",
      keepsSubquery: false,
    });
    expect(s.dropped).toEqual(["groupBy", "outerWhere"]);
  });

  it("rule 7: a CTE used as a filter keeps the WITH and the WHERE that reads it", () => {
    const s = set(
      `WITH bad AS (SELECT trace_id FROM "default" WHERE span_status = 'ERROR') SELECT _timestamp, trace_id FROM "default" WHERE service_name = 'querier' AND trace_id IN (SELECT trace_id FROM bad)`,
    );
    expect(s).toMatchObject({
      subject: "matched",
      with: `WITH bad AS (SELECT trace_id FROM "default" WHERE span_status = 'ERROR')`,
      from: `"default"`,
      where: "service_name = 'querier' AND trace_id IN (SELECT trace_id FROM bad)",
      keepsSubquery: true,
    });
    expect(s.dropped).toEqual([]);
  });

  it("rule 6: a CTE named like its stream reads the stream inside its body", () => {
    const s = set(
      `WITH "default" AS (SELECT * FROM "default" WHERE service_name = 'api') SELECT * FROM "default" WHERE duration > 5`,
    );
    expect(s).toMatchObject({
      subject: "cte",
      cte: "default",
      with: `WITH "default" AS (SELECT * FROM "default" WHERE service_name = 'api')`,
      from: `"default"`,
      where: "duration > 5",
      keepsSubquery: true,
    });
  });

  it("rule 6: WITH RECURSIVE gives no span set", () => {
    expect(derive(`WITH RECURSIVE t AS (SELECT * FROM t) SELECT * FROM t`)).toMatchObject({
      kind: "none",
    });
  });

  it("rule 6: a CTE body cannot read a CTE defined after it", () => {
    expect(
      derive(`WITH a AS (SELECT * FROM b), b AS (SELECT * FROM a) SELECT * FROM a WHERE x = 1`),
    ).toMatchObject({ kind: "none" });
  });

  it("rule 8: UNION ALL on one stream ORs the branch WHEREs", () => {
    const s = set(
      `SELECT trace_id, service_name FROM "default" WHERE span_status = 'ERROR' UNION ALL SELECT trace_id, service_name FROM default WHERE service_name = 'alertmanager'`,
    );
    expect(s).toMatchObject({
      subject: "branches",
      branches: 2,
      from: `"default"`,
      where: "(span_status = 'ERROR') OR (service_name = 'alertmanager')",
    });
  });

  it("rule 8: a branch with no WHERE matches every span", () => {
    expect(set(`SELECT a FROM "default" WHERE b = 1 UNION SELECT a FROM "default"`).where).toBe("");
  });

  it("rule 14: UNION across streams and INTERSECT give no span set", () => {
    expect(derive(`SELECT a FROM "default" UNION SELECT a FROM "other"`)).toMatchObject({
      kind: "none",
    });
    expect(derive(`SELECT a FROM "default" INTERSECT SELECT a FROM "default"`)).toMatchObject({
      kind: "none",
      reason: "shape",
    });
  });

  it("rule 9 (d): a trace_id join keeps left spans in traces where the right side matched", () => {
    const s = set(
      `SELECT p._timestamp, p.trace_id, c.operation_name AS child_op FROM "default" p JOIN "default" c ON c.trace_id = p.trace_id AND c.reference_parent_span_id = p.span_id WHERE p.service_name = 'alertmanager' AND c.service_name = 'querier'`,
    );
    expect(s).toMatchObject({
      subject: "joinMatched",
      from: `"default" p`,
      where: `p.service_name = 'alertmanager' AND p.trace_id IN (SELECT DISTINCT c.trace_id FROM "default" c WHERE c.service_name = 'querier')`,
      keepsSubquery: true,
    });
    expect(s.dropped).toEqual([]);
  });

  it("rule 9 (d): a WHERE comparing both sides is not applied", () => {
    const s = set(
      `SELECT * FROM "default" p INNER JOIN "default" c ON p.trace_id = c.trace_id WHERE p.service_name <> c.service_name AND c.duration > 5`,
    );
    expect(s.where).toBe(
      `p.trace_id IN (SELECT DISTINCT c.trace_id FROM "default" c WHERE c.duration > 5)`,
    );
    expect(s.dropped).toEqual(["bothSidesWhere"]);
  });

  it("rule 9 (a): a join on another key keeps the left WHERE only", () => {
    const s = set(
      `SELECT * FROM "default" p JOIN "default" c ON c.reference_parent_span_id = p.span_id WHERE p.service_name = 'a' AND c.service_name BETWEEN 'b' AND 'c'`,
    );
    expect(s).toMatchObject({
      subject: "joinLeft",
      from: `"default" p`,
      where: "p.service_name = 'a'",
      keepsSubquery: false,
    });
    expect(s.dropped).toEqual(["join"]);
  });

  it("rule 10: a subquery in the WHERE is kept, with the stream name inside it verbatim", () => {
    const s = set(
      `SELECT _timestamp, trace_id FROM "default" WHERE service_name = 'querier' AND trace_id IN (SELECT trace_id FROM default WHERE span_status = 'ERROR')`,
    );
    expect(s.where).toBe(
      "service_name = 'querier' AND trace_id IN (SELECT trace_id FROM default WHERE span_status = 'ERROR')",
    );
    expect(s).toMatchObject({ subject: "matched", keepsSubquery: true });
    expect(s.dropped).toEqual([]);
  });

  it("rule 11: a FROM subquery gives the inner WHERE and drops an outer WHERE on a computed column", () => {
    const s = set(
      `SELECT * FROM (SELECT _timestamp, trace_id, row_number() OVER (PARTITION BY service_name ORDER BY duration DESC) AS rn FROM "default" WHERE span_status = 'ERROR') WHERE rn <= 3`,
    );
    expect(s).toMatchObject({
      subject: "inner",
      from: `"default"`,
      where: "span_status = 'ERROR'",
    });
    expect(s.dropped).toEqual(["window", "outerWhere"]);
  });

  it("rule 11: an outer WHERE on a stream column is kept", () => {
    const s = set(
      `SELECT * FROM (SELECT * FROM "default" WHERE span_status = 'ERROR') WHERE service_name = 'a'`,
    );
    expect(s.where).toBe("(span_status = 'ERROR') AND (service_name = 'a')");
    expect(s.dropped).toEqual([]);
  });

  it("rule 14: a FROM that is not a traces stream names the stream", () => {
    expect(derive(`SELECT * FROM "k8s_events" WHERE reason = 'Failed'`)).toEqual({
      kind: "none",
      reason: "notTraces",
      stream: "k8s_events",
    });
  });

  it("rule 14: text the parser cannot read gives no span set", () => {
    expect(derive(`SELECT * FROM "default" WHERE (a = `)).toMatchObject({
      kind: "none",
      reason: "unreadable",
    });
    expect(derive(`service_name = 'a'`)).toMatchObject({ kind: "none", reason: "unreadable" });
  });

  it("treats every stream as a traces stream when no list is given", () => {
    expect(deriveSpanSet(`SELECT * FROM "any" WHERE a = 1`, parser).kind).toBe("set");
  });
});

describe("histogramLosesSpans", () => {
  it("warns on histogram() with a subquery or a CTE", () => {
    expect(
      histogramLosesSpans(
        `SELECT histogram(_timestamp) AS t, count(*) FROM "default" WHERE trace_id IN (SELECT trace_id FROM "default") GROUP BY t`,
      ),
    ).toBe(true);
    expect(
      histogramLosesSpans(
        `WITH x AS (SELECT * FROM "default") SELECT histogram(_timestamp) AS t, count(*) FROM x GROUP BY t`,
      ),
    ).toBe(true);
  });

  it("does not warn on a JOIN, on histogram() alone, or on a subquery alone", () => {
    expect(
      histogramLosesSpans(
        `SELECT histogram(p._timestamp) AS t, count(*) FROM "default" p JOIN "default" c ON p.trace_id = c.trace_id GROUP BY t`,
      ),
    ).toBe(false);
    expect(histogramLosesSpans(`SELECT histogram(_timestamp) AS t FROM "default" GROUP BY t`)).toBe(
      false,
    );
    expect(
      histogramLosesSpans(`SELECT * FROM "default" WHERE a IN (SELECT a FROM "default")`),
    ).toBe(false);
    expect(histogramLosesSpans(`SELECT 'histogram(' FROM "default" WHERE a IN (SELECT 1)`)).toBe(
      false,
    );
  });
});

describe("sqlPaging", () => {
  it("pages a row query with from/size", () => {
    expect(sqlPaging(info(`SELECT * FROM "a"`), 25, 2)).toEqual({
      from: 50,
      size: 25,
      paged: true,
    });
  });

  it("sends size -1 for an aggregate or GROUP BY query", () => {
    expect(sqlPaging(info(`SELECT x, count(*) FROM "a" GROUP BY x`), 25, 3)).toEqual({
      from: 0,
      size: -1,
      paged: false,
    });
    expect(sqlPaging(info(`SELECT count(*) FROM "a"`), 25, 0).size).toBe(-1);
  });

  it("uses the LIMIT as the size and hides paging", () => {
    expect(sqlPaging(info(`SELECT * FROM "a" LIMIT 40`), 25, 1)).toEqual({
      from: 0,
      size: 40,
      paged: false,
    });
  });
});

describe("parseTracesSql", () => {
  it("returns the default result when the text does not parse", () => {
    expect(parseTracesSql("SELECT FROM WHERE (", parser)).toEqual({
      columns: [],
      from: [],
      orderby: null,
      limit: null,
      groupby: null,
      where: null,
    });
  });

  it("returns the default result without a parser", () => {
    expect(parseTracesSql(`SELECT * FROM "a"`, null).columns).toEqual([]);
  });
});

describe("buildTracesSql", () => {
  it("wraps the filter in a SELECT on the stream", () => {
    expect(buildTracesSql("default", "duration > 500000")).toBe(
      `SELECT * FROM "default" WHERE duration > 500000 ORDER BY start_time DESC`,
    );
  });

  it("leaves out WHERE for an empty filter", () => {
    expect(buildTracesSql("default", "  ")).toBe(
      `SELECT * FROM "default" ORDER BY start_time DESC`,
    );
  });
});

describe("insertTraceIdColumn / canAddTraceId", () => {
  it("puts trace_id first in the select list", () => {
    expect(insertTraceIdColumn(`SELECT service_name, duration FROM "a"`)).toBe(
      `SELECT trace_id, service_name, duration FROM "a"`,
    );
    expect(insertTraceIdColumn(`select distinct service_name from "a"`)).toBe(
      `select distinct trace_id, service_name from "a"`,
    );
  });

  it("returns null for text that is not a SELECT", () => {
    expect(insertTraceIdColumn(`a = 1`)).toBeNull();
  });

  it("is offered only without GROUP BY or aggregates", () => {
    expect(canAddTraceId(info(`SELECT service_name FROM "a"`))).toBe(true);
    expect(canAddTraceId(info(`SELECT x, count(*) FROM "a" GROUP BY x`))).toBe(false);
    expect(canAddTraceId(info(`SELECT count(*) FROM "a"`))).toBe(false);
  });

  it("is not offered for DISTINCT, where trace_id would change what counts as a duplicate", () => {
    expect(canAddTraceId(info(`SELECT DISTINCT service_name FROM "default"`))).toBe(false);
  });
});

describe("resultShape / resultKeys", () => {
  it("detects span rows, trace rows and plain rows", () => {
    expect(resultShape(["trace_id", "span_id", "x"])).toBe("spans");
    expect(resultShape(["trace_id", "n"])).toBe("traces");
    expect(resultShape(["service_name", "n"])).toBe("rows");
  });

  it("orders keys by the select list, then by first appearance", () => {
    const hits = [
      { n: 1, service_name: "a" },
      { extra: true, service_name: "b", n: 2 },
    ];
    expect(resultKeys(hits, ["service_name", "n"])).toEqual(["service_name", "n", "extra"]);
    expect(resultKeys(hits, [])).toEqual(["n", "service_name", "extra"]);
  });

  it("shows exactly the selected columns for an explicit select list", () => {
    const hits = [{ _timestamp: 1, service_name: "redis" }];
    expect(resultKeys(hits, ["service_name", "http_status_code"], true)).toEqual([
      "service_name",
      "http_status_code",
    ]);
  });

  it("takes the server's key for a name typed in another case", () => {
    expect(resultKeys([{ service_name: "a" }], ["SERVICE_NAME", "n"], true)).toEqual([
      "service_name",
      "n",
    ]);
  });
});

describe("replaceSqlIdentifier", () => {
  it("replaces every bare use of the column", () => {
    const sql = `SELECT servce_name, count(*) FROM "default" GROUP BY servce_name`;
    expect(replaceSqlIdentifier(sql, "servce_name", "service_name")).toBe(
      `SELECT service_name, count(*) FROM "default" GROUP BY service_name`,
    );
  });

  it("leaves string literals and comments alone", () => {
    const sql = `SELECT servce_name FROM "a" -- servce_name\nWHERE x = 'servce_name'`;
    expect(replaceSqlIdentifier(sql, "servce_name", "service_name")).toBe(
      `SELECT service_name FROM "a" -- servce_name\nWHERE x = 'servce_name'`,
    );
  });

  it("keeps the quotes of a quoted identifier and skips longer names", () => {
    const sql = `SELECT "servce_name", servce_name_x FROM "a"`;
    expect(replaceSqlIdentifier(sql, "servce_name", "service_name")).toBe(
      `SELECT "service_name", servce_name_x FROM "a"`,
    );
  });

  it("matches a bare name in any case, as the server folds it", () => {
    expect(replaceSqlIdentifier(`SELECT Servce_Name FROM "a"`, "servce_name", "service_name")).toBe(
      `SELECT service_name FROM "a"`,
    );
  });
});

describe("matchAllToStrMatch", () => {
  it("rewrites match_all into str_match on the field", () => {
    expect(
      matchAllToStrMatch(
        `SELECT * FROM "default"\nWHERE match_all('PlaceOrder')`,
        "operation_name",
      ),
    ).toEqual({
      sql: `SELECT * FROM "default"\nWHERE str_match(operation_name, 'PlaceOrder')`,
      call: "str_match(operation_name, 'PlaceOrder')",
    });
  });

  it("rewrites every call and keeps the rest of the WHERE", () => {
    const sql = `SELECT * FROM "a" WHERE MATCH_ALL('x') AND duration > 5 OR match_all( 'y' )`;
    expect(matchAllToStrMatch(sql, "operation_name")?.sql).toBe(
      `SELECT * FROM "a" WHERE str_match(operation_name, 'x') AND duration > 5 OR str_match(operation_name, 'y')`,
    );
  });

  it("returns null without a match_all call", () => {
    expect(matchAllToStrMatch(`SELECT * FROM "a" WHERE x = 'match_all(1)'`, "operation_name")).toBe(
      null,
    );
    expect(matchAllToStrMatch(`SELECT * FROM "a" WHERE match_all_raw('x')`, "operation_name")).toBe(
      null,
    );
  });
});

describe("strayKeywordBeforeWhere", () => {
  it("flags an AND between the stream and WHERE", () => {
    const sql = `SELECT * FROM "otel_demo" AND WHERE duration > 100`;
    const start = sql.indexOf("AND");
    expect(strayKeywordBeforeWhere(sql)).toEqual({ start, end: start + 3, word: "AND" });
  });

  it("flags OR after a table alias", () => {
    expect(strayKeywordBeforeWhere(`SELECT * FROM "a" s OR WHERE s.x = 1`)?.word).toBe("OR");
  });

  it("does not flag a well-formed query or a JOIN condition", () => {
    expect(strayKeywordBeforeWhere(`SELECT * FROM "a" WHERE x = 1 AND y = 2`)).toBeNull();
    expect(
      strayKeywordBeforeWhere(
        `SELECT * FROM "a" c JOIN "a" p ON c.t = p.t AND c.s = p.s WHERE c.x = 1`,
      ),
    ).toBeNull();
    expect(strayKeywordBeforeWhere(`SELECT * FROM "a"`)).toBeNull();
  });

  it("ignores a keyword inside a subquery", () => {
    expect(
      strayKeywordBeforeWhere(`SELECT * FROM (SELECT * FROM "a" WHERE x AND y) t WHERE z = 1`),
    ).toBeNull();
  });
});

describe("missingStreamAfterFrom", () => {
  it("flags FROM directly followed by WHERE, in any case", () => {
    expect(missingStreamAfterFrom(`SELECT * FROM WHERE duration > 1`)).toBe(true);
    expect(missingStreamAfterFrom(`select * from\n  where x = 1`)).toBe(true);
  });

  it("ignores a stream named where, strings and comments", () => {
    expect(missingStreamAfterFrom(`SELECT * FROM "where" WHERE x = 1`)).toBe(false);
    expect(missingStreamAfterFrom(`SELECT * FROM "a" WHERE x = 'from where'`)).toBe(false);
    expect(missingStreamAfterFrom(`SELECT * FROM -- where\n "a" WHERE x = 1`)).toBe(false);
    expect(missingStreamAfterFrom(`SELECT * FROM "a" WHERE x = 1`)).toBe(false);
  });
});

describe("sqlJoinKeyword", () => {
  it("finds the JOIN keyword", () => {
    const sql = `SELECT * FROM "a" c LEFT JOIN "a" p ON c.t = p.t`;
    const start = sql.indexOf("JOIN");
    expect(sqlJoinKeyword(sql)).toEqual({ start, end: start + 4 });
  });

  it("returns null without a join, even in a string", () => {
    expect(sqlJoinKeyword(`SELECT * FROM "a" WHERE x = 'join'`)).toBeNull();
  });
});

describe("withFieldUnits", () => {
  it("adds the stored unit to the time fields' type", () => {
    expect(
      withFieldUnits([
        { name: "duration", dataType: "Int64" },
        { name: "start_time", dataType: "Int64" },
        { name: "end_time" },
        { name: "service_name", dataType: "Utf8" },
      ]),
    ).toEqual([
      { name: "duration", dataType: "Int64", type: "Int64 · µs" },
      { name: "start_time", dataType: "Int64", type: "Int64 · ns" },
      { name: "end_time", type: "ns" },
      { name: "service_name", dataType: "Utf8" },
    ]);
  });
});

describe("tracesFilterFromSql", () => {
  const from = (sql: string) => tracesFilterFromSql(sql, parser);

  it("copies the top-level WHERE as typed, without its comments", () => {
    expect(
      from(`SELECT service_name, count(*) FROM "default"
WHERE duration > 500000 -- slow
  AND service_name = 'a''b'
GROUP BY service_name HAVING count(*) > 3`),
    ).toEqual({ filter: "duration > 500000  \n  AND service_name = 'a''b'", problem: null });
  });

  it("skips a WHERE inside FILTER (...)", () => {
    expect(
      from(`SELECT count(*) FILTER (WHERE span_status = 'ERROR') FROM "default" WHERE a = 1`),
    ).toEqual({ filter: "a = 1", problem: null });
  });

  it("has no usable WHERE without one, or with a subquery, CTE, FROM subquery, UNION, JOIN or alias", () => {
    for (const sql of [
      `SELECT trace_id, count(*) FROM "default" GROUP BY trace_id HAVING count(*) > 450`,
      `SELECT * FROM "default" WHERE trace_id IN (SELECT trace_id FROM "default" WHERE a = 1)`,
      `WITH t AS (SELECT * FROM "default" WHERE a = 1) SELECT * FROM t WHERE b = 2`,
      `SELECT * FROM (SELECT * FROM "default" WHERE a = 1) WHERE b = 2`,
      `SELECT * FROM "default" WHERE a = 1 UNION SELECT * FROM "default" WHERE b = 2`,
      `SELECT * FROM "default" c JOIN "default" p ON c.parent = p.span_id WHERE c.a = 1`,
      `SELECT * FROM "default" d WHERE d.service_name = 'api'`,
    ]) {
      expect(from(sql), sql).toEqual({ filter: "", problem: "noWhere" });
    }
  });

  it("cannot read text the parser rejects, or text that is not a statement", () => {
    expect(from(`SELECT * FROM "default" WHERE (a = 1`)).toEqual({
      filter: "",
      problem: "unreadable",
    });
    expect(from("service_name = 'api'")).toEqual({ filter: "", problem: "unreadable" });
  });

  it("keeps a decimal number and a string with a dot", () => {
    expect(from(`SELECT * FROM "default" WHERE a > 1.5 AND b = 'x.y'`)).toEqual({
      filter: "a > 1.5 AND b = 'x.y'",
      problem: null,
    });
  });
});
