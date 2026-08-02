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

/**
 * Sort lanes. Monaco orders by sortText, so a single coherent scheme keeps the
 * groups from interleaving. Fields first (what you are most likely to want),
 * then functions, then structural SQL.
 */
export const SORT_LANE = {
  field: "\u0000",
  function: "\u0001",
  predicate: "\u0002",
  clause: "\u0003",
} as const;

// ── SQL keywords and operators ───────────────────────────────────────────────

export const SQL_KEYWORDS: SqlCompletionEntry[] = [
  {
    name: "and",
    label: "and",
    kind: "Keyword",
    insertText: "and ",
    detail: "logical AND",
    sortText: SORT_LANE.predicate + "and",
    documentation: "Both conditions must hold.",
  },
  {
    name: "or",
    label: "or",
    kind: "Keyword",
    insertText: "or ",
    detail: "logical OR",
    sortText: SORT_LANE.predicate + "or",
    documentation: "Either condition may hold.",
  },
  {
    name: "like",
    label: "like",
    kind: "Keyword",
    insertText: "like '%${1:params}%' ",
    insertTextRules: SNIPPET,
    detail: "pattern match",
    sortText: SORT_LANE.predicate + "like",
    documentation: "SQL pattern match; % matches any run of characters and _ matches one.",
  },
  {
    name: "in",
    label: "in",
    kind: "Keyword",
    insertText: "in ('${1:params}') ",
    insertTextRules: SNIPPET,
    detail: "value in list",
    sortText: SORT_LANE.predicate + "in",
    documentation: "True when the value appears in the supplied list.",
  },
  {
    name: "not in",
    label: "not in",
    kind: "Keyword",
    insertText: "not in ('${1:params}') ",
    insertTextRules: SNIPPET,
    detail: "value not in list",
    sortText: SORT_LANE.predicate + "not in",
    documentation: "True when the value does NOT appear in the supplied list.",
  },
  {
    name: "between",
    label: "between",
    kind: "Keyword",
    insertText: "between '${1:params}' and '${2:params}' ",
    insertTextRules: SNIPPET,
    detail: "inclusive range",
    sortText: SORT_LANE.predicate + "between",
    documentation: "Inclusive range test — equivalent to `>= low AND <= high`.",
  },
  {
    name: "not between",
    label: "not between",
    kind: "Keyword",
    insertText: "not between '${1:params}' and '${2:params}' ",
    insertTextRules: SNIPPET,
    detail: "outside range",
    sortText: SORT_LANE.predicate + "not between",
    documentation: "True when the value falls outside the inclusive range.",
  },
  {
    name: "is null",
    label: "is null",
    kind: "Keyword",
    insertText: "is null ",
    detail: "is NULL",
    sortText: SORT_LANE.predicate + "is null",
    documentation: "Matches rows where the field has no value. `= NULL` never matches.",
  },
  {
    name: "is not null",
    label: "is not null",
    kind: "Keyword",
    insertText: "is not null ",
    detail: "is not NULL",
    sortText: SORT_LANE.predicate + "is not null",
    documentation: "Matches rows where the field has any value.",
  },
  {
    name: ">",
    label: ">",
    kind: "Operator",
    insertText: "> ",
    detail: "greater than",
    sortText: SORT_LANE.predicate + ">",
  },
  {
    name: "<",
    label: "<",
    kind: "Operator",
    insertText: "< ",
    detail: "less than",
    sortText: SORT_LANE.predicate + "<",
  },
  {
    name: ">=",
    label: ">=",
    kind: "Operator",
    insertText: ">= ",
    detail: "greater or equal",
    sortText: SORT_LANE.predicate + ">=",
  },
  {
    name: "<=",
    label: "<=",
    kind: "Operator",
    insertText: "<= ",
    detail: "less or equal",
    sortText: SORT_LANE.predicate + "<=",
  },
  {
    name: "<>",
    label: "<>",
    kind: "Operator",
    insertText: "<> ",
    detail: "not equal",
    sortText: SORT_LANE.predicate + "<>",
  },
  {
    name: "=",
    label: "=",
    kind: "Operator",
    insertText: "= ",
    detail: "equal",
    sortText: SORT_LANE.predicate + "=",
  },
  {
    name: "!=",
    label: "!=",
    kind: "Operator",
    insertText: "!= ",
    detail: "not equal",
    sortText: SORT_LANE.predicate + "!=",
  },
  {
    name: "()",
    label: "()",
    kind: "Keyword",
    insertText: "(${1:condition}) ",
    insertTextRules: SNIPPET,
    detail: "grouping",
    sortText: SORT_LANE.predicate + "()",
    documentation: "Group conditions to control precedence.",
  },
];

