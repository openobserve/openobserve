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

// TDD spec for the shared SQL completion catalog (tmp/code.md Phase 1).
// Covers: A1 (kinds), A2 (static labels), A3 (argument quoting),
// A5 (insertTextRules string -> enum), N7 (field forwarding), C1 (no pre-filter),
// D7/N2 (single catalog shared by every surface).

import { describe, it, expect } from "vitest";
import {
  SQL_FUNCTIONS,
  SQL_KEYWORDS,
  buildCompletionItems,
  type SqlCompletionEntry,
} from "./sqlCompletion";

// Mirrors monaco.languages.CompletionItemKind (verified in
// monaco-editor/esm/vs/editor/common/languages.js byKind map).
const KINDS = {
  Method: 0,
  Function: 1,
  Constructor: 2,
  Field: 3,
  Variable: 4,
  Operator: 11,
  Value: 13,
  Keyword: 17,
  Text: 18,
  Snippet: 27,
} as const;

// Mirrors monaco.languages.CompletionItemInsertTextRule.
const INSERT_RULES = {
  None: 0,
  KeepWhitespace: 1,
  InsertAsSnippet: 4,
} as const;

const range = { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 1 };

const build = (opts: Partial<Parameters<typeof buildCompletionItems>[0]> = {}) =>
  buildCompletionItems({
    keywords: [],
    suggestions: [],
    word: "",
    range,
    kinds: KINDS,
    insertTextRules: INSERT_RULES,
    ...opts,
  });

const byName = (name: string): SqlCompletionEntry => {
  const found = SQL_FUNCTIONS.find((f) => f.name === name);
  if (!found) throw new Error(`SQL_FUNCTIONS is missing "${name}"`);
  return found;
};

// ───────────────────────────────────────────────────────────────────────────
// A1 — completion item kinds
// ───────────────────────────────────────────────────────────────────────────

