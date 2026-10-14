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
import { SORT_LANE, SQL_KEYWORDS, type SqlCompletionEntry } from "./sqlCompletion";
import { maskedSpanEnd } from "./sqlComments";
import { wrapFieldCommand } from "./editorKeyContract";

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
  ["match", /(?:str_match|fuzzy_match)\s*\(\s*(?:\w+\.)?(\w+)\s*,\s*(?:'([^']*)|())$/i],
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
  getModel: () => { getValueInRange: (range: Record<string, number>) => string } | null;
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
  return { ...at, prefix: textBetween(editor, { line: 1, column: 1 }, at), escapes };
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

const PREDICATE_STARTERS = new Set(["WHERE", "HAVING", "ON", "AND", "OR", "NOT"]);

// Reaching one of these first, walking back, means the position is not in WHERE, HAVING or ON.
const CLAUSE_STOPS = new Set([
  "SELECT",
  "FROM",
  "BY",
  "LIMIT",
  "OFFSET",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "UNION",
]);

// A paren after one of these groups an expression; after any other word it is a call.
const NON_CALL_WORDS = new Set([
  ...PREDICATE_STARTERS,
  ...CLAUSE_STOPS,
  "IN",
  "EXISTS",
  "ANY",
  "ALL",
  "AS",
  "JOIN",
]);

interface Frame {
  tokens: string[];
  isCall: boolean;
  parent: Frame | null;
}

const scanFrames = (text: string): Frame => {
  let frame: Frame = { tokens: [], isCall: false, parent: null };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const spanEnd = maskedSpanEnd(text, i);
    if (spanEnd !== null) {
      frame.tokens.push("'");
      i = spanEnd;
    } else if (ch === "(") {
      const prev = frame.tokens.at(-1) ?? "";
      const isCall = /^[A-Z_]/.test(prev) && !NON_CALL_WORDS.has(prev);
      frame = { tokens: [], isCall, parent: frame };
      i++;
    } else if (ch === ")") {
      frame = frame.parent ?? frame;
      frame.tokens.push(")");
      i++;
    } else if (/[A-Za-z_]/.test(ch)) {
      const word = /^[A-Za-z_][\w$]*/.exec(text.slice(i))![0];
      frame.tokens.push(word.toUpperCase());
      i += word.length;
    } else {
      if (!/\s/.test(ch)) frame.tokens.push(ch);
      i++;
    }
  }
  return frame;
};

// The AND of `BETWEEN <expr> AND` ends a range; it does not start a predicate.
const closesBetween = (tokens: string[]): boolean => {
  for (let i = tokens.length - 2; i >= 0; i--) {
    const token = tokens[i];
    if (token === "BETWEEN") return true;
    if (PREDICATE_STARTERS.has(token) || CLAUSE_STOPS.has(token)) return false;
  }
  return false;
};

const inPredicate = (frame: Frame, filterMode: boolean): boolean => {
  const { tokens } = frame;
  const prev = tokens.at(-1);
  const outer = () =>
    frame.parent ? !frame.isCall && inPredicate(frame.parent, filterMode) : filterMode;
  if (prev === undefined) return outer();
  if (!PREDICATE_STARTERS.has(prev)) return false;
  if (prev === "AND" && closesBetween(tokens)) return false;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (tokens[i] === "WHERE" || tokens[i] === "HAVING" || tokens[i] === "ON") return true;
    if (CLAUSE_STOPS.has(tokens[i])) return false;
  }
  return outer();
};

/** filterMode: the text is a bare WHERE fragment (the Logs filter), so a field with nothing before it starts a predicate. */
export const isPredicatePosition = (textBefore: string, filterMode = false): boolean => {
  // A qualifier belongs to the field: `t.level` starts where `t` does.
  const before = textBefore.replace(/[A-Za-z_][\w$]*\.\s*$/, "");
  return inPredicate(scanFrames(before), filterMode);
};

export interface LogicalLeadContext {
  /** A group paren is still open, so `)` is a likely next step. */
  openParen: boolean;
  inCaseWhen: boolean;
  /** WHERE, HAVING or ON; empty in the filter-mode fragment. */
  clause: string;
}

