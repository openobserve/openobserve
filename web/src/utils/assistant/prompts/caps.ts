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

// No imports: hosts read the caps statically without loading the assistant runtime on the flag-off path.

/** "Explain these {n} rows" takes at most this many rows. */
export const MAX_EXPLAIN_ROWS = 20;

/** And at most this many bytes of selected rows. */
export const MAX_EXPLAIN_BYTES = 64 * 1024;

/** True when the selection is over the multi-select cap, so the door is disabled with `assistant.entry.tooManyRows`. */
export function rowsOverCap(rows: readonly unknown[]): boolean {
  if (rows.length > MAX_EXPLAIN_ROWS) return true;
  return new TextEncoder().encode(JSON.stringify(rows)).length > MAX_EXPLAIN_BYTES;
}
