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

/** Whether the SQL sorts its own result: an ORDER BY outside every parenthesis, so one inside a subquery or window, a string literal or a comment does not count. */
export const hasTopLevelOrderBy = (sql: string): boolean => {
  const code = sql.replace(/'(?:[^']|'')*'|--[^\n]*|\/\*[\s\S]*?\*\//g, " ");
  const orderBy = /order\s+by\b/iy;
  let depth = 0;
  for (let i = 0; i < code.length; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")") depth--;
    else if (depth === 0 && !/\w/.test(code[i - 1] ?? "")) {
      orderBy.lastIndex = i;
      if (orderBy.test(code)) return true;
    }
  }
  return false;
};
