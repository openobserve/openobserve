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

export const TABLE_MAX_HEIGHT = "70vh";

const CHAR_PX = 7.4;
const CELL_PAD_PX = 32;
const HEADER_EXTRA_CHARS = 4;

interface FitOptions {
  min?: number;
  max?: number;
}

export function fitColumnSize(
  header: string,
  values: ReadonlyArray<string | number | null | undefined>,
  { min = 64, max = 480 }: FitOptions = {},
): number {
  let longest = header.length + HEADER_EXTRA_CHARS;
  for (const v of values) {
    if (v == null) continue;
    longest = Math.max(longest, String(v).length);
  }
  return Math.min(max, Math.max(min, Math.round(longest * CHAR_PX + CELL_PAD_PX)));
}
