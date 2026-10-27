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

import { ref, type Ref } from "vue";

import type { ComposerState, Sid } from "./assistantStore.types";

export const DRAFT_DEBOUNCE_MS = 250;

const DRAFT_PREFIX = "o2.assistant.draft:";

/** What survives a reload; images stay in memory, only their count is kept for the notice (`00` §10.4). */
export type DraftPayload = Pick<
  ComposerState,
  "text" | "chips" | "timeOverride" | "removedPageKeys"
> & {
  imageCount?: number;
};

export interface DraftStoreOptions {
  /** Defaults to `window.sessionStorage`; a throwing getter models a blocked store. */
  storage?: () => Storage | null;
  delayMs?: number;
}

export interface DraftStore {
  /** Debounced write of one chat's draft for this tab. */
  schedule(userOrgKey: string, sid: Sid, draft: DraftPayload): void;
  flush(): void;
  read(userOrgKey: string, sid: Sid): DraftPayload | null;
  remove(userOrgKey: string, sid: Sid): void;
  /** Sign-out: every draft of the user+org, in storage and in memory. */
  clearAllForUser(userOrgKey: string): void;
  /** True once a write failed; the composer shows `assistant.client.storageBlocked` once. */
  readonly storageBlocked: Ref<boolean>;
}

export function draftKey(userOrgKey: string, sid: Sid): string {
  return `${DRAFT_PREFIX}${userOrgKey}:${sid}`;
}

export function createDraftStore(options: DraftStoreOptions = {}): DraftStore {
  const delayMs = options.delayMs ?? DRAFT_DEBOUNCE_MS;
  const storageBlocked = ref(false);
  // In-memory fallback for blocked storage (private mode), so the draft still follows the session in this tab.
  const memory = new Map<string, DraftPayload>();
  const pending = new Map<string, { draft: DraftPayload; timer: ReturnType<typeof setTimeout> }>();

  const storage = (): Storage | null => {
    try {
      return options.storage ? options.storage() : window.sessionStorage;
    } catch {
      return null;
    }
  };

  const write = (key: string, draft: DraftPayload) => {
    memory.set(key, draft);
    try {
      const store = storage();
      if (!store) throw new Error("storage unavailable");
      if (isEmpty(draft)) store.removeItem(key);
      else store.setItem(key, JSON.stringify(draft));
    } catch {
      storageBlocked.value = true;
      // A stored copy older than `memory` would win on read, so a failed write drops it.
      try {
        storage()?.removeItem(key);
      } catch {
        // Storage is unreachable; there is no stale copy to read either.
      }
    }
  };

  const cancel = (key: string) => {
    const entry = pending.get(key);
    if (entry) clearTimeout(entry.timer);
    pending.delete(key);
  };

  return {
    storageBlocked,
    schedule(userOrgKey, sid, draft) {
      const key = draftKey(userOrgKey, sid);
      cancel(key);
      const snapshot = toPayload(draft);
      const timer = setTimeout(() => {
        pending.delete(key);
        write(key, snapshot);
      }, delayMs);
      pending.set(key, { draft: snapshot, timer });
    },
    flush() {
      for (const [key, entry] of [...pending]) {
        cancel(key);
        write(key, entry.draft);
      }
    },
    read(userOrgKey, sid) {
      const key = draftKey(userOrgKey, sid);
      const queued = pending.get(key)?.draft;
      if (queued) return queued;
      try {
        const value = storage()?.getItem(key);
        if (value) return toPayload(JSON.parse(value) as DraftPayload);
      } catch {
        // A blocked or corrupt entry falls back to this tab's memory.
      }
      return memory.get(key) ?? null;
    },
    remove(userOrgKey, sid) {
      const key = draftKey(userOrgKey, sid);
      cancel(key);
      memory.delete(key);
      try {
        storage()?.removeItem(key);
      } catch {
        // Nothing was stored.
      }
    },
    clearAllForUser(userOrgKey) {
      const prefix = `${DRAFT_PREFIX}${userOrgKey}:`;
      for (const key of [...pending.keys(), ...memory.keys()]) {
        if (!key.startsWith(prefix)) continue;
        cancel(key);
        memory.delete(key);
      }
      try {
        const store = storage();
        if (!store) return;
        const keys = Array.from({ length: store.length }, (_, i) => store.key(i));
        for (const key of keys) if (key?.startsWith(prefix)) store.removeItem(key);
      } catch {
        // Nothing was stored.
      }
    },
  };
}

function toPayload(draft: DraftPayload): DraftPayload {
  return {
    text: typeof draft.text === "string" ? draft.text : "",
    chips: Array.isArray(draft.chips) ? draft.chips.map((chip) => ({ ...chip })) : [],
    timeOverride: draft.timeOverride ? { ...draft.timeOverride } : null,
    removedPageKeys: Array.isArray(draft.removedPageKeys) ? [...draft.removedPageKeys] : [],
    ...(typeof draft.imageCount === "number" &&
      draft.imageCount > 0 && { imageCount: draft.imageCount }),
  };
}

function isEmpty(draft: DraftPayload): boolean {
  return (
    !draft.text &&
    draft.chips.length === 0 &&
    !draft.timeOverride &&
    draft.removedPageKeys.length === 0 &&
    !draft.imageCount
  );
}
