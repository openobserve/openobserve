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
import {
  sqlLiteral,
  sqlEquals,
  sqlIn,
  sqlLike,
  sqlIsNull,
  unescapeSqlLiteral,
  splitOnAnd,
} from "./sqlFilterBuilder";

// Values here are arbitrary log/trace field data.
const SPECIAL_CHAR_CASES: Array<[label: string, input: string]> = [
  ["embedded single quote", "notificationHandling's"],
  ["multiple embedded quotes", "it's a 'test'"],
  ["backslash", "C:\\Users\\test"],
  ["trailing backslash", "ends\\"],
  ["backslash immediately before a quote", "path\\'s end"],
  ["a quote-closing payload", "nobody\\' OR 1=1 --"],
  ["two adjacent quotes", "a''b"],
  ["only quotes", "'''"],
  ["backslashes and quotes mixed", "\\\\''\\'"],
  ["double quote", 'He said "hi"'],
  ["percent and underscore", "100%_done"],
  ["semicolon", "a;DROP TABLE x"],
  ["SQL comment syntax", "a--b/*c*/d"],
  ["newline and tab", "line1\nline2\tend"],
  ["unicode and emoji", "日本語🚀"],
  ["parens and comparison operators", "a(b)=c<d>e"],
  ["empty string", ""],
];

// Models the backend: sqlparser-rs parses a literal, re-serialises it with `EscapeQuotedString`, then reparses.

/** Parses `'a'`, or `('a' || 'b' …)`, into its piece values; throws on anything else. */
const parseLiteralChain = (sql: string): string[] => {
  let text = sql;
  if (text.startsWith("(") && text.endsWith(")")) text = text.slice(1, -1);
  const pieces: string[] = [];
  let i = 0;
  for (;;) {
    if (text[i] !== "'") throw new Error(`expected a literal at ${i} in ${sql}`);
    let value = "";
    i++;
    for (;;) {
      if (i >= text.length) throw new Error(`unterminated literal in ${sql}`);
      if (text[i] === "'") {
        if (text[i + 1] === "'") {
          value += "'";
          i += 2;
          continue;
        }
        i++;
        break;
      }
      value += text[i++];
    }
    pieces.push(value);
    if (i === text.length) return pieces;
    if (!text.startsWith(" || ", i)) throw new Error(`SQL continues after a literal: ${sql}`);
    i += 4;
  }
};

/** sqlparser-rs `EscapeQuotedString` for `'`. */
const sqlparserDisplay = (value: string): string => {
  let out = "";
  let previous = "";
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === "'" && previous !== "\\") {
      if (value[i + 1] === "'") {
        out += "''";
        i++;
        previous = "'";
        continue;
      }
      out += "''";
    } else {
      out += ch;
    }
    previous = ch;
  }
  return out;
};

const afterReserialising = (literal: string): string => {
  const pieces = parseLiteralChain(literal);
  const shown = pieces.map((piece) => `'${sqlparserDisplay(piece)}'`);
  const again = shown.length > 1 ? `(${shown.join(" || ")})` : shown[0];
  return parseLiteralChain(again).join("");
};

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

  it("keeps a backslash as an ordinary character", () => {
    expect(sqlLiteral("C:\\Users")).toBe("'C:\\Users'");
  });

  it("the model reproduces the bug a plain doubled literal has", () => {
    expect(() => afterReserialising("'a\\''b'")).toThrow();
  });

  for (const [label, input] of SPECIAL_CHAR_CASES) {
    it(`a value containing ${label} survives the backend's re-serialisation`, () => {
      expect(afterReserialising(sqlLiteral(input))).toBe(input);
    });
  }
});

describe("sqlEquals", () => {
  it("builds an include (=) expression", () => {
    expect(sqlEquals("op", "notificationHandling's")).toBe("op='notificationHandling''s'");
  });

  it("builds an exclude (!=) expression when negated", () => {
    expect(sqlEquals("op", "notificationHandling's", true)).toBe("op!='notificationHandling''s'");
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
    expect(sqlLike("message", "o'brien", "contains", true)).toBe("message NOT LIKE '%o''brien%'");
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

describe("unescapeSqlLiteral", () => {
  it("undoubles embedded quotes and round-trips sqlLiteral", () => {
    const raw = "it's a 'test'";
    expect(unescapeSqlLiteral(sqlLiteral(raw).slice(1, -1))).toBe(raw);
  });

  it("leaves plain and non-string values alone", () => {
    expect(unescapeSqlLiteral("plain")).toBe("plain");
    expect(unescapeSqlLiteral(5)).toBe("5");
  });
});

describe("splitOnAnd", () => {
  it.each([
    [
      "splits on AND outside quotes only",
      "a = 'x and y' AND b = '1' and c = 2",
      ["a = 'x and y'", "b = '1'", "c = 2"],
    ],
    [
      "keeps a doubled quote inside the literal",
      "a = 'it''s and ok' AND b = 1",
      ["a = 'it''s and ok'", "b = 1"],
    ],
    [
      "ignores an apostrophe in a comment line",
      "-- don't page\nservice = 'api' AND level = 'error'",
      ["-- don't page\nservice = 'api'", "level = 'error'"],
    ],
    [
      "ignores apostrophes in several comment lines",
      "-- it's noisy\nservice = 'api' AND level = 'error'\n-- that's all",
      ["-- it's noisy\nservice = 'api'", "level = 'error'\n-- that's all"],
    ],
    [
      "falls back to a plain AND split when a quote is left unbalanced",
      "a = 'x AND b = 1",
      ["a = 'x", "b = 1"],
    ],
  ])("%s", (_name, query, expected) => {
    expect(splitOnAnd(query)).toEqual(expected);
  });
});
