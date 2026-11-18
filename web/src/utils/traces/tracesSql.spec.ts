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
  groupsByTraceIdOnly,
  insertTraceIdColumn,
  insertWhereCondition,
  matchAllToStrMatch,
  withAllFieldRefs,
  missingStreamAfterFrom,
  fieldHasOtherCondition,
  fieldValuesCondition,
  filterHasSubquery,
  hasOwnCondition,
  replaceOwnCondition,
  replaceSqlIdentifier,
  sqlJoinKeyword,
  strayKeywordBeforeWhere,
  withFieldUnits,
  isRowQuery,
  parseTracesSql,
  resultKeys,
  resultShape,
  sqlPaging,
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
  it("keeps the WITH clause as typed, ahead of the main SELECT", () => {
    expect(
      info(`WITH s AS (SELECT * FROM "d" WHERE a = 1) SELECT * FROM s WHERE b = 2`).withClause,
    ).toBe(`WITH s AS (SELECT * FROM "d" WHERE a = 1)`);
    expect(info(`SELECT * FROM "d"`).withClause).toBe("");
  });

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
  it("is false for OFFSET, as the WHERE count no longer describes the rows", () => {
    expect(isRowQuery(info(`SELECT * FROM "a" OFFSET 10`))).toBe(false);
  });

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
  it("does not page a query with OFFSET and no LIMIT by from", () => {
    expect(sqlPaging(info(`SELECT * FROM "a" ORDER BY start_time OFFSET 10`), 25, 2)).toEqual({
      from: 0,
      size: -1,
      paged: false,
    });
  });

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

describe("insertWhereCondition", () => {
  const cond = "service_name = 'api'";

  it("creates a WHERE after FROM when there is none", () => {
    expect(insertWhereCondition(`SELECT * FROM "default"`, cond)).toBe(
      `SELECT * FROM "default" WHERE service_name = 'api'`,
    );
    expect(insertWhereCondition(`SELECT * FROM "default";`, cond)).toBe(
      `SELECT * FROM "default" WHERE service_name = 'api';`,
    );
  });

  it("adds to a plain WHERE", () => {
    expect(insertWhereCondition(`SELECT * FROM "default" WHERE duration > 5`, cond)).toBe(
      `SELECT * FROM "default" WHERE duration > 5 AND service_name = 'api'`,
    );
  });

  it("wraps a WHERE with a top-level OR so the new condition narrows all of it", () => {
    expect(insertWhereCondition(`SELECT * FROM "default" WHERE a = 1 OR b = 2`, cond)).toBe(
      `SELECT * FROM "default" WHERE (a = 1 OR b = 2) AND service_name = 'api'`,
    );
    expect(insertWhereCondition(`SELECT * FROM "default" WHERE (a = 1 OR b = 2)`, cond)).toBe(
      `SELECT * FROM "default" WHERE (a = 1 OR b = 2) AND service_name = 'api'`,
    );
  });

  it("puts the condition before GROUP BY, ORDER BY and LIMIT, with or without a WHERE", () => {
    const grouped = `SELECT service_name, count(*) AS n FROM "default"\nWHERE duration > 5\nGROUP BY service_name\nORDER BY n DESC\nLIMIT 10`;
    expect(insertWhereCondition(grouped, cond)).toBe(
      `SELECT service_name, count(*) AS n FROM "default"\nWHERE duration > 5 AND service_name = 'api'\nGROUP BY service_name\nORDER BY n DESC\nLIMIT 10`,
    );
    const bare = `SELECT trace_id FROM "default"\nGROUP BY trace_id\nHAVING count(*) > 200\nORDER BY trace_id\nLIMIT 100`;
    expect(insertWhereCondition(bare, cond)).toBe(
      `SELECT trace_id FROM "default" WHERE service_name = 'api'\nGROUP BY trace_id\nHAVING count(*) > 200\nORDER BY trace_id\nLIMIT 100`,
    );
  });

  it("leaves a subquery in the WHERE alone", () => {
    const sql = `SELECT * FROM "default" WHERE trace_id IN (SELECT trace_id FROM "default" WHERE span_status = 'ERROR') ORDER BY start_time`;
    expect(insertWhereCondition(sql, cond)).toBe(
      `SELECT * FROM "default" WHERE trace_id IN (SELECT trace_id FROM "default" WHERE span_status = 'ERROR') AND service_name = 'api' ORDER BY start_time`,
    );
  });

  it("adds to the main statement of a CTE, not to the CTE body", () => {
    const sql = `WITH slow AS (SELECT * FROM "default" WHERE duration > 5) SELECT * FROM slow LIMIT 10`;
    expect(insertWhereCondition(sql, cond)).toBe(
      `WITH slow AS (SELECT * FROM "default" WHERE duration > 5) SELECT * FROM slow WHERE service_name = 'api' LIMIT 10`,
    );
  });

  it("never touches a CASE WHEN on the same field", () => {
    const sql = `SELECT sum(CASE WHEN service_name = 'db' THEN 1 ELSE 0 END) AS db FROM "default" WHERE span_status = 'ERROR'`;
    expect(insertWhereCondition(sql, cond)).toBe(
      `SELECT sum(CASE WHEN service_name = 'db' THEN 1 ELSE 0 END) AS db FROM "default" WHERE span_status = 'ERROR' AND service_name = 'api'`,
    );
  });

  it("reads a where inside a string or a comment as text", () => {
    const sql = `SELECT * FROM "default" WHERE operation_name = 'where to go' -- where else\nORDER BY start_time`;
    expect(insertWhereCondition(sql, "service_name != 'api'")).toBe(
      `SELECT * FROM "default" WHERE operation_name = 'where to go' AND service_name != 'api' -- where else\nORDER BY start_time`,
    );
    expect(insertWhereCondition(`SELECT 'where' AS w FROM "default"`, cond)).toBe(
      `SELECT 'where' AS w FROM "default" WHERE service_name = 'api'`,
    );
  });

  it("returns null where there is no single top-level WHERE to add to", () => {
    expect(insertWhereCondition("", cond)).toBeNull();
    expect(insertWhereCondition("service_name = 'a'", cond)).toBeNull();
    expect(insertWhereCondition(`SELECT 1`, cond)).toBeNull();
    expect(insertWhereCondition(`SELECT a FROM "x" UNION ALL SELECT a FROM "y"`, cond)).toBeNull();
  });
});

