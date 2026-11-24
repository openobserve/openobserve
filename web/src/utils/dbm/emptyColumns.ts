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

const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || v === "—";

/**
 * Ids of columns whose value is empty on every row. No rows hides nothing, so a
 * loading or empty table keeps its full header.
 */
export const emptyColumnIds = <T>(
  rows: readonly T[],
  accessors: Record<string, (row: T) => unknown>,
): string[] =>
  rows.length === 0
    ? []
    : Object.keys(accessors).filter((id) => rows.every((row) => isEmpty(accessors[id](row))));
