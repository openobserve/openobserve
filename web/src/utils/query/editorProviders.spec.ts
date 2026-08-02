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
} from "./editorProviders";

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

  it("ignores a bare parenthesised group with no function name", () => {
    expect(parseCallContext("WHERE (a > 1 AND ")).toBeNull();
  });

  it("tolerates whitespace between the name and the paren", () => {
    expect(parseCallContext("SELECT sum (")).toEqual({ name: "sum", activeParameter: 0 });
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
    const [head] = buildHoverContents(fn("histogram"))!;
    expect(head.value).toContain("histogram(field, interval)");
    expect(head.value).toContain("```");
  });

  it("shows the function's prose underneath", () => {
    const contents = buildHoverContents(fn("histogram"))!;
    expect(contents.map((c) => c.value).join("\n")).toContain(fn("histogram").documentation);
  });

  it("shows a field's column type", () => {
    const contents = buildHoverContents({
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
    const contents = buildHoverContents({
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
    const contents = buildHoverContents({
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
    const contents = buildHoverContents(fn("match_all"))!;
    expect(
      contents
        .map((c) => c.value)
        .join(" ")
        .toLowerCase(),
    ).not.toContain("deprecated");
  });

  it("returns null when there is nothing to say", () => {
    expect(buildHoverContents(null)).toBeNull();
  });
});
