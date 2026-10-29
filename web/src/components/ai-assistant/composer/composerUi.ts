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

import { reactive, toRaw } from "vue";

import type { useAssistantStore } from "@/composables/assistant";
import type { I18nText } from "@/types/i18n";

/** How long a cap sentence stays under the tray (`40` §2.6). */
export const CAP_NOTICE_MS = 6_000;

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

const states = reactive(new Map<string, ComposerUi>());

let seq = 0;

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
