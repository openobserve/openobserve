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

// TDD spec for tmp/code.md Phase 3 — the two providers the editor has never
// had. Completion tells you a function EXISTS; signature help tells you what to
// type next, and hover tells you what something is without typing at all.
//
// Both derive from the same catalog entries completion already uses, so the
// only new logic is: work out which call the cursor sits in, and render an
// entry for each surface.

import { describe, it, expect } from "vitest";
import { SQL_FUNCTIONS } from "./sqlCompletion";
import {
  parseCallContext,
  buildSignatureHelp,
  buildHoverContents,
  findCatalogEntry,
  findFunctionEntry,
  isNumericField,
  wantsNumericColumn,
  rankNumericFieldsFirst,
  parseValueContext,
  buildValueEntries,
} from "./editorProviders";
import { gt } from "@/types/i18n";

const fn = (name: string) => SQL_FUNCTIONS.find((f) => f.name === name)!;

// ───────────────────────────────────────────────────────────────────────────
// parseCallContext — which call is the cursor inside, and on which argument
// ───────────────────────────────────────────────────────────────────────────

describe("parseCallContext — locating the enclosing call", () => {
  it("returns null when the cursor is not inside a call", () => {
    expect(parseCallContext("")).toBeNull();
    expect(parseCallContext("SELECT ")).toBeNull();
    expect(parseCallContext("SELECT * FROM logs WHERE ")).toBeNull();
  });

  it("finds the function as soon as the paren opens", () => {
    expect(parseCallContext("SELECT histogram(")).toEqual({
      name: "histogram",
      activeParameter: 0,
    });
  });

  it("stays on argument 0 while the first argument is being typed", () => {
    expect(parseCallContext("SELECT histogram(_timestamp")).toEqual({
      name: "histogram",
      activeParameter: 0,
    });
  });

  it("advances to the next argument after a comma", () => {
    expect(parseCallContext("SELECT histogram(_timestamp, ")).toEqual({
      name: "histogram",
      activeParameter: 1,
    });
  });

  it("stays on that argument while it is being typed", () => {
    expect(parseCallContext("SELECT histogram(_timestamp, '30 sec")).toEqual({
      name: "histogram",
      activeParameter: 1,
    });
  });

  it("returns null once the call is closed", () => {
    expect(parseCallContext("SELECT histogram(_timestamp, '30 second')")).toBeNull();
  });

  it("reports the INNERMOST open call when calls are nested", () => {
    expect(parseCallContext("SELECT sum(abs(")).toEqual({ name: "abs", activeParameter: 0 });
  });

  it("returns to the outer call once the inner one closes", () => {
    expect(parseCallContext("SELECT sum(abs(x), ")).toEqual({ name: "sum", activeParameter: 1 });
  });

  it("ignores commas inside a string literal", () => {
    // Otherwise typing a value containing a comma silently advances the hint
    // to the wrong parameter.
    expect(parseCallContext("str_match(body, 'a,b'")).toEqual({
      name: "str_match",
      activeParameter: 1,
    });
  });

  it("ignores parens inside a string literal", () => {
    expect(parseCallContext("str_match(body, 'f(x'")).toEqual({
      name: "str_match",
      activeParameter: 1,
    });
  });

  it("handles a doubled quote as an escaped quote, not a string boundary", () => {
    expect(parseCallContext("str_match(body, 'it''s, fine', ")).toEqual({
      name: "str_match",
      activeParameter: 2,
    });
  });

  it("works across newlines", () => {
    expect(parseCallContext("SELECT sum(\n  amount")).toEqual({
      name: "sum",
      activeParameter: 0,
    });
  });

  it("returns null when the paren has no identifier before it at all", () => {
    // `WHERE (` would NOT belong here: WHERE is an identifier as far as a
    // syntactic parser is concerned, and the test below requires it to be
    // reported. Using it here made this pair mutually unsatisfiable.
    expect(parseCallContext("(")).toBeNull();
    expect(parseCallContext("WHERE x = (")).toBeNull();
    expect(parseCallContext("SELECT 1 + (")).toBeNull();
  });

  it("tolerates whitespace between the name and the paren", () => {
    expect(parseCallContext("SELECT sum (")).toEqual({ name: "sum", activeParameter: 0 });
  });

  // This parser is purely syntactic: it reports whatever identifier precedes
  // the open paren, including a SQL keyword. It cannot do otherwise — `WHERE (`
  // and `sum (` are the same shape, and the text alone does not say which is a
  // function. Rejecting non-functions is the catalog's job (see below), which
  // is also what keeps a column named like a keyword from breaking anything.
  it("reports a preceding keyword rather than trying to judge it", () => {
    expect(parseCallContext("WHERE (a > 1 AND ")).toEqual({
      name: "WHERE",
      activeParameter: 0,
    });
  });
});

