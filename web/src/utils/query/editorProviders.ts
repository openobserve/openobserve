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
 * Signature help and hover, built from the same catalog entries completion uses.
 *
 * Completion tells you a function exists. Signature help tells you what to type
 * next — which matters because half the catalog takes two or more arguments and
 * their ORDER is invisible: histogram(_timestamp, '30 second') versus
 * spath(field, 'path') versus arrindex(field, start, end). Hover answers the
 * same question for a query you did not write, where completion never fires.
 */

import type { TranslateFn } from "@/types/i18n";
import type { SqlCompletionEntry } from "./sqlCompletion";

/** An entry as it may arrive from either list. Org VRL functions come through
 *  `updateFunctionKeywords` carrying a `label` and no `name`. */
type LooseEntry = Partial<SqlCompletionEntry> & { label: string; kind?: string };

/** The identity of an entry, whichever key it happens to carry. */
const entryName = (entry: LooseEntry): string => entry.name ?? entry.label ?? "";

export interface CallContext {
  /** The identifier preceding the open paren — NOT necessarily a function. */
  name: string;
  activeParameter: number;
}

/**
 * Locate the call the cursor sits inside, and which argument it is on.
 *
 * Purely syntactic on purpose: it reports whatever identifier precedes the open
 * paren, keyword or not. `WHERE (` and `sum (` are the same shape, and the text
 * alone cannot say which is a function — deciding that belongs to the catalog
 * (findFunctionEntry), which is also what keeps a column named like a keyword
 * from breaking anything.
 */
export const parseCallContext = (textUntilCursor: string): CallContext | null => {
  if (!textUntilCursor) return null;

  type Frame = { nameEnd: number; commas: number };
  const stack: Frame[] = [];

  let inString = false;
  let inLineComment = false;

  for (let i = 0; i < textUntilCursor.length; i++) {
    const ch = textUntilCursor[i];

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }

    if (inString) {
      if (ch === "'") {
        // A doubled quote is an escaped quote, not the end of the literal.
        if (textUntilCursor[i + 1] === "'") i++;
        else inString = false;
      }
      continue;
    }

    if (ch === "'") {
      inString = true;
      continue;
    }
    // Only `--` starts a comment; a lone minus is arithmetic.
    if (ch === "-" && textUntilCursor[i + 1] === "-") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "(") {
      stack.push({ nameEnd: i, commas: 0 });
      continue;
    }
    if (ch === ")") {
      stack.pop();
      continue;
    }
    if (ch === "," && stack.length) {
      stack[stack.length - 1].commas++;
    }
  }

  const frame = stack[stack.length - 1];
  if (!frame) return null;

  // Whatever identifier sits before the paren, allowing whitespace between.
  const before = textUntilCursor.slice(0, frame.nameEnd);
  const match = before.match(/([A-Za-z_][\w$]*)\s*$/);
  if (!match) return null;

  return { name: match[1], activeParameter: frame.commas };
};

/** Split "(a, b)" into ["a", "b"]. Opaque or empty signatures yield []. */
const parseParameters = (detail?: string): string[] => {
  if (!detail) return [];
  const match = detail.match(/\(([^)]*)\)/);
  if (!match) return [];
  const inner = match[1].trim();
  if (!inner || inner === "...") return [];
  return inner
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
};

/** Render one catalog entry as monaco's SignatureHelp payload. */
export const buildSignatureHelp = (entry: LooseEntry | null, activeParameter: number): any => {
  if (!entry) return null;

  const name = entryName(entry);
  const parameters = parseParameters(entry.detail);
  // A signature with no argument metadata still gets a usable label rather
  // than printing "undefined" — org VRL functions arrive with no `detail`.
  const args = entry.detail && entry.detail.startsWith("(") ? entry.detail : "()";

  return {
    signatures: [
      {
        label: `${name}${args}`,
        parameters: parameters.map((label) => ({ label })),
        ...(entry.documentation ? { documentation: { value: entry.documentation } } : {}),
      },
    ],
    activeSignature: 0,
    // Extra commas must not leave monaco pointing past the end.
    activeParameter: parameters.length ? Math.min(activeParameter, parameters.length - 1) : 0,
  };
};