// ── SQL clause keywords ──────────────────────────────────────────────────────
//
// monaco's sql.contribution.js is tokenizer-only — it registers no completion
// provider — so SELECT/FROM/WHERE were never offered by anything. They only
// appeared to work because the word-based provider echoed text already in the
// buffer. Uppercase by SQL convention; the predicate list above stays lowercase
// because that is how it has always been inserted.

export const SQL_CLAUSE_KEYWORDS: SqlCompletionEntry[] = [
  {
    name: "SELECT",
    label: "SELECT",
    kind: "Keyword",
    detail: "choose columns",
    documentation: "Choose which columns the query returns. `SELECT *` returns every column.",
    insertText: "SELECT ${1:*}",
    insertTextRules: SNIPPET,
    sortText: SORT_LANE.clause + "SELECT",
  },
  {
    name: "FROM",
    label: "FROM",
    kind: "Keyword",
    detail: "source stream",
    documentation: "Names the stream the query reads from.",
    insertText: "FROM ${1:stream}",
    insertTextRules: SNIPPET,
    sortText: SORT_LANE.clause + "FROM",
  },
  {
    name: "WHERE",
    label: "WHERE",
    kind: "Keyword",
    detail: "filter rows",
    documentation: "Filters rows before grouping. Applied to individual rows.",
    insertText: "WHERE ${1:condition}",
    insertTextRules: SNIPPET,
    sortText: SORT_LANE.clause + "WHERE",
  },
  {
    name: "GROUP BY",
    label: "GROUP BY",
    kind: "Keyword",
    detail: "aggregate by",
    documentation: "Collapses rows sharing the listed values into one row per group.",
    insertText: "GROUP BY ${1:field}",
    insertTextRules: SNIPPET,
    sortText: SORT_LANE.clause + "GROUP BY",
  },
  {
    name: "ORDER BY",
    label: "ORDER BY",
    kind: "Keyword",
    detail: "sort results",
    documentation: "Sorts the result set. Combine with ASC or DESC.",
    insertText: "ORDER BY ${1:field} ${2:DESC}",
    insertTextRules: SNIPPET,
    sortText: SORT_LANE.clause + "ORDER BY",
  },
  {
    name: "HAVING",
    label: "HAVING",
    kind: "Keyword",
    detail: "filter groups",
    documentation: "Filters AFTER grouping — use it on aggregates, where WHERE cannot reach.",
    insertText: "HAVING ${1:condition}",
    insertTextRules: SNIPPET,
    sortText: SORT_LANE.clause + "HAVING",
  },
  {
    name: "LIMIT",
    label: "LIMIT",
    kind: "Keyword",
    detail: "cap row count",
    documentation: "Caps how many rows are returned.",
    insertText: "LIMIT ${1:100}",
    insertTextRules: SNIPPET,
    sortText: SORT_LANE.clause + "LIMIT",
  },
  {
    name: "OFFSET",
    label: "OFFSET",
    kind: "Keyword",
    detail: "skip rows",
    documentation: "Skips the first N rows, usually paired with LIMIT for paging.",
    insertText: "OFFSET ${1:0}",
    insertTextRules: SNIPPET,
    sortText: SORT_LANE.clause + "OFFSET",
  },
  {
    name: "DISTINCT",
    label: "DISTINCT",
    kind: "Keyword",
    detail: "unique values",
    documentation: "Removes duplicate rows from the result.",
    insertText: "DISTINCT ${1:field}",
    insertTextRules: SNIPPET,
    sortText: SORT_LANE.clause + "DISTINCT",
  },
  {
    name: "AS",
    label: "AS",
    kind: "Keyword",
    detail: "alias",
    documentation: "Renames a column or stream for the rest of the query.",
    insertText: "AS ${1:alias}",
    insertTextRules: SNIPPET,
    sortText: SORT_LANE.clause + "AS",
  },
  {
    name: "WITH",
    label: "WITH",
    kind: "Keyword",
    detail: "common table expression",
    documentation: "Defines a named subquery you can reference below, for readability.",
    insertText: "WITH ${1:name} AS (${2:SELECT ...})",
    insertTextRules: SNIPPET,
    sortText: SORT_LANE.clause + "WITH",
  },
  {
    name: "UNION",
    label: "UNION",
    kind: "Keyword",
    detail: "combine, dedup",
    documentation: "Combines two result sets and removes duplicate rows.",
    insertText: "UNION",
    sortText: SORT_LANE.clause + "UNION",
  },
  {
    name: "UNION ALL",
    label: "UNION ALL",
    kind: "Keyword",
    detail: "combine, keep dups",
    documentation: "Combines two result sets keeping every row. Cheaper than UNION.",
    insertText: "UNION ALL",
    sortText: SORT_LANE.clause + "UNION ALL",
  },
  {
    name: "INNER JOIN",
    label: "INNER JOIN",
    kind: "Keyword",
    detail: "matching rows only",
    documentation: "Returns only rows with a match on both sides of the join.",
    insertText: "INNER JOIN ${1:stream} ON ${2:condition}",
    insertTextRules: SNIPPET,
    sortText: SORT_LANE.clause + "INNER JOIN",
  },
  {
    name: "LEFT JOIN",
    label: "LEFT JOIN",
    kind: "Keyword",
    detail: "all left rows",
    documentation: "Returns every left-hand row, filling unmatched right columns with NULL.",
    insertText: "LEFT JOIN ${1:stream} ON ${2:condition}",
    insertTextRules: SNIPPET,
    sortText: SORT_LANE.clause + "LEFT JOIN",
  },
  {
    name: "RIGHT JOIN",
    label: "RIGHT JOIN",
    kind: "Keyword",
    detail: "all right rows",
    documentation: "Returns every right-hand row, filling unmatched left columns with NULL.",
    insertText: "RIGHT JOIN ${1:stream} ON ${2:condition}",
    insertTextRules: SNIPPET,
    sortText: SORT_LANE.clause + "RIGHT JOIN",
  },
  {
    name: "FULL OUTER JOIN",
    label: "FULL OUTER JOIN",
    kind: "Keyword",
    detail: "all rows both sides",
    documentation: "Returns rows from both sides, filling unmatched columns with NULL.",
    insertText: "FULL OUTER JOIN ${1:stream} ON ${2:condition}",
    insertTextRules: SNIPPET,
    sortText: SORT_LANE.clause + "FULL OUTER JOIN",
  },
  {
    name: "ON",
    label: "ON",
    kind: "Keyword",
    detail: "join condition",
    documentation: "States which columns a join matches on.",
    insertText: "ON ${1:left} = ${2:right}",
    insertTextRules: SNIPPET,
    sortText: SORT_LANE.clause + "ON",
  },
  {
    name: "CASE",
    label: "CASE",
    kind: "Keyword",
    detail: "conditional expression",
    documentation: "Inline conditional. Each WHEN is tested in order; ELSE supplies the fallback.",
    insertText: "CASE WHEN ${1:condition} THEN ${2:result} ELSE ${3:fallback} END",
    insertTextRules: SNIPPET,
    sortText: SORT_LANE.clause + "CASE",
  },
  {
    name: "WHEN",
    label: "WHEN",
    kind: "Keyword",
    detail: "case branch",
    documentation: "One branch of a CASE expression, tested in order.",
    insertText: "WHEN ${1:condition} THEN ${2:result}",
    insertTextRules: SNIPPET,
    sortText: SORT_LANE.clause + "WHEN",
  },
  {
    name: "THEN",
    label: "THEN",
    kind: "Keyword",
    detail: "case result",
    documentation: "The value a CASE branch produces when its condition holds.",
    insertText: "THEN ${1:result}",
    insertTextRules: SNIPPET,
    sortText: SORT_LANE.clause + "THEN",
  },
  {
    name: "ELSE",
    label: "ELSE",
    kind: "Keyword",
    detail: "case fallback",
    documentation: "The value a CASE produces when no branch matched.",
    insertText: "ELSE ${1:fallback}",
    insertTextRules: SNIPPET,
    sortText: SORT_LANE.clause + "ELSE",
  },
  {
    name: "END",
    label: "END",
    kind: "Keyword",
    detail: "close case",
    documentation: "Closes a CASE expression.",
    insertText: "END",
    sortText: SORT_LANE.clause + "END",
  },
  {
    name: "CAST",
    label: "CAST",
    kind: "Keyword",
    detail: "convert type",
    documentation: "Converts a value to another type, e.g. `CAST(code AS VARCHAR)`.",
    insertText: "CAST(${1:expr} AS ${2:type})",
    insertTextRules: SNIPPET,
    sortText: SORT_LANE.clause + "CAST",
  },
  {
    name: "OVER",
    label: "OVER",
    kind: "Keyword",
    detail: "window frame",
    documentation: "Turns an aggregate into a window function computed across related rows.",
    insertText: "OVER (PARTITION BY ${1:field} ORDER BY ${2:field})",
    insertTextRules: SNIPPET,
    sortText: SORT_LANE.clause + "OVER",
  },
  {
    name: "PARTITION BY",
    label: "PARTITION BY",
    kind: "Keyword",
    detail: "window grouping",
    documentation: "Splits a window function's input into independent groups.",
    insertText: "PARTITION BY ${1:field}",
    insertTextRules: SNIPPET,
    sortText: SORT_LANE.clause + "PARTITION BY",
  },
  {
    name: "ASC",
    label: "ASC",
    kind: "Keyword",
    detail: "ascending",
    documentation: "Sorts smallest first. The default for ORDER BY.",
    insertText: "ASC",
    sortText: SORT_LANE.clause + "ASC",
  },
  {
    name: "DESC",
    label: "DESC",
    kind: "Keyword",
    detail: "descending",
    documentation: "Sorts largest first — usually what you want for timestamps.",
    insertText: "DESC",
    sortText: SORT_LANE.clause + "DESC",
  },
  {
    name: "NULLS FIRST",
    label: "NULLS FIRST",
    kind: "Keyword",
    detail: "nulls before values",
    documentation: "Places NULLs at the start of the sort order.",
    insertText: "NULLS FIRST",
    sortText: SORT_LANE.clause + "NULLS FIRST",
  },
  {
    name: "NULLS LAST",
    label: "NULLS LAST",
    kind: "Keyword",
    detail: "nulls after values",
    documentation: "Places NULLs at the end of the sort order.",
    insertText: "NULLS LAST",
    sortText: SORT_LANE.clause + "NULLS LAST",
  },
  {
    name: "EXISTS",
    label: "EXISTS",
    kind: "Keyword",
    detail: "subquery has rows",
    documentation: "True when the subquery returns at least one row.",
    insertText: "EXISTS (${1:SELECT ...})",
    insertTextRules: SNIPPET,
    sortText: SORT_LANE.clause + "EXISTS",
  },
  {
    name: "ANY",
    label: "ANY",
    kind: "Keyword",
    detail: "matches any",
    documentation: "True when the comparison holds for at least one value returned.",
    insertText: "ANY (${1:SELECT ...})",
    insertTextRules: SNIPPET,
    sortText: SORT_LANE.clause + "ANY",
  },
  {
    name: "ALL",
    label: "ALL",
    kind: "Keyword",
    detail: "matches all",
    documentation: "True when the comparison holds for every value returned.",
    insertText: "ALL (${1:SELECT ...})",
    insertTextRules: SNIPPET,
    sortText: SORT_LANE.clause + "ALL",
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
    ? ([...SQL_KEYWORDS, ...SQL_CLAUSE_KEYWORDS] as unknown as T[])
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

/** Callers pass field lists in several shapes; a bare string is a field name. */
const normalizeEntry = (entry: unknown): LooseEntry | null => {
  if (typeof entry === "string") {
    return entry ? { name: entry, label: entry, kind: "Field", insertText: entry } : null;
  }
  if (!entry || typeof entry !== "object") return null;
  const e = entry as LooseEntry;
  // An entry with no label cannot be rendered — it used to reach monaco as
  // `undefined` with the literal text "undefined" as its insertion.
  return e.label === undefined || e.label === null || e.label === "" ? null : e;
};

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
}: BuildCompletionItemsOptions): Record<string, unknown>[] =>
  [...keywords, ...suggestions]
    .map(normalizeEntry)
    .filter((e): e is LooseEntry => e !== null)
    .map((e) => toMonacoItem(e, word, range, kinds, insertTextRules, tags));

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

/**
 * Build a completion entry for a schema field.
 *
 * The column type is already carried on every field object and used to be
 * discarded; it is exactly what belongs in the suggest widget's inline column,
 * and it is what type-aware operator suggestions will key off later.
 */
export interface FieldLike {
  name: string;
  /** Dynamic fields and Alerts columns. */
  type?: string;
  /** Logs SCHEMA fields (useStreamFields.ts:452). */
  dataType?: string;
  /** Raw stream-schema payloads. */
  data_type?: string;
  field_type?: string;
}

export const buildFieldEntry = (field: FieldLike): SqlCompletionEntry => {
  const entry: SqlCompletionEntry = {
    name: field.name,
    label: field.name,
    kind: "Field",
    insertText: field.name,
    sortText: SORT_LANE.field + field.name,
  };
  // The column type reaches us under four different keys depending on which
  // API the caller read it from. Omit rather than render "undefined".
  const columnType = field.type || field.dataType || field.data_type || field.field_type;
  if (columnType) entry.detail = columnType;
  return entry;
};
