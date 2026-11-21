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

import type { I18nKey } from "@/types/i18n";
import { isMacOS } from "@/utils/keyboardShortcuts";

/** A keydown inside an assistant root this recent means the user is typing there. */
export const IDLE_FOCUS_MS = 1_500;

const ROOT_SELECTOR = "[data-assistant-root]";

// Monaco's own textarea and every editable control count as text; a card never takes focus from them.
const TEXT_SELECTOR =
  "input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='textbox'], [role='combobox'], .monaco-editor";

let lastKeydownAt = Number.NEGATIVE_INFINITY;

/** What a card asks when it arrives: may it take focus, and how the announcement says where it is. */
export interface AssistantIdleFocus {
  /** True on `body`, or on a non-text control inside an assistant root with no keydown in the last 1.5 s. */
  canTakeFocus(): boolean;
  /** The announcement's ending when focus stayed where it was: the chord, or "above the message box" on touch. */
  jumpKey(): I18nKey;
  /** The chord as a reader speaks it. */
  spokenKeys(): I18nKey;
}

/** Called by the shell for every keydown inside its root. */
export function noteAssistantKeydown(at: number = Date.now()): void {
  lastKeydownAt = at;
}

/** When the last keydown inside an assistant root happened. */
export function assistantKeydownAt(): number {
  return lastKeydownAt;
}

/** The arrival rule every decision card follows: focus moves in only when nobody is typing. */
export function useAssistantIdleFocus(now: () => number = Date.now): AssistantIdleFocus {
  return {
    canTakeFocus() {
      if (typeof document === "undefined") return false;
      const active = document.activeElement;
      if (!active || active === document.body) return true;
      if (!active.closest(ROOT_SELECTOR)) return false;
      if (active.matches(TEXT_SELECTOR) || active.closest(".monaco-editor")) return false;
      return now() - lastKeydownAt >= IDLE_FOCUS_MS;
    },
    jumpKey() {
      return coarsePointer()
        ? "assistant.announce.approvalJumpTouch"
        : "assistant.announce.approvalJump";
    },
    spokenKeys() {
      return isMacOS() ? "assistant.announce.keysOpenMac" : "assistant.announce.keysOpen";
    },
  };
}

/** Lets a spec start with no recorded keydown; never called by app code. */
export function resetIdleFocusForTests(): void {
  lastKeydownAt = Number.NEGATIVE_INFINITY;
}

function coarsePointer(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)")?.matches === true
  );
}
