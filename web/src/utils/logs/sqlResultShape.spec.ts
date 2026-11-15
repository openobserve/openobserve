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

import { describe, it, expect } from "vitest";
import { Parser } from "@openobserve/node-sql-parser/build/datafusionsql";
import {
  aggregateResultColumns,
  isAggregateQuery,
  isNonTimeSeriesAggregate,
  numericResultColumns,
} from "./sqlResultShape";

const parser = new Parser();
const parse = (sql: string) => {
  const ast: any = parser.astify(sql);
  return Array.isArray(ast) ? ast[0] : ast;
};
const grouped = (sql: string) => isNonTimeSeriesAggregate(parse(sql), sql, "_timestamp");

describe("sqlResultShape", () => {
  it("treats GROUP BY and a bare aggregate as aggregates, a plain select as raw rows", () => {
    expect(isAggregateQuery(parse('SELECT service, count(*) FROM "a" GROUP BY service'))).toBe(
      true,
    );
    expect(isAggregateQuery(parse('SELECT count(*) FROM "a"'))).toBe(true);
    expect(isAggregateQuery(parse('SELECT * FROM "a"'))).toBe(false);
    expect(isAggregateQuery(parse('SELECT service FROM "a"'))).toBe(false);
  });

  it("reads a GROUP BY hidden inside a CTE from the raw query", () => {
    const sql = 'WITH c AS (SELECT level, count(*) AS n FROM "a" GROUP BY level) SELECT * FROM c';
    expect(isAggregateQuery(parse(sql), sql)).toBe(true);
  });

  it("drops the histogram only for aggregates that are not bucketed by time", () => {
    expect(grouped('SELECT service, count(*) FROM "a" GROUP BY service')).toBe(true);
    expect(grouped('SELECT count(*) FROM "a"')).toBe(true);
    expect(grouped('SELECT max(_timestamp) AS last, service FROM "a" GROUP BY service')).toBe(true);
    expect(grouped('SELECT histogram(_timestamp) AS ts, count(*) FROM "a" GROUP BY ts')).toBe(
      false,
    );
    expect(
      grouped("SELECT date_trunc('hour', _timestamp) AS h, count(*) FROM \"a\" GROUP BY h"),
    ).toBe(false);
    expect(grouped('SELECT * FROM "a"')).toBe(false);
  });

  it("keeps the current behaviour when the query does not parse", () => {
    expect(isNonTimeSeriesAggregate(null, "SELECT x GROUP BY y", "_timestamp")).toBe(false);
  });

  it("lists result columns in the server's order and leaves the timestamp to its own column", () => {
    const hits = [
      { service: "auth", "count(*)": 3 },
      { service: "cart", "count(*)": 5, _timestamp: 1 },
    ];
    expect(aggregateResultColumns(hits, "_timestamp")).toEqual(["service", "count(*)"]);
    expect(aggregateResultColumns(undefined, "_timestamp")).toEqual([]);
  });

  it("marks only all-number columns as numeric, skipping nulls", () => {
    const hits = [
      { service: "auth", n: 3, avg: null },
      { service: "cart", n: 5, avg: 1.5 },
    ];
    expect([...numericResultColumns(hits, ["service", "n", "avg"])]).toEqual(["n", "avg"]);
  });
});
