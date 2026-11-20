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

export interface FlyoutBox {
  tileTop: number;
  height: number;
  viewportHeight: number;
  margin: number;
}

export function needsColumns(box: FlyoutBox, sections: number): boolean {
  const top = Math.max(box.tileTop, box.margin);
  return sections >= 2 && top + box.height > box.viewportHeight - box.margin;
}

/** Columns cap at 3 so the 200px columns stay within 600px and most of the table stays visible. */
export const MAX_FLYOUT_COLUMNS = 3;

/** One column per group once a flyout holds more than 8 items in at least 2 groups; a short list stays one column. */
export function flyoutColumns(groupSizes: number[]): number {
  const items = groupSizes.reduce((sum, n) => sum + n, 0);
  return items > 8 && groupSizes.length >= 2 ? Math.min(groupSizes.length, MAX_FLYOUT_COLUMNS) : 1;
}

export function flyoutTop(box: FlyoutBox): number {
  const { tileTop, height, viewportHeight, margin } = box;
  const shown = Math.min(height, viewportHeight - margin * 2);
  const maxTop = viewportHeight - shown - margin;
  if (tileTop + shown <= viewportHeight - margin) return Math.max(margin, tileTop);
  const centred = (viewportHeight - shown) / 2;
  // A centred flyout that no longer reaches the tile's row would lose the pointer.
  const reachesTile = centred + shown > tileTop;
  return Math.max(margin, reachesTile ? centred : Math.min(tileTop, maxTop));
}
