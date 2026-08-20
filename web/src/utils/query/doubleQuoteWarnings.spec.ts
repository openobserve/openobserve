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

// TDD spec for tmp/code.md section E — the double-quote warning.
//
// CodeQueryEditor.validateDoubleQuotes regexes the RAW query text, so anything
// shaped like `field = "value"` is flagged wherever it appears: inside a `--`
// comment, inside a block comment, or inside a single-quoted string that
// legitimately contains double quotes. The warning is then wrong, and a wrong
// warning on valid SQL is worse than no warning — users learn to ignore the
// squiggle, including the times it is right.
//
// The scan moves out of the component and into a pure function so it can be
// tested at all: today it needs a mounted editor, a monaco model and the marker
// API to observe a decision that is really just string in, offsets out. The
// component keeps the monaco half — offsets to positions, positions to markers.

import { describe, it, expect } from "vitest";
import { findDoubleQuoteIssues } from "./doubleQuoteWarnings";
import { gt } from "@/types/i18n";

/** The substring each issue points at, so offsets are checked, not just counts. */
const flagged = (sql: string) =>
  findDoubleQuoteIssues(gt, sql).map((i) => sql.slice(i.startOffset, i.endOffset));

describe("findDoubleQuoteIssues — what it must still flag", () => {
  it("flags a double-quoted value after a comparison", () => {
    expect(flagged(`SELECT * FROM t WHERE level = "error"`)).toEqual([`"error"`]);
  });

  it("flags every comparison and membership operator", () => {
    for (const op of ["=", "!=", "<>", ">=", "<=", ">", "<", "LIKE"]) {
      expect(flagged(`WHERE a ${op} "x"`), op).toEqual([`"x"`]);
    }
    expect(flagged(`WHERE a IN ("x")`)).toEqual([`"x"`]);
    expect(flagged(`WHERE a NOT IN ("x")`)).toEqual([`"x"`]);
    expect(flagged(`WHERE a NOT LIKE "x"`)).toEqual([`"x"`]);
  });

  it("flags mismatched quotes in both directions", () => {
    expect(flagged(`WHERE a = "x'`)).toEqual([`"x'`]);
    expect(flagged(`WHERE a = 'x"`)).toEqual([`'x"`]);
  });

  it("separates the two messages", () => {
    const [plain] = findDoubleQuoteIssues(gt, `WHERE a = "x"`);
    const [mixed] = findDoubleQuoteIssues(gt, `WHERE a = "x'`);
    expect(plain.message).toMatch(/single quotes/i);
    expect(mixed.message).toMatch(/mismatched/i);
  });

  it("reports offsets that point at the quoted token itself", () => {
    const sql = `SELECT * FROM t WHERE level = "error"`;
    const [issue] = findDoubleQuoteIssues(gt, sql);
    expect(sql.slice(issue.startOffset, issue.endOffset)).toBe(`"error"`);
    // The marker must not swallow the operator or the spaces before it.
    expect(sql[issue.startOffset]).toBe('"');
  });

  it("flags each of several occurrences", () => {
    expect(flagged(`WHERE a = "x" AND b = "y"`)).toEqual([`"x"`, `"y"`]);
  });

  it("leaves identifier quoting alone", () => {
    // FROM "stream" and SELECT "column" are correct SQL and always were.
    expect(flagged(`SELECT "col" FROM "stream"`)).toEqual([]);
  });
});

describe("findDoubleQuoteIssues — what it must stop flagging", () => {
  it("ignores a line comment", () => {
    expect(flagged(`-- level = "error"\nSELECT * FROM t`)).toEqual([]);
  });

  it("ignores a line comment that trails real SQL", () => {
    expect(flagged(`SELECT * FROM t -- try level = "error"`)).toEqual([]);
  });

  it("ignores a block comment, including a multi-line one", () => {
    expect(flagged(`/* level = "error" */ SELECT 1`)).toEqual([]);
    expect(flagged(`/*\n  level = "error"\n*/\nSELECT 1`)).toEqual([]);
  });

  it("ignores double quotes inside a single-quoted string", () => {
    // A legal literal that happens to contain the shape being matched.
    expect(flagged(`WHERE msg = 'he said "hi"'`)).toEqual([]);
  });

  it("ignores an operator that only appears inside a string", () => {
    expect(flagged(`WHERE msg = 'a = "b"' AND c = 'd'`)).toEqual([]);
  });

  it("still flags real SQL on the line after a comment", () => {
    // The comment must end at the newline, not swallow the rest of the query.
    expect(flagged(`-- a note\nWHERE level = "error"`)).toEqual([`"error"`]);
  });

  it("still flags real SQL after a block comment closes", () => {
    expect(flagged(`/* note */ WHERE level = "error"`)).toEqual([`"error"`]);
  });

  it("still flags real SQL after a string literal closes", () => {
    expect(flagged(`WHERE msg = 'ok' AND level = "error"`)).toEqual([`"error"`]);
  });

  it("treats a doubled quote inside a literal as an escape, not a terminator", () => {
    // 'it''s' is one string. Reading the middle pair as a close-then-open would
    // put the scanner out of phase for the rest of the query.
    expect(flagged(`WHERE msg = 'it''s fine' AND level = "error"`)).toEqual([`"error"`]);
  });

  it("does not treat a lone minus as the start of a comment", () => {
    expect(flagged(`WHERE a - b = "x"`)).toEqual([`"x"`]);
  });
});

describe("findDoubleQuoteIssues — degenerate input", () => {
  it("returns nothing for empty or whitespace-only input", () => {
    expect(findDoubleQuoteIssues(gt, "")).toEqual([]);
    expect(findDoubleQuoteIssues(gt, "   \n  ")).toEqual([]);
  });

  it("does not hang or throw on an unterminated string or comment", () => {
    expect(() => findDoubleQuoteIssues(gt, `WHERE a = 'unterminated`)).not.toThrow();
    expect(() => findDoubleQuoteIssues(gt, `/* unterminated`)).not.toThrow();
    expect(flagged(`/* unterminated ... level = "error"`)).toEqual([]);
  });
});
