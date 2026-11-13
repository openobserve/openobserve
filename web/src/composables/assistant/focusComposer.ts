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

import { nextTick } from "vue";

const EDITABLE = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";
const MODAL = "dialog[open], [role='dialog'][aria-modal='true'], [role='alertdialog']";

/** An automatic focus never steals: not on touch, not from another field, not over an open modal. */
export function canAutoFocus(target?: HTMLElement | null): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(pointer: coarse)")?.matches) return false;
  const active = document.activeElement;
  if (active && active !== document.body && active !== target && active.matches(EDITABLE))
    return false;
  const modal = document.querySelector(MODAL);
  return !modal || !!target?.closest(MODAL);
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Focuses the field once it is mounted and enabled (one retry); false when a rule or the field said no. */
export async function focusWhenReady(get: () => HTMLElement | null | undefined): Promise<boolean> {
  await nextTick();
  await frame();
  let el = get();
  if (!el || (el as HTMLTextAreaElement).disabled) {
    await frame();
    el = get();
  }
  if (!el || (el as HTMLTextAreaElement).disabled || !canAutoFocus(el)) return false;
  el.focus({ preventScroll: true });
  return true;
}
