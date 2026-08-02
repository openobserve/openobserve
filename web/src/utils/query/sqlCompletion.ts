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

/**
 * The single source of truth for SQL completion content.
 *
 * This module exists because the catalog previously lived in TWO places —
 * CodeQueryEditor.vue and useSuggestions.ts — which had already drifted apart
 * (7 entries vs 26). Traces, which passes no `suggestions` prop, was silently
 * served the smaller list and had no aggregate functions at all.
 *
 * Three rules the entries here must keep:
 *
 *  1. `label` is a STATIC string — never a function of what the user has typed.
 *     Monaco invokes a completion provider once per word and then filters the
 *     returned list client-side, so anything derived from the in-flight token
 *     freezes at its first keystroke (you type "appr", the item still says
 *     approx_topk('a', 10)).
 *  2. Column/expression arguments are BARE snippet tab stops; only genuine
 *     string literals are quoted. `sum('field')` and `arrcount('field')` are
 *     not valid SQL — the backend wants a column reference.
 *  3. `insertTextRules` is the STRING name of a monaco enum member. It is
 *     resolved to the numeric flag in buildCompletionItems, because monaco
 *     tests it bitwise and a raw string coerces to 0 (silently disabling
 *     snippets).
 */

/** Names of monaco's CompletionItemKind members that we actually use. */
export type CompletionKindName =
  | "Function"
  | "Keyword"
  | "Operator"
  | "Field"
  | "Value"
  | "Variable"
  | "Snippet"
  | "Text";

/** Names of monaco's CompletionItemInsertTextRule members. */
export type InsertTextRuleName = "InsertAsSnippet" | "KeepWhitespace" | "None";

export interface SqlCompletionEntry {
  /** Stable identity — the bare function/keyword name. Consumers that need to
   *  recognise a function (e.g. natural-language detection) key off this, NOT
   *  off the display label. */
  name: string;
  label: string;
  kind: CompletionKindName;
  insertText: string;
  /** Signature shown in the suggest widget's right-hand column. */
  detail?: string;
  documentation?: string;
  insertTextRules?: InsertTextRuleName;
  sortText?: string;
  /** Still accepted by the backend, but rewritten to something else. */
  deprecated?: boolean;
}

/** An entry as it may arrive from the `suggestions` prop — callers outside this
 *  module may still use the legacy callable shape. */
type LooseEntry = Omit<Partial<SqlCompletionEntry>, "label" | "insertText"> & {
  label: string | ((word: string) => string);
  insertText?: string | ((word: string) => string);
  kind?: string;
};

const SNIPPET: InsertTextRuleName = "InsertAsSnippet";

// ── SQL keywords and operators ───────────────────────────────────────────────

export const SQL_KEYWORDS: SqlCompletionEntry[] = [
  { name: "and", label: "and", kind: "Keyword", insertText: "and ", detail: "logical AND" },
  { name: "or", label: "or", kind: "Keyword", insertText: "or ", detail: "logical OR" },
  {
    name: "like",
    label: "like",
    kind: "Keyword",
    insertText: "like '%${1:params}%' ",
    insertTextRules: SNIPPET,
    detail: "pattern match",
  },
  {
    name: "in",
    label: "in",
    kind: "Keyword",
    insertText: "in ('${1:params}') ",
    insertTextRules: SNIPPET,
    detail: "value in list",
  },
  {
    name: "not in",
    label: "not in",
    kind: "Keyword",
    insertText: "not in ('${1:params}') ",
    insertTextRules: SNIPPET,
    detail: "value not in list",
  },
  {
    name: "between",
    label: "between",
    kind: "Keyword",
    insertText: "between '${1:params}' and '${2:params}' ",
    insertTextRules: SNIPPET,
    detail: "inclusive range",
  },
  {
    name: "not between",
    label: "not between",
    kind: "Keyword",
    insertText: "not between '${1:params}' and '${2:params}' ",
    insertTextRules: SNIPPET,
    detail: "outside range",
  },
  { name: "is null", label: "is null", kind: "Keyword", insertText: "is null ", detail: "is NULL" },
  {
    name: "is not null",
    label: "is not null",
    kind: "Keyword",
    insertText: "is not null ",
    detail: "is not NULL",
  },
  { name: ">", label: ">", kind: "Operator", insertText: "> ", detail: "greater than" },
  { name: "<", label: "<", kind: "Operator", insertText: "< ", detail: "less than" },
  { name: ">=", label: ">=", kind: "Operator", insertText: ">= ", detail: "greater or equal" },
  { name: "<=", label: "<=", kind: "Operator", insertText: "<= ", detail: "less or equal" },
  { name: "<>", label: "<>", kind: "Operator", insertText: "<> ", detail: "not equal" },
  { name: "=", label: "=", kind: "Operator", insertText: "= ", detail: "equal" },
  { name: "!=", label: "!=", kind: "Operator", insertText: "!= ", detail: "not equal" },
  {
    name: "()",
    label: "()",
    kind: "Keyword",
    insertText: "(${1:condition}) ",
    insertTextRules: SNIPPET,
    detail: "grouping",
  },
];

