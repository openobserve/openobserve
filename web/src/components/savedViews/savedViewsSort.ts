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

export interface SavedViewLike {
  view_id: string;
  view_name: string;
}

/**
 * Ordering for the saved-views quick dropdown: favorited views first, then
 * case-insensitive alphabetical. The dropdown has no search box, so ordering
 * is what makes a long list scannable. Returns a new array.
 */
export function sortSavedViews<T extends SavedViewLike>(
  views: T[] | null | undefined,
  favoriteIds: string[],
): T[] {
  const favs = new Set(favoriteIds);
  return [...(views ?? [])].sort((a, b) => {
    const af = favs.has(a.view_id) ? 0 : 1;
    const bf = favs.has(b.view_id) ? 0 : 1;
    return (
      af - bf ||
      String(a.view_name).localeCompare(String(b.view_name), undefined, {
        sensitivity: "base",
      })
    );
  });
}
