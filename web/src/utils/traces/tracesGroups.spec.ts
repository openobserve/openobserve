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
  buildGroupsDistinctSql,
  buildGroupsSparklineSql,
  buildGroupsSql,
  decodeGroupsSort,
  DEFAULT_GROUPS_SORT,
  encodeGroupsSort,
  groupTerm,
  GROUPS_LIMIT,
  isTextType,
  quoteIdentifier,
  sparklinePlan,
  sparklineSeries,
  toGroupRows,
} from "./tracesGroups";

const base = { stream: "default", key: "service_name", filter: "", scope: "" };

describe("quoteIdentifier", () => {
  it("quotes the name and doubles an embedded quote", () => {
    expect(quoteIdentifier("service_name")).toBe('"service_name"');
    expect(quoteIdentifier('a"b')).toBe('"a""b"');
  });
});

describe("buildGroupsSql", () => {
  it("groups by the quoted key with the RED columns, errors first, top 50", () => {
    expect(buildGroupsSql({ ...base, sort: DEFAULT_GROUPS_SORT })).toBe(
      'SELECT "service_name" AS value, count(*) AS spans, ' +
        "count(*) FILTER (WHERE span_status = 'ERROR') AS errors, " +
        "approx_percentile_cont(duration, 0.5) AS p50, " +
        "approx_percentile_cont(duration, 0.95) AS p95, " +
        "approx_percentile_cont(duration, 0.99) AS p99 " +
        'FROM "default" GROUP BY "service_name" ORDER BY errors DESC, spans DESC LIMIT 50',
    );
    expect(GROUPS_LIMIT).toBe(50);
  });

  it("adds the filter and the scope as one bracketed WHERE", () => {
    const sql = buildGroupsSql({
      ...base,
      filter: "http_status_code = '500' OR duration > 10",
      scope: "(reference_parent_span_id IS NULL OR reference_parent_span_id = '')",
      sort: DEFAULT_GROUPS_SORT,
    });
    expect(sql).toContain(
      "WHERE (http_status_code = '500' OR duration > 10) AND " +
        "(reference_parent_span_id IS NULL OR reference_parent_span_id = '') GROUP BY",
    );
  });

  it("adds no WHERE without a filter or scope", () => {
    expect(buildGroupsSql({ ...base, sort: DEFAULT_GROUPS_SORT })).toContain(
      'FROM "default" GROUP BY',
    );
  });

  it("orders by the picked column, Error % as a ratio, and the value alone by name", () => {
    expect(buildGroupsSql({ ...base, sort: { by: "p95", order: "asc" } })).toContain(
      "ORDER BY p95 ASC, spans DESC LIMIT 50",
    );
    expect(buildGroupsSql({ ...base, sort: { by: "error_pct", order: "desc" } })).toContain(
      "ORDER BY errors * 1.0 / spans DESC, spans DESC LIMIT 50",
    );
    expect(buildGroupsSql({ ...base, sort: { by: "spans", order: "desc" } })).toContain(
      "ORDER BY spans DESC LIMIT 50",
    );
    expect(buildGroupsSql({ ...base, sort: { by: "value", order: "asc" } })).toContain(
      "ORDER BY value ASC LIMIT 50",
    );
  });

  it("folds empty into null for a text key, so (no value) is one row", () => {
    const sql = buildGroupsSql({ ...base, textKey: true, sort: DEFAULT_GROUPS_SORT });
    expect(sql).toContain(`SELECT NULLIF("service_name", '') AS value`);
    expect(sql).toContain(`GROUP BY NULLIF("service_name", '') ORDER BY`);
  });

  it("quotes a key that is not a plain identifier", () => {
    const sql = buildGroupsSql({ ...base, key: "http.method", sort: DEFAULT_GROUPS_SORT });
    expect(sql).toContain('SELECT "http.method" AS value');
    expect(sql).toContain('GROUP BY "http.method"');
  });
});

describe("sparklinePlan", () => {
  it("splits the window into at most 25 buckets aligned to the histogram origin", () => {
    const start = 1_793_640_000_000_000;
    const plan = sparklinePlan(start, start + 3_600_000_000);
    expect(plan.intervalSec).toBe(150);
    expect((plan.alignedStartUs / 1_000_000 - 978_307_200) % 150).toBe(0);
    expect(plan.alignedStartUs).toBeLessThanOrEqual(start);
    expect(plan.bucketCount).toBeGreaterThanOrEqual(24);
    expect(plan.bucketCount).toBeLessThanOrEqual(25);
  });

  it("never asks for an interval below one second", () => {
    expect(sparklinePlan(0, 1_000_000).intervalSec).toBe(1);
  });
});