// ── O2 SQL functions ─────────────────────────────────────────────────────────
//
// Argument conventions, verified against the backend:
//   match_all family      — the sole argument is a search TERM (quoted)
//   str_match / re_match  — column first, literal second
//   arr* / spath / cast_* — column first (see arrcount_udf.rs:51)
//   aggregates            — bare column
//   histogram             — column + interval literal (useAlertForm.ts:463)

export const SQL_FUNCTIONS: SqlCompletionEntry[] = [
  {
    name: "match_all",
    label: "match_all",
    kind: "Function",
    detail: "(term)",
    documentation: "Full-text search for a term across all indexed fields of the stream.",
    insertText: "match_all('${1:value}')",
    insertTextRules: SNIPPET,
  },
  {
    name: "match_all_raw",
    label: "match_all_raw",
    kind: "Function",
    detail: "(term)",
    documentation:
      "Deprecated alias for `match_all` — the query planner rewrites it before execution. Prefer `match_all`.",
    insertText: "match_all_raw('${1:value}')",
    insertTextRules: SNIPPET,
    deprecated: true,
  },
  {
    name: "match_all_raw_ignore_case",
    label: "match_all_raw_ignore_case",
    kind: "Function",
    detail: "(term)",
    documentation:
      "Deprecated alias for `match_all` — the query planner rewrites it before execution. Prefer `match_all`.",
    insertText: "match_all_raw_ignore_case('${1:value}')",
    insertTextRules: SNIPPET,
    deprecated: true,
  },
  {
    name: "re_match",
    label: "re_match",
    kind: "Function",
    detail: "(field, regex)",
    documentation: "Return rows where the field matches the regular expression.",
    insertText: "re_match(${1:field}, '${2:regex}')",
    insertTextRules: SNIPPET,
  },
  {
    name: "re_not_match",
    label: "re_not_match",
    kind: "Function",
    detail: "(field, regex)",
    documentation: "Return rows where the field does NOT match the regular expression.",
    insertText: "re_not_match(${1:field}, '${2:regex}')",
    insertTextRules: SNIPPET,
  },
  {
    name: "str_match",
    label: "str_match",
    kind: "Function",
    detail: "(field, value)",
    documentation: "Case-sensitive substring match against a field.",
    insertText: "str_match(${1:field}, '${2:value}')",
    insertTextRules: SNIPPET,
  },
  {
    name: "str_match_ignore_case",
    label: "str_match_ignore_case",
    kind: "Function",
    detail: "(field, value)",
    documentation: "Case-insensitive substring match against a field.",
    insertText: "str_match_ignore_case(${1:field}, '${2:value}')",
    insertTextRules: SNIPPET,
  },
  {
    name: "arr_descending",
    label: "arr_descending",
    kind: "Function",
    detail: "(field)",
    documentation: "Sort the elements of an array field in descending order.",
    insertText: "arr_descending(${1:field})",
    insertTextRules: SNIPPET,
  },
  {
    name: "arrcount",
    label: "arrcount",
    kind: "Function",
    detail: "(field)",
    documentation: "Number of elements in an array field.",
    insertText: "arrcount(${1:field})",
    insertTextRules: SNIPPET,
  },
  {
    name: "arrsort",
    label: "arrsort",
    kind: "Function",
    detail: "(field)",
    documentation: "Sort the elements of an array field in ascending order.",
    insertText: "arrsort(${1:field})",
    insertTextRules: SNIPPET,
  },
  {
    name: "cast_to_arr",
    label: "cast_to_arr",
    kind: "Function",
    detail: "(field)",
    documentation: "Cast a field value to an array so the arr* functions can operate on it.",
    insertText: "cast_to_arr(${1:field})",
    insertTextRules: SNIPPET,
  },
  {
    name: "arrindex",
    label: "arrindex",
    kind: "Function",
    detail: "(field, start, end)",
    documentation: "Slice an array field by an inclusive index range.",
    insertText: "arrindex(${1:field}, ${2:1}, ${3:10})",
    insertTextRules: SNIPPET,
  },
  {
    name: "arrjoin",
    label: "arrjoin",
    kind: "Function",
    detail: "(field, delimiter)",
    documentation: "Join the elements of an array field into a single string.",
    insertText: "arrjoin(${1:field}, '${2:delimiter}')",
    insertTextRules: SNIPPET,
  },
  {
    name: "arrzip",
    label: "arrzip",
    kind: "Function",
    detail: "(field1, field2, delimiter)",
    documentation: "Pair up two array fields element by element, joined by the delimiter.",
    insertText: "arrzip(${1:field1}, ${2:field2}, '${3:delimiter}')",
    insertTextRules: SNIPPET,
  },
  {
    name: "spath",
    label: "spath",
    kind: "Function",
    detail: "(field, path)",
    documentation:
      "Extract a nested value from a structured field using a dotted path, e.g. `spath(body, 'user.id')`.",
    insertText: "spath(${1:field}, '${2:path}')",
    insertTextRules: SNIPPET,
  },
  {
    name: "to_array_string",
    label: "to_array_string",
    kind: "Function",
    detail: "(field)",
    documentation: "Render an array field as its string representation.",
    insertText: "to_array_string(${1:field})",
    insertTextRules: SNIPPET,
  },
  {
    name: "unnest",
    label: "unnest",
    kind: "Function",
    detail: "(array)",
    documentation:
      "Expand an array into one row per element, e.g. `unnest(flatten(cast_to_arr(field)))`.",
    insertText: "unnest(${1:array})",
    insertTextRules: SNIPPET,
  },
  {
    name: "array_extract",
    label: "array_extract",
    kind: "Function",
    detail: "(array, index)",
    documentation:
      "Extract a single element from an array by 1-based index, e.g. " +
      "`array_extract(regexp_match(log, '...'), 1)`.",
    insertText: "array_extract(${1:array}, ${2:1})",
    insertTextRules: SNIPPET,
  },
  {
    name: "sum",
    label: "sum",
    kind: "Function",
    detail: "(field)",
    documentation: "Sum of all values in the field. Aggregate — pair with GROUP BY.",
    insertText: "sum(${1:field})",
    insertTextRules: SNIPPET,
  },
  {
    name: "avg",
    label: "avg",
    kind: "Function",
    detail: "(field)",
    documentation: "Arithmetic mean of the field. Aggregate — pair with GROUP BY.",
    insertText: "avg(${1:field})",
    insertTextRules: SNIPPET,
  },
  {
    name: "count",
    label: "count",
    kind: "Function",
    detail: "(field)",
    documentation: "Number of rows. Aggregate — pair with GROUP BY.",
    insertText: "count(${1:field})",
    insertTextRules: SNIPPET,
  },
  {
    name: "max",
    label: "max",
    kind: "Function",
    detail: "(field)",
    documentation: "Largest value in the field. Aggregate — pair with GROUP BY.",
    insertText: "max(${1:field})",
    insertTextRules: SNIPPET,
  },
  {
    name: "min",
    label: "min",
    kind: "Function",
    detail: "(field)",
    documentation: "Smallest value in the field. Aggregate — pair with GROUP BY.",
    insertText: "min(${1:field})",
    insertTextRules: SNIPPET,
  },
  {
    name: "histogram",
    label: "histogram",
    kind: "Function",
    detail: "(field, interval)",
    documentation:
      "Bucket a timestamp column into fixed intervals, e.g. `histogram(_timestamp, '30 second')`. Use as the x-axis of a time series.",
    insertText: "histogram(${1:_timestamp}, '${2:30 second}')",
    insertTextRules: SNIPPET,
  },
  {
    name: "approx_topk",
    label: "approx_topk",
    kind: "Function",
    detail: "(field, k)",
    documentation:
      "Approximate the k most frequent values of a field. Much cheaper than an exact GROUP BY ... ORDER BY count DESC on high-cardinality fields.",
    insertText: "approx_topk(${1:field}, ${2:10})",
    insertTextRules: SNIPPET,
  },
  {
    name: "approx_topk_distinct",
    label: "approx_topk_distinct",
    kind: "Function",
    detail: "(field, distinct_field, k)",
    documentation:
      "Approximate the k values of `field` with the highest distinct count of `distinct_field`.",
    insertText: "approx_topk_distinct(${1:field}, ${2:field2}, ${3:10})",
    insertTextRules: SNIPPET,
  },
];

