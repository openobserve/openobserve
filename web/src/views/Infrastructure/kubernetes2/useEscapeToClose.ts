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

import { onBeforeUnmount, watch, type Ref } from "vue";

// A drawer, dialog or menu open over the page takes Escape for itself; one still animating closed does not count.
const OVERLAY = ["dialog", "alertdialog", "menu", "listbox"]
  .map((role) => `[role="${role}"]:not([data-state="closed"]):not([hidden])`)
  .join(", ");

// Escape in a text field belongs to the field, to clear it or close its suggestions.
const typing = (el: Element | null) =>
  !!el &&
  (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable);

// While `open` is true, Escape anywhere on the page calls `close`, so a panel opened with the mouse, which leaves
// focus outside it, still closes from the keyboard. An Escape something else already handled, one typed in a text
// field, and one an open overlay takes are left alone.
export function useEscapeToClose(open: Ref<boolean>, close: () => void) {
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (document.querySelector(OVERLAY) || typing(document.activeElement)) return;
    event.preventDefault();
    close();
  };
  const stop = () => document.removeEventListener("keydown", onKey);
  watch(
    open,
    (now) => {
      stop();
      if (now) document.addEventListener("keydown", onKey);
    },
    { immediate: true },
  );
  onBeforeUnmount(stop);
}
