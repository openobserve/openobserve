// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

export type LikePosition = "start" | "end" | "contains";

// The search service re-serialises SQL without doubling a `'` after `\` or `'`, so such values are split and joined with `||` (as Rust's `quote_sql_string`).
export const sqlLiteral = (value: unknown): string => {
  const pieces = String(value ?? "")
    .split(/(?<=[\\'])(?=')/)
    .map((piece) => `'${piece.replace(/'/g, "''")}'`);
  return pieces.length > 1 ? `(${pieces.join(" || ")})` : pieces[0];
};

// The SQL parser returns a quoted literal's value with its doubled quotes intact.
export const unescapeSqlLiteral = (value: unknown): string => String(value).replace(/''/g, "'");

// Splits on `junction` outside quoted literals and names, brackets and `--` comments; an unterminated quote falls back to a plain split.
const splitOnJunction = (query: string, junction: "AND" | "OR"): string[] => {
  const pattern = new RegExp(`\\s+${junction}\\s+`, "iy");
  const parts: string[] = [];
  let quote: string | null = null;
  let depth = 0;
  let start = 0;
  for (let i = 0; i < query.length; i++) {
    const ch = query[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (query.startsWith("--", i)) {
      const eol = query.indexOf("\n", i);
      if (eol === -1) break;
      i = eol;
      continue;
    }
    if (query[i] === "(") depth++;
    else if (query[i] === ")") depth--;
    if (depth !== 0) continue;
    pattern.lastIndex = i;
    const match = pattern.exec(query);
    if (!match) continue;
    parts.push(query.slice(start, i));
    i += match[0].length - 1;
    start = i + 1;
  }
  if (quote) return query.split(new RegExp(`\\s+${junction}\\s+`, "i"));
  parts.push(query.slice(start));
  return parts;
};

export const splitOnAnd = (query: string): string[] => splitOnJunction(query, "AND");

// The text inside brackets that wrap all of `part`; null when they do not, as in `(a) OR (b)`.
const innerOfGroup = (part: string): string | null => {
  if (!part.startsWith("(") || !part.endsWith(")")) return null;
  let inQuote = false;
  let depth = 0;
  for (let i = 0; i < part.length - 1; i++) {
    if (part[i] === "'") inQuote = !inQuote;
    if (inQuote) continue;
    if (part[i] === "(") depth++;
    else if (part[i] === ")" && --depth === 0) return null;
  }
  return part.slice(1, -1);
};

/** `clause` without the comparisons `isTarget` picks, inside brackets too; the rest keeps its AND, OR and brackets. */
export const removeConditions = (
  clause: string,
  isTarget: (condition: string) => boolean,
): string => {
  let changed = false;
  const operands = splitOnJunction(clause, "OR").flatMap((operand) => {
    const kept = splitOnJunction(operand, "AND").flatMap((part) => {
      const condition = part.trim();
      if (isTarget(condition)) {
        changed = true;
        return [];
      }
      const inner = innerOfGroup(condition);
      if (inner === null) return [condition];
      const rest = removeConditions(inner, isTarget);
      if (rest !== inner) changed = true;
      return rest.trim() ? [`(${rest})`] : [];
    });
    return kept.length ? [kept.join(" AND ")] : [];
  });
  return changed ? operands.join(" OR ") : clause;
};

export const sqlEquals = (fieldName: string, value: unknown, negate = false): string =>
  `${fieldName}${negate ? "!=" : "="}${sqlLiteral(value)}`;

// "field IN ()" is invalid SQL — an empty list can never match, so it
// degrades to a constant-false predicate instead.
export const sqlIn = (fieldName: string, values: unknown[]): string =>
  values.length ? `${fieldName} IN (${values.map(sqlLiteral).join(",")})` : "1=0";

/** Backslash-escapes the backslash and LIKE wildcards as the backend does (DataFusion's default escape, no ESCAPE clause). */
export const escapeLikeWildcards = (value: string): string => value.replace(/[\\%_]/g, "\\$&");

const likePattern = (value: unknown, position: LikePosition, escapeWildcards: boolean): string => {
  const raw = String(value ?? "");
  const text = escapeWildcards ? escapeLikeWildcards(raw) : raw;
  switch (position) {
    case "start":
      return `${text}%`;
    case "end":
      return `%${text}`;
    default:
      return `%${text}%`;
  }
};

export const sqlLike = (
  fieldName: string,
  value: unknown,
  position: LikePosition = "contains",
  negate = false,
  escapeWildcards = false,
): string =>
  `${fieldName} ${negate ? "NOT LIKE" : "LIKE"} ${sqlLiteral(likePattern(value, position, escapeWildcards))}`;

export const sqlIsNull = (fieldName: string, negate = false): string =>
  `${fieldName} ${negate ? "IS NOT" : "IS"} NULL`;
