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
type LooseEntry = Partial<SqlCompletionEntry> & {
  label: string;
  kind?: string;
};

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

export const VALUE_WAIT_BUDGET_MS = 1000;

/** A list this long may be cut short by the lookup, so the menu says so. */
export const VALUES_SHOWN_CAP = 10;

export type ValueOperator = "compare" | "in" | "like" | "match";

export interface ValueContext {
  field: string;
  hasOpenQuote: boolean;
  typed: string;
  operator: ValueOperator;
  /** Earlier elements of the IN list being typed; empty for every other operator. */
  chosen: string[];
}

const BARE_OR_QUOTED = String.raw`(?:'([^']*)|([\w.\-]*))`;
// A finished IN element: a quoted literal ('' is an escaped quote) or a bare number, boolean or word.
const IN_ELEMENT = String.raw`(?:'(?:[^']|'')*'|[\w.\-+]+)`;
const IN_ELEMENT_EACH = /'((?:[^']|'')*)'|([\w.\-+]+)/g;

const VALUE_PATTERNS: [ValueOperator, RegExp][] = [
  ["compare", new RegExp(String.raw`(\w+)\s*(?:!=|<>|>=|<=|=|>|<)\s*${BARE_OR_QUOTED}$`)],
  [
    "in",
    new RegExp(
      String.raw`(\w+)\s+(?:NOT\s+)?IN\s*\(\s*(?:${IN_ELEMENT}\s*,\s*)*${BARE_OR_QUOTED}$`,
      "i",
    ),
  ],
  ["like", new RegExp(String.raw`(\w+)\s+(?:NOT\s+)?I?LIKE\s*${BARE_OR_QUOTED}$`, "i")],
  ["match", /(?:str_match|fuzzy_match)\s*\(\s*(\w+)\s*,\s*(?:'([^']*)|())$/i],
];

const chosenInValues = (list: string): string[] =>
  [...list.matchAll(IN_ELEMENT_EACH)].map(
    ([, quoted, bare]) => quoted?.replace(/''/g, "'") ?? bare,
  );

export const parseValueContext = (textUntilCursor: string): ValueContext | null => {
  for (const [operator, pattern] of VALUE_PATTERNS) {
    const match = pattern.exec(textUntilCursor);
    if (!match) continue;
    const quoted = match[2];
    // `match_all('user=` is text inside a string, not a comparison: only the match's own quote may open one.
    const codeUpTo =
      quoted === undefined ? textUntilCursor.length : match.index + match[0].lastIndexOf("'");
    if (literalStateAtEnd(textUntilCursor.slice(0, codeUpTo)) !== "code") continue;
    const typed = quoted ?? match[3] ?? "";
    // The finished elements run from the IN paren to where the element being typed starts.
    const listEnd = match[0].length - typed.length - (quoted === undefined ? 0 : 1);
    return {
      field: match[1],
      hasOpenQuote: quoted !== undefined,
      typed,
      operator,
      chosen:
        operator === "in" ? chosenInValues(match[0].slice(match[0].indexOf("(") + 1, listEnd)) : [],
    };
  }
  return null;
};

export const literalStateAtEnd = (text: string): "code" | "string" | "comment" => {
  let state: "code" | "string" | "identifier" | "line" | "block" = "code";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (state === "line") {
      if (ch === "\n") state = "code";
    } else if (state === "block") {
      if (ch === "*" && next === "/") {
        state = "code";
        i++;
      }
    } else if (state === "string" || state === "identifier") {
      const quote = state === "string" ? "'" : '"';
      // A doubled quote is an escaped quote, not the end of the literal.
      if (ch === quote && next === quote) i++;
      else if (ch === quote) state = "code";
    } else if (ch === "'") state = "string";
    else if (ch === '"') state = "identifier";
    else if (ch === "-" && next === "-") state = "line";
    else if (ch === "/" && next === "*") {
      state = "block";
      i++;
    }
  }
  if (state === "string") return "string";
  return state === "line" || state === "block" ? "comment" : "code";
};

export type ColumnKind = "text" | "number" | "boolean" | "unknown";

export const columnKind = (type?: string): ColumnKind => {
  if (!type) return "unknown";
  if (NUMERIC_TYPE.test(type)) return "number";
  if (/^bool/i.test(type)) return "boolean";
  if (/utf8|string|binary|text|varchar/i.test(type)) return "text";
  return "unknown";
};

export interface ValueEntryOptions {
  /** The user has typed an opening quote, so the value only needs closing. */
  hasOpenQuote: boolean;
  /** Monaco's auto-closed quote sits right after the cursor and must be swallowed. */
  closingQuoteAhead?: boolean;
  range?: Record<string, number>;
  /** Without it the value itself decides whether to quote. */
  fieldType?: string;
  pattern?: boolean;
}

const looksBare = (value: string): boolean =>
  (value !== "" && !Number.isNaN(Number(value))) || value === "true" || value === "false";

/** % and _ are wildcards and \ is DataFusion's implicit LIKE escape; an ESCAPE '\' literal would read as unterminated to the editor's scanners. */
const likeLiteral = (value: string): string =>
  `%${value.replace(/[\\%_]/g, "\\$&").replace(/'/g, "''")}%`;