describe("keyword-shaped call sites produce no signature", () => {
  it("the catalog rejects what the parser cannot", () => {
    // End to end: `WHERE (` parses, then finds no function, so the provider has
    // nothing to show. Neither half can make that decision alone.
    const ctx = parseCallContext("WHERE (a > 1 AND ")!;
    expect(ctx.name).toBe("WHERE");
    expect(findFunctionEntry(ctx.name, [], SQL_FUNCTIONS)).toBeNull();
    expect(buildSignatureHelp(findFunctionEntry(ctx.name, [], SQL_FUNCTIONS), 0)).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// buildSignatureHelp — render one catalog entry as monaco's SignatureHelp
// ───────────────────────────────────────────────────────────────────────────

describe("buildSignatureHelp", () => {
  it("labels the signature with the name and its arguments", () => {
    const help = buildSignatureHelp(fn("histogram"), 0)!;
    expect(help.signatures[0].label).toBe("histogram(field, interval)");
  });

  it("splits the detail into one parameter per argument", () => {
    const help = buildSignatureHelp(fn("histogram"), 0)!;
    expect(help.signatures[0].parameters.map((p: any) => p.label)).toEqual(["field", "interval"]);
  });

  it("reports the active parameter so monaco can bold it", () => {
    expect(buildSignatureHelp(fn("histogram"), 1)!.activeParameter).toBe(1);
  });

  it("clamps a runaway active parameter to the last one", () => {
    // Typing extra commas must not leave monaco pointing past the end.
    expect(buildSignatureHelp(fn("histogram"), 9)!.activeParameter).toBe(1);
  });

  it("carries the documentation so the hint explains the function", () => {
    const help = buildSignatureHelp(fn("approx_topk"), 0)!;
    expect(help.signatures[0].documentation).toEqual({ value: fn("approx_topk").documentation });
  });

  it("always reports a single active signature", () => {
    expect(buildSignatureHelp(fn("sum"), 0)!.activeSignature).toBe(0);
  });

  it("handles a zero-argument entry without inventing parameters", () => {
    const help = buildSignatureHelp(
      { name: "now", label: "now", kind: "Function", insertText: "now()", detail: "()" },
      0,
    )!;
    expect(help.signatures[0].parameters).toEqual([]);
    expect(help.activeParameter).toBe(0);
  });

  it("degrades gracefully when the signature is opaque", () => {
    const help = buildSignatureHelp(
      { name: "x", label: "x", kind: "Function", insertText: "x()", detail: "(...)" },
      0,
    )!;
    expect(help.signatures[0].label).toBe("x(...)");
    expect(help.signatures[0].parameters).toEqual([]);
  });

  it("returns null for an entry it cannot describe", () => {
    expect(buildSignatureHelp(null, 0)).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// findCatalogEntry — resolve the word under the cursor
// ───────────────────────────────────────────────────────────────────────────

describe("findCatalogEntry", () => {
  const fields = [
    {
      name: "host_name",
      label: "host_name",
      kind: "Field" as const,
      insertText: "host_name",
      detail: "Utf8",
    },
  ];

  it("finds a function from the suggestion catalog", () => {
    expect(findCatalogEntry("histogram", fields, SQL_FUNCTIONS)?.name).toBe("histogram");
  });

  it("finds a field from the keyword list", () => {
    expect(findCatalogEntry("host_name", fields, SQL_FUNCTIONS)?.kind).toBe("Field");
  });

  it("matches case-insensitively, as SQL is written both ways", () => {
    expect(findCatalogEntry("HISTOGRAM", fields, SQL_FUNCTIONS)?.name).toBe("histogram");
  });

  it("returns null for an unknown word rather than guessing", () => {
    expect(findCatalogEntry("not_a_function", fields, SQL_FUNCTIONS)).toBeNull();
  });

  it("returns null for an empty word", () => {
    expect(findCatalogEntry("", fields, SQL_FUNCTIONS)).toBeNull();
  });

  it("prefers the field when a bare word matches both a field and a function", () => {
    // Hovering `count` in `WHERE count > 5` is about the column.
    const shadow = [
      {
        name: "count",
        label: "count",
        kind: "Field" as const,
        insertText: "count",
        detail: "Int64",
      },
    ];
    expect(findCatalogEntry("count", shadow, SQL_FUNCTIONS)?.kind).toBe("Field");
  });
});

describe("findFunctionEntry — call sites resolve to FUNCTIONS", () => {
  it("resolves a function even when a column shadows its name", () => {
    // Signature help runs at `count(`, which is unambiguously a call. Reusing
    // the field-preferring lookup here would silently produce no signature for
    // any function whose name matches a column in the stream.
    const shadow = [
      {
        name: "count",
        label: "count",
        kind: "Field" as const,
        insertText: "count",
        detail: "Int64",
      },
    ];
    expect(findFunctionEntry("count", shadow as any, SQL_FUNCTIONS)?.kind).toBe("Function");
  });

  it("matches case-insensitively", () => {
    expect(findFunctionEntry("HISTOGRAM", [], SQL_FUNCTIONS)?.name).toBe("histogram");
  });

  it("returns null for a word that is not a function", () => {
    const fields = [
      { name: "host_name", label: "host_name", kind: "Field" as const, insertText: "host_name" },
    ];
    expect(findFunctionEntry("host_name", fields as any, SQL_FUNCTIONS)).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// buildHoverContents
// ───────────────────────────────────────────────────────────────────────────

describe("buildHoverContents", () => {
  it("shows a function's signature as code", () => {
    const [head] = buildHoverContents(gt, fn("histogram"))!;
    expect(head.value).toContain("histogram(field, interval)");
    expect(head.value).toContain("```");
  });

  it("shows the function's prose underneath", () => {
    const contents = buildHoverContents(gt, fn("histogram"))!;
    expect(contents.map((c) => c.value).join("\n")).toContain(fn("histogram").documentation);
  });

  it("shows a field's column type", () => {
    const contents = buildHoverContents(gt, {
      name: "host_name",
      label: "host_name",
      kind: "Field",
      insertText: "host_name",
      detail: "Utf8",
    })!;
    expect(contents[0].value).toContain("host_name");
    expect(contents[0].value).toContain("Utf8");
  });

  it("does not claim a type for a field that has none", () => {
    const contents = buildHoverContents(gt, {
      name: "mystery",
      label: "mystery",
      kind: "Field",
      insertText: "mystery",
    })!;
    expect(contents[0].value).toContain("mystery");
    expect(contents[0].value).not.toContain("undefined");
  });

  it("marks a deprecated entry as deprecated from the FLAG, not its prose", () => {
    // Using match_all_raw here would prove nothing: its documentation already
    // begins "Deprecated alias for...", so the assertion would pass even if the
    // `deprecated` flag were ignored entirely.
    const contents = buildHoverContents(gt, {
      name: "legacy_fn",
      label: "legacy_fn",
      kind: "Function",
      insertText: "legacy_fn()",
      detail: "()",
      documentation: "Does a thing.",
      deprecated: true,
    })!;
    expect(
      contents
        .map((c) => c.value)
        .join(" ")
        .toLowerCase(),
    ).toContain("deprecated");
  });

  it("does not call a live function deprecated", () => {
    const contents = buildHoverContents(gt, fn("match_all"))!;
    expect(
      contents
        .map((c) => c.value)
        .join(" ")
        .toLowerCase(),
    ).not.toContain("deprecated");
  });

  it("returns null when there is nothing to say", () => {
    expect(buildHoverContents(gt, null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Organisation VRL functions
//
// These do NOT live in the suggestion catalog. updateFunctionKeywords pushes
// them into the KEYWORDS list with kind "Function", and -- unlike every catalog
// entry -- they carry a `label` and no `name`. A lookup that searched only
// suggestions, or keyed only off `name`, would leave signature help and hover
// silently dead for exactly the functions a user is least likely to know.
// ---------------------------------------------------------------------------

describe("org VRL functions reach the providers", () => {
  const orgFn = {
    label: "my_org_fn",
    kind: "Function" as const,
    insertText: "my_org_fn('${1:value}')",
    insertTextRules: "InsertAsSnippet" as const,
    sortText: "my_org_fn",
  };
  const keywords = [
    { name: "host_name", label: "host_name", kind: "Field" as const, insertText: "host_name" },
    orgFn,
  ];

  it("findFunctionEntry finds a function that lives in the KEYWORDS list", () => {
    expect(findFunctionEntry("my_org_fn", keywords as any, SQL_FUNCTIONS)).toBeTruthy();
  });

  it("matches on `label` when the entry has no `name`", () => {
    const found = findFunctionEntry("my_org_fn", keywords as any, SQL_FUNCTIONS)!;
    expect(found.label).toBe("my_org_fn");
  });

  it("still refuses a Field of the same shape", () => {
    expect(findFunctionEntry("host_name", keywords as any, SQL_FUNCTIONS)).toBeNull();
  });

  it("builds a usable signature even with no detail metadata", () => {
    // The keywords path carries no `detail`, so there are no parameter names to
    // show. It must degrade to a bare label, not print "undefined".
    const help = buildSignatureHelp(orgFn as any, 0)!;
    expect(help.signatures[0].label).toContain("my_org_fn");
    expect(help.signatures[0].label).not.toContain("undefined");
    expect(help.signatures[0].parameters).toEqual([]);
  });

  it("hovers without inventing a signature or a type", () => {
    const contents = buildHoverContents(gt, orgFn as any)!;
    const text = contents.map((c) => c.value).join(" ");
    expect(text).toContain("my_org_fn");
    expect(text).not.toContain("undefined");
  });
});

describe("parseCallContext ignores SQL comments", () => {
  it("does not treat a call inside a line comment as the enclosing call", () => {
    // An unclosed paren in a comment would otherwise pin the hint to a function
    // the user is not writing.
    expect(parseCallContext("-- sum(\nSELECT ")).toBeNull();
  });

  it("still finds a real call on a line after a comment", () => {
    expect(parseCallContext("-- a note\nSELECT abs(")).toEqual({
      name: "abs",
      activeParameter: 0,
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Numeric-column ranking
//
// Reported from the SLO form: inside approx_percentile_cont( on a metrics
// stream the dropdown offered twenty string labels and buried `value` — the
// only column the function can take — below the fold. The list was correct and
// useless at the same time.
//
// This RANKS, it does not filter. A declared type is a strong hint, not a rule
// (a quantity stored as Utf8 is still a legal argument), and hiding a column
// the user knows is there is worse than ordering it late.
// ───────────────────────────────────────────────────────────────────────────

// The field lane prefix, written as an ESCAPE: a raw control character in a
// source file is invisible in review and easy to mangle in an edit.
const FIELD_LANE = "\u0000";

describe("isNumericField — what counts as a numeric column", () => {
  const field = (detail?: string) => ({ label: "c", kind: "Field", detail }) as any;

  it("accepts the arrow types a stream schema actually reports", () => {
    for (const t of ["Int64", "Int32", "UInt8", "Float64", "Float32", "Decimal128(10, 2)"]) {
      expect(isNumericField(field(t)), t).toBe(true);
    }
  });

  it("rejects the non-numeric ones", () => {
    for (const t of ["Utf8", "Boolean", "Binary", "Timestamp(Nanosecond, None)"]) {
      expect(isNumericField(field(t)), t).toBe(false);
    }
  });

  it("is case-insensitive, since the type key varies by API", () => {
    expect(isNumericField(field("float64"))).toBe(true);
  });

  it("treats an unknown type as non-numeric rather than guessing", () => {
    expect(isNumericField(field(undefined))).toBe(false);
    expect(isNumericField(field(""))).toBe(false);
  });

  it("never promotes a non-Field entry, whatever its detail says", () => {
    // A function whose detail mentions a numeric type is still a function and
    // must not be ranked in among the columns.
    expect(isNumericField({ label: "abs", kind: "Function", detail: "(Int64)" } as any)).toBe(
      false,
    );
  });
});

describe("wantsNumericColumn — when the ranking applies", () => {
  it("applies to the first argument of a numeric aggregate", () => {
    expect(wantsNumericColumn(parseCallContext("SELECT approx_percentile_cont("))).toBe(true);
    expect(wantsNumericColumn(parseCallContext("SELECT avg("))).toBe(true);
    expect(wantsNumericColumn(parseCallContext("SELECT sum(x"))).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(wantsNumericColumn(parseCallContext("SELECT AVG("))).toBe(true);
  });

  it("stops applying past the first argument", () => {
    // approx_percentile_cont(value, 0.95) — argument 1 is a fraction, not a
    // column, so there is nothing to rank.
    expect(wantsNumericColumn(parseCallContext("SELECT approx_percentile_cont(value, "))).toBe(
      false,
    );
  });

  it("does not apply to functions that take any type", () => {
    expect(wantsNumericColumn(parseCallContext("SELECT count("))).toBe(false);
    expect(wantsNumericColumn(parseCallContext("SELECT str_match("))).toBe(false);
  });

  it("does not apply outside a call", () => {
    expect(wantsNumericColumn(null)).toBe(false);
    expect(wantsNumericColumn(parseCallContext("SELECT "))).toBe(false);
  });

  it("does not apply to a WHERE group, which parses as a call with no function", () => {
    expect(wantsNumericColumn(parseCallContext("SELECT * FROM t WHERE ("))).toBe(false);
  });
});

describe("rankNumericFieldsFirst", () => {
  const entries = [
    {
      label: "availability_zone",
      kind: "Field",
      detail: "Utf8",
      sortText: `${FIELD_LANE}availability_zone`,
    },
    { label: "value", kind: "Field", detail: "Float64", sortText: `${FIELD_LANE}value` },
    { label: "duration_ms", kind: "Field", detail: "Int64", sortText: `${FIELD_LANE}duration_ms` },
    { label: "avg", kind: "Function", detail: "(field)", sortText: "\u0001avg" },
  ] as any[];

  // localeCompare ignores the control characters the lanes are built from, so
  // compare the raw code units — the same order monaco applies.
  const order = (list: any[]) =>
    [...list]
      .sort((a, b) => (String(a.sortText) < String(b.sortText) ? -1 : 1))
      .map((e) => e.label);

  it("sorts every numeric column above every string one", () => {
    expect(order(rankNumericFieldsFirst(entries))).toEqual([
      "duration_ms",
      "value",
      "availability_zone",
      "avg",
    ]);
  });

  it("leaves the functions below the columns", () => {
    const ranked = order(rankNumericFieldsFirst(entries));
    expect(ranked.indexOf("avg")).toBeGreaterThan(ranked.indexOf("availability_zone"));
  });

  it("does not drop, add or rewrite any entry", () => {
    const ranked = rankNumericFieldsFirst(entries);
    expect(ranked).toHaveLength(entries.length);
    expect(ranked.map((e: any) => e.label).sort()).toEqual(entries.map((e) => e.label).sort());
    expect(ranked.find((e: any) => e.label === "value")!.detail).toBe("Float64");
  });

  it("does not mutate the caller's entries", () => {
    // These are the composable's live refs. Mutating them would make the
    // ranking permanent instead of contextual.
    const before = entries.map((e) => e.sortText);
    rankNumericFieldsFirst(entries);
    expect(entries.map((e) => e.sortText)).toEqual(before);
  });

  it("orders a field with no sortText by its own name", () => {
    const ranked = rankNumericFieldsFirst([
      { label: "b_num", kind: "Field", detail: "Int64" },
      { label: "a_num", kind: "Field", detail: "Int64" },
    ] as any[]);
    expect(order(ranked)).toEqual(["a_num", "b_num"]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Field VALUE completion
//
// parseValueContext decides the cursor is where a value belongs;
// buildValueEntries decides how to insert one. The quoting is the fiddly half:
// monaco AUTO-CLOSES a typed quote, so the text is already `level = ''` with
// the cursor between them, and appending our own closer produced
// `level = 'error''` — reported from the SLO scope field.
// ───────────────────────────────────────────────────────────────────────────

describe("parseValueContext — where a value belongs", () => {
  it("recognises the comparison operators", () => {
    for (const op of ["=", "!=", "<>", ">", "<", ">=", "<="]) {
      expect(parseValueContext(`WHERE code ${op} `)?.field, op).toBe("code");
    }
  });

  it("recognises IN, NOT IN and LIKE", () => {
    expect(parseValueContext("WHERE level IN (")?.field).toBe("level");
    expect(parseValueContext("WHERE level NOT IN (")?.field).toBe("level");
    expect(parseValueContext("WHERE body LIKE ")?.field).toBe("body");
  });

  it("recognises the match functions' value argument", () => {
    expect(parseValueContext("WHERE str_match(body, ")?.field).toBe("body");
    expect(parseValueContext("WHERE fuzzy_match(body, ")?.field).toBe("body");
  });

  it("reports an open quote so the inserted value can close it", () => {
    expect(parseValueContext("WHERE level = '")).toEqual({ field: "level", hasOpenQuote: true });
    expect(parseValueContext("WHERE level = ")).toEqual({ field: "level", hasOpenQuote: false });
  });

  it("stays open while the value is being typed", () => {
    expect(parseValueContext("WHERE level = 'err")).toEqual({ field: "level", hasOpenQuote: true });
  });

  it("is not fooled by a CLOSED quote from an earlier condition", () => {
    // `http = 'te'` has no unterminated quote; the new condition must not
    // inherit one, or its value would be inserted with a stray closer.
    expect(parseValueContext("WHERE http = 'te' AND level = ")).toEqual({
      field: "level",
      hasOpenQuote: false,
    });
  });

  it("returns null where no value belongs", () => {
    expect(parseValueContext("")).toBeNull();
    expect(parseValueContext("SELECT ")).toBeNull();
    expect(parseValueContext("SELECT * FROM logs WHERE ")).toBeNull();
  });
});

describe("buildValueEntries — inserting a value", () => {
  const RANGE = { startLineNumber: 1, endLineNumber: 1, startColumn: 12, endColumn: 12 };
  const insert = (v: string[], o: any) => buildValueEntries(v, o).map((e) => e.insertText);

  it("wraps a bare string in quotes when none was typed", () => {
    expect(insert(["error"], { hasOpenQuote: false })).toEqual(["'error'"]);
  });

  it("closes the quote the user opened", () => {
    expect(insert(["error"], { hasOpenQuote: true })).toEqual(["error'"]);
  });

  it("leaves numbers and booleans unquoted", () => {
    expect(insert(["200", "true", "false", "1.5"], { hasOpenQuote: false })).toEqual([
      "200",
      "true",
      "false",
      "1.5",
    ]);
  });

  it("quotes a value that only looks empty", () => {
    expect(insert([""], { hasOpenQuote: false })).toEqual(["''"]);
  });

  it("sorts values above every other lane, in the order given", () => {
    const entries = buildValueEntries(["b", "a"], { hasOpenQuote: false });
    expect(entries.map((e) => e.sortText)).toEqual(["\u0000000000", "\u0000000001"]);
    expect(entries.every((e) => e.kind === "Value")).toBe(true);
  });

  describe("when monaco has already auto-closed the quote", () => {
    const opts = { hasOpenQuote: true, closingQuoteAhead: true, range: RANGE };

    it("still inserts its own closing quote", () => {
      expect(insert(["error"], opts)).toEqual(["error'"]);
    });

    it("extends the range over monaco's quote so it is not left behind", () => {
      // Text-only alternatives (omit the closer, keep the range) produce the
      // right string but park the cursor INSIDE the literal, so the next thing
      // typed lands inside the quotes.
      const [entry] = buildValueEntries(["error"], opts);
      expect(entry.range).toEqual({ ...RANGE, endColumn: RANGE.endColumn + 1 });
    });

    it("does NOT extend it for a numeric value, which inserts no closer", () => {
      // Swallowing the quote there would leave `status = '200` unterminated.
      const [entry] = buildValueEntries(["200"], opts);
      expect(entry.range).toBeUndefined();
      expect(entry.insertText).toBe("200");
    });

    it("does not touch the range when no quote is ahead", () => {
      expect(
        buildValueEntries(["error"], { hasOpenQuote: true, range: RANGE })[0].range,
      ).toBeUndefined();
    });

    it("degrades to text-only when the caller supplies no range", () => {
      const [entry] = buildValueEntries(["error"], { hasOpenQuote: true, closingQuoteAhead: true });
      expect(entry.insertText).toBe("error'");
      expect(entry.range).toBeUndefined();
    });
  });
});
