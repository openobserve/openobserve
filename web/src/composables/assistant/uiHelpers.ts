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

import { nextTick, onScopeDispose, shallowReactive, watch } from "vue";
import type { Sid } from "./assistantStore.types";
import i18n from "@/locales";
import { raw, type I18nText } from "@/types/i18n";

export const SIDEBAR_MIN_REM = 20;

/** `<main>` never drops below this beside a pinned sidebar. */
export const MAIN_MIN_REM = 32;

/** Must match `ONavbar`'s rail (`w-[5.5rem]`), which `<main>` also gives up at `md` and up. */
export const NAV_RAIL_REM = 5.5;

const WIDTH_DEFAULT_SHARE = 0.3;

const WIDTH_DEFAULT_MIN_REM = 22;

const WIDTH_DEFAULT_MAX_REM = 32;

/** `clamp(22rem, 30vw, 32rem)`, the default sidebar width. */
export function defaultWidthRem(viewportRem: number): number {
  return Math.min(
    Math.max(viewportRem * WIDTH_DEFAULT_SHARE, WIDTH_DEFAULT_MIN_REM),
    WIDTH_DEFAULT_MAX_REM,
  );
}

/** The width the sidebar draws at: the stored width, held to half the window and to what leaves `<main>` 32 rem. */
export function sidebarWidthFor(storedRem: number, viewportRem: number): number {
  const room = Math.min(viewportRem / 2, viewportRem - NAV_RAIL_REM - MAIN_MIN_REM);
  return Math.max(SIDEBAR_MIN_REM, Math.min(storedRem, room));
}

/** The assistant's focus scope: `assistantClose` is bound only while focus is inside it. */
export const ASSISTANT_ROOT_SELECTOR = "[data-assistant-root]";

/** Every assistant surface that owns the keyboard while focused (the tray renders inside the Threads bar). */
export const ASSISTANT_SURFACES_SELECTOR = `${ASSISTANT_ROOT_SELECTOR}, [data-assistant-window], [data-test='threads-bar']`;

/** A new tab the opened page cannot script back; `noopener` would make `window.open` return null even on success. */
export function openTabWithoutOpener(href: string): boolean {
  const opened = window.open(href, "_blank");
  if (!opened) return false;
  opened.opener = null;
  return true;
}

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

const displayed = /* @__PURE__ */ shallowReactive(new Map<symbol, Sid>());

/** The chats some mounted container has on screen with its transcript showing. */
export function viewedChatSids(): ReadonlySet<Sid> {
  return new Set(displayed.values());
}

/** Registers what one container displays; `null` while its chat is covered, peeked or listed over. */
export function useViewedChat(sid: () => Sid | null): void {
  const id = Symbol("viewedChat");
  watch(
    sid,
    (value) => {
      if (value) displayed.set(id, value);
      else displayed.delete(id);
    },
    { immediate: true },
  );
  onScopeDispose(() => displayed.delete(id));
}

/** The product name as the `{product}` value, the en-US brand value. */
export function useAssistantName(): { product: I18nText } {
  return { product: raw(i18n.global.t("brand.autobot")) };
}
