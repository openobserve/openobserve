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

export function sqlLimitOf(parsedSql: any): number | null {
  // A trailing ";" makes the parser return an array; only the outermost LIMIT, on the last node of a set operation, bounds the result.
  let node = Array.isArray(parsedSql) ? parsedSql[parsedSql.length - 1] : parsedSql;
  while (node?._next) node = node._next;
  const values = node?.limit?.value ?? [];
  // A lone value after "offset" is the OFFSET of a query with no LIMIT.
  if (node?.limit?.seperator === "offset" && values.length < 2) return null;
  const limit = Number(values[0]?.value);
  return Number.isFinite(limit) ? limit : null;
}

export function downloadRangeWindow(
  initialNumber: number,
  range: number,
  sqlLimit: number | null,
): { from: number; size: number } {
  // The server applies the SQL LIMIT and ignores from/size, so the range is trimmed client-side.
  if (sqlLimit !== null) return { from: 0, size: sqlLimit };
  return { from: initialNumber === 0 ? 0 : initialNumber - 1, size: range };
}

export function applyDownloadRange<T>(
  hits: T[],
  initialNumber: number,
  range: number,
  sqlLimit: number | null,
): T[] {
  if (sqlLimit === null) return hits;
  const start = Math.max(initialNumber - 1, 0);
  return hits.slice(start, start + range);
}
