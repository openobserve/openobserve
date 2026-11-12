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
import { queryNarrowedRange } from "./queryTimeNarrowing";

const picker = {
  startUs: Date.UTC(2026, 10, 12, 0) * 1000,
  endUs: Date.UTC(2026, 10, 13, 0) * 1000,
};
const at = (hour: number) => Date.UTC(2026, 10, 12, hour) * 1000;

describe("a query that narrows the picker's range", () => {
  it("is nothing when the query does not filter on the timestamp column", () => {
    expect(queryNarrowedRange('SELECT * FROM "default"', "_timestamp", picker)).toBeNull();
    expect(
      queryNarrowedRange("SELECT * FROM t WHERE my_timestamp > 5", "_timestamp", picker),
    ).toBeNull();
    expect(queryNarrowedRange("", "_timestamp", picker)).toBeNull();
    const other = `SELECT * FROM t WHERE my_timestamp > ${at(9)} AND _timestamp < ${at(17)}`;
    expect(queryNarrowedRange(other, "_timestamp", picker)).toEqual({
      startUs: picker.startUs,
      endUs: at(17),
    });
  });

  it("reads microsecond, millisecond and second literals on both sides", () => {
    const sql = `SELECT * FROM t WHERE _timestamp >= ${at(9)} AND _timestamp < ${at(17) / 1000}`;
    expect(queryNarrowedRange(sql, "_timestamp", picker)).toEqual({
      startUs: at(9),
      endUs: at(17),
    });
    const seconds = `SELECT * FROM t WHERE "_timestamp" > ${at(6) / 1_000_000}`;
    expect(queryNarrowedRange(seconds, "_timestamp", picker)).toEqual({
      startUs: at(6) + 1,
      endUs: picker.endUs,
    });
  });

  it("reads quoted timestamps as UTC and BETWEEN", () => {
    const sql =
      "SELECT * FROM t WHERE _timestamp BETWEEN '2026-11-12 09:00:00' AND '2026-11-12T10:00:00Z'";
    expect(queryNarrowedRange(sql, "_timestamp", picker)).toEqual({
      startUs: at(9),
      endUs: at(10) + 1,
    });
  });

  it("is nothing when no bound moves inside the picker's range", () => {
    const wider = `SELECT * FROM t WHERE _timestamp > ${at(-48)}`;
    expect(queryNarrowedRange(wider, "_timestamp", picker)).toBeNull();
    expect(
      queryNarrowedRange("SELECT * FROM t WHERE _timestamp > 0", "_timestamp", picker),
    ).toBeNull();
    const expression = "SELECT * FROM t WHERE _timestamp >= now() - interval '1 hour'";
    expect(queryNarrowedRange(expression, "_timestamp", picker)).toBeNull();
    const arithmetic = `SELECT * FROM t WHERE _timestamp >= ${at(9)} - 3600000000`;
    expect(queryNarrowedRange(arithmetic, "_timestamp", picker)).toBeNull();
  });

  it("claims nothing when the query has an OR, since a branch may keep more", () => {
    const sql = `SELECT * FROM t WHERE _timestamp IS NOT NULL OR _timestamp < ${at(9)}`;
    expect(queryNarrowedRange(sql, "_timestamp", picker)).toBeNull();
    const streamOr = `SELECT * FROM "web-or-app" WHERE _timestamp < ${at(9)}`;
    expect(queryNarrowedRange(streamOr, "_timestamp", picker)).toEqual({
      startUs: picker.startUs,
      endUs: at(9),
    });
    const quotedOr = `SELECT * FROM t WHERE msg = 'this or that' AND _timestamp < ${at(9)}`;
    expect(queryNarrowedRange(quotedOr, "_timestamp", picker)).toEqual({
      startUs: picker.startUs,
      endUs: at(9),
    });
  });

  it("reads no bound written inside a quoted alias, but still reads the quoted column", () => {
    const alias = `SELECT count(*) AS "_timestamp < ${at(9)}" FROM t`;
    expect(queryNarrowedRange(alias, "_timestamp", picker)).toBeNull();
    const quoted = `SELECT * FROM "t" WHERE "_timestamp" < ${at(9)}`;
    expect(queryNarrowedRange(quoted, "_timestamp", picker)).toEqual({
      startUs: picker.startUs,
      endUs: at(9),
    });
  });

  it("still sees an OR next to a quoted identifier that holds a quote or touches a keyword", () => {
    const apostrophe = `SELECT * FROM "o'brien" WHERE _timestamp < ${at(9)} OR level = 'e'`;
    expect(queryNarrowedRange(apostrophe, "_timestamp", picker)).toBeNull();
    const touching = `SELECT * FROM t WHERE _timestamp < ${at(9)} AND"a"OR b = 1`;
    expect(queryNarrowedRange(touching, "_timestamp", picker)).toBeNull();
  });

  it("ignores the column inside string literals and comments", () => {
    const quoted = `SELECT * FROM t WHERE msg = '_timestamp < ${at(9)}'`;
    expect(queryNarrowedRange(quoted, "_timestamp", picker)).toBeNull();
    const line = `SELECT * FROM t -- _timestamp < ${at(9)}\nWHERE a = 1`;
    expect(queryNarrowedRange(line, "_timestamp", picker)).toBeNull();
    const block = `SELECT * FROM t /* _timestamp < ${at(9)} */ WHERE a = 1`;
    expect(queryNarrowedRange(block, "_timestamp", picker)).toBeNull();
  });

  it("maps each operator to an exclusive end and an inclusive start", () => {
    const read = (op: string) =>
      queryNarrowedRange(`SELECT * FROM t WHERE _timestamp ${op} ${at(9)}`, "_timestamp", picker);
    expect(read(">=")).toEqual({ startUs: at(9), endUs: picker.endUs });
    expect(read(">")).toEqual({ startUs: at(9) + 1, endUs: picker.endUs });
    expect(read("<")).toEqual({ startUs: picker.startUs, endUs: at(9) });
    expect(read("<=")).toEqual({ startUs: picker.startUs, endUs: at(9) + 1 });
    expect(read("=")).toEqual({ startUs: at(9), endUs: at(9) + 1 });
  });
});
