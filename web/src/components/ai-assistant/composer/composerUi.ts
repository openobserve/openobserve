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

import { computed, inject, reactive, toRaw, type ComputedRef, type InjectionKey } from "vue";

import type { useAssistantStore } from "@/composables/assistant";
import type { I18nText } from "@/types/i18n";

/** How long a cap sentence stays under the tray (`40` §2.6). */
export const CAP_NOTICE_MS = 6_000;

/** At and below this width the composer always takes two rows and chips sit behind `+N`. */
export const COMPOSER_NARROW_REM = 24;

/** The narrowest window; popovers take its width less 3 px a side. */
export const COMPOSER_TIGHT_REM = 20;

/** Chips shown before `+N` by width: none when narrow, one at 27 rem, three in a full view. */
export const COMPOSER_WIDE_REM = 40;

/** A cleared draft's notice; `token` is `null` across orgs, where no Undo is offered (`40` §9). */
export interface ClearedNotice {
  token: string | null;
  org?: string;
  at: number;
  /** New chat: the chat that kept its draft; "Bring it here" moves it in (SH-03 AC 6, V6). */
  from?: string;
}

type Store = ReturnType<typeof useAssistantStore>;

/** View state of one session's composer that must survive a container move; never a draft. */
export interface ComposerUi {
  /** The composer region's next sentence; `seq` makes a repeat speak again. */
  status: { seq: number; text: I18nText } | null;
  cap: { text: I18nText; at: number } | null;
  cleared: ClearedNotice | null;
}

/** What a control inside the composer needs to know about the composer's own width. */
export interface ComposerLayout {
  narrow: boolean;
  tight: boolean;
  wide: boolean;
  /** Dictation at 20 rem takes the room of `+N` and the chips. */
  yieldChips: boolean;
}

/** The inputs of the one-row decision; widths in px, 0 when not measured yet. */
export interface ComposerRowInput {
  narrow: boolean;
  /** Chips, images, a meter or anything else the control row must show beyond time. */
  extras: boolean;
  text: string;
  textWidth: number;
  frameWidth: number;
  controlsWidth: number;
}

export const composerLayoutKey: InjectionKey<ComputedRef<ComposerLayout>> =
  Symbol("assistantComposerLayout");

const states = reactive(new Map<string, ComposerUi>());

let seq = 0;

// The frame's 12 px text inset and the 8 px the text keeps from the first control.
const TEXT_INSET_PX = 20;

/** One row holds while the draft fits a line beside the controls and nothing else needs showing. */
export function composerFitsOneRow(input: ComposerRowInput): boolean {
  if (input.narrow || input.extras || input.text.includes("\n")) return false;
  if (!input.text || input.frameWidth === 0) return true;
  return input.textWidth + TEXT_INSET_PX + input.controlsWidth <= input.frameWidth;
}

/** The composer's layout for a control inside it; outside a composer nothing is narrow. */
export function useComposerLayout(): ComputedRef<ComposerLayout> {
  return inject(
    composerLayoutKey,
    computed(() => ({ narrow: false, tight: false, wide: false, yieldChips: false })),
    false,
  );
}

/** One popover width on every board; 3 px a side short of a 20 rem window. */
export function composerPopoverClass(tight: boolean): string {
  return tight ? "w-[calc(20rem-0.375rem)]" : "w-[min(20rem,calc(100vw-0.375rem))]";
}

/** The per-session view state the composer, the tray and the shell share. */
export function composerUi(sid: string): ComposerUi {
  let state = states.get(sid);
  if (!state) {
    states.set(sid, { status: null, cap: null, cleared: null });
    state = states.get(sid)!;
  }
  return state;
}

/** Speaks once through the composer's `role="status"` region (`95` §2). */
export function announceComposer(sid: string, text: I18nText): void {
  seq += 1;
  composerUi(sid).status = { seq, text };
}

/** States a cap under the tray for 6 s; never a toast (CT-02 AC 7, CT-10 AC 4). */
export function noteCap(sid: string, text: I18nText, now: number = Date.now()): void {
  composerUi(sid).cap = { text, at: now };
  announceComposer(sid, text);
}

/** The New chat or org-switch notice, shown by whichever container renders `sid` (CT-06 AC 5–6). */
export function noteDraftCleared(sid: string, notice: ClearedNotice): void {
  composerUi(sid).cleared = notice;
}

/** Moves a chat's whole staged payload (text, chips, images, time, removed fields) into another, so it never lives in both (S7, S8, V6). */
export function moveDraft(store: Store, from: string, to: string): void {
  const source = store.state.sessions[from]?.composer;
  const target = store.state.sessions[to]?.composer;
  if (!source || !target) return;
  const { text, chips, images, timeOverride, removedPageKeys } = toRaw(source);
  store.stage(to, { text, mode: target.text.trim() ? "append" : "replace" });
  // A choice already made in the target chat wins over the copied one (V6).
  store.setDraft(to, {
    timeOverride: target.timeOverride ?? (timeOverride ? { ...timeOverride } : null),
    removedPageKeys: [...new Set([...target.removedPageKeys, ...removedPageKeys])],
  });
  // What the target refuses at its caps stays in the source chat instead of being lost.
  const keptChips = chips.filter((chip) => !store.addChip(to, { ...toRaw(chip) }).ok);
  const keptImages = images.filter((image) => !store.addImage(to, { ...toRaw(image) }).ok);
  store.setDraft(from, {
    text: "",
    chips: keptChips.map((chip) => ({ ...toRaw(chip) })),
    images: keptImages.map((image) => ({ ...toRaw(image) })),
    timeOverride: null,
    removedPageKeys: [],
  });
}

/** Drops the view state of chats that no longer exist, so the map does not grow per chat forever (S11). */
export function forgetComposerUi(live: ReadonlySet<string>): void {
  for (const sid of [...states.keys()]) if (sid && !live.has(sid)) states.delete(sid);
}

/** Lets a spec start from no notices; never called by app code. */
export function resetComposerUiForTests(): void {
  states.clear();
  seq = 0;
}
