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

export interface ColumnFix {
  column: string;
  match: string;
  line: number | null;
}

const MAX_DISTANCE = 2;
// DataFusion names a missing column "No field named x"; a qualifier and quotes may wrap it.
const UNKNOWN_COLUMN = /no field named\s+(?:["'`]?[\w$]+["'`]?\.)*["'`]?([\w$]+)["'`]?/i;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wholeWord = (word: string, flags = "") =>
  new RegExp(`(?<![\\w$])${escapeRegExp(word)}(?![\\w$])`, flags);

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

/** The one field an unknown-column error most likely meant, or null when the error names no column or the guess is not unique. */
export function unknownColumnFix(error: string, sql: string, fields: string[]): ColumnFix | null {
  const column = UNKNOWN_COLUMN.exec(error)?.[1];
  if (!column) return null;
  const lower = column.toLowerCase();
  const close = [...new Set(fields)].filter(
    (f) => f && editDistance(f.toLowerCase(), lower) <= MAX_DISTANCE,
  );
  if (close.length !== 1) return null;
  const index = sql.split("\n").findIndex((text) => wholeWord(column, "i").test(text));
  return { column, match: close[0], line: index === -1 ? null : index + 1 };
}

/** The query with every whole-word use of `column` spelled `match`. */
export function applyColumnFix(sql: string, column: string, match: string): string {
  return sql.replace(wholeWord(column, "g"), match);
}
