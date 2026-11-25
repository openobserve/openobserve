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
import { applyColumnFix, unknownColumnFix } from "./sqlErrorFix";

const SQL =
  "SELECT service, count(*) AS errors\nFROM \"default\"\nWHERE status >= 500 AND servce != 'healthcheck'\nGROUP BY service";
const FIELDS = ["service", "status", "path"];

describe("unknownColumnFix", () => {
  it.each([
    [
      "one close field",
      "Schema error: No field named servce. Valid fields are ...",
      SQL,
      FIELDS,
      { column: "servce", match: "service", line: 3 },
    ],
    [
      "a quoted, qualified name",
      'No field named "default"."servce"',
      SQL,
      FIELDS,
      { column: "servce", match: "service", line: 3 },
    ],
    ["two close fields", "No field named stat", "SELECT stat FROM t", ["state", "status"], null],
    ["no close field", "No field named zzzzzz", SQL, FIELDS, null],
    ["an error that names no column", "sql parser error: expected FROM", SQL, FIELDS, null],
    [
      "a column the query does not spell",
      "No field named servce",
      "SELECT 1",
      FIELDS,
      { column: "servce", match: "service", line: null },
    ],
  ])("%s", (_case, error, sql, fields, expected) => {
    expect(unknownColumnFix(error, sql, fields)).toEqual(expected);
  });
});

describe("applyColumnFix", () => {
  it("replaces whole words only", () => {
    expect(
      applyColumnFix(
        "SELECT servce, servce_count FROM t WHERE \"servce\" = 'a'",
        "servce",
        "service",
      ),
    ).toBe("SELECT service, servce_count FROM t WHERE \"service\" = 'a'");
  });
});
