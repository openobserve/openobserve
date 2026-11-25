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

/** Double-quotes bare field names in a where clause, leaving '...' string literals untouched. */
export function quoteFieldNames(where: string, fieldNames: string[]): string {
  const fields = new Set(fieldNames);
  let out = "";
  let chunk = "";
  const flush = () => {
    out += chunk
      .split(" ")
      .map((token) => (fields.has(token) ? `"${token}"` : token))
      .join(" ");
    chunk = "";
  };
  let i = 0;
  while (i < where.length) {
    if (where[i] !== "'") {
      chunk += where[i++];
      continue;
    }
    flush();
    let end = i + 1;
    while (end < where.length) {
      if (where[end] !== "'") end += 1;
      else if (where[end + 1] === "'") end += 2;
      else break;
    }
    out += where.slice(i, end + 1);
    i = end + 1;
  }
  flush();
  return out;
}