// ── Prop fallback resolution ─────────────────────────────────────────────────

/**
 * Which suggestion list an editor should use.
 *
 * `null` means "the caller expressed no opinion" → serve the shared catalog for
 * SQL. An explicit `[]` means "deliberately none" (value context) and must be
 * honoured — collapsing the two is what made field-value popups show functions.
 */
export const resolveSuggestions = <T>(language: string, propValue: T[] | null | undefined): T[] =>
  language === "sql" && propValue == null
    ? (SQL_FUNCTIONS as unknown as T[])
    : ((propValue ?? []) as T[]);

/** Which keyword list an editor should use. Empty means "use the defaults". */
export const resolveKeywords = <T>(language: string, propValue: T[] | null | undefined): T[] =>
  language === "sql" && !propValue?.length
    ? (SQL_KEYWORDS as unknown as T[])
    : ((propValue ?? []) as T[]);

// ── Monaco item construction ─────────────────────────────────────────────────

export interface BuildCompletionItemsOptions {
  keywords?: LooseEntry[];
  suggestions?: LooseEntry[];
  /** The word monaco reports at the cursor. Used ONLY to feed legacy callable
   *  entries; nothing in the shared catalog depends on it. */
  word?: string;
  range: unknown;
  /** monaco.languages.CompletionItemKind */
  kinds: Record<string, number>;
  /** monaco.languages.CompletionItemInsertTextRule */
  insertTextRules: Record<string, number>;
  /** monaco.languages.CompletionItemTag. Optional — omit and no item is tagged. */
  tags?: Record<string, number>;
}

