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
// Anything the bubble must not sit on: covering it hides a control or text box the user may reach for next.
const COVERED_CONTROLS =
  'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="switch"], [role="checkbox"], [role="menuitem"], [role="textbox"], [contenteditable="true"], [tabindex]:not([tabindex="-1"])';
const BUBBLE_SELECTOR = '[data-test="o-tooltip-content"]';
const SIDE_ORDER: CopyConfirmSide[] = ["top", "right", "left", "bottom"];
// The bubble's size is only known once it renders, so its box is estimated from the text-xs label, icon and padding.
const BUBBLE_HEIGHT_REM = 1.75;
const BUBBLE_CHAR_REM = 0.45;
const BUBBLE_CHROME_REM = 2.5;
// OTooltip's side offset plus its arrow.
const BUBBLE_GAP_REM = 0.5625;

export type CopyConfirmTone = "success" | "error";
export type CopyConfirmSide = "top" | "right" | "bottom" | "left";

interface CopyConfirmState {
  anchor: HTMLElement | null;
  message: I18nText;
  open: boolean;
  side: CopyConfirmSide;
  tone: CopyConfirmTone;
}

interface Box {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The one in-place copy bubble ("Copied", or "Couldn't copy" in red), rendered by OToastProvider next to `anchor`. */
export const copyConfirm = shallowReactive<CopyConfirmState>({
  anchor: null,
  message: raw(""),
  open: false,
  side: "top",
  tone: "success",
});

let timer: ReturnType<typeof setTimeout> | null = null;
let detachWatch: ReturnType<typeof setInterval> | null = null;
let stopScrollWatch: (() => void) | null = null;
let lastActivation: { control: HTMLElement | null; at: number } | null = null;
let hosted = false;
// Bumped whenever the bubble changes, so a placement check queued for an earlier bubble does nothing.
let placementCheck = 0;

export function confirmCopy(
  anchor: HTMLElement,
  message: I18nText,
  onUnseen?: () => void,
  tone: CopyConfirmTone = "success",
): void {
  stopTimers();
  const side = roomySide(anchor, estimatedSize(String(message)));
  // No side keeps clear of every control, so the toast says it instead.
  if (!side) {
    copyConfirm.open = false;
    onUnseen?.();
    return;
  }
  copyConfirm.anchor = anchor;
  copyConfirm.message = message;
  copyConfirm.tone = tone;
  copyConfirm.side = side;
  copyConfirm.open = true;
  checkRenderedPlacement(anchor, onUnseen, [side]);
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
  placementCheck += 1;
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

function estimatedSize(message: string): { width: number; height: number } {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  return {
    width: (BUBBLE_CHROME_REM + message.length * BUBBLE_CHAR_REM) * rem,
    height: BUBBLE_HEIGHT_REM * rem,
  };
}

// The first side, above first, where the bubble stays on screen and covers no other control, or null when none does.
function roomySide(
  anchor: HTMLElement,
  size: { width: number; height: number },
  tried: CopyConfirmSide[] = [],
): CopyConfirmSide | null {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const rect = anchor.getBoundingClientRect();
  // An anchor without a box can't be measured against anything, so the default side stands.
  if (rect.width === 0 && rect.height === 0) return tried.includes("top") ? null : "top";
  const rtl = getComputedStyle(anchor).direction === "rtl";
  const sides = SIDE_ORDER.map((side) =>
    rtl && (side === "left" || side === "right") ? (side === "left" ? "right" : "left") : side,
  ).filter((side) => !tried.includes(side));
  const controls = coverableControls(anchor);
  return (
    sides.find((side) =>
      hasRoom(bubbleBox(side, rect, size.width, size.height, BUBBLE_GAP_REM * rem), controls),
    ) ?? null
  );
}

// The estimate can be off and the tooltip may shift itself, so the drawn bubble is checked once it is placed.
function checkRenderedPlacement(
  anchor: HTMLElement,
  onUnseen: (() => void) | undefined,
  tried: CopyConfirmSide[],
): void {
  if (typeof requestAnimationFrame !== "function") return;
  const check = placementCheck;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (check !== placementCheck) return;
      const bubble = document
        .querySelector('[data-test="copy-confirm"]')
        ?.closest<HTMLElement>(BUBBLE_SELECTOR);
      if (!copyConfirm.open || copyConfirm.anchor !== anchor || !bubble) return;
      const drawn = bubble.getBoundingClientRect();
      if (drawn.width === 0 || hasRoom(drawn, coverableControls(anchor))) return;
      const next = roomySide(anchor, { width: drawn.width, height: drawn.height }, tried);
      if (!next) {
        dismissCopyConfirm();
        onUnseen?.();
        return;
      }
      copyConfirm.side = next;
      checkRenderedPlacement(anchor, onUnseen, [...tried, next]);
    });
  });
}

function bubbleBox(
  side: CopyConfirmSide,
  rect: DOMRect,
  width: number,
  height: number,
  gap: number,
): Box {
  const midX = rect.left + rect.width / 2;
  const midY = rect.top + rect.height / 2;
  if (side === "top" || side === "bottom") {
    const top = side === "top" ? rect.top - gap - height : rect.bottom + gap;
    return { top, bottom: top + height, left: midX - width / 2, right: midX + width / 2 };
  }
  const left = side === "right" ? rect.right + gap : rect.left - gap - width;
  return { top: midY - height / 2, bottom: midY + height / 2, left, right: left + width };
}

// Controls on the anchor's own layer (its dialog, else the page), minus the anchor, what holds it, and the bubble itself.
function coverableControls(anchor: HTMLElement): Box[] {
  const layer = anchor.closest('[role="dialog"]') ?? document;
  const boxes: Box[] = [];
  for (const control of layer.querySelectorAll<HTMLElement>(COVERED_CONTROLS)) {
    if (control === anchor || anchor.contains(control) || control.contains(anchor)) continue;
    if (control.closest(BUBBLE_SELECTOR)) continue;
    const r = control.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) boxes.push(r);
  }
  return boxes;
}

function hasRoom(box: Box, controls: Box[]): boolean {
  if (box.top < 0 || box.left < 0) return false;
  if (box.bottom > window.innerHeight || box.right > window.innerWidth) return false;
  return !controls.some(
    (c) => c.left < box.right && c.right > box.left && c.top < box.bottom && c.bottom > box.top,
  );
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
