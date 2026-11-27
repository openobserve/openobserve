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

// Widgets that move between their own items with the arrow keys.
const ARROW_WIDGET_SELECTOR =
  "[role='tablist'], [role='menu'], [role='menubar'], [role='listbox'], [role='radiogroup'], [role='slider']";
// Escape from inside an open menu, listbox or popover, or from the trigger it is open on, closes only it.
const OPEN_POPUP_SELECTOR =
  "[role='menu'], [role='listbox'], [data-reka-popper-content-wrapper], [aria-haspopup][aria-expanded='true']";

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

/** Arrows step the open item and Escape returns to the list; returns the explorer root's `keydown`,
 * which also takes Escape from a field in the open item. */
export function useExplorerDetailKeys(handlers: {
  isOpen: () => boolean;
  prev: () => void;
  next: () => void;
  back: () => void;
}): (e: KeyboardEvent) => void {
  // Noted before any widget runs: closing a popup unmounts it before the key bubbles back up.
  let popupOpenAtKey = false;
  const notePopup = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    const target = e.target instanceof Element ? e.target : null;
    popupOpenAtKey = !!target?.closest(OPEN_POPUP_SELECTOR);
  };
  // Bubble phase, after the item's own widgets: a key one of them used is left to it.
  const onKeydown = (e: KeyboardEvent) => {
    if (!handlers.isOpen() || isTypingTarget(e.target) || e.defaultPrevented) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest(ARROW_WIDGET_SELECTOR)) return;
      e.preventDefault();
      if (e.key === "ArrowLeft") handlers.prev();
      else handlers.next();
    } else if (e.key === "Escape" && !popupOpenAtKey) {
      e.preventDefault();
      handlers.back();
    }
  };
  onMounted(() => {
    window.addEventListener("keydown", notePopup, true);
    window.addEventListener("keydown", onKeydown);
  });
  onBeforeUnmount(() => {
    window.removeEventListener("keydown", notePopup, true);
    window.removeEventListener("keydown", onKeydown);
  });

  // The drawer's ×, Escape and outside click ask here first, so they step back to the list.
  const host = inject(EXPLORER_BACK_KEY, null);
  const unregister = host?.register({ isOpen: handlers.isOpen, back: handlers.back });
  onBeforeUnmount(() => unregister?.());

  // An Escape from inside the open item that no widget used goes back before the drawer sees it; a
  // suggest list stops the key in its field, and a portaled menu's keys never pass through this root.
  return (e: KeyboardEvent) => {
    if (e.key === "Escape" && handlers.isOpen() && !e.defaultPrevented && !popupOpenAtKey) {
      e.preventDefault();
      e.stopPropagation();
      const active = document.activeElement;
      if (isTypingTarget(active) && active instanceof HTMLElement) active.blur();
      handlers.back();
      return;
    }
    leaveFieldOnEscape(e);
  };
}

/** Escape in a field leaves the field, so the drawer closes only on the next one. Leaves it even when
 * the field only marked the key (the chip bar), or the drawer could never take Escape back. */
export function leaveFieldOnEscape(e: KeyboardEvent): void {
  if (e.key !== "Escape" || !isTypingTarget(e.target)) return;
  e.stopPropagation();
  const active = document.activeElement;
  if (active instanceof HTMLElement && e.currentTarget instanceof Node) {
    if (e.currentTarget.contains(active)) active.blur();
  }
}