// Search functions that are a condition on their own, so their `)` completes a predicate.
const CONDITION_FUNCTIONS = new Set([
  "MATCH_ALL",
  "MATCH_ALL_IGNORE_CASE",
  "STR_MATCH",
  "STR_MATCH_IGNORE_CASE",
  "RE_MATCH",
  "RE_NOT_MATCH",
  "FUZZY_MATCH",
  "EXISTS",
]);
const COMPARISON_WORDS = new Set(["LIKE", "ILIKE", "RLIKE", "SIMILAR"]);
const COMPARISON_CHARS = new Set(["=", "<", ">", "!"]);
const PREDICATE_CLAUSES = new Set(["WHERE", "HAVING", "ON"]);

const isComparison = (token: string) => COMPARISON_CHARS.has(token) || COMPARISON_WORDS.has(token);

// `IS NOT` and `NOT IN` sit inside one predicate; only a NOT where a predicate can start begins one.
const predicateStart = (tokens: string[]): number => {
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i];
    if (CLAUSE_STOPS.has(token)) return i;
    if (!PREDICATE_STARTERS.has(token)) continue;
    if (token === "AND" && closesBetween(tokens.slice(0, i + 1))) continue;
    const before = tokens[i - 1];
    const negatesPredicate =
      before === undefined || PREDICATE_STARTERS.has(before) || CLAUSE_STOPS.has(before);
    if (token === "NOT" && !negatesPredicate) continue;
    return i;
  }
  return -1;
};

const isCompletePredicate = (predicate: string[]): boolean => {
  const last = predicate.at(-1);
  if (last === undefined) return false;
  const opAt = predicate.findIndex(isComparison);
  if (last === ")") {
    const before = predicate.at(-2);
    return before === undefined || before === "IN" || CONDITION_FUNCTIONS.has(before) || opAt > 0;
  }
  if (predicate.includes("IS")) return ["NULL", "TRUE", "FALSE"].includes(last);
  const between = predicate.indexOf("BETWEEN");
  if (between >= 0) {
    const and = predicate.indexOf("AND", between);
    return and > between + 1 && and < predicate.length - 1;
  }
  return opAt > 0 && opAt < predicate.length - 1 && !isComparison(last) && last !== "NOT";
};

/** The caret follows a complete predicate and a space, so a logical operator is the likely next word. */
export const parseLogicalLeadContext = (
  textBefore: string,
  filterMode = false,
): LogicalLeadContext | null => {
  if (!/\s$/.test(textBefore) || literalStateAtEnd(textBefore) !== "code") return null;
  const frame = scanFrames(textBefore);
  const start = predicateStart(frame.tokens);
  if (!isCompletePredicate(frame.tokens.slice(start + 1))) return null;
  const head = frame.tokens.slice(0, start + 1);
  const scope = [...head].reverse().find((t) => CLAUSE_STOPS.has(t) || PREDICATE_CLAUSES.has(t));
  const inCaseWhen = scope === "WHEN";
  if (!inCaseWhen && !inPredicate({ ...frame, tokens: head }, filterMode)) return null;
  return {
    openParen: frame.parent !== null && !frame.isCall,
    inCaseWhen,
    clause: scope && PREDICATE_CLAUSES.has(scope) ? scope : "",
  };
};

interface OperatorSpec {
  label: string;
  insert: string;
  kind: "Operator" | "Keyword" | "Function";
  snippet?: boolean;
  /** Its value comes next, so accepting it opens the value menu. */
  chains?: boolean;
  wrapsField?: boolean;
}

const op = (label: string, rest: Partial<OperatorSpec> = {}): OperatorSpec => ({
  label,
  insert: label,
  kind: /^[A-Za-z]/.test(label) ? "Keyword" : "Operator",
  ...rest,
});

