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

import { withCompositeGroupLabel } from "@/utils/alerts/aggregationPreviewQuery";

describe("withCompositeGroupLabel", () => {
  it("collapses two group-by columns into one composite label", () => {
    const sql =
      'SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_num, svc, region FROM "bugtest" WHERE ("k8s_cluster" = \'production\') GROUP BY zo_sql_key, svc, region';

    const out = withCompositeGroupLabel(sql, ["svc", "region"]);

    expect(out).toContain("concat_ws(' / '");
    expect(out).toContain("GROUP BY zo_sql_key, zo_group_label");
  });

  it("does not truncate the query when a filter value contains 'order by' followed by a word", () => {
    // Regression for a filter value like "sort order by name": the trailing
    // ORDER BY strip used to search the raw text and cut the query in half
    // right inside this quoted literal.
    const sql =
      'SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_num, svc, region FROM "bugtest" WHERE ("k8s_cluster" = \'sort order by name\') GROUP BY zo_sql_key, svc, region';

    const out = withCompositeGroupLabel(sql, ["svc", "region"]);

    expect(out).toContain("'sort order by name'");
    expect(out).toContain("GROUP BY zo_sql_key, zo_group_label");
  });

  it("still strips a real trailing ORDER BY clause", () => {
    const sql =
      'SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_num, svc, region FROM "bugtest" GROUP BY zo_sql_key, svc, region ORDER BY zo_sql_num DESC';

    const out = withCompositeGroupLabel(sql, ["svc", "region"]);

    expect(out).not.toContain("ORDER BY");
  });
});