/**
 * Resolve a bare word for HOVER.
 *
 * Keywords are searched first, so a column named `count` wins over the function
 * of the same name — hovering `count` in `WHERE count > 5` is about the column.
 */
export const findCatalogEntry = (
  word: string,
  keywords: LooseEntry[] = [],
  suggestions: LooseEntry[] = [],
): LooseEntry | null => {
  if (!word) return null;
  const needle = word.toLowerCase();
  const match = (e: LooseEntry) => entryName(e).toLowerCase() === needle;
  return keywords.find(match) ?? suggestions.find(match) ?? null;
};

/**
 * Resolve a name for SIGNATURE HELP, which only ever runs at `name(` — a call.
 *
 * Functions win here, and keywords are searched too: org VRL functions live in
 * the keyword list with kind "Function", so searching suggestions alone would
 * leave signature help dead for exactly the functions a user knows least.
 */
export const findFunctionEntry = (
  name: string,
  keywords: LooseEntry[] = [],
  suggestions: LooseEntry[] = [],
): LooseEntry | null => {
  if (!name) return null;
  const needle = name.toLowerCase();
  const isFn = (e: LooseEntry) => e.kind === "Function" && entryName(e).toLowerCase() === needle;
  return suggestions.find(isFn) ?? keywords.find(isFn) ?? null;
};

/** Render an entry as monaco hover contents (IMarkdownString[]). */
export const buildHoverContents = (
  t: TranslateFn,
  entry: LooseEntry | null,
): { value: string }[] | null => {
  if (!entry) return null;
  const name = entryName(entry);
  const contents: { value: string }[] = [];

  if (entry.kind === "Field") {
    // Omit rather than render "undefined" for a field with no known type.
    contents.push({
      value: `\`\`\`sql\n${name}${entry.detail ? `: ${entry.detail}` : ""}\n\`\`\``,
    });
  } else {
    const args = entry.detail && entry.detail.startsWith("(") ? entry.detail : "";
    contents.push({ value: `\`\`\`sql\n${name}${args}\n\`\`\`` });
  }

  if (entry.deprecated) {
    contents.push({ value: t("sqlEditor.hover.deprecated") });
  }
  if (entry.documentation) contents.push({ value: entry.documentation });

  return contents;
};

/**
 * Aggregates whose FIRST argument is a numeric column.
 *
 * Only the first argument: approx_percentile_cont(value, 0.95) takes a fraction
 * second, and percentile_cont takes one first — ranking columns there would be
 * noise. Restricting to argument 0 covers the reported case and every common
 * one without a per-function argument table nobody would keep up to date.
 *
 * min/max are here even though they accept strings: ranking is a hint, and the
 * numeric case is overwhelmingly the intent in a metrics query.
 */
const NUMERIC_COLUMN_FUNCTIONS = new Set([
  "avg",
  "sum",
  "min",
  "max",
  "median",
  "approx_median",
  "approx_percentile_cont",
  "approx_percentile_cont_with_weight",
  "stddev",
  "stddev_pop",
  "stddev_samp",
  "var",
  "var_pop",
  "var_samp",
  "variance",
]);

/** Arrow types that name a number. Decimal carries a precision suffix. */
const NUMERIC_TYPE = /^(u?int(8|16|32|64)|float(16|32|64)|decimal)/i;

/**
 * Is this entry a column holding numbers?
 *
 * Kind is checked first: a FUNCTION whose detail happens to mention a numeric
 * type is still a function and must not be ranked in among the columns.
 */
export const isNumericField = (entry: LooseEntry): boolean =>
  entry.kind === "Field" && NUMERIC_TYPE.test(entry.detail ?? "");

/** Does the cursor sit where a numeric column is wanted? */
export const wantsNumericColumn = (call: CallContext | null): boolean =>
  !!call && call.activeParameter === 0 && NUMERIC_COLUMN_FUNCTIONS.has(call.name.toLowerCase());

