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

/** True for the parser's OFFSET-only shape: one value under the "offset" separator. */
export function isOffsetOnlyLimit(
  limit: { seperator?: string; value?: unknown[] } | null | undefined,
) {
  return limit?.seperator === "offset" && Array.isArray(limit.value) && limit.value.length === 1;
}

const TRAILING_OFFSET = /\s+OFFSET\s+(\d+)\s*;?\s*$/i;
const TRAILING_LIMIT = /\blimit\s+\d+\s*$/i;

/** Splits a trailing OFFSET off a query with no LIMIT; the count of its rows must not skip rows. */
export function splitTrailingOffset(sql: string): { sql: string; offset: number } {
  const match = TRAILING_OFFSET.exec(sql);
  if (!match) return { sql, offset: 0 };
  const rest = sql.slice(0, match.index);
  if (TRAILING_LIMIT.test(rest)) return { sql, offset: 0 };
  return { sql: rest, offset: Number(match[1]) };
}
