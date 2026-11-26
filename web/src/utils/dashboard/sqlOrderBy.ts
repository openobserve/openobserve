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

// Literals, quoted identifiers and comments become same-length blanks, so offsets still point into the original SQL.
const maskNonCode = (sql: string): string =>
  sql.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"|--[^\n]*|\/\*[\s\S]*?\*\//g, (match) =>
    " ".repeat(match.length),
  );

/** Offset just past the first ORDER BY outside every parenthesis, or -1; one in a subquery, window, literal, quoted identifier or comment does not count. */
const topLevelOrderByEnd = (sql: string): number => {
  const code = maskNonCode(sql);
  const orderBy = /order\s+by\b/iy;
  let depth = 0;
  for (let i = 0; i < code.length; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")") depth--;
    else if (depth === 0 && !/\w/.test(code[i - 1] ?? "")) {
      orderBy.lastIndex = i;
      if (orderBy.test(code)) return orderBy.lastIndex;
    }
  }
  return -1;
};

/** Whether the SQL sorts its own result with a top-level ORDER BY. */
export const hasTopLevelOrderBy = (sql: string): boolean => topLevelOrderByEnd(sql) >= 0;

const ORDER_KEY =
  /^\s*(?:"((?:[^"]|"")+)"|([A-Za-z_][\w$]*))\s*(?:asc\b|desc\b)?\s*(?:,|nulls\b|limit\b|offset\b|;|--|\/\*|$)/i;

/** The first key of the top-level ORDER BY when it is a plain or double-quoted column name, else null. */
export const firstTopLevelOrderByKey = (sql: string): string | null => {
  const end = topLevelOrderByEnd(sql);
  if (end < 0) return null;
  const key = ORDER_KEY.exec(sql.slice(end));
  if (!key) return null;
  return key[1] !== undefined ? key[1].replace(/""/g, '"') : key[2];
};