const OPERATOR_SPECS: Record<string, OperatorSpec> = {
  "=": op("=", { chains: true }),
  "!=": op("!=", { chains: true }),
  ">=": op(">=", { chains: true }),
  ">": op(">", { chains: true }),
  "<": op("<", { chains: true }),
  "<=": op("<=", { chains: true }),
  IN: op("IN", { insert: "IN ('${1}')", snippet: true }),
  LIKE: op("LIKE", { chains: true }),
  ILIKE: op("ILIKE", { chains: true }),
  "NOT LIKE": op("NOT LIKE", { chains: true }),
  str_match: op("str_match", { kind: "Function", wrapsField: true }),
  re_match: op("re_match", { kind: "Function", wrapsField: true }),
  re_not_match: op("re_not_match", { kind: "Function", wrapsField: true }),
  "IS NULL": op("IS NULL"),
  "IS NOT NULL": op("IS NOT NULL"),
  BETWEEN: op("BETWEEN", { insert: "BETWEEN ${1} AND ${2}", snippet: true }),
  "= true": op("= true"),
  "= false": op("= false"),
};

/** Ranks only: an operator missing from a type's list still reaches the menu through the catalog. */
export const OPERATORS_BY_TYPE: Record<"text" | "number" | "boolean" | "neutral", string[]> = {
  text: [
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
  ],
  number: [">=", ">", "<", "<=", "=", "!=", "BETWEEN", "IN", "IS NULL"],
  boolean: ["= true", "= false", "IS NULL"],
  neutral: ["=", "!=", ">", ">=", "<", "<=", "IN", "LIKE", "ILIKE", "IS NULL", "IS NOT NULL"],
};

const ALL_OPERATOR_LABELS = Object.keys(OPERATOR_SPECS).map((label) => label.toLowerCase());

export interface OperatorContext {
  field: string;
  /** The field as typed, with its `t.` qualifier when it has one. */
  qualified: string;
  partial: string;
  span: string;
}

// IS NOT NULL and NOT LIKE are typed a word at a time, so up to two finished words may sit before the fragment; `_` belongs to re_not_match.
const OPERATOR_TAILS = [0, 1, 2].map(
  (words) =>
    new RegExp(
      String.raw`((?:[A-Za-z_]\w*\.)?([A-Za-z_]\w*))(\s+)((?:[A-Za-z!_]+[ \t]+){${words}}[A-Za-z!_]*)$`,
    ),
);

export const parseOperatorContext = (
  textUntilCursor: string,
  knownFields: string[],
  filterMode = false,
): OperatorContext | null => {
  for (const pattern of OPERATOR_TAILS) {
    const match = pattern.exec(textUntilCursor);
    if (!match) continue;
    const [span, qualified, field, , partial] = match;
    if (!knownFields.some((name) => name.toLowerCase() === field.toLowerCase())) continue;
    const typed = partial.toLowerCase().replace(/\s+/g, " ");
    if (typed && !ALL_OPERATOR_LABELS.some((label) => label.startsWith(typed))) continue;
    if (!isPredicatePosition(textUntilCursor.slice(0, match.index), filterMode)) continue;
    return { field, qualified, partial, span };
  }
  return null;
};

const catalogDetail = (label: string): string | undefined =>
  SQL_KEYWORDS.find((entry) => entry.name === label.toLowerCase())?.detail;

export interface OperatorLaneOptions {
  context: OperatorContext;
  fieldType?: string;
  lineNumber: number;
  column: number;
  /** Set in Automatic where nothing follows on the line: operators whose value comes next carry it and drop their trailing space. */
  chainCommand?: SqlCompletionEntry["command"];
}

