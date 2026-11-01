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

import type { I18nKey } from "@/types/i18n";

/** A plain-language reading of a backend query error, as i18n keys plus their values. */
export interface QueryErrorExplanation {
  titleKey: I18nKey;
  messageKey: I18nKey;
  params: Record<string, string>;
}

export interface ExplainQueryErrorContext {
  /** The SQL the user ran; only pass it when the error was raised for this exact text. */
  query?: string;
  /** Stream to use in the "for example FROM …" hint. */
  streamName?: string;
}

type Matcher = (text: string, ctx: ExplainQueryErrorContext) => QueryErrorExplanation | null;

const SYNTAX_TITLE: I18nKey = "queryError.sqlError";

const TRAILING_KEYWORDS = new Set([
  "SELECT",
  "FROM",
  "WHERE",
  "AND",
  "OR",
  "NOT",
  "BY",
  "ON",
  "HAVING",
  "JOIN",
  "LIMIT",
  "OFFSET",
  "IN",
  "LIKE",
  "IS",
  "AS",
  "BETWEEN",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
]);

const NUMERIC_ARROW_TYPE = /^(U?Int\d+|Float\d+|Decimal\d*)$/i;

const quoted = (value: string) => `"${value}"`;

function syntax(messageKey: I18nKey, params: Record<string, string> = {}): QueryErrorExplanation {
  return { titleKey: SYNTAX_TITLE, messageKey, params };
}

function trailingKeyword(query: string | undefined): string | null {
  const match = query?.trim().match(/([A-Za-z]+)$/);
  if (!match) return null;
  const word = match[1].toUpperCase();
  return TRAILING_KEYWORDS.has(word) ? word : null;
}

const missingStream: Matcher = (text, ctx) => {
  if (!/Expected: identifier, found: EOF/.test(text)) return null;
  if (trailingKeyword(ctx.query) !== "FROM") return null;
  const stream = ctx.streamName?.trim() || "default";
  return syntax("queryError.explain.missingStream", {
    from: "FROM",
    example: `FROM ${quoted(stream)}`,
  });
};

const unclosedBracket: Matcher = (text) => {
  const match = text.match(/Expected: ([)\]}]), found: EOF/);
  return match ? syntax("queryError.explain.unclosedBracket", { char: match[1] }) : null;
};

const unexpectedEnd: Matcher = (text, ctx) => {
  if (!/Expected: [^,]+, found: EOF/.test(text)) return null;
  const keyword = trailingKeyword(ctx.query);
  return keyword
    ? syntax("queryError.explain.unexpectedEndAfter", { keyword })
    : syntax("queryError.explain.unexpectedEnd");
};

const notAStatement: Matcher = (text) => {
  const match = text.match(/Expected: an SQL statement, found: (\S+?) at Line: \d+, Column: \d+/);
  return match
    ? syntax("queryError.explain.notAStatement", { keyword: "SELECT", token: quoted(match[1]) })
    : null;
};

const unexpectedToken: Matcher = (text) => {
  const match = text.match(/Expected: [^\n]+?, found: (\S+?) at Line: \d+, Column: \d+/);
  return match ? syntax("queryError.explain.unexpectedToken", { token: quoted(match[1]) }) : null;
};

const unclosedQuote: Matcher = (text) =>
  /Unterminated string literal/.test(text) ? syntax("queryError.explain.unclosedQuote") : null;

const unclosedDelimiter: Matcher = (text) => {
  const match = text.match(/Expected close delimiter '(.)' before EOF/);
  return match ? syntax("queryError.explain.unclosedDelimiter", { char: match[1] }) : null;
};

const streamNotFound: Matcher = (text) => {
  const match = text.match(/stream not found: ([^\s,;]+)/i);
  if (!match) return null;
  const name = match[1].replace(/\.$/, "");
  return {
    titleKey: "queryError.streamNotFound",
    messageKey: "queryError.explain.streamNotFound",
    params: { name: quoted(name) },
  };
};

const unknownField: Matcher = (text) => {
  const match =
    text.match(/No field named "?([^"\s]+?)"?\.?(?:\s|$)/) ?? text.match(/unknown field '([^']+)'/);
  if (!match) return null;
  return {
    titleKey: "queryError.fieldNotFound",
    messageKey: "queryError.explain.unknownField",
    params: { name: quoted(match[1]) },
  };
};

const unknownFunction: Matcher = (text) => {
  const match =
    text.match(/Invalid function '([^']+)'/) ?? text.match(/unknown function '([^']+)'/);
  if (!match) return null;
  const params: Record<string, string> = { name: quoted(match[1]) };
  const suggestion = text.match(/Did you mean '([^']+)'\?/)?.[1];
  if (suggestion) params.suggestion = quoted(suggestion);
  return {
    titleKey: "queryError.functionNotDefined",
    messageKey: suggestion
      ? "queryError.explain.unknownFunctionSuggest"
      : "queryError.explain.unknownFunction",
    params,
  };
};

const notANumber: Matcher = (text) => {
  const match = text.match(/Cannot cast string '([^']*)' to value of (\w+) type/);
  if (!match || !NUMERIC_ARROW_TYPE.test(match[2])) return null;
  return {
    titleKey: "queryError.dataTypeMismatch",
    messageKey: "queryError.explain.notANumber",
    params: { value: `'${match[1]}'` },
  };
};

const functionArgs: Matcher = (text) => {
  const match = text.match(/Failed to coerce arguments to satisfy a call to '([^']+)' function/);
  if (!match) return null;
  return {
    titleKey: "queryError.dataTypeMismatch",
    messageKey: "queryError.explain.functionArgs",
    params: { name: quoted(match[1]) },
  };
};

const notGrouped: Matcher = (text) => {
  const match = text.match(/column "([^"]+)" must appear in the GROUP BY clause/);
  if (!match) return null;
  return {
    titleKey: "queryError.generic",
    messageKey: "queryError.explain.notGrouped",
    params: { name: quoted(match[1]), groupBy: "GROUP BY" },
  };
};

// Order matters: specific readings of a parser message come before the general ones.
const MATCHERS: Matcher[] = [
  missingStream,
  unclosedBracket,
  unexpectedEnd,
  notAStatement,
  unexpectedToken,
  unclosedQuote,
  unclosedDelimiter,
  streamNotFound,
  unknownField,
  unknownFunction,
  notANumber,
  functionArgs,
  notGrouped,
];

/** Plain-language reading of a known query error, or null so callers never show a guess. */
export function explainQueryError(
  text: string,
  ctx: ExplainQueryErrorContext = {},
): QueryErrorExplanation | null {
  if (!text) return null;
  for (const matcher of MATCHERS) {
    const result = matcher(text, ctx);
    if (result) return result;
  }
  return null;
}