describe("A1 — every function is kind Function, never Text", () => {
  it("no catalog function is kind Text (the 'abc' glyph)", () => {
    const textKinded = SQL_FUNCTIONS.filter((f) => f.kind === "Text");
    expect(textKinded).toEqual([]);
  });

  it("every catalog function declares kind Function", () => {
    for (const fn of SQL_FUNCTIONS) {
      expect(fn.kind, `${fn.name} should be kind Function`).toBe("Function");
    }
  });

  it("maps kind Function to monaco's numeric 1 (symbolFunction glyph)", () => {
    const items = build({ suggestions: [byName("approx_topk")] });
    expect(items[0].kind).toBe(KINDS.Function);
  });

  it("comparison operators are kind Operator, not Keyword", () => {
    for (const op of ["=", "!=", "<>", ">", "<", ">=", "<="]) {
      const entry = SQL_KEYWORDS.find((k) => k.label === op);
      expect(entry, `SQL_KEYWORDS is missing operator "${op}"`).toBeDefined();
      expect(entry!.kind, `operator ${op}`).toBe("Operator");
    }
  });

  it("logical/predicate words are kind Keyword", () => {
    for (const kw of ["and", "or", "like", "in", "not in", "between", "is null"]) {
      const entry = SQL_KEYWORDS.find((k) => k.label === kw);
      expect(entry, `SQL_KEYWORDS is missing keyword "${kw}"`).toBeDefined();
      expect(entry!.kind, `keyword ${kw}`).toBe("Keyword");
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// A2 — static labels (no typed-token interpolation)
// ───────────────────────────────────────────────────────────────────────────

describe("A2 — labels are static strings, never functions of the typed token", () => {
  it("no catalog entry exposes a callable label", () => {
    for (const entry of [...SQL_FUNCTIONS, ...SQL_KEYWORDS]) {
      expect(typeof entry.label, `${entry.name} label`).toBe("string");
    }
  });

  it("no catalog entry exposes a callable insertText", () => {
    for (const entry of [...SQL_FUNCTIONS, ...SQL_KEYWORDS]) {
      expect(typeof entry.insertText, `${entry.name} insertText`).toBe("string");
    }
  });

  it("function labels are the bare function name — no embedded arguments", () => {
    // The screenshot bug: label read "approx_topk('a', 10)" with a frozen 'a'.
    expect(byName("approx_topk").label).toBe("approx_topk");
    expect(byName("match_all").label).toBe("match_all");
    expect(byName("histogram").label).toBe("histogram");
  });

  it("labels never contain a quote character", () => {
    for (const fn of SQL_FUNCTIONS) {
      expect(fn.label, `${fn.name} label must not embed a literal`).not.toContain("'");
    }
  });

  it("produces identical items regardless of what the user has typed", () => {
    // Guards the staleness class of bug outright: item content cannot depend on `word`.
    const atA = build({ suggestions: SQL_FUNCTIONS, word: "a" });
    const atAppr = build({ suggestions: SQL_FUNCTIONS, word: "appr" });
    expect(atA).toEqual(atAppr);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// A3 — argument quoting
// ───────────────────────────────────────────────────────────────────────────

describe("A3 — column arguments are unquoted, literal arguments are quoted", () => {
  // Functions whose FIRST argument is a column/expression reference.
  const COLUMN_FIRST = [
    "re_match",
    "re_not_match",
    "str_match",
    "str_match_ignore_case",
    "arr_descending",
    "arrcount",
    "arrsort",
    "cast_to_arr",
    "arrindex",
    "arrjoin",
    "arrzip",
    "spath",
    "to_array_string",
    "sum",
    "avg",
    "count",
    "max",
    "min",
    "histogram",
    "approx_topk",
    "approx_topk_distinct",
  ];

  it.each(COLUMN_FIRST)("%s does not wrap its first argument in quotes", (name) => {
    const insertText = byName(name).insertText;
    // First argument begins right after "name(" and must not open with a quote.
    const firstArg = insertText.slice(name.length + 1);
    expect(firstArg.startsWith("'"), `${name} => ${insertText}`).toBe(false);
  });

  it("sum/avg/count/max/min take a bare column tab stop", () => {
    for (const agg of ["sum", "avg", "count", "max", "min"]) {
      expect(byName(agg).insertText).toBe(`${agg}(\${1:field})`);
    }
  });

  it("histogram takes an unquoted column and a quoted interval", () => {
    // Real usage in the app: histogram(_timestamp, '30 second') — useAlertForm.ts:463
    expect(byName("histogram").insertText).toBe("histogram(${1:_timestamp}, '${2:30 second}')");
  });

  it("spath takes an unquoted column and a quoted path", () => {
    // Backend tests use spath(object, 'nested.value') — first arg is an expression.
    expect(byName("spath").insertText).toBe("spath(${1:field}, '${2:path}')");
  });

  it("approx_topk takes an unquoted column and a numeric k", () => {
    expect(byName("approx_topk").insertText).toBe("approx_topk(${1:field}, ${2:10})");
  });

  it("arrcount takes a bare array column (arrcount_udf.rs:51)", () => {
    expect(byName("arrcount").insertText).toBe("arrcount(${1:field})");
  });

  it("match_all quotes its search term — it is a literal", () => {
    expect(byName("match_all").insertText).toBe("match_all('${1:value}')");
  });

  it("str_match takes an unquoted column and a quoted value", () => {
    expect(byName("str_match").insertText).toBe("str_match(${1:field}, '${2:value}')");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// A5 — insertTextRules must reach monaco as a NUMBER
// ───────────────────────────────────────────────────────────────────────────

describe("A5 — snippet rules are mapped from string name to numeric enum", () => {
  const snippetEntry: SqlCompletionEntry = {
    name: "demo",
    label: "demo",
    kind: "Function",
    insertText: "demo(${1:field})",
    insertTextRules: "InsertAsSnippet",
  };

  it("emits the numeric InsertAsSnippet flag, never the string", () => {
    const [item] = build({ suggestions: [snippetEntry] });
    expect(item.insertTextRules).toBe(INSERT_RULES.InsertAsSnippet);
    expect(typeof item.insertTextRules).toBe("number");
  });

  it("survives monaco's bitwise test", () => {
    const [item] = build({ suggestions: [snippetEntry] });
    // suggestController.js:368 — if (!(insertTextRules & 4)) escape as plain text.
    // A string value coerces to 0 here, which is the bug this pins.
    expect(item.insertTextRules & INSERT_RULES.InsertAsSnippet).toBeTruthy();
  });

  it("applies the same mapping on the keywords path", () => {
    const [item] = build({
      keywords: [
        {
          name: "like",
          label: "like",
          kind: "Keyword",
          insertText: "like '%${1:params}%' ",
          insertTextRules: "InsertAsSnippet",
        },
      ],
    });
    expect(item.insertTextRules).toBe(INSERT_RULES.InsertAsSnippet);
  });

  it("omits insertTextRules for plain-text entries", () => {
    const [item] = build({
      keywords: [{ name: "and", label: "and", kind: "Keyword", insertText: "and " }],
    });
    expect(item.insertTextRules).toBeUndefined();
  });

  it("every catalog entry containing a ${…} tab stop declares InsertAsSnippet", () => {
    for (const entry of [...SQL_FUNCTIONS, ...SQL_KEYWORDS]) {
      if (entry.insertText.includes("${")) {
        expect(entry.insertTextRules, `${entry.name} has tab stops but no snippet rule`).toBe(
          "InsertAsSnippet",
        );
      }
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// N7 — the push site must forward every field, not just four
// ───────────────────────────────────────────────────────────────────────────

describe("N7 — optional metadata is forwarded to monaco", () => {
  const rich: SqlCompletionEntry = {
    name: "approx_topk",
    label: "approx_topk",
    kind: "Function",
    detail: "(field, k) → top-k values",
    documentation: "Approximate top-k aggregation.",
    insertText: "approx_topk(${1:field}, ${2:10})",
    insertTextRules: "InsertAsSnippet",
    sortText: "approx_topk",
  };

  it("forwards detail", () => {
    expect(build({ suggestions: [rich] })[0].detail).toBe("(field, k) → top-k values");
  });

  it("forwards documentation", () => {
    expect(build({ suggestions: [rich] })[0].documentation).toBe(
      "Approximate top-k aggregation.",
    );
  });

  it("forwards sortText", () => {
    expect(build({ suggestions: [rich] })[0].sortText).toBe("approx_topk");
  });

  it("attaches the supplied range to every item", () => {
    const items = build({ suggestions: SQL_FUNCTIONS, keywords: SQL_KEYWORDS });
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.range).toBe(range);
  });

  it("every catalog function ships a detail signature for the docs column", () => {
    for (const fn of SQL_FUNCTIONS) {
      expect(fn.detail, `${fn.name} needs a detail signature`).toBeTruthy();
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// C1 — no substring pre-filter; monaco does the scoring
// ───────────────────────────────────────────────────────────────────────────

describe("C1 — candidates are not pre-filtered by substring", () => {
  const fields = [
    { name: "kubernetes_namespace_name", label: "kubernetes_namespace_name", kind: "Field" as const, insertText: "kubernetes_namespace_name" },
    { name: "code", label: "code", kind: "Field" as const, insertText: "code" },
  ];

  it("returns every keyword even when the typed word matches none of them", () => {
    const items = build({ keywords: fields, word: "zzz" });
    expect(items).toHaveLength(2);
  });

  it("keeps subsequence matches that String.includes would have dropped", () => {
    // "knn" is a subsequence of kubernetes_namespace_name but not a substring.
    const items = build({ keywords: fields, word: "knn" });
    expect(items.map((i: any) => i.label)).toContain("kubernetes_namespace_name");
  });

  it("returns suggestions unfiltered too", () => {
    const items = build({ suggestions: SQL_FUNCTIONS, word: "zzz" });
    expect(items).toHaveLength(SQL_FUNCTIONS.length);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// D7 / N2 — one catalog, shared everywhere
// ───────────────────────────────────────────────────────────────────────────

describe("D7/N2 — the catalog is complete and internally consistent", () => {
  it("carries all 26 historical suggestions", () => {
    expect(SQL_FUNCTIONS.length).toBeGreaterThanOrEqual(26);
  });

  it("includes the aggregates Traces was missing", () => {
    for (const name of ["sum", "avg", "count", "max", "min", "histogram", "approx_topk"]) {
      expect(SQL_FUNCTIONS.some((f) => f.name === name), `missing ${name}`).toBe(true);
    }
  });

  it("includes the array family", () => {
    for (const name of ["arrcount", "arrsort", "arrindex", "arrjoin", "arrzip", "arr_descending"]) {
      expect(SQL_FUNCTIONS.some((f) => f.name === name), `missing ${name}`).toBe(true);
    }
  });

  it("has no duplicate function names", () => {
    const names = SQL_FUNCTIONS.map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("marks the backward-compatibility aliases deprecated", () => {
    // sql/rewriter/match_all_raw.rs:41 rewrites these to match_all.
    for (const name of ["match_all_raw", "match_all_raw_ignore_case"]) {
      expect(byName(name).deprecated, `${name} should be flagged deprecated`).toBe(true);
    }
  });

  it("does not mark match_all itself deprecated", () => {
    expect(byName("match_all").deprecated).toBeFalsy();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Back-compat — the `suggestions` prop is public; legacy shape must still work
// ───────────────────────────────────────────────────────────────────────────

describe("back-compat — legacy callable label/insertText entries still build", () => {
  const legacy = {
    label: (kw: string) => `custom_fn('${kw}')`,
    kind: "Text",
    insertText: (kw: string) => `custom_fn('${kw}')`,
  };

  it("invokes callable label/insertText with the typed word", () => {
    const [item] = build({ suggestions: [legacy as any], word: "abc" });
    expect(item.label).toBe("custom_fn('abc')");
    expect(item.insertText).toBe("custom_fn('abc')");
  });

  it("still maps a legacy string kind through the enum", () => {
    const [item] = build({ suggestions: [legacy as any], word: "abc" });
    expect(item.kind).toBe(KINDS.Text);
  });

  // A4: the old code derived the token with textUntilPosition.split(" "), which
  // broke on newlines ("*\nFROM") and on partially quoted tokens ("'err").
  // buildCompletionItems must receive monaco's own word and nothing else.
  it("uses only the supplied word — never a space-split of the whole buffer", () => {
    const [item] = build({ suggestions: [legacy as any], word: "err" });
    expect(item.label).toBe("custom_fn('err')");
    expect(item.label).not.toContain("\n");
    expect(item.label).not.toContain("FROM");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// N2 / D7 — prop fallback resolution (pure; the component delegates to this)
// ───────────────────────────────────────────────────────────────────────────

describe("N2/D7 — resolveSuggestions / resolveKeywords", () => {
  it("falls back to the shared catalog when the SQL suggestions prop is null", async () => {
    const { resolveSuggestions } = await import("./sqlCompletion");
    expect(resolveSuggestions("sql", null)).toEqual(SQL_FUNCTIONS);
  });

  it("honours an explicit empty array (value context must stay empty)", async () => {
    const { resolveSuggestions } = await import("./sqlCompletion");
    expect(resolveSuggestions("sql", [])).toEqual([]);
  });

  it("passes a caller-supplied list through untouched", async () => {
    const { resolveSuggestions } = await import("./sqlCompletion");
    const custom = [{ name: "x", label: "x", kind: "Function", insertText: "x" }] as any;
    expect(resolveSuggestions("sql", custom)).toBe(custom);
  });

  it("does not inject SQL suggestions into non-SQL editors", async () => {
    const { resolveSuggestions } = await import("./sqlCompletion");
    expect(resolveSuggestions("json", null)).toEqual([]);
    expect(resolveSuggestions("promql", null)).toEqual([]);
  });

  it("falls back to the shared keyword list when the SQL keywords prop is empty", async () => {
    const { resolveKeywords } = await import("./sqlCompletion");
    expect(resolveKeywords("sql", [])).toEqual(SQL_KEYWORDS);
  });

  it("prefers caller-supplied keywords over the defaults", async () => {
    const { resolveKeywords } = await import("./sqlCompletion");
    const custom = [{ name: "host", label: "host", kind: "Field", insertText: "host" }] as any;
    expect(resolveKeywords("sql", custom)).toBe(custom);
  });
});
