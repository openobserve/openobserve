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

import { useShortcuts, type UseShortcutsOptions } from "@/lib/vue-shortcut-manager";

/** Marks the element holding a page's main filter or search; "/" focuses the first field shown inside it. */
export const PRIMARY_QUERY_ATTR = "data-primary-query";

const FOCUSABLE = "input:not([type='hidden']):not([disabled]), textarea:not([disabled])";

// A hidden editor (v-show) still holds its textarea, so only a rendered box counts.
const isShown = (element: Element) => element.getClientRects().length > 0;

/** Focuses the first shown field in the first shown region; `extra` selectors are tried after the marked ones. */
export function focusPrimaryQuery(extra: string[] = [], root: ParentNode = document): boolean {
  for (const selector of [`[${PRIMARY_QUERY_ATTR}]`, ...extra]) {
    for (const region of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
      if (!isShown(region)) continue;
      const field = Array.from(region.querySelectorAll<HTMLElement>(FOCUSABLE)).find(isShown);
      if (field) {
        field.focus();
        return true;
      }
    }
  }
  return false;
}

/** Binds a page's "/" shortcut to its primary query (KB1); the manager already ignores it while typing. */
export function usePrimaryQueryFocus(
  shortcutId: string,
  extra: string[] = [],
  options: UseShortcutsOptions = {},
) {
  useShortcuts([{ id: shortcutId, handler: () => focusPrimaryQuery(extra) }], undefined, options);
}
