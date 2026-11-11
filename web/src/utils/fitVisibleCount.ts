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

/** How many items fit in `available` px; items past that collapse into a `+N` of width `moreWidth`. */
export function fitVisibleCount(
  widths: number[],
  available: number,
  gap: number,
  moreWidth: number,
): number {
  if (widths.length === 0) return 0;
  const total = widths.reduce((sum, w) => sum + w, 0) + gap * (widths.length - 1);
  if (total <= available) return widths.length;
  let used = 0;
  let fit = 0;
  for (const [i, width] of widths.entries()) {
    used += width + (i > 0 ? gap : 0);
    if (used + gap + moreWidth > available) break;
    fit = i + 1;
  }
  // The first item always shows, truncated if it has to be, so a cell is never just `+N`.
  return Math.max(1, fit);
}
