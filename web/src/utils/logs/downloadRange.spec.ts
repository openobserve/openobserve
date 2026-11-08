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
import sqlParserModule from "@openobserve/node-sql-parser/build/datafusionsql";
import { applyDownloadRange, downloadRangeWindow, sqlLimitOf } from "@/utils/logs/downloadRange";

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));
const sqlParser = new (sqlParserModule as any).Parser();
const limitOf = (sql: string) => sqlLimitOf(sqlParser.astify(sql));

describe("sqlLimitOf", () => {
  it("reads a plain LIMIT", () => {
    expect(limitOf('SELECT * FROM "default" LIMIT 2000')).toBe(2000);
  });

  it("reads the LIMIT of a query that ends in a semicolon", () => {
    expect(limitOf('SELECT * FROM "default" LIMIT 2000;')).toBe(2000);
  });

  it("reads the LIMIT of a query with an OFFSET", () => {
    expect(limitOf('SELECT * FROM "default" LIMIT 50 OFFSET 10')).toBe(50);
  });

  it("reads the trailing LIMIT of a set operation", () => {
    expect(limitOf("SELECT a FROM s1 UNION ALL SELECT a FROM s2 LIMIT 7")).toBe(7);
  });

  it("ignores a LIMIT that bounds only one branch of a set operation", () => {
    expect(limitOf("(SELECT a FROM s1 LIMIT 5) UNION ALL (SELECT a FROM s2)")).toBeNull();
  });

  it("does not read the OFFSET of a query with no LIMIT as a LIMIT", () => {
    expect(limitOf('SELECT * FROM "default" OFFSET 5')).toBeNull();
  });

  it("returns null without a LIMIT or without a parsed query", () => {
    expect(limitOf('SELECT * FROM "default"')).toBeNull();
    expect(sqlLimitOf(undefined)).toBeNull();
  });
});

describe("downloadRangeWindow", () => {
  it("asks the server for the requested window when the query has no LIMIT", () => {
    expect(downloadRangeWindow(5, 50, null)).toEqual({ from: 4, size: 50 });
  });

  it("treats an initial number of 0 as the first row", () => {
    expect(downloadRangeWindow(0, 50, null)).toEqual({ from: 0, size: 50 });
  });

  it("fetches the whole LIMIT result when the query has a LIMIT", () => {
    expect(downloadRangeWindow(5, 50, 2000)).toEqual({ from: 0, size: 2000 });
  });
});

describe("applyDownloadRange", () => {
  it("keeps the server's rows when the query has no LIMIT", () => {
    expect(applyDownloadRange(rows(50), 5, 50, null)).toHaveLength(50);
  });

  it("trims a LIMIT result to the requested range", () => {
    const out = applyDownloadRange(rows(2000), 1, 500, 2000);
    expect(out).toHaveLength(500);
    expect(out[0].id).toBe(1);
  });

  it("starts the range at the initial number", () => {
    const out = applyDownloadRange(rows(2000), 101, 500, 2000);
    expect(out).toHaveLength(500);
    expect(out[0].id).toBe(101);
    expect(out[499].id).toBe(600);
  });

  it("returns what is left when the range runs past the LIMIT result", () => {
    expect(applyDownloadRange(rows(2000), 1900, 500, 2000)).toHaveLength(101);
  });

  it("returns nothing when the initial number is beyond the result", () => {
    expect(applyDownloadRange(rows(10), 50, 5, 10)).toEqual([]);
  });
});
