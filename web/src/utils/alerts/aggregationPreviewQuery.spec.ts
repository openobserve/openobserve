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
});

describe("buildCountChartQuery", () => {
  it("rewrites a plain custom SQL query into a count-over-time query", () => {
    const chartQuery = buildCountChartQuery('SELECT _timestamp FROM "bugtest"');

    expect(chartQuery).toBe(
      'SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_num FROM "bugtest" GROUP BY zo_sql_key',
    );
  });

  it("does not mistake a line comment's 'from' for the statement's real FROM", () => {
    const chartQuery = buildCountChartQuery(
      'SELECT _timestamp -- pick the from column\nFROM "bugtest"',
    );

    expect(chartQuery).toBe(
      'SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_num FROM "bugtest" GROUP BY zo_sql_key',
    );
  });

  it("does not mistake a block comment's 'from' for the statement's real FROM", () => {
    const chartQuery = buildCountChartQuery(
      'SELECT _timestamp /* from here */ FROM "bugtest"',
    );

    expect(chartQuery).toBe(
      'SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_num FROM "bugtest" GROUP BY zo_sql_key',
    );
  });

  it("returns null rather than a broken query for a query that starts with a CTE", () => {
    const chartQuery = buildCountChartQuery(
      'WITH x AS (SELECT _timestamp FROM "bugtest") SELECT _timestamp FROM x',
    );

    expect(chartQuery).toBeNull();
  });

  it("returns null rather than a broken query for a UNION", () => {
    const chartQuery = buildCountChartQuery(
      'SELECT _timestamp FROM "bugtest" UNION ALL SELECT _timestamp FROM "bugtest"',
    );

    expect(chartQuery).toBeNull();
  });

  it("returns null rather than a broken query for a JOIN", () => {
    const chartQuery = buildCountChartQuery(
      'SELECT a._timestamp FROM "bugtest" a JOIN "bugtest" b ON a.svc = b.svc',
    );

    expect(chartQuery).toBeNull();
  });

  it("still ignores a quoted filter value containing a real comment marker", () => {
    const chartQuery = buildCountChartQuery(
      'SELECT _timestamp FROM "bugtest" WHERE (note = \'-- not a comment\')',
    );

    expect(chartQuery).toContain("WHERE (note = '-- not a comment')");
  });
});