describe("fieldValuesCondition", () => {
  it("writes = for one value and IN for several, escaping quotes", () => {
    expect(fieldValuesCondition("service_name", ["api"], false)).toBe("service_name = 'api'");
    expect(fieldValuesCondition("service_name", ["api", "o'k"], false)).toBe(
      "service_name IN ('api','o''k')",
    );
  });

  it("writes != and NOT IN for excluded values", () => {
    expect(fieldValuesCondition("s", ["a"], true)).toBe("s != 'a'");
    expect(fieldValuesCondition("s", ["a", "b"], true)).toBe("s NOT IN ('a','b')");
  });

  it("reads the null value as IS NULL, bracketed beside a list", () => {
    expect(fieldValuesCondition("s", ["null"], false)).toBe("s IS NULL");
    expect(fieldValuesCondition("s", ["null"], true)).toBe("s IS NOT NULL");
    expect(fieldValuesCondition("s", ["a", "null"], false)).toBe("(s = 'a' OR s IS NULL)");
    expect(fieldValuesCondition("s", ["a", "b", "null"], true)).toBe(
      "(s NOT IN ('a','b') AND s IS NOT NULL)",
    );
  });

  it("is empty with no values", () => {
    expect(fieldValuesCondition("s", [], false)).toBe("");
  });
});

describe("replaceOwnCondition / hasOwnCondition", () => {
  const from = `SELECT * FROM "default"`;
  const own = "service_name IN ('a','b')";

  it("finds its own condition only as a whole top-level AND part with the same text", () => {
    expect(hasOwnCondition(`${from} WHERE a = 1 AND ${own} ORDER BY x`, own)).toBe(true);
    expect(hasOwnCondition(`${from} WHERE ${own}`, own)).toBe(true);
    expect(hasOwnCondition(`${from} WHERE service_name IN ('a', 'b')`, own)).toBe(false);
    expect(hasOwnCondition(`${from} WHERE ${own} OR a = 1`, own)).toBe(false);
    expect(hasOwnCondition(`${from} WHERE x = '${"service_name IN"}'`, own)).toBe(false);
    expect(hasOwnCondition("", own)).toBe(false);
  });

  it("swaps only its own condition, leaving the typed ones and their spelling", () => {
    expect(
      replaceOwnCondition(
        `${from} WHERE a = 1 /* keep */ AND ${own} ORDER BY x`,
        own,
        "service_name = 'a'",
      ),
    ).toBe(`${from} WHERE a = 1 /* keep */ AND service_name = 'a' ORDER BY x`);
  });

  it("removes its own condition with its AND, or the WHERE when it was alone", () => {
    expect(replaceOwnCondition(`${from} WHERE a = 1 AND ${own} LIMIT 5`, own, "")).toBe(
      `${from} WHERE a = 1 LIMIT 5`,
    );
    expect(replaceOwnCondition(`${from} WHERE ${own} AND a = 1`, own, "")).toBe(
      `${from} WHERE a = 1`,
    );
    expect(replaceOwnCondition(`${from} WHERE ${own} ORDER BY x`, own, "")).toBe(
      `${from} ORDER BY x`,
    );
  });

  it("returns null when its own condition is not there", () => {
    expect(replaceOwnCondition(`${from} WHERE a = 1`, own, "")).toBeNull();
    expect(replaceOwnCondition(`${from} WHERE (${own})`, own, "x = 1")).toBeNull();
  });
});