export const buildOperatorLane = ({
  context,
  fieldType,
  lineNumber,
  column,
  chainCommand,
}: OperatorLaneOptions): LooseEntry[] => {
  const kind = columnKind(fieldType);
  const order = OPERATORS_BY_TYPE[kind === "unknown" ? "neutral" : kind];
  const partialRange = {
    startLineNumber: lineNumber,
    endLineNumber: lineNumber,
    startColumn: column - context.partial.length,
    endColumn: column,
  };
  return order.flatMap((label, index): LooseEntry[] => {
    const spec = OPERATOR_SPECS[label];
    const entry: LooseEntry = {
      name: spec.label,
      label: spec.label,
      kind: spec.kind,
      insertText: spec.insert,
      detail: catalogDetail(spec.label),
      sortText: `${SORT_LANE.operator}${String(index).padStart(3, "0")}`,
      filterText: spec.label,
      range: partialRange,
    };
    if (spec.snippet) entry.insertTextRules = "InsertAsSnippet";
    if (spec.chains && chainCommand) entry.command = chainCommand;
    else if (spec.chains) entry.insertText = `${spec.insert} `;
    if (!spec.wrapsField) return [entry];
    if (context.span.includes("\n")) return [];
    // A range reaching back over the field would give the row a non-empty filter word, and Monaco ranks that above `=`.
    return [
      {
        ...entry,
        labelDetail: `(${context.qualified}, …)`,
        insertText: "",
        command: wrapFieldCommand({
          fn: spec.label,
          field: context.qualified,
          lineNumber,
          startColumn: column - context.span.length,
          openValues: !!chainCommand && spec.label === "str_match",
        }),
      },
    ];
  });
};

/** Catalog names in lead order; GROUP BY and friends only where the full query can end the WHERE here. */
export const logicalLeadNames = (context: LogicalLeadContext, filterMode: boolean): string[] => {
  const lead = ["and", "or"];
  if (context.openParen) lead.push(")");
  if (context.inCaseWhen) lead.push("then");
  else if (!filterMode && !context.openParen) {
    if (context.clause !== "HAVING") lead.push("group by");
    lead.push("order by", "limit");
  }
  return lead;
};

/** A field comes next after these, so in Automatic they chain into the field menu. */
export const CHAINING_KEYWORDS = new Set(["and", "or", "not"]);

/** The chain types the space, so the keyword's own trailing space goes. */
export const chainedKeyword = (
  entry: LooseEntry,
  chainCommand: SqlCompletionEntry["command"],
): LooseEntry => ({
  ...entry,
  insertText: String(entry.insertText ?? entry.name ?? entry.label).trimEnd(),
  command: chainCommand,
});

const CLOSE_PAREN_ENTRY: LooseEntry = {
  name: ")",
  label: ")",
  kind: "Operator",
  insertText: ")",
  filterText: ")",
};

/** Moves the lead to the top by sortText alone; every other entry stays in the menu. */
export const buildLogicalLead = (
  entries: unknown[],
  leadNames: string[],
  chainCommand?: SqlCompletionEntry["command"],
): unknown[] => {
  const nameOf = (raw: unknown) =>
    raw && typeof raw === "object" ? String(entryName(raw as LooseEntry)).toLowerCase() : "";
  const lead = leadNames.flatMap((name, index): LooseEntry[] => {
    const found = entries.find((raw) => nameOf(raw) === name) as LooseEntry | undefined;
    const base = found ?? (name === ")" ? CLOSE_PAREN_ENTRY : undefined);
    if (!base) return [];
    const sorted: LooseEntry = { ...base, sortText: `${SORT_LANE.operator}${index}` };
    const chains = chainCommand && CHAINING_KEYWORDS.has(name);
    return [chains ? chainedKeyword(sorted, chainCommand) : sorted];
  });
  const leading = new Set(leadNames);
  return [...lead, ...entries.filter((raw) => !leading.has(nameOf(raw)))];
};

export interface SuggestGroup {
  header: string;
  /** A value or operator row's description, read by screen readers as "'error', Values". */
  name: string;
  entries: LooseEntry[];
}

export interface GroupOptions {
  /** The token being typed; every row filters by it, so Monaco's scores tie and sortText keeps the groups in place. */
  typed: string;
  range: Record<string, number>;
  /** Real rows take the initial highlight; never set for a menu a trigger character opened. */
  preselect: boolean;
}

const isStatusEntry = (entry: LooseEntry): boolean => String(entryName(entry)).startsWith("\u0000");

const matchText = (entry: LooseEntry): string =>
  String(entryName(entry)).replace(/^'|'$/g, "").toLowerCase();

/** Case-insensitive prefix of the name or of any `_` segment; LIKE wildcards around the typed text are ignored. */
export const matchesTyped = (entry: LooseEntry, typed: string): boolean => {
  const word = typed.replace(/^%+|%+$/g, "").toLowerCase();
  if (!word) return true;
  const text = matchText(entry);
  return text.startsWith(word) || text.split("_").some((segment) => segment.startsWith(word));
};

