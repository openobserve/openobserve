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

export const SIDEBAR_MIN_REM = 20;

/** `<main>` never drops below this beside a pinned sidebar. */
export const MAIN_MIN_REM = 32;

/** Must match `ONavbar`'s rail (`w-[5.5rem]`), which `<main>` also gives up at `md` and up. */
export const NAV_RAIL_REM = 5.5;

/** The width the sidebar draws at: the stored width, held to half the window and, pinned, to what leaves `<main>` 32 rem. */
export function sidebarWidthFor(storedRem: number, viewportRem: number, floating: boolean): number {
  const half = viewportRem / 2;
  const room = floating ? half : Math.min(half, viewportRem - NAV_RAIL_REM - MAIN_MIN_REM);
  return Math.max(SIDEBAR_MIN_REM, Math.min(storedRem, room));
}
