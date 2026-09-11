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
import { sqlLiteral, sqlEquals, sqlIn, sqlLike, sqlIsNull } from "./sqlFilterBuilder";

// Values here are arbitrary log/trace field data. The backend's PostgreSqlDialect
// parser (sqlparser-rs) does not support backslash string-literal escapes, so only
// an embedded single quote needs escaping (by doubling) — every other character
// listed is safe once wrapped in quotes. See docs/sql-string-literal-escaping.md.
const SPECIAL_CHAR_CASES: Array<[label: string, input: string]> = [
  ["embedded single quote", "notificationHandling's"],
  ["multiple embedded quotes", "it's a 'test'"],
  ["backslash", "C:\\Users\\test"],
  ["backslash immediately before a quote", "path\\'s end"],
  ["double quote", 'He said "hi"'],
  ["percent and underscore", "100%_done"],
  ["semicolon", "a;DROP TABLE x"],
  ["SQL comment syntax", "a--b/*c*/d"],
  ["newline and tab", "line1\nline2\tend"],
  ["unicode and emoji", "日本語🚀"],
  ["parens and comparison operators", "a(b)=c<d>e"],
  ["empty string", ""],
];

describe("sqlLiteral", () => {
  it("doubles an embedded single quote", () => {
    expect(sqlLiteral("notificationHandling's")).toBe("'notificationHandling''s'");
  });

  it("wraps null/undefined as an empty literal", () => {
    expect(sqlLiteral(null)).toBe("''");
    expect(sqlLiteral(undefined)).toBe("''");
  });

  it("stringifies non-string values", () => {
    expect(sqlLiteral(42)).toBe("'42'");
  });

  for (const [label, input] of SPECIAL_CHAR_CASES) {
    it(`safely wraps a value containing ${label}`, () => {
      const literal = sqlLiteral(input);
      expect(literal.startsWith("'")).toBe(true);
      expect(literal.endsWith("'")).toBe(true);
      // Every unescaped quote in the literal body must be part of a doubled pair.
      const body = literal.slice(1, -1);
      expect(body.replace(/''/g, "")).not.toContain("'");
    });
  }
});

describe("sqlEquals", () => {
  it("builds an include (=) expression", () => {
    expect(sqlEquals("op", "notificationHandling's")).toBe("op='notificationHandling''s'");
  });

  it("builds an exclude (!=) expression when negated", () => {
    expect(sqlEquals("op", "notificationHandling's", true)).toBe(
      "op!='notificationHandling''s'",
    );
  });
});

describe("sqlIn", () => {
  it("builds a quoted, comma-joined IN list", () => {
    expect(sqlIn("view_id", ["o'brien", "plain"])).toBe("view_id IN ('o''brien','plain')");
  });

  it("degrades to a constant-false predicate for no values, since IN () is invalid SQL", () => {
    expect(sqlIn("view_id", [])).toBe("1=0");
  });
});

describe("sqlLike", () => {
  it("builds a contains pattern by default", () => {
    expect(sqlLike("message", "o'brien")).toBe("message LIKE '%o''brien%'");
  });

  it("builds a starts-with pattern", () => {
    expect(sqlLike("message", "o'brien", "start")).toBe("message LIKE 'o''brien%'");
  });

  it("builds an ends-with pattern", () => {
    expect(sqlLike("message", "o'brien", "end")).toBe("message LIKE '%o''brien'");
  });

  it("negates to NOT LIKE", () => {
    expect(sqlLike("message", "o'brien", "contains", true)).toBe(
      "message NOT LIKE '%o''brien%'",
    );
  });
});

describe("sqlIsNull", () => {
  it("builds IS NULL", () => {
    expect(sqlIsNull("brand")).toBe("brand IS NULL");
  });

  it("builds IS NOT NULL when negated", () => {
    expect(sqlIsNull("brand", true)).toBe("brand IS NOT NULL");
  });
});
