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

// @openobserve/node-sql-parser's astify()/parse() is a PEG parser whose runtime
// grows exponentially with WHERE-clause parenthesis nesting depth (measured:
// ~14ms at depth 5, ~1000ms at depth 15), so a deeply nested paste can freeze
// the tab for many seconds. Callers use this to skip client-side parsing
// (quickMode field extraction, inline diagnostics, dashboard/alert query
// building) for queries past a safe depth — the query still runs fine
// server-side, only these optional client-side UX features are lost.
export const SQL_PARSE_MAX_DEPTH = 12;

// Top-level keywords that can follow a WHERE predicate and end it.
const WHERE_TERMINATORS = new Set([
  "GROUP",
  "ORDER",
  "LIMIT",
  "OFFSET",
  "HAVING",
  "WINDOW",
  "UNION",
  "INTERSECT",
  "EXCEPT",
]);

export const maxParenDepth = (text: string): number => {
  let depth = 0;
  let max = 0;
  for (const ch of text) {
    if (ch === "(") {
      depth++;
      if (depth > max) max = depth;
    } else if (ch === ")") {
      depth--;
    }
  }
  return max;
};

/**
 * Replaces every top-level WHERE predicate with `1 = 1` so callers that read only the
 * SELECT list or FROM aliases can parse without paying the predicate's nesting cost.
 */
export const stripWherePredicate = (sql: string): string => {
  if (!sql || typeof sql !== "string") return sql;

  const ranges: Array<[number, number]> = [];
  const n = sql.length;
  let depth = 0;
  let whereStart = -1;
  let i = 0;

  while (i < n) {
    const ch = sql[i];

    if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      while (i < n) {
        if (sql[i] === quote) {
          // A doubled quote is an escaped quote, not the end of the literal.
          if (sql[i + 1] === quote) i += 2;
          else {
            i++;
            break;
          }
        } else i++;
      }
      continue;
    }

    if (ch === "-" && sql[i + 1] === "-") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }

    if (ch === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2;
      continue;
    }

    if (ch === "(") {
      depth++;
      i++;
      continue;
    }

    if (ch === ")") {
      depth--;
      i++;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(sql[j])) j++;
      if (depth === 0) {
        const word = sql.slice(i, j).toUpperCase();
        if (word === "WHERE" && whereStart === -1) whereStart = j;
        else if (whereStart !== -1 && WHERE_TERMINATORS.has(word)) {
          ranges.push([whereStart, i]);
          whereStart = -1;
        }
      }
      i = j;
      continue;
    }

    i++;
  }

  if (whereStart !== -1) ranges.push([whereStart, n]);
  if (!ranges.length) return sql;

  let out = "";
  let prev = 0;
  for (const [start, end] of ranges) {
    out += sql.slice(prev, start) + " 1 = 1 ";
    prev = end;
  }
  return out + sql.slice(prev);
};
