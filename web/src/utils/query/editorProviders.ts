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
export const buildHoverContents = (entry: LooseEntry | null): { value: string }[] | null => {
  if (!entry) return null;
  const name = entryName(entry);
  const contents: { value: string }[] = [];

  if (entry.kind === "Field") {
    // Omit rather than render "undefined" for a field with no known type.
    contents.push({ value: `\`\`\`sql\n${name}${entry.detail ? `: ${entry.detail}` : ""}\n\`\`\`` });
  } else {
    const args = entry.detail && entry.detail.startsWith("(") ? entry.detail : "";
    contents.push({ value: `\`\`\`sql\n${name}${args}\n\`\`\`` });
  }

  if (entry.deprecated) {
    contents.push({ value: "**Deprecated** — prefer the canonical function." });
  }
  if (entry.documentation) contents.push({ value: entry.documentation });

  return contents;
};

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

/** Build completion entries for resolved field values, quoted appropriately. */
export const buildValueEntries = (values: string[], hasOpenQuote: boolean): LooseEntry[] =>
  values.map((value, index) => {
    const isNumeric = value !== "" && !Number.isNaN(Number(value));
    const isBoolean = value === "true" || value === "false";
    let insertText: string;
    if (isNumeric || isBoolean) insertText = value;
    else if (hasOpenQuote) insertText = `${value}'`;
    else insertText = `'${value}'`;
    return {
      name: value,
      label: value,
      kind: "Value",
      insertText,
      // Values sort above everything else: at this position nothing else is
      // plausible.   is the lowest-sorting prefix in use.
      sortText: ` ${String(index).padStart(6, "0")}`,
    };
  });
