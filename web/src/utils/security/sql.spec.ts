// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import { quoteString } from "./sql";

describe("quoteString", () => {
  it("writes ordinary values as a plain literal, doubling quotes", () => {
    expect(quoteString("abc")).toBe("'abc'");
    expect(quoteString("it's")).toBe("'it''s'");
    // A backslash in the middle is kept as written; the tokenizer leaves it alone.
    expect(quoteString("C:\\Windows\\cmd.exe")).toBe("'C:\\Windows\\cmd.exe'");
  });

  it("spells a backslash before a quote or at the end with chr(92)", () => {
    expect(quoteString("C:\\Windows\\")).toBe("('C:\\Windows' || chr(92))");
    expect(quoteString("[\\'\"]")).toBe("('[' || chr(92) || '''\"]')");
    expect(quoteString("a\\\\")).toBe("('a' || repeat(chr(92), 2))");
    expect(quoteString("\\")).toBe("(chr(92))");
    expect(quoteString("x\\' OR 1=1 --")).toBe("('x' || chr(92) || ''' OR 1=1 --')");
  });

  it("splits before a quote that follows another, as the server does", () => {
    expect(quoteString("")).toBe("''");
    expect(quoteString("a''b")).toBe("('a''' || '''b')");
    expect(quoteString("'''")).toBe("('''' || '''' || '''')");
  });
});