export const buildValueEntries = (
  values: string[],
  { hasOpenQuote, closingQuoteAhead = false, range, fieldType, pattern = false }: ValueEntryOptions,
): LooseEntry[] => {
  const kind = columnKind(fieldType);
  return values.map((value, index) => {
    const entry: LooseEntry = {
      name: value,
      label: value,
      kind: "Value",
      insertText: value,
      // An escape, not a raw NUL: a literal one makes the file binary to git.
      sortText: `\u0000${String(index).padStart(6, "0")}`,
      filterText: value,
    };

    const bareByType = kind === "number" || kind === "boolean";
    const bare =
      !hasOpenQuote && !pattern && (bareByType || (kind === "unknown" && looksBare(value)));
    if (bare) return entry;

    const literal = pattern ? likeLiteral(value) : value.replace(/'/g, "''");
    // The label shows what goes in, so `'200'` and `200` read differently before they are picked.
    entry.label = `'${literal}'`;
    if (!hasOpenQuote) {
      entry.insertText = `'${literal}'`;
      // Filtered as typed, quote included: a late answer is matched against `'e` as well as `e`.
      entry.filterText = `'${value}'`;
      return entry;
    }

    entry.insertText = `${literal}'`;
    entry.filterText = pattern ? literal : value;
    // Swallow Monaco's auto-closed quote, or the caret is left inside the string.
    if (closingQuoteAhead && range) {
      entry.range = { ...range, endColumn: (range.endColumn ?? 1) + 1 };
    }
    return entry;
  });
};

export type ValueStatus = "loading" | "empty" | "failed" | "cap";

export const valueStatusText = (
  t: TranslateFn,
  status: ValueStatus,
  field: string,
  { minutes = 0, count = 0 }: { minutes?: number; count?: number } = {},
): string => {
  if (status === "loading") return t("sqlEditor.completion.valuesLoading", { field });
  if (status === "empty") return t("sqlEditor.completion.valuesEmpty", { field, minutes });
  if (status === "failed") return t("sqlEditor.completion.valuesFailed", { field });
  return t("sqlEditor.completion.valuesCap", { count }, count);
};

/** A row that inserts nothing; a loading row's hint sits in the label's description. */
export const buildValueStatusEntry = (
  t: TranslateFn,
  status: ValueStatus,
  field: string,
  details: { minutes?: number; count?: number } = {},
): LooseEntry => ({
  name: `\u0000${status}`,
  // The row sits under the field's own value position, so a loading row leaves the name out and its hint never truncates.
  label:
    status === "loading"
      ? t("sqlEditor.completion.valuesLoadingRow")
      : valueStatusText(t, status, field, details),
  description: status === "loading" ? t("sqlEditor.completion.valuesLoadingHint") : undefined,
  kind: status === "loading" ? "Event" : "Issue",
  insertText: "",
  // The cap row trails the values it counts, above the fields that follow them.
  sortText: status === "cap" ? "\u0000\uffff" : "\u0000",
});

const NUMERIC_TEXT = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/;

/** A stable order between runs: numbers by value, everything else alphabetically. */
export const orderValues = (values: string[], fieldType?: string): string[] => {
  const unique = [...new Set(values)];
  const kind = columnKind(fieldType);
  const numeric =
    kind === "number" || (kind === "unknown" && unique.every((v) => NUMERIC_TEXT.test(v)));
  return numeric
    ? unique.sort((a, b) => Number(a) - Number(b))
    : unique.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
};

export const fieldEntriesOf = (
  keywords: (LooseEntry | string)[] = [],
  suggestions: (LooseEntry | string)[] = [],
): LooseEntry[] =>
  [...keywords, ...suggestions]
    .map((e): LooseEntry =>
      typeof e === "string" ? { name: e, label: e, kind: "Field", insertText: e } : e,
    )
    .filter((e): e is LooseEntry => !!e && e.kind === "Field" && !!entryName(e))
    // After every value: in a value position the column is the fallback, not the answer.
    .map((e) => ({ ...e, sortText: `\u0001${entryName(e)}` }));

export interface GuardedEditor {
  getPosition: () => { lineNumber: number; column: number } | null;
  getModel: () => {
    getValueInRange: (range: Record<string, number>) => string;
  } | null;
  hasTextFocus?: () => boolean;
}

export interface ValueGuardSnapshot {
  line: number;
  column: number;
  prefix: string;
  escapes: number;
}

const textBetween = (
  editor: GuardedEditor,
  from: { line: number; column: number },
  to: { line: number; column: number },
): string =>
  editor.getModel()?.getValueInRange({
    startLineNumber: from.line,
    startColumn: from.column,
    endLineNumber: to.line,
    endColumn: to.column,
  }) ?? "";

export const takeValueGuardSnapshot = (
  editor: GuardedEditor | null,
  escapes: number,
): ValueGuardSnapshot | null => {
  const position = editor?.getPosition();
  if (!editor || !position) return null;
  const at = { line: position.lineNumber, column: position.column };
  return {
    ...at,
    prefix: textBetween(editor, { line: 1, column: 1 }, at),
    escapes,
  };
};

/** Guard v2: drop a late answer on Esc, blur, a move left, an edit before the cursor or typed whitespace. */
export const isValueAnswerStale = (
  snapshot: ValueGuardSnapshot | null,
  editor: GuardedEditor | null,
  escapes: number,
): boolean => {
  if (!snapshot || !editor) return false;
  if (escapes !== snapshot.escapes) return true;
  if (editor.hasTextFocus && !editor.hasTextFocus()) return true;
  const position = editor.getPosition();
  if (!position) return true;
  if (position.lineNumber !== snapshot.line || position.column < snapshot.column) return true;
  if (textBetween(editor, { line: 1, column: 1 }, snapshot) !== snapshot.prefix) return true;
  if (position.column === snapshot.column) return false;
  // Typing forward in the same token keeps the answer; Monaco filters it by what was typed.
  const typed = textBetween(editor, snapshot, {
    line: position.lineNumber,
    column: position.column,
  });
  return /\s/.test(typed.replace(/^'/, ""));
};
