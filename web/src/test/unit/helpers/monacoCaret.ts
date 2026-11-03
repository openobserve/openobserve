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

export interface CaretBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const FIRST_LINE_CARET: CaretBox = { left: 113, top: 91, right: 115, bottom: 109 };

/** Gives Monaco's caret element an on-screen box, since happy-dom lays nothing out and the recents dropdown opens at the caret. */
export const placeCaret = (cursor: Element | null, box: CaretBox = FIRST_LINE_CARET) => {
  if (!cursor) return;
  cursor.getBoundingClientRect = () =>
    ({
      ...box,
      x: box.left,
      y: box.top,
      width: box.right - box.left,
      height: box.bottom - box.top,
      toJSON: () => ({}),
    }) as DOMRect;
};
