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

import { ref, shallowRef } from "vue";

/** Width in px of a column pinned at the viewport's end that page drawers must sit beside, never over; 0 when none. */
export const drawerInsetEnd = ref(0);

/** The assistant column while it is shown, pinned or floating: an opted-in drawer keeps it usable beside itself. */
export const drawerInsetColumn = shallowRef<Element | null>(null);

/** Marks the pinned column, so a click or focus there never dismisses a drawer beside it. */
export const DRAWER_INSET_ATTR = "data-o2-drawer-inset";

/** Called by the owner of the pinned column whenever its width or visibility changes. */
export function setDrawerInsetEnd(px: number, column: Element | null = null): void {
  drawerInsetEnd.value = Math.max(0, Math.round(px));
  drawerInsetColumn.value = column;
}

/** Marks an app-level layer root (toasts, sheets, a drawer's scrim) that stays usable while a drawer hides the page. */
export const LAYER_ROOT_ATTR = "data-o2-layer";

// Layers that must stay usable beside an open drawer: marked roots, reka's portaled poppers and dialogs, live regions.
const LAYER_ROOTS = `[${LAYER_ROOT_ATTR}], [data-reka-popper-content-wrapper], [role="dialog"], [role="alertdialog"], [aria-live]`;

/** Makes every page branch except the kept elements, their ancestors and app layers hidden and inert; returns the undo. */
export function hideAllBut(keep: readonly Element[]): () => void {
  const kept = [...keep, ...Array.from(document.querySelectorAll(LAYER_ROOTS))];
  const onPath = new Set<Element>();
  for (const el of kept) for (let n: Element | null = el; n; n = n.parentElement) onPath.add(n);
  const added: [Element, string][] = [];
  const mark = (el: Element, name: string, value: string) => {
    if (el.hasAttribute(name)) return;
    el.setAttribute(name, value);
    added.push([el, name]);
  };
  const walk = (parent: Element) => {
    for (const child of Array.from(parent.children)) {
      if (kept.includes(child)) continue;
      if (onPath.has(child)) walk(child);
      else if (child.tagName !== "SCRIPT") {
        mark(child, "aria-hidden", "true");
        mark(child, "inert", "");
      }
    }
  };
  walk(document.body);
  // Only what this call added is removed, so a branch that was already inert stays so.
  return () => added.forEach(([el, name]) => el.removeAttribute(name));
}
