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
import { cleanAggregationQuery, withCompositeGroupLabel } from "./aggregationPreviewQuery";

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
});
