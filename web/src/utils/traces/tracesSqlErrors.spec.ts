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
  allNullColumns,
  closestField,
  offsetRange,
  ONE_HOUR_US,
  sqlErrorCode,
  tracesSqlGuards,
  tracesSqlErrorFix,
  unknownFieldName,
} from "./tracesSqlErrors";

const FIELDS = ["service_name", "operation_name", "duration", "_timestamp", "span_status"];
const STREAM_FIELD_ERROR =
  "Search field not found: Schema error: No field named servce_name.\nValid fields are otel_demo._timestamp.";
const OOM_ERROR =
  "Search SQL execute error: Resources exhausted: Failed to allocate additional 1024.0 MB for HashJoinInput[0]";

describe("sqlErrorCode", () => {
  it("keeps an app error code", () => {
    expect(sqlErrorCode(20002, "Search stream not found: where")).toBe(20002);
  });

  it("reads the code from the message when the stream sends an HTTP status", () => {
    expect(sqlErrorCode(400, STREAM_FIELD_ERROR)).toBe(20004);
    expect(sqlErrorCode(500, OOM_ERROR)).toBe(20008);
    expect(sqlErrorCode(400, "something else")).toBe(0);
  });
});

describe("unknownFieldName", () => {
  it("reads the field from the engine and the enriched messages", () => {
    expect(unknownFieldName(STREAM_FIELD_ERROR)).toBe("servce_name");
    expect(unknownFieldName("unknown field 'servce_name'")).toBe("servce_name");
    expect(unknownFieldName("No field named otel_demo.servce_name. Valid fields are a.")).toBe(
      "servce_name",
    );
    expect(unknownFieldName('No field named "Servce". Valid fields are a.')).toBe("Servce");
  });

  it("returns null for other messages", () => {
    expect(unknownFieldName("Search stream not found: where")).toBeNull();
  });
});

describe("closestField", () => {
  it("picks the nearest field within the typo threshold", () => {
    expect(closestField("servce_name", FIELDS)).toBe("service_name");
    expect(closestField("duraton", FIELDS)).toBe("duration");
  });

  it("skips system fields and far-off names", () => {
    expect(closestField("timestamp", FIELDS)).toBeNull();
    expect(closestField("zone", FIELDS)).toBeNull();
  });
});

