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

/**
 * Detects whether streaming chunks arrive left-to-right (earliest first)
 * or right-to-left (latest first).
 *
 * Compares the first chunk's time_offset boundaries against the user's
 * selected time range:
 *   - LTR: first chunk's start_time is close to the user's start
 *   - RTL: first chunk's end_time is close to the user's end
 *
 * @returns `true` for LTR, `false` for RTL, or `null` if inputs are invalid.
 */
export const detectChunkingDirection = (
  firstChunkStart: number,
  firstChunkEnd: number,
  userStart: number,
  userEnd: number,
): boolean | null => {
  if (!firstChunkStart || !firstChunkEnd || !userStart || !userEnd) {
    return null;
  }
  return (
    Math.abs(firstChunkStart - userStart) <=
    Math.abs(firstChunkEnd - userEnd)
  );
};

/**
 * Determines whether incoming chunk data should be prepended or appended
 * to the existing data array based on the chunking direction and the
 * per-chunk order_by.
 *
 *   RTL + asc  → prepend   |  LTR + asc  → append
 *   RTL + desc → append    |  LTR + desc → prepend
 *
 * @param isLTR    - true if chunks arrive left-to-right (earliest first)
 * @param orderAsc - true if data within each chunk is ascending
 * @returns `true` if new data should be prepended, `false` if appended.
 */
export const shouldPrependChunk = (
  isLTR: boolean,
  orderAsc: boolean,
): boolean => {
  return isLTR !== orderAsc;
};
