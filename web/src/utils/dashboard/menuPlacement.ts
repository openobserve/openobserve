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

interface Size {
  width: number;
  height: number;
}

const MARGIN = 8;

/** Where a menu opened at a click goes: beside the click, flipped left or up where it would leave the viewport. */
export const placeMenu = (
  click: { x: number; y: number },
  menu: Size,
  viewport: Size,
): { left: number; top: number } => {
  const fits = (start: number, size: number, limit: number) => start + size + MARGIN <= limit;
  const left = fits(click.x, menu.width, viewport.width) ? click.x : click.x - menu.width;
  const top = fits(click.y, menu.height, viewport.height) ? click.y : click.y - menu.height;
  return {
    left: Math.max(MARGIN, Math.min(left, viewport.width - menu.width - MARGIN)),
    top: Math.max(MARGIN, Math.min(top, viewport.height - menu.height - MARGIN)),
  };
};