describe("tracesSqlErrorFix", () => {
  const base = { suggestions: [], fields: FIELDS, rangeUs: ONE_HOUR_US };

  it("offers the server's first suggestion for an unknown field", () => {
    expect(
      tracesSqlErrorFix({
        ...base,
        code: 20004,
        text: "unknown field 'servce_name'",
        suggestions: ["service_name", "span_name"],
      }),
    ).toEqual({ kind: "suggestion", field: "servce_name", suggestion: "service_name" });
  });

  it("falls back to the closest stream field when the stream error has no suggestions", () => {
    expect(tracesSqlErrorFix({ ...base, code: 400, text: STREAM_FIELD_ERROR })).toEqual({
      kind: "suggestion",
      field: "servce_name",
      suggestion: "service_name",
    });
  });

  it("offers no card for an unknown field nothing resembles", () => {
    expect(
      tracesSqlErrorFix({
        ...base,
        code: 400,
        text: "Search field not found: Schema error: No field named zone.",
      }),
    ).toBeNull();
  });

  it("offers the last hour for an out-of-memory error over a longer range", () => {
    expect(
      tracesSqlErrorFix({ ...base, code: 500, text: OOM_ERROR, rangeUs: 24 * ONE_HOUR_US }),
    ).toEqual({ kind: "lastHour" });
  });

  it("offers no range card when the range is already one hour or less", () => {
    expect(tracesSqlErrorFix({ ...base, code: 500, text: OOM_ERROR })).toBeNull();
  });

  it("offers no range card for an execute error that is not about memory", () => {
    expect(
      tracesSqlErrorFix({
        ...base,
        code: 20008,
        text: "Search SQL execute error: divide by zero",
        rangeUs: 24 * ONE_HOUR_US,
      }),
    ).toBeNull();
  });

  it("names the missing stream for FROM where", () => {
    expect(
      tracesSqlErrorFix({ ...base, code: 20002, text: "Search stream not found: where" }),
    ).toEqual({ kind: "missingStream" });
    expect(
      tracesSqlErrorFix({ ...base, code: 20002, text: "Search stream not found: wherever" }),
    ).toBeNull();
  });

  it("names the missing stream for a parser error when the query has FROM WHERE", () => {
    const parserError = `Error# SQL error: ParserError("Expected: end of statement, found: > at Line: 1, Column: 30")`;
    expect(
      tracesSqlErrorFix({
        ...base,
        code: 400,
        text: parserError,
        query: "SELECT * FROM WHERE duration > 1",
      }),
    ).toEqual({ kind: "missingStream" });
    expect(
      tracesSqlErrorFix({
        ...base,
        code: 20002,
        text: "Search stream not found: x",
        query: "SELECT * FROM WHERE duration > 1",
      }),
    ).toEqual({ kind: "missingStream" });
    expect(
      tracesSqlErrorFix({ ...base, code: 400, text: parserError, query: `SELECT * FROM "a" >` }),
    ).toBeNull();
  });

  it("offers str_match when match_all hits a stream with no full-text fields", () => {
    expect(
      tracesSqlErrorFix({
        ...base,
        code: 20001,
        text: "Search SQL not valid match_all() should only apply to the stream that have full text search fields",
        query: `SELECT * FROM "default" WHERE match_all('redis')`,
      }),
    ).toEqual({
      kind: "strMatch",
      sql: `SELECT * FROM "default" WHERE str_match(operation_name, 'redis')`,
      call: "str_match(operation_name, 'redis')",
    });
  });

  it("leaves other errors as the server sent them", () => {
    expect(tracesSqlErrorFix({ ...base, code: 20001, text: "Search SQL not valid" })).toBeNull();
  });
});

describe("allNullColumns", () => {
  it("lists columns that are null or missing in every returned row", () => {
    const hits = [{ service_name: "a", http_status_code: null }, { service_name: "b" }];
    expect(allNullColumns(hits, ["service_name", "http_status_code"])).toEqual([
      "http_status_code",
    ]);
  });

  it("returns nothing for no rows", () => {
    expect(allNullColumns([], ["a"])).toEqual([]);
  });
});

describe("tracesSqlGuards", () => {
  const STRAY = `SELECT * FROM "otel_demo" AND WHERE duration > 1`;
  const JOIN = `SELECT * FROM "a" c\nJOIN "a" p ON c.t = p.t`;

  it("flags a keyword between the stream and WHERE", () => {
    const start = STRAY.indexOf("AND");
    expect(tracesSqlGuards(STRAY, ONE_HOUR_US)).toEqual([
      { kind: "strayKeyword", word: "AND", start, end: start + 3 },
    ]);
  });

  it("warns about a JOIN only over more than one hour", () => {
    const start = JOIN.indexOf("JOIN");
    expect(tracesSqlGuards(JOIN, ONE_HOUR_US)).toEqual([]);
    expect(tracesSqlGuards(JOIN, 2 * ONE_HOUR_US)).toEqual([
      { kind: "joinLongRange", word: "JOIN", start, end: start + 4 },
    ]);
  });

  it("flags nothing in a plain query", () => {
    expect(tracesSqlGuards(`SELECT * FROM "a" WHERE x = 1`, 24 * ONE_HOUR_US)).toEqual([]);
  });
});

describe("offsetRange", () => {
  it("turns offsets into 1-based editor lines and columns", () => {
    const text = `SELECT *\nFROM "a" AND WHERE`;
    const start = text.indexOf("AND");
    expect(offsetRange(text, start, start + 3)).toEqual({
      startLine: 2,
      endLine: 2,
      column: 10,
      endColumn: 13,
    });
  });
});
