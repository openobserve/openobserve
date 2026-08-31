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