const toMonacoItem = (
  entry: LooseEntry,
  word: string,
  range: unknown,
  kinds: Record<string, number>,
  rules: Record<string, number>,
  tags?: Record<string, number>,
): Record<string, unknown> => {
  // Legacy callable shape is still supported: `suggestions` is a public prop.
  const label = typeof entry.label === "function" ? entry.label(word) : entry.label;
  const insertText =
    typeof entry.insertText === "function"
      ? entry.insertText(word)
      : (entry.insertText ?? String(label));

  const item: Record<string, unknown> = {
    label,
    kind: kinds[entry.kind ?? "Text"],
    insertText,
    range,
  };

  // The string name MUST be translated here. Monaco does `insertTextRules & 4`,
  // and "InsertAsSnippet" & 4 === 0 — a string silently disables snippets.
  const ruleName = entry.insertTextRules;
  if (ruleName && rules[ruleName] !== undefined) item.insertTextRules = rules[ruleName];

  if (entry.detail !== undefined) item.detail = entry.detail;
  // Wrapped as an IMarkdownString: monaco renders markdown only for the object
  // form, so a plain string would show its backticks literally in the docs panel.
  if (entry.documentation !== undefined) {
    item.documentation =
      typeof entry.documentation === "string"
        ? { value: entry.documentation }
        : entry.documentation;
  }
  if (entry.sortText !== undefined) item.sortText = entry.sortText;

  // Renders the label with a strikethrough. match_all_raw and friends are still
  // accepted (sql/rewriter rewrites them) but should not be reached for.
  if (entry.deprecated && tags?.Deprecated !== undefined) item.tags = [tags.Deprecated];

  return item;
};

/**
 * Turn catalog entries into monaco completion items.
 *
 * Deliberately does NO filtering. Monaco already scores candidates with a
 * word-boundary-aware subsequence matcher; the substring pre-filter this
 * replaced discarded matches that matcher would have ranked first (typing
 * "knn" never surfaced kubernetes_namespace_name).
 */
export const buildCompletionItems = ({
  keywords = [],
  suggestions = [],
  word = "",
  range,
  kinds,
  insertTextRules,
  tags,
}: BuildCompletionItemsOptions): Record<string, unknown>[] => [
  ...keywords.map((k) => toMonacoItem(k, word, range, kinds, insertTextRules, tags)),
  ...suggestions.map((s) => toMonacoItem(s, word, range, kinds, insertTextRules, tags)),
];

/**
 * True when any entry derives its content from the typed word.
 *
 * Monaco calls a provider once per word and then filters the returned list
 * client-side; it only re-queries mid-word when the list is marked
 * `incomplete`. Nothing in the shared catalog is dynamic, but the `suggestions`
 * prop is public and legacy callers may still pass callables — for those the
 * caller must report the list as incomplete or the content freezes at the first
 * keystroke (the original approx_topk('a', 10) bug).
 */
export const hasDynamicEntries = (entries: LooseEntry[] = []): boolean =>
  entries.some((e) => typeof e.label === "function" || typeof e.insertText === "function");

/** Bare function names, for consumers that must recognise a call site (e.g.
 *  natural-language detection). Keyed off `name`, never off the display label. */
export const getSqlFunctionNames = (): string[] => SQL_FUNCTIONS.map((f) => f.name);

/**
 * Snippet argument list for a custom (VRL) function of `numArgs` arguments.
 *
 * Each argument gets its OWN tab stop. Monaco LINKS placeholders that share an
 * index, so the previous `'${1:value}'` repeated per argument meant typing into
 * one mirrored into all of them and a multi-argument function could not be
 * filled in. That was invisible while insertTextRules was broken and the text
 * was inserted literally; it became reachable the moment snippets started working.
 */
export const buildFunctionArgs = (numArgs: number | string): string => {
  const count = Number.parseInt(String(numArgs), 10);
  if (!Number.isFinite(count) || count <= 0) return "()";
  const args = Array.from({ length: count }, (_, i) => `'\${${i + 1}:value}'`);
  return `(${args.join(",")})`;
};
