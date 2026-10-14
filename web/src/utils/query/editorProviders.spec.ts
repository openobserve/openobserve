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
import { SQL_CLAUSE_KEYWORDS, SQL_FUNCTIONS, SQL_KEYWORDS } from "./sqlCompletion";
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
  buildValueStatusEntry,
  orderValues,
  columnKind,
  fieldEntriesOf,
  isValueAnswerStale,
  literalStateAtEnd,
  takeValueGuardSnapshot,
  VALUE_WAIT_BUDGET_MS,
  buildOperatorLane,
  isCaretInComment,
  isPredicatePosition,
  parseOperatorContext,
  parseLogicalLeadContext,
  logicalLeadNames,
  buildLogicalLead,
  groupEntries,
  matchesTyped,
  type LogicalLeadContext,
  OPERATORS_BY_TYPE,
} from "./editorProviders";
import { validateSql } from "./sqlDiagnostics";
import { registerAcceptCommands, resetKeyContractForTests } from "./editorKeyContract";
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
    expect(parseValueContext("WHERE level = '")).toMatchObject({
      field: "level",
      hasOpenQuote: true,
    });
    expect(parseValueContext("WHERE level = ")).toMatchObject({
      field: "level",
      hasOpenQuote: false,
    });
  });

  it("stays open while the value is being typed", () => {
    expect(parseValueContext("WHERE level = 'err")).toMatchObject({
      field: "level",
      hasOpenQuote: true,
      typed: "err",
    });
  });

  it("is not fooled by a CLOSED quote from an earlier condition", () => {
    // `http = 'te'` has no unterminated quote; the new condition must not
    // inherit one, or its value would be inserted with a stray closer.
    expect(parseValueContext("WHERE http = 'te' AND level = ")).toMatchObject({
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

    it("closes a quoted number too: the user chose a string literal", () => {
      const [entry] = buildValueEntries(["200"], opts);
      expect(entry.insertText).toBe("200'");
      expect(entry.range).toEqual({ ...RANGE, endColumn: RANGE.endColumn + 1 });
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

describe("parseValueContext — never inside someone else's string", () => {
  it("does not treat `key=` inside a string literal as a comparison", () => {
    expect(parseValueContext("WHERE match_all('user=")).toBeNull();
    expect(parseValueContext("WHERE match_all('code > 5")).toBeNull();
  });

  it("still opens values for a quote the comparison itself opened", () => {
    expect(parseValueContext("WHERE a = 'x' AND level = 'er")).toMatchObject({
      field: "level",
      hasOpenQuote: true,
      typed: "er",
    });
  });

  it("is not fooled by a comment", () => {
    expect(parseValueContext("SELECT 1 -- level = ")).toBeNull();
  });
});

describe("parseValueContext — bare values and the wider operator set", () => {
  it("keeps value help while a bare value is typed", () => {
    expect(parseValueContext("WHERE code = 50")).toMatchObject({
      field: "code",
      hasOpenQuote: false,
      typed: "50",
      operator: "compare",
    });
    expect(parseValueContext("WHERE host = api-g")).toMatchObject({ typed: "api-g" });
  });

  it("recognises = and comparison operators typed without spaces", () => {
    expect(parseValueContext("WHERE level=")?.field).toBe("level");
    expect(parseValueContext("WHERE code>")?.field).toBe("code");
    expect(parseValueContext("WHERE code>=")?.field).toBe("code");
  });

  it("gives ILIKE and NOT LIKE values, as a pattern", () => {
    expect(parseValueContext("WHERE body ILIKE ")).toMatchObject({
      field: "body",
      operator: "like",
    });
    expect(parseValueContext("WHERE body NOT LIKE '")).toMatchObject({
      field: "body",
      operator: "like",
      hasOpenQuote: true,
    });
  });

  it("offers values for a later IN element once its quote is typed", () => {
    expect(parseValueContext("WHERE service IN ('checkout', '")).toMatchObject({
      field: "service",
      operator: "in",
      hasOpenQuote: true,
    });
    expect(parseValueContext("WHERE service IN ('checkout', 'ca")).toMatchObject({ typed: "ca" });
  });

  it("continues an IN list after each comma, bare or quoted, for IN and NOT IN", () => {
    expect(parseValueContext("WHERE service IN ('checkout',c")).toMatchObject({
      field: "service",
      operator: "in",
      hasOpenQuote: false,
      typed: "c",
      chosen: ["checkout"],
    });
    expect(parseValueContext("WHERE service IN ('checkout', ")).toMatchObject({
      typed: "",
      chosen: ["checkout"],
    });
    expect(parseValueContext("WHERE service NOT IN ('a', 'b', 'ca")).toMatchObject({
      hasOpenQuote: true,
      typed: "ca",
      chosen: ["a", "b"],
    });
    expect(parseValueContext("WHERE service in (c")).toMatchObject({ typed: "c", chosen: [] });
    expect(parseValueContext("WHERE code IN (200, 4")).toMatchObject({
      field: "code",
      typed: "4",
      chosen: ["200"],
    });
    expect(parseValueContext("WHERE t.k8s_cluster IN ('a', ")?.field).toBe("k8s_cluster");
  });

  it("unescapes a chosen value with a doubled quote", () => {
    expect(parseValueContext("WHERE name IN ('O''Brien', ")?.chosen).toEqual(["O'Brien"]);
  });

  it("ends the IN value position at a finished element, a closed list or a call", () => {
    for (const text of [
      "WHERE s IN ('a'",
      "WHERE s IN ('a' ",
      "WHERE s IN ('a') ",
      "WHERE s IN (lower('a'), ",
      "WHERE s IN (SELECT a FROM t WHERE b",
      "WHERE match_all('s IN ('a', ",
    ]) {
      expect(parseValueContext(text), text).toBeNull();
    }
  });

  it("gives every non-IN operator an empty chosen list", () => {
    expect(parseValueContext("WHERE level = 'e")?.chosen).toEqual([]);
    expect(parseValueContext("WHERE level LIKE 'e")?.chosen).toEqual([]);
  });

  it("ends the value position at whitespace after a bare value", () => {
    expect(parseValueContext("WHERE code = 50 ")).toBeNull();
    expect(parseValueContext("WHERE level = 'error' ")).toBeNull();
  });
});

describe("literalStateAtEnd — never identifiers inside a string", () => {
  it("knows an open single-quoted string", () => {
    expect(literalStateAtEnd("WHERE zone = 'z")).toBe("string");
    expect(literalStateAtEnd("WHERE match_all('err")).toBe("string");
    expect(literalStateAtEnd("WHERE name = 'O''Br")).toBe("string");
  });

  it("is code after a closed string or inside a double-quoted identifier's close", () => {
    expect(literalStateAtEnd("WHERE zone = 'z' ")).toBe("code");
    expect(literalStateAtEnd('SELECT * FROM "default" ')).toBe("code");
    expect(literalStateAtEnd("WHERE name = 'O''Brien' AND ")).toBe("code");
  });

  it("does not call a double-quoted identifier a string", () => {
    expect(literalStateAtEnd('SELECT * FROM "def')).toBe("code");
  });

  it("knows a comment, and that a quote inside one opens nothing", () => {
    expect(literalStateAtEnd("SELECT 1 -- it's here")).toBe("comment");
    expect(literalStateAtEnd("SELECT /* note ")).toBe("comment");
    expect(literalStateAtEnd("SELECT 1 -- it's\nWHERE ")).toBe("code");
  });
});

describe("columnKind", () => {
  it("groups Arrow types the way quoting needs them", () => {
    expect(columnKind("Utf8")).toBe("text");
    expect(columnKind("LargeUtf8")).toBe("text");
    expect(columnKind("Int64")).toBe("number");
    expect(columnKind("Float64")).toBe("number");
    expect(columnKind("Boolean")).toBe("boolean");
    expect(columnKind(undefined)).toBe("unknown");
    expect(columnKind("Timestamp(Microsecond, None)")).toBe("unknown");
  });
});

describe("buildValueEntries — quoting by column type (P0-5)", () => {
  const insert = (v: string[], o: any) => buildValueEntries(v, o).map((e) => e.insertText);

  it("quotes a Utf8 value that looks like a number", () => {
    expect(insert(["200"], { hasOpenQuote: false, fieldType: "Utf8" })).toEqual(["'200'"]);
  });

  it("leaves numeric and boolean columns bare", () => {
    expect(insert(["500"], { hasOpenQuote: false, fieldType: "Int64" })).toEqual(["500"]);
    expect(insert(["true"], { hasOpenQuote: false, fieldType: "Boolean" })).toEqual(["true"]);
  });

  it("doubles a quote inside a string value", () => {
    expect(insert(["O'Brien"], { hasOpenQuote: false, fieldType: "Utf8" })).toEqual(["'O''Brien'"]);
    expect(insert(["O'Brien"], { hasOpenQuote: true, fieldType: "Utf8" })).toEqual(["O''Brien'"]);
  });

  it("falls back to looking at the value when the type is missing", () => {
    expect(insert(["200", "error"], { hasOpenQuote: false })).toEqual(["200", "'error'"]);
  });

  it("filters a quoted value with its quote, so a late answer matches 'e and e", () => {
    const [entry] = buildValueEntries(["error"], { hasOpenQuote: false, fieldType: "Utf8" });
    expect(entry.filterText).toBe("'error'");
  });

  it("inserts a complete contains-pattern for LIKE and ILIKE", () => {
    expect(insert(["warn"], { hasOpenQuote: false, pattern: true })).toEqual(["'%warn%'"]);
    expect(insert(["warn"], { hasOpenQuote: true, pattern: true })).toEqual(["%warn%'"]);
  });

  it("escapes LIKE wildcards with DataFusion's implicit backslash, and no ESCAPE clause", () => {
    expect(insert(["50%"], { hasOpenQuote: false, pattern: true })).toEqual(["'%50\\%%'"]);
    expect(insert(["user_id"], { hasOpenQuote: false, pattern: true })).toEqual(["'%user\\_id%'"]);
    expect(insert(["a\\b"], { hasOpenQuote: true, pattern: true })).toEqual(["%a\\\\b%'"]);
  });

  it("the inserted LIKE patterns parse as SQL in the editor", async () => {
    for (const value of ["50%", "checkout_service", "a\\b", "O'Brien"]) {
      const [pattern] = insert([value], { hasOpenQuote: false, pattern: true });
      const sql = `SELECT * FROM t WHERE body LIKE ${pattern}`;
      expect(await validateSql(sql), sql).toBeNull();
      expect(literalStateAtEnd(sql), sql).toBe("code");
    }
  });

  it("quotes a numeric-looking value inside a LIKE pattern", () => {
    expect(insert(["500"], { hasOpenQuote: false, pattern: true, fieldType: "Int64" })).toEqual([
      "'%500%'",
    ]);
  });
});

describe("buildValueStatusEntry — rows that insert nothing", () => {
  const t = ((key: string, params?: any) => `${key}:${JSON.stringify(params ?? {})}`) as any;

  it("reads as loading, with what to do next in the label's own description", () => {
    const entry = buildValueStatusEntry(t, "loading", "level", { minutes: 15 });
    expect(entry.insertText).toBe("");
    expect(entry.kind).toBe("Event");
    expect(entry.label).toContain("valuesLoading");
    expect(entry.description).toContain("valuesLoadingHint");
  });

  it("names the field and window when there are no values", () => {
    const entry = buildValueStatusEntry(t, "empty", "trace_id", { minutes: 15 });
    expect(entry.kind).toBe("Issue");
    expect(entry.label).toContain('"field":"trace_id"');
    expect(entry.label).toContain('"minutes":15');
  });

  it("says it could not load on a failure", () => {
    expect(buildValueStatusEntry(t, "failed", "zone").label).toContain("valuesFailed");
  });

  it("a cut-short list says how many it shows and sorts after the values, before the fields", () => {
    const entry = buildValueStatusEntry(t, "cap", "level", { count: 10 });
    expect(entry.label).toContain('"count":10');
    const [lastValue] = buildValueEntries(["999"], { hasOpenQuote: false }).slice(-1);
    expect(entry.sortText! > lastValue.sortText!).toBe(true);
    expect(entry.sortText! < "\u0001level").toBe(true);
    expect(entry.insertText).toBe("");
  });
});

describe("orderValues — the same order every run", () => {
  it("sorts text alphabetically and drops repeats", () => {
    expect(orderValues(["warn", "error", "warn", "info"], "Utf8")).toEqual([
      "error",
      "info",
      "warn",
    ]);
  });

  it("sorts a numeric column by value, not as text", () => {
    expect(orderValues(["10", "9", "100", "0.5"], "Int64")).toEqual(["0.5", "9", "10", "100"]);
  });

  it("treats an untyped all-number list as numbers and a mixed one as text", () => {
    expect(orderValues(["10", "9"])).toEqual(["9", "10"]);
    expect(orderValues(["b10", "b9", "a"])).toEqual(["a", "b9", "b10"]);
  });
});

describe("buildValueEntries — the label shows what goes in", () => {
  it("quotes text values in the label and leaves numbers bare", () => {
    expect(buildValueEntries(["200"], { hasOpenQuote: false, fieldType: "Utf8" })[0].label).toBe(
      "'200'",
    );
    expect(buildValueEntries(["200"], { hasOpenQuote: false, fieldType: "Int64" })[0].label).toBe(
      "200",
    );
  });

  it("filters an in-quote value by the bare text typed after the quote", () => {
    const [entry] = buildValueEntries(["error"], { hasOpenQuote: true, fieldType: "Utf8" });
    expect(entry.label).toBe("'error'");
    expect(entry.filterText).toBe("error");
  });
});

describe("fieldEntriesOf — columns for comparisons in a value position", () => {
  it("keeps fields only, from both lists, after every value", () => {
    const entries = fieldEntriesOf(
      [
        { name: "level", label: "level", kind: "Field", insertText: "level" },
        { name: "and", label: "and", kind: "Keyword", insertText: "and " },
        "host",
      ],
      [{ name: "count", label: "count", kind: "Function", insertText: "count()" }],
    );
    expect(entries.map((e) => e.label)).toEqual(["level", "host"]);
    expect(entries.every((e) => e.sortText!.startsWith("\u0001"))).toBe(true);
  });
});

describe("guard v2 — dropping a late value answer", () => {
  const makeEditor = (text: string, column: number) => {
    const state = { text, column, focus: true };
    const editor = {
      getPosition: () => ({ lineNumber: 1, column: state.column }),
      hasTextFocus: () => state.focus,
      getModel: () => ({
        getValueInRange: (r: any) => state.text.slice(r.startColumn - 1, r.endColumn - 1),
      }),
    };
    return { state, editor };
  };
  const BASE = "SELECT * FROM t WHERE level = ";

  it("waits up to 1000 ms before it shows the loading row", () => {
    expect(VALUE_WAIT_BUDGET_MS).toBe(1000);
  });

  it("keeps the answer when nothing happened", () => {
    const { editor } = makeEditor(BASE, BASE.length + 1);
    const snap = takeValueGuardSnapshot(editor, 0);
    expect(isValueAnswerStale(snap, editor, 0)).toBe(false);
  });

  it("drops it after Esc", () => {
    const { editor } = makeEditor(BASE, BASE.length + 1);
    const snap = takeValueGuardSnapshot(editor, 0);
    expect(isValueAnswerStale(snap, editor, 1)).toBe(true);
  });

  it("drops it after blur", () => {
    const { state, editor } = makeEditor(BASE, BASE.length + 1);
    const snap = takeValueGuardSnapshot(editor, 0);
    state.focus = false;
    expect(isValueAnswerStale(snap, editor, 0)).toBe(true);
  });

  it("drops it when the cursor moves left", () => {
    const { state, editor } = makeEditor(BASE, BASE.length + 1);
    const snap = takeValueGuardSnapshot(editor, 0);
    state.column -= 1;
    expect(isValueAnswerStale(snap, editor, 0)).toBe(true);
  });

  it("drops it after an edit before the cursor", () => {
    const { state, editor } = makeEditor(BASE, BASE.length + 1);
    const snap = takeValueGuardSnapshot(editor, 0);
    state.text = BASE.replace("level", "lever");
    expect(isValueAnswerStale(snap, editor, 0)).toBe(true);
  });

  it("drops it when whitespace was typed after the request point", () => {
    const { state, editor } = makeEditor(BASE, BASE.length + 1);
    const snap = takeValueGuardSnapshot(editor, 0);
    state.text = BASE + "x ";
    state.column += 2;
    expect(isValueAnswerStale(snap, editor, 0)).toBe(true);
  });

  it("keeps it while the user types forward in the same token", () => {
    const { state, editor } = makeEditor(BASE, BASE.length + 1);
    const snap = takeValueGuardSnapshot(editor, 0);
    state.text = BASE + "'e";
    state.column += 2;
    expect(isValueAnswerStale(snap, editor, 0)).toBe(false);
    state.text = BASE + "e";
    state.column -= 1;
    expect(isValueAnswerStale(snap, editor, 0)).toBe(false);
  });

  it("never drops an answer it cannot check", () => {
    expect(isValueAnswerStale(null, null, 3)).toBe(false);
  });
});

describe("isPredicatePosition — WHERE, HAVING and ON chain; nothing else does", () => {
  it("is a predicate right after WHERE, AND, OR, NOT, HAVING, ON and an open paren", () => {
    for (const text of [
      "SELECT * FROM t WHERE ",
      "SELECT * FROM t WHERE a = 1 AND ",
      "SELECT * FROM t WHERE a = 1 or ",
      "SELECT * FROM t WHERE NOT ",
      "SELECT k, count(*) FROM t GROUP BY k HAVING ",
      "SELECT * FROM a JOIN b ON ",
      "SELECT * FROM t WHERE (",
      "SELECT * FROM t WHERE a = 1 AND (",
      "SELECT * FROM a JOIN b ON a.",
    ]) {
      expect(isPredicatePosition(text), text).toBe(true);
    }
  });

  it("treats the Logs filter fragment as one predicate, only in filter mode", () => {
    expect(isPredicatePosition("", true)).toBe(true);
    expect(isPredicatePosition("level = 'error' AND ", true)).toBe(true);
    expect(isPredicatePosition("")).toBe(false);
    expect(isPredicatePosition("level = 'error' AND ")).toBe(false);
  });

  it("never chains in boolean expressions inside SELECT, or after BETWEEN <expr> AND", () => {
    for (const text of [
      "SELECT CASE WHEN a = 1 AND ",
      "SELECT NOT ",
      "SELECT a FROM t WHERE ts BETWEEN now() - 1 AND ",
      "SELECT a FROM t WHERE x = 1 AND (b) = CASE WHEN ",
    ]) {
      expect(isPredicatePosition(text), text).toBe(false);
    }
    expect(isPredicatePosition("SELECT a FROM t WHERE x BETWEEN 1 AND 2 AND ")).toBe(true);
    expect(isPredicatePosition("SELECT a FROM t WHERE ts > now() - 1 AND ")).toBe(true);
  });

  it("a string or comment between does not confuse the clause", () => {
    expect(isPredicatePosition("SELECT a FROM t WHERE s = 'SELECT x' AND ")).toBe(true);
    expect(isPredicatePosition("SELECT a -- WHERE \nFROM t GROUP BY ")).toBe(false);
  });

  it("a finished comment right after WHERE leaves the predicate slot open", () => {
    expect(isPredicatePosition("SELECT * FROM t WHERE /* explain filter */ ")).toBe(true);
    expect(isPredicatePosition("SELECT * FROM t WHERE -- note\n")).toBe(true);
    expect(isPredicatePosition("SELECT * FROM t WHERE a = 1 AND /* x */ ")).toBe(true);
  });

  it("never chains in SELECT, GROUP BY, ORDER BY or function arguments", () => {
    for (const text of [
      "SELECT ",
      "SELECT level, ",
      "SELECT * FROM t GROUP BY ",
      "SELECT * FROM t ORDER BY ",
      "SELECT * FROM t WHERE count(",
      "SELECT * FROM t WHERE str_match(",
      "SELECT CASE WHEN ",
      "SELECT * FROM t WHERE code BETWEEN 1 AND ",
    ]) {
      expect(isPredicatePosition(text), text).toBe(false);
    }
  });
});

describe("parseOperatorContext — the operator position", () => {
  const FIELDS = ["level", "code", "trace_id"];

  it("fires after a known field and whitespace in a predicate", () => {
    expect(parseOperatorContext("SELECT * FROM t WHERE level ", FIELDS)).toEqual({
      field: "level",
      qualified: "level",
      partial: "",
      span: "level ",
    });
  });

  it("keeps a qualifier with the field, so a wrap starts at the qualifier", () => {
    expect(parseOperatorContext("SELECT * FROM t WHERE t.level ", FIELDS)).toEqual({
      field: "level",
      qualified: "t.level",
      partial: "",
      span: "t.level ",
    });
  });

  it("keeps the lane while an operator is being typed", () => {
    expect(parseOperatorContext("WHERE level I", FIELDS)?.partial).toBe("I");
    expect(parseOperatorContext("WHERE level !", FIELDS)?.partial).toBe("!");
    expect(parseOperatorContext("WHERE level is x", FIELDS)).toBeNull();
  });

  it("keeps the lane while a multi-word operator or an underscored name is typed", () => {
    expect(parseOperatorContext("WHERE level IS N", FIELDS)).toMatchObject({
      field: "level",
      partial: "IS N",
    });
    expect(parseOperatorContext("WHERE level IS ", FIELDS)?.partial).toBe("IS ");
    expect(parseOperatorContext("WHERE level IS NOT N", FIELDS)?.partial).toBe("IS NOT N");
    expect(parseOperatorContext("WHERE level NOT L", FIELDS)?.partial).toBe("NOT L");
    expect(parseOperatorContext("WHERE level re_n", FIELDS)?.partial).toBe("re_n");
    expect(parseOperatorContext("WHERE level str_", FIELDS)?.partial).toBe("str_");
    expect(parseOperatorContext("WHERE level AND code", FIELDS)).toBeNull();
  });

  it("an IS N prefix offers IS NULL and IS NOT NULL over the prefix, never ORDER BY's NULLS FIRST", () => {
    const context = parseOperatorContext("WHERE level IS N", FIELDS)!;
    const rows = buildOperatorLane({ context, fieldType: "Utf8", lineNumber: 1, column: 17 });
    const matching = rows.filter((r) => String(r.label).toLowerCase().startsWith("is n"));
    expect(matching.map((r) => r.label)).toEqual(["IS NULL", "IS NOT NULL"]);
    expect(acceptIn("WHERE level ", { ...matching[0], insertText: "IS NULL" })).toBe(
      "WHERE level IS NULL",
    );
    expect(matching[0].range).toMatchObject({ startColumn: 13, endColumn: 17 });
  });

  it("does not fire for an unknown word, a non-operator, or outside predicates", () => {
    expect(parseOperatorContext("WHERE nope ", FIELDS)).toBeNull();
    expect(parseOperatorContext("WHERE level AS", FIELDS)).toBeNull();
    expect(parseOperatorContext("SELECT level ", FIELDS)).toBeNull();
    expect(parseOperatorContext("SELECT * FROM t GROUP BY level ", FIELDS)).toBeNull();
    expect(parseOperatorContext("SELECT * FROM t WHERE count(level ", FIELDS)).toBeNull();
    expect(parseOperatorContext("SELECT CASE WHEN level ", FIELDS)).toBeNull();
    expect(parseOperatorContext("WHERE x BETWEEN 1 AND code ", FIELDS)).toBeNull();
  });

  it("does not fire on the right-hand side of a comparison", () => {
    expect(parseOperatorContext("WHERE a = level ", FIELDS)).toBeNull();
  });
});

let menuReopened = false;

// Accepts a row the way Monaco does: insert its text, then run its command against a one-line editor.
const acceptIn = (line: string, entry: any, lineNumber = 1): string => {
  resetKeyContractForTests();
  menuReopened = false;
  let text = line + String(entry.insertText ?? "");
  const editor = {
    hasTextFocus: () => true,
    getPosition: () => ({ lineNumber, column: text.length + 1 }),
    trigger: (_source: string, id: string, payload: any) => {
      if (id === "type") text += payload.text;
      if (id === "editor.action.triggerSuggest") menuReopened = true;
    },
    executeEdits: (_source: string, edits: any[]) => {
      for (const { range, text: inserted } of edits) {
        text = text.slice(0, range.startColumn - 1) + inserted + text.slice(range.endColumn - 1);
      }
    },
    pushUndoStop: () => {},
  };
  const commands = new Map<string, (...args: any[]) => void>();
  const monaco = {
    editor: {
      getEditors: () => [editor],
      registerCommand: (id: string, run: (...args: any[]) => void) => {
        commands.set(id, run);
        return { dispose: () => {} };
      },
    },
    Selection: class {},
  };
  registerAcceptCommands(monaco, () => {});
  if (entry.command) commands.get(entry.command.id)?.({}, ...(entry.command.arguments ?? []));
  resetKeyContractForTests();
  return text;
};

describe("buildOperatorLane — operators by type, ranked, never filtered", () => {
  const ctx = (field: string, partial = "", qualified = field) => ({
    field,
    qualified,
    partial,
    span: `${qualified} ${partial}`,
  });
  const CHAIN = { id: "o2.suggest.chainSpace", title: "", arguments: ["operator"] };
  const lane = (field: string, fieldType: string | undefined, chainCommand?: any) =>
    buildOperatorLane({ context: ctx(field), fieldType, lineNumber: 2, column: 20, chainCommand });

  it("puts = first for text and >= first for numbers", () => {
    expect(lane("level", "Utf8")[0].label).toBe("=");
    expect(lane("code", "Int64")[0].label).toBe(">=");
    expect(lane("ok", "Boolean").map((e) => e.label)).toEqual(["= true", "= false", "IS NULL"]);
  });

  it("uses one neutral order when the type is unknown", () => {
    expect(lane("x", undefined).map((e) => e.label)).toEqual(OPERATORS_BY_TYPE.neutral);
  });

  it("keeps the text order fixed, match functions named alone with the field as their detail", () => {
    const rows = lane("level", "Utf8");
    expect(rows.map((e) => e.label)).toEqual([
      "=",
      "!=",
      "IN",
      "LIKE",
      "ILIKE",
      "str_match",
      "re_match",
      "IS NULL",
      "IS NOT NULL",
      "NOT LIKE",
      "re_not_match",
    ]);
    expect(rows.find((e) => e.label === "str_match")!.labelDetail).toBe("(level, …)");
  });

  it("marks the match-function rows as edits, so Enter on an arrowed row accepts it", () => {
    // Monaco's smart Enter skips a row whose insertText already equals the text under its range, unless it has additionalTextEdits.
    for (const name of ["str_match", "re_match", "re_not_match"]) {
      expect(
        lane("level", "Utf8", CHAIN).find((e) => e.name === name)!.additionalTextEdits,
      ).toEqual([]);
    }
  });

  it("wraps a qualified field whole, from its qualifier", () => {
    const rows = buildOperatorLane({
      context: ctx("level", "", "t.level"),
      fieldType: "Utf8",
      lineNumber: 1,
      column: 30,
    });
    const row = rows.find((e) => e.name === "str_match")!;
    expect(row.labelDetail).toBe("(t.level, …)");
    expect(acceptIn(`${"x".repeat(21)}t.level `, row)).toBe(
      `${"x".repeat(21)}str_match(t.level, '')`,
    );
  });

  it("only str_match opens values after its wrap, and only where the chain runs", () => {
    const line = `${"x".repeat(13)}level `;
    const opens = (rows: any[], name: string) => {
      acceptIn(
        line,
        rows.find((e) => e.name === name),
        2,
      );
      return menuReopened;
    };
    expect(opens(lane("level", "Utf8", CHAIN), "str_match")).toBe(true);
    expect(opens(lane("level", "Utf8", CHAIN), "re_match")).toBe(false);
    expect(opens(lane("level", "Utf8"), "str_match")).toBe(false);
  });

  it("in Automatic, accepting = or LIKE writes one space through the chain, and IS NULL or IN do not chain", () => {
    const entries = lane("level", "Utf8", CHAIN);
    const accept = (label: string) =>
      acceptIn(
        "level ",
        entries.find((e) => e.label === label)!,
      );
    expect(accept("=")).toBe("level = ");
    expect(accept("LIKE")).toBe("level LIKE ");
    expect(accept("IS NULL")).toBe("level IS NULL");
  });

  it("without the chain, operators keep today's trailing space", () => {
    const eq = lane("level", "Utf8").find((e) => e.label === "=")!;
    expect(acceptIn("level ", eq)).toBe("level = ");
  });

  it("sorts above the field lane", () => {
    expect(lane("level", "Utf8").every((e) => e.sortText! < "\u0000a")).toBe(true);
  });

  it("match functions filter like plain operators, so = keeps row 1, and still wrap the field", () => {
    const rows = lane("level", "Utf8");
    const row = rows.find((e) => e.name === "str_match")!;
    expect(row.range).toEqual(rows.find((e) => e.name === "=")!.range);
    expect(row.filterText).toBe("str_match");
    expect(row.insertText).toBe("");
    expect(row.sortText! > rows.find((e) => e.name === "=")!.sortText!).toBe(true);
    // The lane was built for column 20 on line 2, with `level ` just before it.
    expect(acceptIn(`${"x".repeat(13)}level `, row, 2)).toBe(
      `${"x".repeat(13)}str_match(level, '')`,
    );
  });

  it("replaces a partially typed operator", () => {
    const [first] = buildOperatorLane({
      context: ctx("level", "!"),
      fieldType: "Utf8",
      lineNumber: 1,
      column: 30,
    });
    expect(first.range).toMatchObject({ startColumn: 29, endColumn: 30 });
  });
});

describe("parseLogicalLeadContext — after a complete predicate", () => {
  it("fires after each complete predicate shape and a space", () => {
    for (const text of [
      "service_name = 'openobserve' ",
      "level IS NULL ",
      "level IS NOT NULL ",
      "level IN ('a','b') ",
      "level NOT IN ('a','b') ",
      "code BETWEEN 1 AND 5 ",
      "(a = 1) ",
      "str_match(level, 'x') ",
      "lower(x) = 'a' ",
      "NOT level = 'a' ",
    ]) {
      expect(parseLogicalLeadContext(text, true), text).not.toBeNull();
    }
  });

  it("does not fire mid-predicate, inside a string, or outside a predicate", () => {
    for (const text of [
      "level ",
      "level = ",
      "level = 'x' AND ",
      "code BETWEEN 1 ",
      "code BETWEEN 1 AND ",
      "lower(x) ",
      "level = 'x ",
      "level = 'x'",
    ]) {
      expect(parseLogicalLeadContext(text, true), text).toBeNull();
    }
    expect(parseLogicalLeadContext("SELECT a = 1 ")).toBeNull();
    expect(parseLogicalLeadContext("SELECT * FROM t ORDER BY a ")).toBeNull();
    expect(parseLogicalLeadContext("level = 'x' ")).toBeNull();
  });

  it("reports an open group, CASE WHEN and the clause", () => {
    expect(parseLogicalLeadContext("a = 1 AND (b = 2 ", true)).toEqual({
      openParen: true,
      inCaseWhen: false,
      clause: "",
    });
    expect(parseLogicalLeadContext("SELECT CASE WHEN level = 'x' ")?.inCaseWhen).toBe(true);
    expect(parseLogicalLeadContext("SELECT * FROM t GROUP BY a HAVING count(*) > 5 ")?.clause).toBe(
      "HAVING",
    );
    expect(parseLogicalLeadContext("SELECT * FROM t WHERE a BETWEEN lo AND hi ")?.clause).toBe(
      "WHERE",
    );
  });
});

describe("logicalLeadNames and buildLogicalLead — AND and OR lead, nothing removed", () => {
  const lead = (context: Partial<LogicalLeadContext>, filterMode = false) =>
    logicalLeadNames(
      { openParen: false, inCaseWhen: false, clause: "WHERE", ...context },
      filterMode,
    );

  it("ranks AND, OR, then ) when a group is open, then the clauses that can follow", () => {
    expect(lead({}, true)).toEqual(["and", "or"]);
    expect(lead({ openParen: true }, true)).toEqual(["and", "or", ")"]);
    expect(lead({})).toEqual(["and", "or", "group by", "order by", "limit"]);
    expect(lead({ clause: "HAVING" })).toEqual(["and", "or", "order by", "limit"]);
    expect(lead({ openParen: true })).toEqual(["and", "or", ")"]);
    expect(lead({ inCaseWhen: true, clause: "" })).toEqual(["and", "or", "then"]);
  });

  it("puts the lead first by sortText and keeps every other entry", () => {
    const catalog = [
      { name: "level", label: "level", kind: "Field", sortText: "\u0000level" },
      ...SQL_KEYWORDS,
      ...SQL_CLAUSE_KEYWORDS,
    ];
    const out = buildLogicalLead(catalog, ["and", "or", ")", "group by"]) as any[];
    const sorted = [...out].sort((a, b) => (a.sortText < b.sortText ? -1 : 1));
    expect(sorted.slice(0, 4).map((e) => e.name)).toEqual(["and", "or", ")", "GROUP BY"]);
    expect(out).toHaveLength(catalog.length + 1);
  });

  it("in Automatic AND and OR insert without their space and carry the chain", () => {
    const CHAIN = { id: "o2.suggest.chainSpace", title: "", arguments: ["operator"] };
    const out = buildLogicalLead([...SQL_KEYWORDS], ["and", "or"], CHAIN) as any[];
    // Uppercase, like GROUP BY and ORDER BY beside them; the chain types the space.
    expect(out.slice(0, 2).map((e) => e.label)).toEqual(["AND", "OR"]);
    expect(acceptIn("level = 'x' ", out[0])).toBe("level = 'x' AND ");
    expect(acceptIn("level = 'x' ", out[1])).toBe("level = 'x' OR ");
    const plain = buildLogicalLead([...SQL_KEYWORDS], ["and"]) as any[];
    expect(acceptIn("level = 'x' ", plain[0])).toBe("level = 'x' AND ");
  });
});

describe("isCaretInComment — W0-B, no completion inside comments", () => {
  it("falls back to scanning the text when no tokenizer is present", () => {
    const model = {};
    expect(isCaretInComment(model, { lineNumber: 1, column: 20 }, "-- show me errors ")).toBe(true);
    expect(isCaretInComment(model, { lineNumber: 1, column: 9 }, "SELECT ")).toBe(false);
    expect(isCaretInComment(model, { lineNumber: 1, column: 9 }, "SELECT /* a ")).toBe(true);
  });

  it("asks Monaco's tokenizer when there is one", () => {
    // `level -- note`: offsets 6.. are the comment token.
    const line = "level -- note";
    const tokens = {
      findTokenIndexAtOffset: (offset: number) => (offset >= 6 ? 1 : 0),
      getStandardTokenType: (index: number) => (index === 1 ? 1 : 0),
    };
    const model = {
      tokenization: { getLineTokens: () => tokens, forceTokenization: () => {} },
      getLineLength: () => line.length,
    };
    expect(isCaretInComment(model, { lineNumber: 1, column: line.length + 1 }, line)).toBe(true);
    expect(isCaretInComment(model, { lineNumber: 1, column: 6 }, "level")).toBe(false);
    expect(isCaretInComment(model, { lineNumber: 1, column: 1 }, "")).toBe(false);
  });
});

describe("groupEntries — header rows over provider-filtered groups", () => {
  const range = { startLineNumber: 1, endLineNumber: 1, startColumn: 9, endColumn: 10 };
  const value = (v: string) => ({ name: v, label: `'${v}'`, kind: "Value", insertText: `'${v}'` });
  const field = (f: string, type = "Utf8") => ({
    name: f,
    label: f,
    kind: "Field",
    insertText: f,
    detail: type,
  });
  const groups = (values: any[], fields: any[]) => [
    { header: "Values · last 15 min", name: "Values", entries: values },
    { header: "Fields", name: "Fields", entries: fields },
  ];
  const build = (typed: string, preselect = false, values = ["error", "warn", "fatal_error"]) =>
    groupEntries(groups(values.map(value), [field("level"), field("error_code", "Int64")]), {
      typed,
      range,
      preselect,
    });
  const names = (rows: any[]) => rows.map((r) => (r.kind === "Folder" ? `H:${r.label}` : r.label));

  // What Monaco does on accept: replace the row's range with its insertText.
  const accepted = (line: string, row: any) =>
    line.slice(0, row.range.startColumn - 1) + row.insertText + line.slice(row.range.endColumn - 1);
  const LINE = "level = e";

  it("a header is a Folder row: accepting it changes nothing and reopens the same menu", () => {
    const [header] = build("e");
    expect(header.kind).toBe("Folder");
    expect(header.label).toBe("Values · last 15 min");
    expect(accepted(LINE, header)).toBe(LINE);
    expect(
      header.additionalTextEdits,
      "so 'smart' Enter accepts rather than types a newline",
    ).toEqual([]);
    expect(header.command!.id).toBe("editor.action.triggerSuggest");
    expect(header.preselect).toBeUndefined();
  });

  it("filters by prefix or `_` segment, and every row filters by the typed token so the scores tie", () => {
    const rows = build("e");
    expect(names(rows)).toEqual([
      "H:Values · last 15 min",
      "'error'",
      "'fatal_error'",
      "H:Fields",
      "error_code",
    ]);
    expect(rows.every((r) => r.filterText === "e")).toBe(true);
    expect(names(build("f"))).toEqual(["H:Values · last 15 min", "'fatal_error'"]);
  });

  it("drops a group whose rows all filter out, header included", () => {
    expect(names(build("lev"))).toEqual(["H:Fields", "level"]);
  });

  it("orders by sortText: header, then its rows, group after group", () => {
    const sorted = [...build("")].sort((a, b) => (a.sortText! < b.sortText! ? -1 : 1));
    expect(names(sorted)).toEqual(names(build("")));
    expect(build("").map((r) => r.sortText)).toEqual([
      "0a",
      "0b0000",
      "0b0001",
      "0b0002",
      "1a",
      "1b0000",
      "1b0001",
    ]);
  });

  it("preselects real rows only, and only when asked", () => {
    expect(
      build("", true)
        .filter((r) => r.preselect)
        .map((r) => r.label),
    ).toEqual(["'error'", "'warn'", "'fatal_error'", "level", "error_code"]);
    expect(build("", false).some((r) => r.preselect)).toBe(false);
  });

  it("puts the group name in a value row's description and keeps a field's column type", () => {
    const rows = build("");
    expect(rows.find((r) => r.label === "'error'")!.description).toBe("Values");
    expect(rows.find((r) => r.label === "error_code")!.description).toBe("Int64");
  });

  it("keeps a status row inside its group, never filtered and never a target", () => {
    const loading = {
      name: "\u0000loading",
      label: "Still loading",
      kind: "Event",
      insertText: "",
    };
    const rows = groupEntries(groups([loading], [field("level")]), {
      typed: "x",
      range,
      preselect: true,
    });
    expect(names(rows)).toEqual(["H:Values · last 15 min", "Still loading"]);
    expect(accepted("level = x", rows[1]), "accepting it changes nothing").toBe("level = x");
    expect(rows[1].preselect).toBeUndefined();
  });

  it("shows the cap row after the values it counts, and not without them", () => {
    const cap = { name: "\u0000cap", label: "10 values shown", kind: "Issue", insertText: "" };
    const withValues = groupEntries(groups([value("error"), cap], []), {
      typed: "",
      range,
      preselect: false,
    });
    expect(names(withValues)).toEqual(["H:Values · last 15 min", "'error'", "10 values shown"]);
    const none = groupEntries(groups([value("error"), cap], [field("level")]), {
      typed: "lev",
      range,
      preselect: false,
    });
    expect(names(none)).toEqual(["H:Fields", "level"]);
  });

  it("matches ignore quotes and LIKE wildcards", () => {
    expect(matchesTyped({ name: "'error'", label: "'error'" } as any, "err")).toBe(true);
    expect(matchesTyped({ name: "warn", label: "warn" } as any, "%wa")).toBe(true);
    expect(matchesTyped({ name: "kubernetes_pod_name", label: "x" } as any, "pod")).toBe(true);
    expect(matchesTyped({ name: "level", label: "level" } as any, "ev")).toBe(false);
  });
});
