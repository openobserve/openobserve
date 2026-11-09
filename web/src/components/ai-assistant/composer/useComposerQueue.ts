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

import { computed, reactive, watch, type ComputedRef } from "vue";

import type { Sid } from "@/composables/assistant";

// Keyed by chat, so a container move or a second composer on the same chat sees one queue.
const queues = reactive(new Map<string, QueuedMessage>());

export interface QueuedMessage {
  text: string;
  at: number;
}

export interface ComposerQueueOptions {
  sid(): Sid | null;
  /** The chat's answer is streaming or waiting to start. */
  running(): boolean;
  /** The answer ended well, so the queued message goes; anything else hands it back. */
  endedDone(): boolean;
  /** The draft as typed since queuing; only an empty one lets the queued message send by itself. */
  draft(sid: Sid): string;
  send(sid: Sid, text: string): void;
  restore(sid: Sid, text: string): void;
}

export interface ComposerQueue {
  queued: ComputedRef<QueuedMessage | null>;
  /** Holds one message until the answer ends; false when one already waits. */
  enqueue(text: string): boolean;
  /** Puts the queued text back in front of the draft. */
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

/** Joins the queued text and what was typed after it, queued first. */
export function mergeQueued(queued: string, draft: string): string {
  return draft.trim() ? `${queued}\n${draft}` : queued;
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

  function edit(): void {
    const sid = options.sid();
    const item = sid ? takeQueued(sid) : null;
    if (sid && item) options.restore(sid, mergeQueued(item.text, options.draft(sid)));
  }

  watch(
    () => options.running(),
    (running, was) => {
      const sid = options.sid();
      if (running || !was || !sid) return;
      const item = takeQueued(sid);
      if (!item) return;
      const draft = options.draft(sid);
      if (options.endedDone() && !draft.trim()) options.send(sid, item.text);
      else options.restore(sid, mergeQueued(item.text, draft));
    },
  );

  return { queued, enqueue, edit };
}

/** Lets a spec start with no queued messages; never called by app code. */
export function resetComposerQueueForTests(): void {
  queues.clear();
}
