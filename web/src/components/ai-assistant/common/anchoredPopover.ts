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

import { inject } from "vue";

import { DIALOG_DEPTH_KEY } from "@/lib/overlay/Dialog/dialogStacking";

const FOCUSABLE =
  "button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex='-1'])";

/** OPopover's `z-index` one layer above the dialog, sheet or drawer the caller sits in, as ODropdown stacks. */
export function usePopoverZIndex(): number {
  const depth = Math.max(inject<number>(DIALOG_DEPTH_KEY, 0), inject<number>("o2DrawerDepth", 0));
  return 6000 + depth * 1000;
}

/**
 * Focus return for an OPopover placed by its `anchor` prop, which has no trigger for reka to refocus.
 * Bind `onPointerDownOutside` to `pointer-down-outside`, and call `onClose` on every close.
 */
export function useAnchorFocusReturn(anchor: () => Element | null | undefined) {
  let clickedAway = false;
  return {
    onPointerDownOutside(event: Event): void {
      if (!event.defaultPrevented) clickedAway = true;
    },
    onClose(): void {
      const away = clickedAway;
      clickedAway = false;
      const active = document.activeElement;
      // A click away, or a focus the user or caller already moved elsewhere, keeps its place.
      if (
        away ||
        (active && active !== document.body && !active.closest("[data-o-popover-content]"))
      )
        return;
      const el = anchor();
      const control = el?.matches(FOCUSABLE) ? el : el?.querySelector(FOCUSABLE);
      if (control instanceof HTMLElement) control.focus();
    },
  };
}
