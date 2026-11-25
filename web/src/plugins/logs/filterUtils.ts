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

import { maskedSpanEnd } from "@/utils/query/sqlComments";
import { removeConditions } from "@/utils/query/sqlFilterBuilder";

/**
 * Extracts the field name from a filter expression.
 * Handles single: `field = 'val'`, multi: `(field = 'x' OR field = 'y')`,
 * and SQL-prefixed: `"stream".field = 'val'`.
 */
export const getFieldFromExpression = (expression: string): string | null => {
  const cleaned = expression.trim().replace(/^\(\s*/, "");
  const match =
    cleaned.match(/^"[^"]+"\."?(\w+)"?\s*(?:=|!=|is)/i) || cleaned.match(/^(\w+)\s*(?:=|!=|is)/i);
  return match ? match[1] : null;
};

/** Puts `"prefix".` before the field of every condition in a filter built for one field, outside quoted values. */
export const qualifyFieldConditions = (filter: string, prefix: string): string => {
  const field = /^[\s(]*("(?:[^"]|"")+"|\w+)/.exec(filter)?.[1];
  if (!field) return `"${prefix}".${filter}`;
  const esc = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const condition = new RegExp(
    `(^[\\s(]*|\\(\\s*|\\s(?:and|or)\\s+)${esc}(?=\\s*(?:[=!<>]|(?:is|in|like|not)\\b))`,
    "gi",
  );
  return filter
    .split(/('(?:[^']|'')*')/)
    .map((part, i) => (i % 2 ? part : part.replace(condition, `$1"${prefix}".${field}`)))
    .join("");
};

/**
 * Checks whether a query string already contains an existing condition for
 * the given field name (single value or parenthesized multi-value group).
 *
 * This is used to distinguish between "no existing condition → append" and
 * "existing condition with same value → replace", which would otherwise both
 * produce an unchanged string from replaceExistingFieldCondition.
 */
export const hasFieldCondition = (queryStr: string, fieldName: string): boolean => {
  const esc = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const valPat = `(?:'(?:[^']|'')*'|null|\\d+(?:\\.\\d+)?|true|false)`;
  const opPat = `(?:=|!=|is(?:\\s+not)?)`;
  // The lookbehind stops `operation_name` from matching inside `db_operation_name`.
  const condPat = `(?<!\\w)(?:"[^"]+"\\.)?${esc}\\s*${opPat}\\s*${valPat}`;

  const multiRegex = new RegExp(`\\(\\s*${condPat}(?:\\s+(?:OR|AND)\\s+${condPat})*\\s*\\)`, "gi");
  if (multiRegex.test(queryStr)) return true;

  const singleRegex = new RegExp(condPat, "gi");
  return singleRegex.test(queryStr);
};

/**
 * Removes all conditions for `fieldName` from `queryStr`.
 * Handles both single conditions and parenthesized multi-value groups.
 * Cleans up dangling AND connectors after removal.
 */
export const removeFieldCondition = (queryStr: string, fieldName: string): string => {
  const esc = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Match both comparison operators (=, !=, <, >) and IS / IS NOT (for null checks)
  const fieldPattern = new RegExp(`^"?${esc}"?\\s*(?:[=!<>]|is\\s)`, "i");
  return removeConditions(queryStr.trim(), (condition) => fieldPattern.test(condition));
};

/**
 * Tries to replace an existing condition for `fieldName` in `queryStr` with
 * `newExpression`. Returns the modified string, or the original if not found.
 * Handles both parenthesized multi-value groups and single conditions.
 */
export const replaceExistingFieldCondition = (
  queryStr: string,
  fieldName: string,
  newExpression: string,
): string => {
  const esc = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const valPat = `(?:'(?:[^']|'')*'|null|\\d+(?:\\.\\d+)?|true|false)`;
  const opPat = `(?:=|!=|is(?:\\s+not)?)`;
  // The lookbehind stops `operation_name` from matching inside `db_operation_name`.
  const condPat = `(?<!\\w)(?:"[^"]+"\\.)?${esc}\\s*${opPat}\\s*${valPat}`;

  // Try parenthesized multi-value group first: (field = 'x' OR/AND field = 'y')
  const multiRegex = new RegExp(`\\(\\s*${condPat}(?:\\s+(?:OR|AND)\\s+${condPat})*\\s*\\)`, "gi");
  if (multiRegex.test(queryStr)) {
    return queryStr.replace(multiRegex, () => newExpression);
  }

  // Try single condition
  const singleRegex = new RegExp(condPat, "gi");
  if (singleRegex.test(queryStr)) {
    return queryStr.replace(singleRegex, () => newExpression);
  }

  return queryStr;
};

const TOP_LEVEL_KEYWORD = /(where|group\s+by|having|order\s+by|limit|offset|or)\b/iy;
const UNION_KEYWORD = /union(\s+all)?\b/iy;

/** Splits at top-level UNION / UNION ALL, outside quotes, comments and brackets. */
export const splitUnion = (query: string): { parts: string[]; ops: string[] } => {
  const parts: string[] = [];
  const ops: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < query.length; i++) {
    const span = maskedSpanEnd(query, i);
    if (span !== null) i = span - 1;
    else if (query[i] === "(") depth++;
    else if (query[i] === ")") depth--;
    else if (depth === 0 && !/\w/.test(query[i - 1] ?? " ")) {
      UNION_KEYWORD.lastIndex = i;
      const m = UNION_KEYWORD.exec(query);
      if (m) {
        parts.push(query.slice(start, i));
        ops.push(m[1] ? "UNION ALL" : "UNION");
        i += m[0].length - 1;
        start = i + 1;
      }
    }
  }
  parts.push(query.slice(start));
  return { parts, ops };
};