const groupHeader = (
  group: SuggestGroup,
  index: number,
  { typed, range }: GroupOptions,
): LooseEntry => ({
  name: `\u0000group:${group.name}`,
  label: group.header,
  kind: "Folder",
  // Accepting a header must change nothing: it re-inserts the typed token and reopens the same menu.
  insertText: typed,
  range,
  filterText: typed,
  sortText: `${index}a`,
  additionalTextEdits: [],
  command: { id: "editor.action.triggerSuggest", title: "" },
  skipRow: true,
});

// A status row sits in its group but is never a target, so accepting it re-inserts the typed token.
const asStatusRow = (entry: LooseEntry, { typed, range }: GroupOptions): LooseEntry => ({
  ...entry,
  insertText: typed,
  range,
  filterText: typed,
  additionalTextEdits: [],
  skipRow: true,
});

// A column type or short detail stays visible on the right; values and operators carry the group name, which only a screen reader reads.
const rowDescription = (entry: LooseEntry, group: SuggestGroup): string | undefined => {
  if (entry.kind === "Value" || entry.kind === "Operator") return group.name;
  const detail = typeof entry.detail === "string" ? entry.detail : "";
  // A function's signature already sits after its name, so its right-hand column stays empty.
  return detail && !detail.startsWith("(") ? detail : undefined;
};

const isCapEntry = (entry: LooseEntry): boolean => entryName(entry) === "\u0000cap";

/** Header rows over provider-filtered groups; a group with nothing left after filtering loses its header too. */
export const groupEntries = (groups: SuggestGroup[], options: GroupOptions): LooseEntry[] =>
  groups.flatMap((group, index) => {
    const status = group.entries.filter(isStatusEntry);
    const members = group.entries.filter(
      (entry) => !isStatusEntry(entry) && matchesTyped(entry, options.typed),
    );
    // The cap counts the values shown, so it goes with them; a loading or empty row stands alone.
    const statusShown = members.length ? status : status.filter((entry) => !isCapEntry(entry));
    if (!members.length && !statusShown.length) return [];
    const rows = members.map((entry, i): LooseEntry => ({
      ...entry,
      range: entry.range ?? options.range,
      filterText: options.typed,
      sortText: `${index}b${String(i).padStart(4, "0")}`,
      description: entry.description ?? rowDescription(entry, group),
      ...(options.preselect ? { preselect: true } : {}),
    }));
    const statusRows = statusShown.map((entry) => ({
      ...asStatusRow(entry, options),
      sortText: isCapEntry(entry) ? `${index}c` : `${index}b`,
    }));
    return [
      groupHeader(group, index, options),
      ...statusRows.filter((r) => !isCapEntry(r)),
      ...rows,
      ...statusRows.filter(isCapEntry),
    ];
  });

/** Monaco's StandardTokenType.Comment. */
const COMMENT_TOKEN = 1;

/** W0-B: is the caret inside a -- or block comment? Trigger characters skip Monaco's own check. */
export const isCaretInComment = (
  model: any,
  position: { lineNumber: number; column: number },
  textUntilCursor: string,
): boolean => {
  const tokenization = model?.tokenization;
  if (!tokenization?.getLineTokens) return literalStateAtEnd(textUntilCursor) === "comment";
  if (position.column <= 1) return false;
  // Monaco internal (tokenization.forceTokenization / getLineTokens): not in monaco.d.ts.
  tokenization.forceTokenization?.(position.lineNumber);
  const tokens = tokenization.getLineTokens(position.lineNumber);
  const isComment = (offset: number) =>
    tokens.getStandardTokenType(tokens.findTokenIndexAtOffset(offset)) === COMMENT_TOKEN;
  const atLineEnd = position.column - 1 >= model.getLineLength(position.lineNumber);
  // The character before the caret decides; the one after only matters mid-line, e.g. right after `*/`.
  return isComment(position.column - 2) && (atLineEnd || isComment(position.column - 1));
};
