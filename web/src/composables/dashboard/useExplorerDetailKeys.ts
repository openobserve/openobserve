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

import { onBeforeUnmount, onMounted } from "vue";

const TYPING_SELECTOR =
  "input, textarea, select, [contenteditable]:not([contenteditable='false']), .monaco-editor";

/** Whether a key event was typed into a text field or code editor, which owns its own keys. */
export const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof Element && !!target.closest(TYPING_SELECTOR);

/** The explorer drawer's detail keys: arrows step the open item, Escape returns to the list. */
export function useExplorerDetailKeys(handlers: {
  isOpen: () => boolean;
  prev: () => void;
  next: () => void;
  back: () => void;
}) {
  const onKeydown = (e: KeyboardEvent) => {
    if (!handlers.isOpen() || isTypingTarget(e.target)) return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      handlers.prev();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      handlers.next();
    } else if (e.key === "Escape") {
      // Return to the list instead of letting the drawer close.
      e.preventDefault();
      e.stopPropagation();
      handlers.back();
    }
  };
  // Capture phase, so the drawer's own Escape handler never sees a key the detail used.
  onMounted(() => window.addEventListener("keydown", onKeydown, true));
  onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown, true));
}

/**
 * Bound as the explorer root's `keydown`: Escape in one of its fields leaves the field instead of
 * closing the drawer (whose Escape listener sits on window, past this root). The next Escape then
 * goes back from the detail or closes the drawer as before. A key the field already used is left alone.
 */
export function leaveFieldOnEscape(e: KeyboardEvent): void {
  if (e.key !== "Escape" || !isTypingTarget(e.target)) return;
  e.stopPropagation();
  if (e.defaultPrevented) return;
  const active = document.activeElement;
  if (active instanceof HTMLElement && e.currentTarget instanceof Node) {
    if (e.currentTarget.contains(active)) active.blur();
  }
}
