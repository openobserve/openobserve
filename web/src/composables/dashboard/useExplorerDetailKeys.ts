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

import { inject, onBeforeUnmount, onMounted, type InjectionKey } from "vue";

const TYPING_SELECTOR =
  "input, textarea, select, [contenteditable]:not([contenteditable='false']), .monaco-editor";

/** Whether a key event was typed into a text field or code editor, which owns its own keys. */
export const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof Element && !!target.closest(TYPING_SELECTOR);

interface DetailBack {
  isOpen: () => boolean;
  back: () => void;
}

/** The drawer's way back from an open item: its × / Escape / outside click step back to the list first. */
export interface ExplorerBack {
  /** Adds an explorer's open item; returns its removal. */
  register: (detail: DetailBack) => () => void;
  /** Goes back from whichever item is open; false when none is, so the drawer may close. */
  back: () => boolean;
}

/** Provided by the drawer host; every explorer inside it registers its open item. */
export const EXPLORER_BACK_KEY: InjectionKey<ExplorerBack> = Symbol("explorerBack");

export function createExplorerBack(): ExplorerBack {
  const details = new Set<DetailBack>();
  return {
    register: (detail) => {
      details.add(detail);
      return () => details.delete(detail);
    },
    back: () => {
      const open = [...details].find((detail) => detail.isOpen());
      open?.back();
      return !!open;
    },
  };
}

/**
 * The explorer drawer's detail keys: arrows step the open item, Escape returns to the list. Returns
 * the explorer root's `keydown`: Escape in a field goes back while an item is open, and otherwise
 * only leaves the field (leaveFieldOnEscape).
 */
export function useExplorerDetailKeys(handlers: {
  isOpen: () => boolean;
  prev: () => void;
  next: () => void;
  back: () => void;
}): (e: KeyboardEvent) => void {
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

  // The drawer's ×, Escape and outside click ask here first, so they step back to the list.
  const host = inject(EXPLORER_BACK_KEY, null);
  const unregister = host?.register({ isOpen: handlers.isOpen, back: handlers.back });
  onBeforeUnmount(() => unregister?.());

  // A field inside the open item (a JSON value, the Table tab's search, a span's inputs) gets one
  // Escape back to the list too; an open dropdown or suggest list stops the key before it gets here.
  return (e: KeyboardEvent) => {
    if (e.key === "Escape" && handlers.isOpen() && isTypingTarget(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
      handlers.back();
      return;
    }
    leaveFieldOnEscape(e);
  };
}

/**
 * Bound as the explorer root's `keydown`: Escape in one of its fields leaves the field instead of
 * closing the drawer (whose Escape listener sits on window, past this root). The next Escape then
 * goes back from the detail or closes the drawer as before. A field that used the key fully (an
 * open suggest or chip list) stops it itself and never reaches here; one that only marked it
 * (the chip bar with its list closed) is still left, or the drawer could never take Escape back.
 */
export function leaveFieldOnEscape(e: KeyboardEvent): void {
  if (e.key !== "Escape" || !isTypingTarget(e.target)) return;
  e.stopPropagation();
  const active = document.activeElement;
  if (active instanceof HTMLElement && e.currentTarget instanceof Node) {
    if (e.currentTarget.contains(active)) active.blur();
  }
}
