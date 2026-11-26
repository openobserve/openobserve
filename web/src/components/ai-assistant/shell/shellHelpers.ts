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

import { onScopeDispose, readonly, ref, shallowRef, watch, type Ref } from "vue";
import { openingDurationMs } from "@/components/ai-assistant/common/assistantMotion";

/** Who opened the locked sidebar, so focus can return there. */
export interface LockedPanelState {
  invoker: HTMLElement | null;
}

// The store is inert on G2 and writes no placement (`00` §4.2 rule 8), so the locked sidebar is view state.
const lockedPanel = /* @__PURE__ */ shallowRef<LockedPanelState | null>(null);

// Set when the panel closed by moving to the full view, which takes the focus and says nothing of a close.
let movedToFullView = false;

/** The open locked sidebar, or null; read by the sidebar host and the header button. */
export function useLockedPanel() {
  return lockedPanel;
}

export function openLockedPanel(invoker: HTMLElement | null): void {
  movedToFullView = false;
  lockedPanel.value = { invoker };
}

/** `move` hands the session to the `/assistant` hero instead of closing it. */
export function closeLockedPanel(reason: "close" | "move" = "close"): void {
  movedToFullView = reason === "move";
  lockedPanel.value = null;
}

/** True while the last close was a move to the full view; the host skips its close announcement. */
export function lockedPanelMoved(): boolean {
  return movedToFullView;
}

/** Read once by the full view, which then focuses its hero; later opens start clean. */
export function takeLockedMove(): boolean {
  const moved = movedToFullView;
  movedToFullView = false;
  return moved;
}

export type WindowKeyboardMode = "move" | "resize";

/** A sidebar tear-off the new window carries on, under the same pointer. */
export interface TearOffDrag {
  sid: string;
  pointerId: number;
  clientX: number;
  clientY: number;
}

/** Set by the sidebar host as it tears a chat off; the window born from it takes the gesture over. */
export const tearOffRequest = /* @__PURE__ */ shallowRef<TearOffDrag | null>(null);

// Sub-pixel rounding leaves a fitting transcript a pixel or two taller than its box.
const OVERFLOW_TOLERANCE_PX = 2;

/** True when a finished answer's first line is out of view in a transcript that scrolls; only then is it worth leaving the bottom for. */
export function answerStartHidden(answer: HTMLElement, scroller: HTMLElement | null): boolean {
  if (!scroller || scroller.scrollHeight <= scroller.clientHeight + OVERFLOW_TOLERANCE_PX)
    return false;
  const box = scroller.getBoundingClientRect();
  const top = answer.getBoundingClientRect().top;
  return top < box.top - OVERFLOW_TOLERANCE_PX || top >= box.bottom;
}

/** True when a finished turn should move the view to its answer's start; a reader who scrolled away keeps their place. */
export function readFromAnswerStart(
  following: boolean,
  answer: HTMLElement | undefined,
  scroller: HTMLElement | null,
): boolean {
  return following && !!answer && answerStartHidden(answer, scroller);
}

/** Greeting, three starters and the composer: the items the opening staggers. */
export const OPENING_ITEMS = 5;

/** True from the moment `shown` turns on until the opening sequence has played once. */
export function useOpeningMotion(shown: () => boolean): { opening: Readonly<Ref<boolean>> } {
  const opening = ref(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  // The classes come off after the run, so a later re-render or remount never replays it.
  watch(shown, (now, before) => {
    stop();
    opening.value = now && !before;
    if (!opening.value) return;
    timer = setTimeout(() => {
      timer = null;
      opening.value = false;
    }, openingDurationMs(OPENING_ITEMS));
  });

  onScopeDispose(stop);
  return { opening: readonly(opening) };
}
