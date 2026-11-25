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
import { isOffsetOnlyLimit, splitTrailingOffset } from "@/utils/logs/sqlOffset";

describe("isOffsetOnlyLimit", () => {
  it("is true for the parser's OFFSET-only shape", () => {
    expect(isOffsetOnlyLimit({ seperator: "offset", value: [{ type: "number", value: 5 }] })).toBe(
      true,
    );
  });

  it("is false for LIMIT, LIMIT OFFSET and no limit", () => {
    expect(isOffsetOnlyLimit({ seperator: "", value: [{ type: "number", value: 10 }] })).toBe(
      false,
    );
    expect(
      isOffsetOnlyLimit({
        seperator: "offset",
        value: [
          { type: "number", value: 10 },
          { type: "number", value: 5 },
        ],
      }),
    ).toBe(false);
    expect(isOffsetOnlyLimit(null)).toBe(false);
    expect(isOffsetOnlyLimit(undefined)).toBe(false);
  });
});

describe("splitTrailingOffset", () => {
  it("removes a trailing OFFSET and returns its value", () => {
    expect(splitTrailingOffset('SELECT * FROM "s" ORDER BY _timestamp DESC OFFSET 5')).toEqual({
      sql: 'SELECT * FROM "s" ORDER BY _timestamp DESC',
      offset: 5,
    });
  });

  it("is case-insensitive and ignores a trailing semicolon", () => {
    expect(splitTrailingOffset('select * from "s" offset 12 ;')).toEqual({
      sql: 'select * from "s"',
      offset: 12,
    });
  });

  it("leaves a query without a trailing OFFSET alone", () => {
    expect(splitTrailingOffset('SELECT * FROM "s" LIMIT 10')).toEqual({
      sql: 'SELECT * FROM "s" LIMIT 10',
      offset: 0,
    });
    expect(splitTrailingOffset("")).toEqual({ sql: "", offset: 0 });
  });

  it("leaves a LIMIT with OFFSET alone, since that query has no count request", () => {
    const sql = 'SELECT * FROM "s" LIMIT 10 OFFSET 5';
    expect(splitTrailingOffset(sql)).toEqual({ sql, offset: 0 });
  });

  it("does not touch an OFFSET inside a subquery or literal", () => {
    const sql = "SELECT * FROM (SELECT * FROM s OFFSET 3) AS t";
    expect(splitTrailingOffset(sql)).toEqual({ sql, offset: 0 });
    expect(splitTrailingOffset("SELECT 'a offset 4' FROM s").offset).toBe(0);
  });
});
