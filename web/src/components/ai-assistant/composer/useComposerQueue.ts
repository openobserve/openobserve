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

import { computed, effectScope, reactive, watch, type ComputedRef, type EffectScope } from "vue";

import { isRunning, useAssistantStore, type Sid } from "@/composables/assistant";

type ComposerSnapshot = Parameters<ReturnType<typeof useAssistantStore>["resend"]>[1];

// Keyed by chat, so a container move or a second composer on the same chat sees one queue.
const queues = reactive(new Map<string, QueuedMessage>());

// One drain for the app's store, outside any component, so a chat's queue goes when its turn ends wherever the user is.
let drain: { store: QueueStore; scope: EffectScope } | null = null;

export interface QueuedMessage {
  text: string;
  at: number;
}

export interface ComposerQueueOptions {
  sid(): Sid | null;
  /** Unused: the store's drain reads whether the chat's turn runs. */
  running?(): boolean;
  /** Unused: the store's drain reads how the turn ended. */
  endedDone?(): boolean;
  /** The draft as typed since queuing; Edit swaps it with the queued message. */
  draft(sid: Sid): string;
  /** Unused: the store's drain sends, so a draft in the field is never touched. */
  send?(sid: Sid, text: string): void;
  restore(sid: Sid, text: string): void;
  /** The store whose turn ends drain the queue of a chat no composer shows; the app's own by default. */
  store?: QueueStore;
}

/** The slice of the assistant store the background drain reads and drives. */
export interface QueueStore {
  state: {
    sessions: Record<
      string,
      { turn: Parameters<typeof isRunning>[0]; composer: { text: string } } | undefined
    >;
  };
  setDraft(sid: Sid, patch: { text: string }): void;
  resend(sid: Sid, snapshot: ComposerSnapshot, input: "typed"): Promise<unknown>;
}

export interface ComposerQueue {
  queued: ComputedRef<QueuedMessage | null>;
  /** Holds one message until the answer ends; false when one already waits. */
  enqueue(text: string): boolean;
  /** Puts the queued text in the field; a draft there becomes the queued message. */
  edit(): void;
}

/** The message waiting in a chat, if any. */
export function queuedOf(sid: Sid | null): QueuedMessage | null {
  return sid ? (queues.get(sid) ?? null) : null;
}

/** Removes and returns a chat's queued message; only one caller ever gets it. */
export function takeQueued(sid: Sid): QueuedMessage | null {
  const item = queues.get(sid) ?? null;
  queues.delete(sid);
  return item;
}

/** One plain-chat message queued while an answer runs; it sends when the answer ends. */
export function useComposerQueue(options: ComposerQueueOptions): ComposerQueue {
  const queued = computed(() => queuedOf(options.sid()));

  function enqueue(text: string): boolean {
    const sid = options.sid();
    if (!sid || !text.trim() || queues.has(sid)) return false;
    queues.set(sid, { text, at: Date.now() });
    return true;
  }

  // Never joins the two: with a draft in the field the queued text and the draft swap places.
  function edit(): void {
    const sid = options.sid();
    const item = sid ? takeQueued(sid) : null;
    if (!sid || !item) return;
    const draft = options.draft(sid);
    if (draft.trim()) queues.set(sid, { text: draft, at: Date.now() });
    options.restore(sid, item.text);
  }

  installQueueDrain(options.store ?? useAssistantStore());
  return { queued, enqueue, edit };
}

/** Sends or hands back each queued message whose chat's turn ended, whichever chat is on screen. */
export function installQueueDrain(store: QueueStore): void {
  if (drain?.store === store) return;
  drain?.scope.stop();
  const scope = effectScope(true);
  drain = { store, scope };
  scope.run(() =>
    watch(
      () => [...queues.keys()].filter((sid) => endedTurn(store, sid)),
      (ended) => ended.forEach((sid) => drainOne(store, sid)),
      { flush: "post", immediate: true },
    ),
  );
}

/** Lets a spec start with no queued messages; never called by app code. */
export function resetComposerQueueForTests(): void {
  queues.clear();
  drain?.scope.stop();
  drain = null;
}

// A chat this store no longer holds keeps its message until it is opened again.
function endedTurn(store: QueueStore, sid: string): boolean {
  const session = store.state.sessions[sid];
  return !!session && !isRunning(session.turn);
}

function drainOne(store: QueueStore, sid: Sid): void {
  const session = store.state.sessions[sid];
  if (!session || isRunning(session.turn)) return;
  const draft = session.composer.text;
  // A draft typed since stays where it is; the queued message goes as its own prompt.
  if (session.turn.state === "done") {
    const item = takeQueued(sid);
    if (item) void store.resend(sid, snapshotOf(item.text), "typed");
    return;
  }
  // An answer that did not finish hands the message back only into an empty field; else Edit swaps them.
  if (draft.trim()) return;
  const item = takeQueued(sid);
  if (item) store.setDraft(sid, { text: item.text });
}

function snapshotOf(text: string): ComposerSnapshot {
  return { text, chips: [], images: [], mentions: [], timeOverride: null };
}
