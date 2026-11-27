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

/** Double-quotes bare field names in a where clause, leaving '...' literals and "..." identifiers untouched. */
export function quoteFieldNames(where: string, fieldNames: string[]): string {
  const fields = new Set(fieldNames.filter(Boolean));
  if (fields.size === 0 || !where) return where;
  let out = "";
  let chunk = "";
  const flush = () => {
    out += chunk.replace(/[^\s(),;=!<>[\]{}]+/g, (token) =>
      fields.has(token) ? `"${token}"` : token,
    );
    chunk = "";
  };
  let i = 0;
  while (i < where.length) {
    const ch = where[i];
    if (ch !== "'" && ch !== '"') {
      chunk += where[i++];
      continue;
    }
    flush();
    let end = i + 1;
    while (end < where.length) {
      if (where[end] !== ch) end += 1;
      else if (where[end + 1] === ch) end += 2;
      else break;
    }
    out += where.slice(i, end + 1);
    i = end + 1;
  }
  flush();
  return out;
}
