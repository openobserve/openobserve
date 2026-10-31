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

import { shallowReactive } from "vue";
import { raw, type I18nText } from "@/types/i18n";

export const COPY_CONFIRM_MS = 2000;
// A bubble closed by its anchor moving sooner than this was never really seen.
const COPY_CONFIRM_SEEN_MS = 1000;
const DETACH_CHECK_MS = 250;
// A copy that resolves later than this (e.g. after a network call) no longer belongs to the click.
const ACTIVATION_TRUST_MS = 1000;
const CONTROL_SELECTOR = 'button, a[href], [role="button"]';
const ACTIVATION_EVENTS = ["pointerdown", "keydown"];

interface CopyConfirmState {
  anchor: HTMLElement | null;
  message: I18nText;
  open: boolean;
}

/** The one in-place "Copied" bubble, rendered by OToastProvider next to `anchor`. */
export const copyConfirm = shallowReactive<CopyConfirmState>({
  anchor: null,
  message: raw(""),
  open: false,
});

let timer: ReturnType<typeof setTimeout> | null = null;
let detachWatch: ReturnType<typeof setInterval> | null = null;
let stopScrollWatch: (() => void) | null = null;
let lastActivation: { control: HTMLElement | null; at: number } | null = null;
let hosted = false;

export function confirmCopy(anchor: HTMLElement, message: I18nText, onUnseen?: () => void): void {
  stopTimers();
  copyConfirm.anchor = anchor;
  copyConfirm.message = message;
  copyConfirm.open = true;
  timer = setTimeout(dismissCopyConfirm, COPY_CONFIRM_MS);
  const shownAt = Date.now();
  const closeEarly = () => {
    dismissCopyConfirm();
    if (Date.now() - shownAt < COPY_CONFIRM_SEEN_MS) onUnseen?.();
  };
  // A dialog closed right after its copy takes the anchor along, and a detached anchor parks the bubble top-left.
  detachWatch = setInterval(() => {
    if (!anchor.isConnected) closeEarly();
  }, DETACH_CHECK_MS);
  watchAnchorMoves(anchor, closeEarly);
}

export function dismissCopyConfirm(): void {
  stopTimers();
  // The anchor stays so the bubble's exit animation keeps its position.
  copyConfirm.open = false;
}

/** The control a copy confirms on, or null while no OToastProvider is mounted to draw the bubble. */
export function confirmationAnchor(explicit?: HTMLElement | null): HTMLElement | null {
  if (!hosted) return null;
  const recent =
    lastActivation && Date.now() - lastActivation.at <= ACTIVATION_TRUST_MS ? lastActivation : null;
  return explicit ?? (recent ? recent.control : controlOf(document.activeElement));
}

/** Records the control each click or Enter/Space lands on; returns the teardown. */
export function trackActivations(): () => void {
  hosted = true;
  for (const type of ACTIVATION_EVENTS) {
    document.addEventListener(type, recordActivation, { capture: true, passive: true });
  }
  return () => {
    hosted = false;
    lastActivation = null;
    for (const type of ACTIVATION_EVENTS) {
      document.removeEventListener(type, recordActivation, { capture: true });
    }
  };
}

function stopTimers(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (detachWatch) clearInterval(detachWatch);
  detachWatch = null;
  stopScrollWatch?.();
  stopScrollWatch = null;
}

// The bubble follows its anchor, so a scroll that moves the anchor would carry it over sticky headers.
function watchAnchorMoves(anchor: HTMLElement, closeEarly: () => void): void {
  const start = anchor.getBoundingClientRect();
  const onScroll = () => {
    if (!anchor.isConnected) return closeEarly();
    const now = anchor.getBoundingClientRect();
    if (now.top === start.top && now.left === start.left) return;
    closeEarly();
  };
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
  stopScrollWatch = () => document.removeEventListener("scroll", onScroll, { capture: true });
}

function controlOf(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const control = target.closest<HTMLElement>(CONTROL_SELECTOR);
  // Menus close on select, so a confirmation anchored inside one would vanish with it.
  return control && !control.closest('[role="menu"]') ? control : null;
}

function recordActivation(event: Event): void {
  const { key } = event as KeyboardEvent;
  // Any other key (a shortcut) activates no control, so its copy must not land on whatever has focus.
  const activates = event.type !== "keydown" || key === "Enter" || key === " ";
  lastActivation = { control: activates ? controlOf(event.target) : null, at: Date.now() };
}
