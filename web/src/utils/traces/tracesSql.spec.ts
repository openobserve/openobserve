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
  buildTraceSelectorSql,
  canAddTraceId,
  insertTraceIdColumn,
  isRedEligible,
  isRowQuery,
  parseTracesSql,
  resultKeys,
  resultShape,
  sqlPaging,
  sqlToFilter,
  cleanTraceSelectorSql,
  traceIdSuggestion,
  traceSelector,
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

  it("flags a plain SELECT * with only WHERE and ORDER BY", () => {
    expect(
      info(`SELECT * FROM "default" WHERE a = 1 ORDER BY start_time DESC`).plainSelectAll,
    ).toBe(true);
    expect(info(`select * from "default"`).plainSelectAll).toBe(true);
    expect(info(`SELECT trace_id FROM "default"`).plainSelectAll).toBe(false);
    expect(info(`SELECT * FROM "default" LIMIT 1`).plainSelectAll).toBe(false);
    expect(info(`SELECT * FROM "default" d WHERE a = 1`).plainSelectAll).toBe(false);
  });

  it("is not a statement for filter text", () => {
    expect(info(`service_name = 'select'`).isStatement).toBe(false);
  });
});

describe("isRowQuery / isRedEligible", () => {
  it("accepts a plain query and a subquery in WHERE", () => {
    expect(isRedEligible(info(`SELECT * FROM "a" WHERE b = 1`))).toBe(true);
    expect(isRedEligible(info(`SELECT * FROM "a" WHERE t IN (SELECT t FROM "a" GROUP BY t)`))).toBe(
      true,
    );
    expect(isRedEligible(info(`SELECT trace_id, duration FROM "a" WHERE b = 1`))).toBe(true);
  });

  it("collapses for GROUP BY, aggregates, JOIN, WITH, UNION, LIMIT and DISTINCT", () => {
    for (const sql of [
      `SELECT x, count(*) FROM "a" GROUP BY x`,
      `SELECT count(*) FROM "a"`,
      `SELECT * FROM "a" JOIN "b" ON a.x = b.x`,
      `WITH t AS (SELECT * FROM "a") SELECT * FROM t`,
      `SELECT x FROM "a" UNION SELECT x FROM "b"`,
      `SELECT * FROM "a" LIMIT 10`,
      `SELECT DISTINCT x FROM "a"`,
    ]) {
      expect(isRedEligible(info(sql)), sql).toBe(false);
    }
  });

  it("collapses when the server says the query is not eligible", () => {
    expect(isRedEligible(info(`SELECT * FROM "a"`), false)).toBe(false);
    expect(isRedEligible(info(`SELECT * FROM "a"`), true)).toBe(true);
  });

  it("is a row query only when each row is one span", () => {
    expect(isRowQuery(info(`SELECT * FROM "a"`))).toBe(true);
    expect(isRowQuery(info(`SELECT * FROM (SELECT * FROM "a")`))).toBe(false);
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

describe("buildTraceSelectorSql", () => {
  it("selects the trace_id of the spans the filter matches", () => {
    expect(buildTraceSelectorSql('my"stream', "duration > 500000")).toBe(
      `SELECT trace_id FROM "my""stream" WHERE duration > 500000`,
    );
  });

  it("leaves out WHERE for an empty filter, and passes the selector check", () => {
    const sql = buildTraceSelectorSql("default", "  ");
    expect(sql).toBe(`SELECT trace_id FROM "default"`);
    expect(traceSelector(sql, parser).problem).toBeNull();
  });
});

describe("sqlToFilter", () => {
  it("converts a plain SELECT * silently", () => {
    expect(sqlToFilter(info(`SELECT * FROM "default" WHERE a = 1 ORDER BY b`), "default")).toEqual({
      filter: "a = 1",
      dropped: [],
    });
  });

  it("converts the Traces view selector silently, in the Traces view only", () => {
    const sql = `SELECT trace_id FROM "default" WHERE duration > 5000;`;
    expect(sqlToFilter(info(sql), "default", true)).toEqual({
      filter: "duration > 5000",
      dropped: [],
    });
    expect(sqlToFilter(info(`SELECT trace_id FROM "default"`), "default", true)).toEqual({
      filter: "",
      dropped: [],
    });
    expect(sqlToFilter(info(sql), "default").dropped).toEqual(["columns"]);
  });

  it.each([
    `SELECT trace_id FROM "default" WHERE a = 1 ORDER BY start_time`,
    `SELECT trace_id FROM "default" WHERE a = 1 LIMIT 5`,
    `SELECT trace_id, service_name FROM "default" WHERE a = 1`,
    `SELECT span_id AS trace_id FROM "default"`,
    `SELECT DISTINCT trace_id FROM "default"`,
    `SELECT trace_id FROM "default" GROUP BY trace_id`,
    `SELECT trace_id FROM "other" WHERE a = 1`,
    `SELECT trace_id FROM "default" t WHERE t.a = 1`,
  ])("still asks before dropping more than the selector from %s", (sql) => {
    expect(sqlToFilter(info(sql), "default", true).dropped).not.toEqual([]);
  });

  it("names what a grouped query drops and keeps its WHERE", () => {
    const result = sqlToFilter(
      info(`SELECT x, count(*) AS n FROM "default" WHERE a = 1 GROUP BY x LIMIT 5`),
      "default",
    );
    expect(result.filter).toBe("a = 1");
    expect(result.dropped).toEqual(["columns", "grouping", "limit"]);
  });

  it("names joins, distinct, WITH, UNION and another stream", () => {
    expect(sqlToFilter(info(`SELECT * FROM "a" JOIN "b" ON a.x = b.x`), "a").dropped).toEqual([
      "joins",
    ]);
    expect(sqlToFilter(info(`SELECT DISTINCT x FROM "a"`), "a").dropped).toEqual([
      "columns",
      "distinct",
    ]);
    expect(sqlToFilter(info(`WITH t AS (SELECT * FROM "a") SELECT * FROM t`), "a").dropped).toEqual(
      ["with", "stream"],
    );
    expect(sqlToFilter(info(`SELECT * FROM "b"`), "a").dropped).toEqual(["stream"]);
  });

  it("falls back to 'other' when nothing named explains the difference", () => {
    expect(sqlToFilter(info(`SELECT * FROM "a" t WHERE x = 1`), "a")).toEqual({
      filter: "x = 1",
      dropped: ["other"],
    });
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
});

describe("cleanTraceSelectorSql", () => {
  it("removes line and block comments and the trailing semicolon", () => {
    const sql = `-- big traces\nSELECT trace_id /* ids */ FROM "default" -- tail\nGROUP BY trace_id;`;
    expect(cleanTraceSelectorSql(sql)).toEqual({
      sql: `SELECT trace_id   FROM "default"  \nGROUP BY trace_id`,
      quotedMarker: false,
      extraStatement: false,
    });
  });

  it("removes several trailing semicolons with spaces between them", () => {
    expect(cleanTraceSelectorSql(`SELECT trace_id FROM "a" ; ;`).sql).toBe(
      `SELECT trace_id FROM "a"`,
    );
  });

  it("flags -- and ; inside a string literal and leaves the string as typed", () => {
    const dashes = cleanTraceSelectorSql(`SELECT trace_id FROM "a" WHERE x = 'a--b'`);
    expect(dashes.quotedMarker).toBe(true);
    expect(dashes.sql).toBe(`SELECT trace_id FROM "a" WHERE x = 'a--b'`);
    expect(cleanTraceSelectorSql(`SELECT trace_id FROM "a" WHERE x = 'a;b'`).quotedMarker).toBe(
      true,
    );
    expect(cleanTraceSelectorSql(`SELECT trace_id FROM "a--b"`).quotedMarker).toBe(true);
  });

  it("reads an escaped quote as part of the string", () => {
    const out = cleanTraceSelectorSql(`SELECT trace_id FROM "a" WHERE x = 'it''s -- here'`);
    expect(out.quotedMarker).toBe(true);
    const clean = cleanTraceSelectorSql(`SELECT trace_id FROM "a" WHERE x = 'it''s' -- note`);
    expect(clean).toEqual({
      sql: `SELECT trace_id FROM "a" WHERE x = 'it''s'`,
      quotedMarker: false,
      extraStatement: false,
    });
  });

  it("keeps comment markers that sit inside a string out of the comment strip", () => {
    const out = cleanTraceSelectorSql(`SELECT trace_id FROM "a" WHERE x = '/* not */'`);
    expect(out.sql).toBe(`SELECT trace_id FROM "a" WHERE x = '/* not */'`);
    expect(out.quotedMarker).toBe(false);
  });

  it("flags a semicolon between two statements", () => {
    expect(
      cleanTraceSelectorSql(`SELECT trace_id FROM "a"; SELECT trace_id FROM "b"`).extraStatement,
    ).toBe(true);
  });
});

describe("traceSelector", () => {
  const select = (sql: string) => traceSelector(sql, parser);

  it("wraps a single trace_id column as trace_id IN (...)", () => {
    expect(
      select(`SELECT trace_id FROM "default" GROUP BY trace_id HAVING count(*) > 200;`),
    ).toEqual({
      filter: `trace_id IN (SELECT trace_id FROM "default" GROUP BY trace_id HAVING count(*) > 200)`,
      problem: null,
    });
  });

  it("reads trace_id from a derived table when the query returns more columns", () => {
    const sql = `SELECT trace_id, service_name FROM "default" WHERE duration > 2000`;
    expect(select(sql).filter).toBe(`trace_id IN (SELECT trace_id FROM (${sql}))`);
  });

  it("accepts a table-qualified or aliased trace_id", () => {
    expect(select(`SELECT t.trace_id FROM "default" t WHERE t.duration > 1`).problem).toBeNull();
    expect(select(`SELECT "trace_id" FROM "default"`).problem).toBeNull();
    const aliased = `SELECT t.trace_id AS trace_id, t.duration FROM "default" t`;
    expect(select(aliased)).toEqual({
      filter: `trace_id IN (SELECT trace_id FROM (${aliased}))`,
      problem: null,
    });
  });

  it("rejects SELECT *", () => {
    expect(select(`SELECT * FROM "default" WHERE a = 1`)).toEqual({
      filter: "",
      problem: "selectAll",
    });
  });

  it("rejects a query without a trace_id column", () => {
    expect(select(`SELECT service_name, duration FROM "default"`).problem).toBe("noTraceId");
    expect(select(`SELECT trace_id AS tid, duration FROM "default"`).problem).toBe("noTraceId");
  });

  it("rejects WITH, UNION, EXPLAIN, several statements and non-SELECT text", () => {
    for (const sql of [
      `WITH x AS (SELECT trace_id FROM "a") SELECT trace_id FROM x`,
      `SELECT trace_id FROM "a" UNION SELECT trace_id FROM "b"`,
      `EXPLAIN SELECT trace_id FROM "a"`,
      `SELECT trace_id FROM "a"; SELECT trace_id FROM "b"`,
      `service_name = 'api'`,
    ]) {
      expect(select(sql).problem).toBe("notSingleSelect");
    }
  });

  it("blocks -- or ; inside a string before anything else", () => {
    expect(select(`SELECT trace_id FROM "a" WHERE x = 'a;b'`)).toEqual({
      filter: "",
      problem: "quotedMarker",
    });
  });

  it("sends text the parser cannot read and leaves the verdict to the server", () => {
    const sql = `SELECT trace_id FROM "a" WHERE x = ANY_UNKNOWN_SYNTAX ((`;
    expect(select(sql)).toEqual({ filter: `trace_id IN (${sql})`, problem: null });
  });
});

describe("traceIdSuggestion", () => {
  it("diffs the SELECT line with trace_id first", () => {
    const sql = `SELECT service_name, operation_name, duration, start_time\nFROM "default"\nWHERE duration > 2000000`;
    expect(traceIdSuggestion(sql)).toEqual({
      before: "SELECT service_name, operation_name, duration, start_time",
      after: "SELECT trace_id, service_name, operation_name, duration, start_time",
    });
  });

  it("finds the SELECT line below a comment", () => {
    expect(traceIdSuggestion(`-- spans\nselect duration from "a"`)).toEqual({
      before: 'select duration from "a"',
      after: 'select trace_id, duration from "a"',
    });
  });

  it("returns null for text that is not a SELECT", () => {
    expect(traceIdSuggestion("a = 1")).toBeNull();
  });
});
