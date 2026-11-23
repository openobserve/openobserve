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
import type { SpanSet } from "@/utils/traces/tracesSql";
import { buildRedSql, buildSpanSetHeatmapSql, fillRedBuckets, streamSpanSet } from "./tracesRedSql";

const MINUTE = { sql: "1 minute", seconds: 60 };

const plain: SpanSet = {
  kind: "set",
  subject: "matched",
  with: "",
  from: `"default"`,
  where: "service_name = 'a'",
  dropped: [],
  keepsSubquery: false,
};

const withSubquery: SpanSet = {
  ...plain,
  where: `service_name = 'a' AND trace_id IN (SELECT DISTINCT trace_id FROM "default" WHERE span_status = 'ERROR')`,
  keepsSubquery: true,
};

const count = (text: string, part: string) => text.split(part).length - 1;

describe("buildRedSql", () => {
  it("buckets a plain span set with histogram() and sends size -1", () => {
    const { sql, size } = buildRedSql(plain, MINUTE);
    expect(sql).toBe(
      `SELECT histogram(_timestamp, '1 minute') AS time_bucket, count(*) AS spans, ` +
        `count(*) FILTER (WHERE span_status = 'ERROR') AS errors FROM "default" ` +
        `WHERE (service_name = 'a') GROUP BY time_bucket ORDER BY time_bucket ASC LIMIT 20000`,
    );
    expect(size).toBe(-1);
  });

  it("caps rows with a LIMIT, as size -1 alone stops at 1,000 buckets", () => {
    expect(buildRedSql(plain, MINUTE).sql).toMatch(/ORDER BY time_bucket ASC LIMIT 20000$/);
    expect(buildRedSql(withSubquery, MINUTE).sql).toMatch(/LIMIT 20000$/);
  });

  it("buckets a span set that keeps a subquery by modulo and sends size -999", () => {
    const { sql, size } = buildRedSql(withSubquery, MINUTE);
    expect(sql).toContain("_timestamp - (_timestamp % 60000000) AS time_bucket");
    expect(sql).not.toContain("histogram(");
    expect(size).toBe(-999);
  });

  it("puts the filter in once and counts errors with FILTER", () => {
    const { sql } = buildRedSql(withSubquery, MINUTE);
    expect(count(sql, withSubquery.where)).toBe(1);
    expect(count(sql, "span_status = 'ERROR'")).toBe(2);
    expect(count(sql, "FILTER (WHERE span_status = 'ERROR')")).toBe(1);
  });

  it("keeps the WITH in front and leaves the WHERE out when there is none", () => {
    const cte: SpanSet = {
      ...plain,
      subject: "cte",
      with: `WITH slow AS (SELECT * FROM "default" WHERE duration > 1)`,
      from: "slow",
      where: "",
      keepsSubquery: true,
    };
    const { sql } = buildRedSql(cte, MINUTE);
    expect(
      sql.startsWith(`WITH slow AS (SELECT * FROM "default" WHERE duration > 1) SELECT `),
    ).toBe(true);
    expect(sql).toContain("FROM slow GROUP BY time_bucket");
  });
});

describe("buildSpanSetHeatmapSql", () => {
  it("uses the span set's FROM and WHERE with histogram() and size -1", () => {
    const { sql, size } = buildSpanSetHeatmapSql(plain, MINUTE);
    expect(sql).toContain(`SELECT histogram(_timestamp, '1 minute') AS x_axis`);
    expect(sql).toContain(`FROM "default" WHERE (service_name = 'a')`);
    expect(size).toBe(-1);
  });

  it("uses the modulo bucket, the WITH and size -999 when a subquery remains", () => {
    const { sql, size } = buildSpanSetHeatmapSql(
      { ...withSubquery, with: "WITH x AS (SELECT 1)" },
      MINUTE,
    );
    expect(
      sql.startsWith("WITH x AS (SELECT 1) SELECT _timestamp - (_timestamp % 60000000) AS x_axis"),
    ).toBe(true);
    expect(size).toBe(-999);
  });
});

describe("fillRedBuckets", () => {
  const start = Date.UTC(2026, 0, 1, 10, 0, 30) * 1000;
  const end = Date.UTC(2026, 0, 1, 10, 5, 0) * 1000;

  it("zero-fills every bucket of the range and keeps the counts it got", () => {
    const points = fillRedBuckets(
      [{ time_bucket: "2026-01-01T10:02:00", spans: 7, errors: 2 }],
      60,
      start,
      end,
    );
    expect(points.map((p) => p.time_bucket)).toEqual([
      "2026-01-01T10:00:00",
      "2026-01-01T10:01:00",
      "2026-01-01T10:02:00",
      "2026-01-01T10:03:00",
      "2026-01-01T10:04:00",
    ]);
    expect(points.map((p) => p.spans)).toEqual([0, 0, 7, 0, 0]);
    expect(points.map((p) => p.errors)).toEqual([0, 0, 2, 0, 0]);
  });

  it("reads modulo buckets given in microseconds", () => {
    const us = Date.UTC(2026, 0, 1, 10, 3, 0) * 1000;
    const points = fillRedBuckets([{ time_bucket: us, spans: "4", errors: 1 }], 60, start, end);
    expect(points[3]).toEqual({ time_bucket: "2026-01-01T10:03:00", spans: 4, errors: 1 });
  });

  it("draws flat zeros for an empty result", () => {
    const points = fillRedBuckets([], 60, start, end);
    expect(points).toHaveLength(5);
    expect(points.every((p) => p.spans === 0 && p.errors === 0)).toBe(true);
  });
});

describe("streamSpanSet", () => {
  it("is every span of the stream, with nothing to drop", () => {
    expect(streamSpanSet("default")).toEqual({
      kind: "set",
      subject: "stream",
      with: "",
      from: `"default"`,
      where: "",
      dropped: [],
      keepsSubquery: false,
    });
  });
});
