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
import { explainQueryError } from "./queryErrorExplain";

// Every message below was captured from a local server's /_search_stream or /_search response.
const PARSER = (inner: string) => `Error# SQL error: ParserError("${inner}")`;

describe("explainQueryError", () => {
  describe("missing stream after FROM", () => {
    it("names the missing stream and uses the selected stream as the example", () => {
      expect(
        explainQueryError(PARSER("Expected: identifier, found: EOF"), {
          query: "SELECT * FROM",
          streamName: "app_logs",
        }),
      ).toEqual({
        titleKey: "queryError.sqlError",
        messageKey: "queryError.explain.missingStream",
        params: { from: "FROM", example: 'FROM "app_logs"' },
      });
    });

    it("falls back to the default stream in the example and ignores trailing space and case", () => {
      expect(
        explainQueryError(PARSER("Expected: identifier, found: EOF"), { query: "select * from \n" })
          ?.params,
      ).toEqual({ from: "FROM", example: 'FROM "default"' });
    });

    it("does not claim a missing stream when the query does not end in FROM", () => {
      expect(
        explainQueryError(PARSER("Expected: identifier, found: EOF"), {
          query: 'SELECT * FROM "app_logs" AS',
        }),
      ).toMatchObject({
        messageKey: "queryError.explain.unexpectedEndAfter",
        params: { keyword: "AS" },
      });
    });

    it("stays generic without the query text", () => {
      expect(explainQueryError(PARSER("Expected: identifier, found: EOF"))?.messageKey).toBe(
        "queryError.explain.unexpectedEnd",
      );
    });
  });

  describe("query ends early", () => {
    it.each([
      ['SELECT * FROM "app_logs" WHERE', "WHERE"],
      ["SELECT * FROM \"app_logs\" WHERE level = 'a' AND", "AND"],
      ['SELECT * FROM "app_logs" ORDER BY', "BY"],
    ])("names the trailing keyword of %s", (query, keyword) => {
      expect(explainQueryError(PARSER("Expected: an expression, found: EOF"), { query })).toEqual({
        titleKey: "queryError.sqlError",
        messageKey: "queryError.explain.unexpectedEndAfter",
        params: { keyword },
      });
    });

    it("does not treat a trailing value as a keyword", () => {
      expect(
        explainQueryError(PARSER("Expected: an expression, found: EOF"), {
          query: "SELECT * FROM t WHERE level = error",
        })?.messageKey,
      ).toBe("queryError.explain.unexpectedEnd");
    });

    it("reports an unclosed bracket", () => {
      expect(
        explainQueryError(PARSER("Expected: ), found: EOF"), {
          query: "SELECT * FROM \"app_logs\" WHERE (level = 'a'",
        }),
      ).toEqual({
        titleKey: "queryError.sqlError",
        messageKey: "queryError.explain.unclosedBracket",
        params: { char: ")" },
      });
    });
  });

  describe("unexpected words", () => {
    it("explains a misspelled first keyword", () => {
      expect(
        explainQueryError(PARSER("Expected: an SQL statement, found: SELCT at Line: 1, Column: 1")),
      ).toEqual({
        titleKey: "queryError.sqlError",
        messageKey: "queryError.explain.notAStatement",
        params: { keyword: "SELECT", token: '"SELCT"' },
      });
    });

    it("names an unexpected word in the middle of the query", () => {
      expect(
        explainQueryError(PARSER("Expected: end of statement, found: ANDD at Line: 1, Column: 44")),
      ).toEqual({
        titleKey: "queryError.sqlError",
        messageKey: "queryError.explain.unexpectedToken",
        params: { token: '"ANDD"' },
      });
    });
  });

  describe("unclosed quotes", () => {
    it("explains an unterminated string literal", () => {
      expect(
        explainQueryError(
          'Error# SQL error: TokenizerError("Unterminated string literal at Line: 1, Column: 40")',
        ),
      ).toEqual({
        titleKey: "queryError.sqlError",
        messageKey: "queryError.explain.unclosedQuote",
        params: {},
      });
    });

    it("explains an unclosed double-quoted name", () => {
      expect(
        explainQueryError(
          `Error# SQL error: TokenizerError("Expected close delimiter '"' before EOF. at Line: 1, Column: 40")`,
        ),
      ).toEqual({
        titleKey: "queryError.sqlError",
        messageKey: "queryError.explain.unclosedDelimiter",
        params: { char: '"' },
      });
    });
  });

  describe("unknown names", () => {
    it("names a stream that does not exist", () => {
      expect(explainQueryError("Search stream not found: nosuch_stream")).toEqual({
        titleKey: "queryError.streamNotFound",
        messageKey: "queryError.explain.streamNotFound",
        params: { name: '"nosuch_stream"' },
      });
    });

    it("finds the stream name when the logs page put the backend text into the detail", () => {
      expect(
        explainQueryError("Error: Search stream not found.\nSearch stream not found: nosuch_stream")
          ?.params,
      ).toEqual({ name: '"nosuch_stream"' });
    });

    it("names an unknown field from the streaming response", () => {
      expect(
        explainQueryError(
          "Search field not found: Schema error: No field named nosuchfield.\nValid fields are app_logs._timestamp, app_logs.body.",
        ),
      ).toEqual({
        titleKey: "queryError.fieldNotFound",
        messageKey: "queryError.explain.unknownField",
        params: { name: '"nosuchfield"' },
      });
    });

    it("names an unknown field from the enriched /_search response", () => {
      expect(explainQueryError("unknown field 'nosuchfield'")?.params).toEqual({
        name: '"nosuchfield"',
      });
    });

    it("keeps a qualified or quoted field name whole", () => {
      expect(
        explainQueryError("Schema error: No field named app_logs.foo. Valid fields are a, b.")
          ?.params,
      ).toEqual({ name: '"app_logs.foo"' });
      expect(explainQueryError('Schema error: No field named "Foo".')?.params).toEqual({
        name: '"Foo"',
      });
    });

    it("names an unknown function and passes on the server's suggestion", () => {
      expect(
        explainQueryError(
          "Search function not defined: Error during planning: Invalid function 'foo'.\nDid you mean 'row'?",
        ),
      ).toEqual({
        titleKey: "queryError.functionNotDefined",
        messageKey: "queryError.explain.unknownFunctionSuggest",
        params: { name: '"foo"', suggestion: '"row"' },
      });
    });

    it("names an unknown function without a suggestion", () => {
      expect(explainQueryError("unknown function 'foo'")).toEqual({
        titleKey: "queryError.functionNotDefined",
        messageKey: "queryError.explain.unknownFunction",
        params: { name: '"foo"' },
      });
    });
  });

  describe("type problems", () => {
    const CAST = (type: string) =>
      `Search SQL execute error\nOptimizer rule 'simplify_expressions' failed\ncaused by\nArrow error: Cast error: Cannot cast string 'abc' to value of ${type} type`;

    it.each(["Int64", "UInt32", "Float64"])("explains text compared with a %s field", (type) => {
      expect(explainQueryError(CAST(type))).toEqual({
        titleKey: "queryError.dataTypeMismatch",
        messageKey: "queryError.explain.notANumber",
        params: { value: "'abc'" },
      });
    });

    it("leaves casts to non-numeric types to the generic text", () => {
      expect(explainQueryError(CAST("Timestamp(Microsecond, None)"))).toBeNull();
      expect(explainQueryError(CAST("Boolean"))).toBeNull();
    });

    it("explains arguments a function cannot take", () => {
      expect(
        explainQueryError(
          "Search SQL execute error\ntype_coercion\ncaused by\nError during planning: Failed to coerce arguments to satisfy a call to 'str_match' function: coercion from Utf8View to the signature Exact(Utf8, Utf8) failed.",
        ),
      ).toEqual({
        titleKey: "queryError.dataTypeMismatch",
        messageKey: "queryError.explain.functionArgs",
        params: { name: '"str_match"' },
      });
    });
  });

  describe("aggregation", () => {
    it("names a selected column that is neither grouped nor aggregated", () => {
      expect(
        explainQueryError(
          'Search SQL execute error\nError during planning: Column in SELECT must be in GROUP BY or an aggregate function: While expanding wildcard, column "app_logs.level" must appear in the GROUP BY clause or must be part of an aggregate function, currently only "count(Int64(1))" appears in the SELECT clause satisfies this requirement',
        ),
      ).toEqual({
        titleKey: "queryError.generic",
        messageKey: "queryError.explain.notGrouped",
        params: { name: '"app_logs.level"', groupBy: "GROUP BY" },
      });
    });
  });

  describe("fallback", () => {
    it.each([
      [""],
      ["Search SQL execute error"],
      ["Error: Something went wrong. Internal server error."],
      ["Too many open files (os error 24)"],
      ["Error: Search stream not found."],
      ["Query timed out after 300 seconds"],
      [
        "Search SQL execute error\nOptimizer rule 'eliminate_limit' failed\ncaused by\nError during planning: LIMIT must be >= 0, '-1' was provided",
      ],
    ])("returns null for %j", (text) => {
      expect(explainQueryError(text)).toBeNull();
    });
  });

  describe("noisy messages", () => {
    it("still matches with a trace id and surrounding text", () => {
      expect(
        explainQueryError(
          'Error while processing request. Error# SQL error: ParserError("Expected: identifier, found: EOF") TraceID: 01a18663607a74819c757530ee2ed7c0',
          { query: "  SELECT *\nFROM  " },
        )?.messageKey,
      ).toBe("queryError.explain.missingStream");
    });

    it("matches a field error buried after a long field list", () => {
      const fields = Array.from({ length: 300 }, (_, i) => `app_logs.f${i}`).join(", ");
      expect(
        explainQueryError(
          `Search field not found: Schema error: No field named lvl.\nValid fields are ${fields}.`,
        )?.params,
      ).toEqual({ name: '"lvl"' });
    });
  });
});