describe("fieldHasOtherCondition", () => {
  const from = `SELECT * FROM "default"`;

  it("sees a typed condition on the field outside the page's own one", () => {
    const own = "service_name = 'b'";
    expect(
      fieldHasOtherCondition(`${from} WHERE service_name = 'a' AND ${own}`, "service_name", own),
    ).toBe(true);
    expect(fieldHasOtherCondition(`${from} WHERE a = 1 AND ${own}`, "service_name", own)).toBe(
      false,
    );
    expect(fieldHasOtherCondition(`${from} WHERE x = 'service_name'`, "service_name", own)).toBe(
      false,
    );
  });

  it("sees a typed json_get read of a field stored in _all", () => {
    const ref = "json_get_str(_all, 'route')";
    const own = `${ref} = 'b'`;
    expect(
      fieldHasOtherCondition(
        `${from} WHERE JSON_GET_STR(_all, 'route') = 'a' AND ${own}`,
        "route",
        own,
        ref,
      ),
    ).toBe(true);
  });
});

describe("filterHasSubquery", () => {
  it("finds IN (SELECT ...) in a filter with the parser", () => {
    expect(
      filterHasSubquery(
        `trace_id IN (SELECT trace_id FROM "default" WHERE span_status = 'ERROR')`,
        parser,
      ),
    ).toBe(true);
    expect(filterHasSubquery(`a = 1 AND (b = 2 OR c IN (SELECT c FROM "x"))`, parser)).toBe(true);
  });

  it("is not fooled by SELECT inside a string or a plain IN list", () => {
    expect(filterHasSubquery(`db_statement = 'x IN (SELECT 1)'`, parser)).toBe(false);
    expect(filterHasSubquery(`service_name IN ('a','b')`, parser)).toBe(false);
    expect(filterHasSubquery("", parser)).toBe(false);
  });
});

describe("groupsByTraceIdOnly", () => {
  it("is true only when the top-level GROUP BY is trace_id alone", () => {
    expect(
      groupsByTraceIdOnly(`SELECT trace_id FROM "a" GROUP BY trace_id HAVING count(*) > 1`),
    ).toBe(true);
    expect(groupsByTraceIdOnly(`SELECT trace_id FROM "a" GROUP BY "trace_id" LIMIT 5`)).toBe(true);
    expect(
      groupsByTraceIdOnly(`SELECT trace_id FROM "a" GROUP BY trace_id, reference_parent_span_id`),
    ).toBe(false);
    expect(groupsByTraceIdOnly(`SELECT trace_id FROM "a"`)).toBe(false);
    expect(
      groupsByTraceIdOnly(
        `SELECT * FROM "a" WHERE trace_id IN (SELECT trace_id FROM "a" GROUP BY trace_id)`,
      ),
    ).toBe(false);
  });
});

describe("withAllFieldRefs", () => {
  const refs = new Map([["http_status_code", "json_get_int(_all, 'http_status_code')"]]);

  it("reads an _all field through its json_get expression, keeping strings and other names", () => {
    expect(withAllFieldRefs("http_status_code = '500'", refs)).toBe(
      "json_get_int(_all, 'http_status_code') = '500'",
    );
    expect(withAllFieldRefs("(http_status_code='1' or http_status_code='2')", refs)).toBe(
      "(json_get_int(_all, 'http_status_code')='1' or json_get_int(_all, 'http_status_code')='2')",
    );
    expect(withAllFieldRefs("service_name = 'http_status_code'", refs)).toBe(
      "service_name = 'http_status_code'",
    );
    expect(withAllFieldRefs("http_status_code is null", new Map())).toBe(
      "http_status_code is null",
    );
  });
});