describe("buildGroupsSparklineSql", () => {
  const plan = { intervalSec: 150, alignedStartUs: 0, bucketCount: 25 };

  it("buckets the visible keys over time with LIMIT 50 times the bucket count", () => {
    const sql = buildGroupsSparklineSql({
      ...base,
      filter: "duration > 10",
      values: ["cart", "it's"],
      plan,
    });
    expect(sql).toBe(
      "SELECT histogram(_timestamp, '150 seconds') AS ts, \"service_name\" AS value, " +
        'count(*) AS spans FROM "default" ' +
        "WHERE (duration > 10) AND (\"service_name\" IN ('cart', 'it''s')) " +
        "GROUP BY ts, value ORDER BY ts LIMIT 1250",
    );
  });

  it("matches the empty group with IS NULL as well", () => {
    const sql = buildGroupsSparklineSql({ ...base, values: [null, "cart"], plan });
    expect(sql).toContain(
      'WHERE ("service_name" IN (\'cart\') OR "service_name" IS NULL) GROUP BY',
    );
  });

  it("buckets a text key's empty and null values as the one (no value) series", () => {
    const sql = buildGroupsSparklineSql({ ...base, textKey: true, values: [null, "cart"], plan });
    expect(sql).toContain(`NULLIF("service_name", '') AS value`);
    expect(sql).toContain(
      `WHERE ("service_name" IN ('cart') OR "service_name" IS NULL OR "service_name" = '') GROUP BY`,
    );
  });

  it("keeps the scope", () => {
    const sql = buildGroupsSparklineSql({ ...base, scope: "(x = 1)", values: [2], plan });
    expect(sql).toContain("WHERE ((x = 1)) AND (\"service_name\" IN ('2'))");
  });
});

describe("sparklineSeries", () => {
  it("places counts in their bucket and fills buckets with no spans with zero", () => {
    const plan = {
      intervalSec: 60,
      alignedStartUs: Date.UTC(2026, 10, 2, 18, 0) * 1000,
      bucketCount: 3,
    };
    const series = sparklineSeries(
      [
        { ts: "2026-11-02T18:00:00", value: "cart", spans: 4 },
        { ts: "2026-11-02T18:02:00", value: "cart", spans: 1 },
        { ts: "2026-11-02T18:01:00", spans: 7 },
      ],
      plan,
    );
    expect(series.get("cart")).toEqual([4, 0, 1]);
    expect(series.get(null)).toEqual([0, 7, 0]);
  });
});

describe("buildGroupsDistinctSql", () => {
  it("counts the key's values approximately under the same filter", () => {
    expect(buildGroupsDistinctSql({ ...base, filter: "a = 'b'" })).toBe(
      'SELECT approx_distinct("service_name") AS n FROM "default" WHERE a = \'b\'',
    );
  });

  it("counts a text key's values without the empty one", () => {
    expect(buildGroupsDistinctSql({ ...base, textKey: true })).toBe(
      `SELECT approx_distinct(NULLIF("service_name", '')) AS n FROM "default"`,
    );
  });
});

describe("isTextType", () => {
  it("is true for the string column types only", () => {
    expect(["Utf8", "LargeUtf8", "Utf8View"].every(isTextType)).toBe(true);
    expect([undefined, "Int64", "Float64", "Boolean", "UInt64"].some(isTextType)).toBe(false);
  });
});

describe("toGroupRows", () => {
  it("reads a missing value as null and computes Error %", () => {
    expect(
      toGroupRows([
        { value: "cart", spans: 200, errors: 10, p50: 1, p95: 2, p99: 3 },
        { spans: 5, errors: 0, p50: 1, p95: 2, p99: 3 },
      ]),
    ).toEqual([
      { value: "cart", spans: 200, errors: 10, errorPct: 5, p50: 1, p95: 2, p99: 3 },
      { value: null, spans: 5, errors: 0, errorPct: 0, p50: 1, p95: 2, p99: 3 },
    ]);
  });
});

describe("groupTerm", () => {
  it("includes and excludes a value with an escaped quote", () => {
    expect(groupTerm("service_name", "it's", "include")).toBe("service_name = 'it''s'");
    expect(groupTerm("service_name", "cart", "exclude")).toBe("service_name != 'cart'");
    expect(groupTerm("status_code", 2, "include")).toBe("status_code = '2'");
  });

  it("matches both null and empty for the (no value) row", () => {
    expect(groupTerm("user_id", null, "include")).toBe("(user_id IS NULL OR user_id = '')");
    expect(groupTerm("user_id", "", "include")).toBe("(user_id IS NULL OR user_id = '')");
    expect(groupTerm("user_id", null, "exclude")).toBe("(user_id IS NOT NULL AND user_id != '')");
  });
});

describe("groups sort in the URL", () => {
  it("round-trips a sort and rejects anything else", () => {
    expect(encodeGroupsSort({ by: "p95", order: "asc" })).toBe("p95:asc");
    expect(decodeGroupsSort("p95:asc")).toEqual({ by: "p95", order: "asc" });
    expect(decodeGroupsSort("error_pct:desc")).toEqual({ by: "error_pct", order: "desc" });
    expect(decodeGroupsSort("duration:asc")).toBeNull();
    expect(decodeGroupsSort("p95:up")).toBeNull();
    expect(decodeGroupsSort(undefined)).toBeNull();
  });
});