/**
 * Lift the numeric columns to the top of the list.
 *
 * RANKS, does not filter. A declared type is a strong hint, not a rule — a
 * quantity stored as Utf8 is still a legal argument — and hiding a column the
 * user knows exists is worse than ordering it late.
 *
 * Prefixing the existing sortText rather than rebuilding it keeps the relative
 * order inside each group and works whatever lane scheme the host used. Copies
 * are returned because the lists handed in are the composable's live refs:
 * mutating them would make a contextual ranking permanent.
 */
export const rankNumericFieldsFirst = (entries: LooseEntry[]): LooseEntry[] =>
  entries.map((entry) =>
    isNumericField(entry)
      ? { ...entry, sortText: `\u0000${entry.sortText ?? entryName(entry)}` }
      : entry,
  );

/**
 * Detect that the cursor sits where a field VALUE belongs.
 *
 * Mirrors the operator set the composable has always recognised. Returned so
 * the completion provider can await the value lookup itself instead of the
 * parent debouncing, fetching, pushing a prop down and re-opening the widget.
 */
export const parseValueContext = (
  textUntilCursor: string,
): { field: string; hasOpenQuote: boolean } | null => {
  const regex =
    /(\w+)\s*(?:!=|<>|>=|<=|=|>|<)\s*(?:'[^']*)?$|(\w+)\s+(?:NOT\s+)?IN\s*\(\s*(?:'[^']*)?$|(\w+)\s+(?:NOT\s+)?LIKE\s*(?:'[^']*)?$|(?:str_match|fuzzy_match)\s*\(\s*(\w+)\s*,\s*(?:'[^']*)?$/i;
  const match = regex.exec(textUntilCursor);
  if (!match) return null;
  const field = match[1] ?? match[2] ?? match[3] ?? match[4];
  if (!field) return null;
  return {
    field,
    hasOpenQuote: /'[^']*$/.test(textUntilCursor.slice(match.index)),
  };
};

export interface ValueEntryOptions {
  /** The user has typed an opening quote, so the value only needs closing. */
  hasOpenQuote: boolean;
  /**
   * Monaco's auto-closed quote sits immediately after the cursor.
   *
   * Invisible to a parser that sees only the text BEFORE the cursor: typing a
   * quote makes the text `level = ''` with the cursor between them, and
   * appending our own closer produced `level = 'error''`.
   */
  closingQuoteAhead?: boolean;
  /** The replacement range monaco reported. Needed to swallow that quote. */
  range?: Record<string, number>;
}

/**
 * Build completion entries for resolved field values, quoted appropriately.
 *
 * When monaco has already auto-closed the quote, the entry EXTENDS its
 * replacement range over that quote and inserts its own. Simply omitting the
 * closer produces the right TEXT but leaves the cursor inside the string, so
 * the next thing typed lands inside the quotes -- which is how
 * `severity = 'INFO AND service_name = INFO'` happened while testing this.
 * Numeric values keep the plain range: they insert no closer, so swallowing
 * the quote would leave the literal unterminated.
 */
export const buildValueEntries = (
  values: string[],
  { hasOpenQuote, closingQuoteAhead = false, range }: ValueEntryOptions,
): LooseEntry[] =>
  values.map((value, index) => {
    const isNumeric = value !== "" && !Number.isNaN(Number(value));
    const isBoolean = value === "true" || value === "false";

    const entry: LooseEntry = {
      name: value,
      label: value,
      kind: "Value",
      insertText: value,
      // Values sort above every other lane. Written as an ESCAPE, not a raw
      // control character: a literal NUL in the source makes the file binary
      // to git and grep, and is silently easy to mangle in an edit.
      sortText: `\u0000${String(index).padStart(6, "0")}`,
    };

    if (isNumeric || isBoolean) return entry;
    if (!hasOpenQuote) {
      entry.insertText = `'${value}'`;
      return entry;
    }

    entry.insertText = `${value}'`;
    if (closingQuoteAhead && range) {
      entry.range = { ...range, endColumn: (range.endColumn ?? 1) + 1 };
    }
    return entry;
  });
