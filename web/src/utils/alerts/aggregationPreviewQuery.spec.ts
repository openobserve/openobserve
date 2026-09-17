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

import { describe, expect, it } from "vitest";
import {
  buildCountChartQuery,
  cleanAggregationQuery,
  withCompositeGroupLabel,
} from "./aggregationPreviewQuery";

/** Quote count must stay even, or the SQL parser hits "Unterminated string literal". */
const quotesBalanced = (sql: string) => (sql.match(/'/g) || []).length % 2 === 0;

/** Paren count must net to zero, or the rewrite cut the statement mid-expression. */
const parensBalanced = (sql: string) =>
  [...sql].reduce((d, c) => d + (c === "(" ? 1 : c === ")" ? -1 : 0), 0) === 0;

describe("buildCountChartQuery", () => {
  const STREAM = 'FROM "default"';

  it("replaces the projection with a bucketed count and keeps the WHERE clause", () => {
    const out = buildCountChartQuery(
      `SELECT _timestamp, log ${STREAM} WHERE k8s_container_name = 'controller'`,
    ) as string;
    expect(out).toBe(
      'SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_num FROM "default" ' +
        "WHERE k8s_container_name = 'controller' GROUP BY zo_sql_key",
    );
  });

  it("drops a trailing ORDER BY / LIMIT, which would truncate the series", () => {
    const out = buildCountChartQuery(
      `SELECT _timestamp ${STREAM} WHERE a = 1 ORDER BY _timestamp DESC LIMIT 10`,
    ) as string;
    expect(out).not.toMatch(/ORDER\s+BY/i);
    expect(out).not.toMatch(/LIMIT/i);
    expect(out).toContain("WHERE a = 1");
  });

  it("returns null when the statement is not a SELECT it can rewrite", () => {
    expect(buildCountChartQuery("")).toBeNull();
    expect(buildCountChartQuery('DELETE FROM "default"')).toBeNull();
    expect(buildCountChartQuery("SELECT 1")).toBeNull();
  });

  // ── #14514: a keyword inside a string literal or a function call is not the
  // statement's own keyword. Each of these produced a corrupted query before
  // the masking fix, and the failure surfaced as a raw SQL parser error on the
  // alert's Evaluation chart.
  describe("keyword lookalikes (#14514)", () => {
    const CASES: Array<[string, string]> = [
      [
        "literal in the projection containing 'from'",
        `SELECT 'data selected from openobserve' AS description, _timestamp ${STREAM}`,
      ],
      [
        "the issue's own reported query",
        `SELECT 'test data selected from openobserve to keep' as description, count(*) as total_count ${STREAM} WHERE k8s_cluster = 'production'`,
      ],
      [
        "FROM inside EXTRACT(EPOCH FROM now())",
        `SELECT CAST(EXTRACT(EPOCH FROM now()) AS BIGINT) AS now_epoch, _timestamp ${STREAM}`,
      ],
      [
        "WHERE literal containing 'limit'",
        `SELECT _timestamp ${STREAM} WHERE msg = 'rate limit exceeded'`,
      ],
      [
        "WHERE literal containing 'order by'",
        `SELECT _timestamp ${STREAM} WHERE msg = 'sort order by name'`,
      ],
      [
        "WHERE literal containing 'having'",
        `SELECT _timestamp ${STREAM} WHERE msg = 'alerts having errors'`,
      ],
      [
        "WHERE literal containing 'group by'",
        `SELECT _timestamp ${STREAM} WHERE msg = 'group by service'`,
      ],
      ["stream name containing the word from", 'SELECT a FROM "my from stream" WHERE b = 1'],
      [
        "subquery carrying its own FROM and LIMIT",
        `SELECT _timestamp ${STREAM} WHERE svc IN (SELECT svc FROM "other" LIMIT 3)`,
      ],
      ["escaped quote inside the literal", `SELECT 'it''s from here' AS m, _timestamp ${STREAM}`],
      [
        "unbalanced paren inside a literal",
        `SELECT '( unbalanced from' AS m, _timestamp ${STREAM}`,
      ],
      [
        "CASE arms containing 'from'",
        `SELECT CASE WHEN x = 1 THEN 'from a' ELSE 'from b' END AS m, _timestamp ${STREAM}`,
      ],
    ];

    it.each(CASES)("%s", (_name, sql) => {
      const out = buildCountChartQuery(sql) as string;
      expect(out).not.toBeNull();
      // The rewrite must anchor on the real table reference, never mid-expression.
      expect(out).toMatch(/count\(\*\) AS zo_sql_num FROM /);
      expect(out).not.toMatch(/zo_sql_num FROM now\(\)/);
      expect(quotesBalanced(out)).toBe(true);
      expect(parensBalanced(out)).toBe(true);
      expect(out.endsWith("GROUP BY zo_sql_key")).toBe(true);
    });

    it("keeps a WHERE-clause literal byte-for-byte", () => {
      const out = buildCountChartQuery(
        `SELECT _timestamp ${STREAM} WHERE msg = 'sort order by name'`,
      ) as string;
      expect(out).toContain("'sort order by name'");
    });
  });

  // A CTE is not a shape this can rewrite, and returning null is the documented
  // contract — the component then shows "No chart available for this alert's
  // query." rather than a wrong chart. Active, because that behaviour is correct.
  it("declines a CTE rather than rewriting it", () => {
    expect(
      buildCountChartQuery('WITH x AS (SELECT _timestamp FROM "default") SELECT _timestamp FROM x'),
    ).toBeNull();
  });

  // ── o2-enterprise#2635. SQL comments are not masked, so a comment mentioning
  // "from" is mistaken for the real FROM. Un-skip when that issue is fixed.
  // ── o2-enterprise#2635. SQL comments are not masked, so a comment mentioning
  // "from" is mistaken for the statement's real FROM and its text leaks into
  // the rewritten query. Un-skip when that issue is fixed.
  describe.skip("custom SQL comments (o2-enterprise#2635)", () => {
    const EXPECTED =
      'SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_num FROM "default" GROUP BY zo_sql_key';

    it("ignores a line comment that mentions from", () => {
      const out = buildCountChartQuery(`SELECT _timestamp -- pick the from column\nFROM "default"`);
      expect(out).toBe(EXPECTED);
    });

    it("ignores a block comment that mentions from", () => {
      const out = buildCountChartQuery(`SELECT _timestamp /* from here */ FROM "default"`);
      expect(out).toBe(EXPECTED);
    });

    // UNION and JOIN are multi-source shapes this cannot honestly reduce to one
    // bucketed count. Today it emits a statement the backend rejects; the
    // contract says return null so the caller shows the unavailable message.
    it("declines a UNION rather than emitting a statement the backend rejects", () => {
      expect(
        buildCountChartQuery(
          'SELECT _timestamp FROM "default" UNION ALL SELECT _timestamp FROM "other"',
        ),
      ).toBeNull();
    });

    it("declines a JOIN rather than emitting a statement the backend rejects", () => {
      expect(
        buildCountChartQuery(
          'SELECT a._timestamp FROM "default" a JOIN "other" b ON a.svc = b.svc',
        ),
      ).toBeNull();
    });
  });
});

describe("cleanAggregationQuery", () => {
  it("drops the HAVING clause on a plain query", () => {
    const out = cleanAggregationQuery(
      "SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_val FROM stream GROUP BY zo_sql_key HAVING zo_sql_val >= 10",
    );
    expect(out).not.toMatch(/HAVING/i);
    expect(out).toContain("zo_sql_num");
  });

  it("does not truncate a WHERE-clause string literal that contains the word 'having'", () => {
    const query =
      "SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_val FROM \"default\" WHERE message = 'alerts having errors' GROUP BY zo_sql_key HAVING zo_sql_val >= 10";
    const out = cleanAggregationQuery(query);
    // The literal must survive intact — an odd quote count means the SQL
    // parser will hit "Unterminated string literal".
    expect((out.match(/'/g) || []).length % 2).toBe(0);
    expect(out).toContain("'alerts having errors'");
    expect(out).not.toMatch(/HAVING\s+zo_sql_val/i);
  });

  it("does not truncate a WHERE-clause literal that contains 'group by'", () => {
    const query =
      "SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_val FROM \"default\" WHERE message = 'items group by owner' GROUP BY zo_sql_key HAVING zo_sql_val >= 10";
    const out = cleanAggregationQuery(query);
    expect((out.match(/'/g) || []).length % 2).toBe(0);
    expect(out).toContain("'items group by owner'");
  });

  it("keeps a literal containing 'order by' or 'limit' intact", () => {
    for (const value of ["sort order by name", "rate limit exceeded"]) {
      const out = cleanAggregationQuery(
        `SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_val FROM "default" WHERE message = '${value}' GROUP BY zo_sql_key HAVING zo_sql_val >= 10`,
      );
      expect(quotesBalanced(out)).toBe(true);
      expect(out).toContain(`'${value}'`);
    }
  });

  it("strips the payload-only min/max timestamp projections", () => {
    const out = cleanAggregationQuery(
      'SELECT svc, count(*) AS alert_agg_value, MIN(_timestamp) as zo_sql_min_time, MAX(_timestamp) AS zo_sql_max_time FROM "default" GROUP BY svc HAVING alert_agg_value > 0',
    );
    expect(out).not.toMatch(/zo_sql_min_time|zo_sql_max_time/);
    expect(out).toContain("zo_sql_num");
  });

  // Exercises the GROUP BY *injection* path specifically: the query carries no
  // zo_sql_key, so a literal containing "group by" is the first match a raw
  // text search would find, and the injected clause lands inside the literal.
  it("injects GROUP BY around, not inside, a literal containing 'group by'", () => {
    const out = cleanAggregationQuery(
      "SELECT svc, count(*) AS alert_agg_value FROM \"default\" WHERE msg = 'group by service' GROUP BY svc",
    );
    expect(quotesBalanced(out)).toBe(true);
    expect(out).toContain("'group by service'");
    expect(out).toMatch(/GROUP BY zo_sql_key, svc/i);
  });

  it("injects a time bucket when the evaluation query carries none", () => {
    const out = cleanAggregationQuery(
      'SELECT svc, count(*) AS alert_agg_value FROM "default" GROUP BY svc',
    );
    expect(out).toMatch(/histogram\(_timestamp\) AS zo_sql_key/);
    expect(out).toMatch(/GROUP BY zo_sql_key, svc/i);
  });

  // ── o2-enterprise#2631. The alias renames below run on the raw text, so a
  // filter value containing one of these internal names is rewritten inside the
  // user's own string literal. The resulting SQL is still VALID, so the chart
  // returns 200 and silently answers a different question than the alert asks.
  // Un-skip when that issue is fixed.
  describe.skip("internal alias names inside a filter value (o2-enterprise#2631)", () => {
    const AGG = (value: string) =>
      `SELECT svc, COUNT("latency") AS alert_agg_value, MIN(_timestamp) as zo_sql_min_time, MAX(_timestamp) AS zo_sql_max_time FROM "default" WHERE ("k8s_cluster" = '${value}') GROUP BY svc HAVING "alert_agg_value" > 0`;

    it.each(["value zo_sql_val here", "alert_agg_value spotted", "zo_sql_key is here"])(
      "keeps %j exactly as the user typed it",
      (value) => {
        const out = cleanAggregationQuery(AGG(value));
        expect(out).toContain(`'${value}'`);
      },
    );

    it("still injects a time bucket when the literal merely mentions zo_sql_key", () => {
      const out = cleanAggregationQuery(AGG("zo_sql_key is here"));
      expect(out).toMatch(/histogram\(_timestamp\) AS zo_sql_key/);
    });
  });
});

describe("withCompositeGroupLabel", () => {
  it("collapses two group-by columns into one composite label", () => {
    const cleaned = cleanAggregationQuery(
      "SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_val, cost_center, availability_zone FROM stream GROUP BY zo_sql_key, cost_center, availability_zone HAVING zo_sql_val >= 10",
    );
    const out = withCompositeGroupLabel(cleaned, ["cost_center", "availability_zone"]);
    expect(out).toContain("zo_group_label");
    expect(out).toMatch(/GROUP BY zo_sql_key, zo_group_label/i);
  });

  it("leaves a WHERE-clause literal equal to a group-by column name untouched", () => {
    const cleaned = cleanAggregationQuery(
      "SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_val, service, region FROM \"default\" WHERE code IN ('a', 'service') GROUP BY zo_sql_key, service, region HAVING zo_sql_val >= 10",
    );
    const out = withCompositeGroupLabel(cleaned, ["service", "region"]);
    expect(out).toContain("IN ('a', 'service')");
    expect(out).toContain("zo_group_label");
    expect(out).toMatch(/GROUP BY zo_sql_key, zo_group_label/i);
  });

  it("does not truncate a WHERE-clause literal that contains 'order by'", () => {
    const cleaned = cleanAggregationQuery(
      "SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_val, service, region FROM \"default\" WHERE name = 'sort order by name' GROUP BY zo_sql_key, service, region HAVING zo_sql_val >= 10",
    );
    const out = withCompositeGroupLabel(cleaned, ["service", "region"]);
    expect((out.match(/'/g) || []).length % 2).toBe(0);
    expect(out).toContain("'sort order by name'");
    expect(out).toContain("zo_group_label");
    expect(out).toMatch(/GROUP BY zo_sql_key, zo_group_label/i);
  });

  it("does not inject the label inside a function call containing FROM", () => {
    const cleaned = cleanAggregationQuery(
      'SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_val, EXTRACT(EPOCH FROM now()) AS e, service, region FROM "default" GROUP BY zo_sql_key, service, region',
    );
    const out = withCompositeGroupLabel(cleaned, ["service", "region"]) as string;
    expect(out).not.toContain("EXTRACT(EPOCH,");
    expect(parensBalanced(out)).toBe(true);
    expect(out).toContain("zo_group_label");
  });

  it("returns null when there is nothing to collapse", () => {
    const cleaned = cleanAggregationQuery(
      'SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_val, service FROM "default" GROUP BY zo_sql_key, service',
    );
    expect(withCompositeGroupLabel(cleaned, [])).toBeNull();
    expect(withCompositeGroupLabel(cleaned, ["service"])).toBeNull();
  });

  it("survives a filter value carrying 'having' alongside two group-by columns", () => {
    const cleaned = cleanAggregationQuery(
      "SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_val, service, region FROM \"default\" WHERE msg = 'alerts having errors' GROUP BY zo_sql_key, service, region HAVING zo_sql_val >= 10",
    );
    const out = withCompositeGroupLabel(cleaned, ["service", "region"]) as string;
    expect(quotesBalanced(out)).toBe(true);
    expect(out).toContain("'alerts having errors'");
    expect(out).toContain("zo_group_label");
  });
});