// Keyword offsets outside quotes, comments and brackets.
const topLevelKeywords = (sql: string): { kw: string; index: number }[] => {
  const found: { kw: string; index: number }[] = [];
  let depth = 0;
  for (let i = 0; i < sql.length; i++) {
    const span = maskedSpanEnd(sql, i);
    if (span !== null) i = span - 1;
    else if (sql[i] === "(") depth++;
    else if (sql[i] === ")") depth--;
    else if (depth === 0 && !/\w/.test(sql[i - 1] ?? " ")) {
      TOP_LEVEL_KEYWORD.lastIndex = i;
      const m = TOP_LEVEL_KEYWORD.exec(sql);
      if (m) {
        found.push({ kw: m[1].toLowerCase().replace(/\s+/g, " "), index: i });
        i += m[1].length - 1;
      }
    }
  }
  return found;
};

/**
 * Appends `filter` to the query's top-level WHERE (adding one if absent), bracketing
 * existing conditions that hold a top-level OR so the new AND binds to all of them.
 */
export const appendSqlFilter = (query: string, filter: string): string => {
  const keywords = topLevelKeywords(query);
  const where = keywords.find((k) => k.kw === "where");
  const end = keywords.find(
    (k) => k.kw !== "or" && k.kw !== "where" && (!where || k.index > where.index),
  );
  const codeEnd = lastCodeEnd(query, end ? end.index : query.length);
  const trailing = query.slice(codeEnd);
  const rest = trailing.trim();
  // A newline after a trailing comment must survive, or the next UNION branch lands on it.
  const lineBreak = /\n/.test(trailing.slice(trailing.trimEnd().length))
    ? trailing.slice(trailing.trimEnd().length)
    : "";
  const tail = (rest ? " " + rest : "") + lineBreak;
  if (!where) return `${query.slice(0, codeEnd)} where ${filter}${tail}`;
  const condStart = where.index + "where".length;
  const hasOr = keywords.some(
    (k) => k.kw === "or" && k.index > where.index && (!end || k.index < end.index),
  );
  const conditions = query.slice(condStart, codeEnd).trim();
  const wrapped = hasOr ? `(${conditions})` : conditions;
  return `${query.slice(0, condStart)} ${wrapped} AND ${filter}${tail}`;
};

// Trailing comments stay after the appended filter so a line comment cannot swallow it.
const lastCodeEnd = (sql: string, limit: number): number => {
  let last = 0;
  for (let i = 0; i < limit; i++) {
    const span = maskedSpanEnd(sql, i);
    if (span === null) {
      if (!/\s/.test(sql[i])) last = i + 1;
    } else {
      if (!sql.startsWith("--", i) && !sql.startsWith("/*", i)) last = span;
      i = span - 1;
    }
  }
  return last;
};

// Offsets of the outer WHERE's own text, with parenthesised sub-selects cut out.
const outerWhereSegments = (query: string): [number, number][] => {
  const keywords = topLevelKeywords(query);
  const where = keywords.find((k) => k.kw === "where");
  if (!where) return [];
  const end = keywords.find((k) => k.kw !== "or" && k.kw !== "where" && k.index > where.index);
  const limit = end ? end.index : query.length;
  const segments: [number, number][] = [];
  let from = where.index + "where".length;
  for (let i = from; i < limit; i++) {
    const span = maskedSpanEnd(query, i);
    if (span !== null) {
      i = span - 1;
    } else if (query[i] === "(" && /^\(\s*(select|with)\b/i.test(query.slice(i, i + 40))) {
      segments.push([from, i]);
      i = closingBracket(query, i);
      from = i + 1;
    }
  }
  segments.push([from, limit]);
  return segments;
};

const closingBracket = (sql: string, open: number): number => {
  let depth = 0;
  for (let i = open; i < sql.length; i++) {
    const span = maskedSpanEnd(sql, i);
    if (span !== null) i = span - 1;
    else if (sql[i] === "(") depth++;
    else if (sql[i] === ")" && --depth === 0) return i;
  }
  return sql.length;
};

// Literals and comments are swapped for tokens so a field named inside one never matches.
const withOpaqueSpans = (
  piece: string,
  replace: (piece: string) => string | null,
): string | null => {
  const saved: string[] = [];
  let masked = "";
  for (let i = 0; i < piece.length;) {
    const span = maskedSpanEnd(piece, i);
    if (span === null || piece[i] === '"') {
      const keep = span ?? i + 1;
      masked += piece.slice(i, keep);
      i = keep;
      continue;
    }
    const text = piece.slice(i, span);
    masked += piece[i] === "'" ? `'\uE000${saved.length}\uE000'` : `\uE001${saved.length}\uE001`;
    saved.push(text);
    i = span;
  }
  const next = replace(masked);
  if (next === null) return null;
  return next.replace(
    /'\uE000(\d+)\uE000'|\uE001(\d+)\uE001/g,
    (_m, q, c) => saved[Number(q ?? c)],
  );
};

/**
 * Applies `replace` to each piece of the outer WHERE (sub-selects excluded); it returns
 * null when it has nothing to replace. Returns null when no piece was replaced.
 */
export const replaceInOuterWhere = (
  query: string,
  replace: (piece: string) => string | null,
): string | null => {
  let out = "";
  let last = 0;
  let replaced = false;
  for (const [from, to] of outerWhereSegments(query)) {
    const next = withOpaqueSpans(query.slice(from, to), replace);
    if (next === null) continue;
    out += query.slice(last, from) + next;
    last = to;
    replaced = true;
  }
  return replaced ? out + query.slice(last) : null;
};
