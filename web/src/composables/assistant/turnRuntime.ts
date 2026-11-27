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

import type { Sid } from "./assistantStore.types";

/** The transport handles of one running turn; never reactive (constraint 65). */
export interface TurnRuntimeEntry<T> {
  controller: AbortController;
  /** The silence watch: the 30 s stall line and, with a tail, the 20 s reconnect. */
  keepaliveTimer?: ReturnType<typeof setTimeout>;
  /** The 3 s stop timeout, or the close of a `done` stream left open; never both, and an approval's TTL is the engine's. */
  expiryTimer?: ReturnType<typeof setTimeout>;
  /** One tail per chat per browser tab at a time (`00` §14). */
  tailLock?: Promise<unknown>;
  turn: T;
}

export interface TurnRuntime<T> {
  get(sid: Sid): TurnRuntimeEntry<T> | undefined;
  set(sid: Sid, entry: TurnRuntimeEntry<T>): TurnRuntimeEntry<T>;
  /** Clears the entry's timers and forgets it; never aborts. */
  delete(sid: Sid): void;
  /** HA restore of a browser-only chat: the entry moves, it is never duplicated (constraint 7). */
  rename(oldSid: Sid, newSid: Sid): void;
  /** Swaps in a fresh controller for the next request of the same turn and aborts the old one. */
  renew(sid: Sid): AbortController | null;
  abort(sid: Sid, reason?: string): void;
  abortAll(reason: string): Sid[];
}

/** Keyed by the sid captured before the request, so cleanup never follows a session switch (constraint 7). */
export function createTurnRuntime<T>(): TurnRuntime<T> {
  const entries = new Map<Sid, TurnRuntimeEntry<T>>();
  const clearTimers = (entry: TurnRuntimeEntry<T>) => {
    clearTimeout(entry.keepaliveTimer);
    clearTimeout(entry.expiryTimer);
    entry.keepaliveTimer = undefined;
    entry.expiryTimer = undefined;
  };
  const runtime: TurnRuntime<T> = {
    get: (sid) => entries.get(sid),
    set(sid, entry) {
      const previous = entries.get(sid);
      if (previous && previous !== entry) clearTimers(previous);
      entries.set(sid, entry);
      return entry;
    },
    delete(sid) {
      const entry = entries.get(sid);
      if (entry) clearTimers(entry);
      entries.delete(sid);
    },
    rename(oldSid, newSid) {
      const entry = entries.get(oldSid);
      if (!entry || oldSid === newSid) return;
      entries.delete(oldSid);
      entries.set(newSid, entry);
    },
    renew(sid) {
      const entry = entries.get(sid);
      if (!entry) return null;
      entry.controller.abort("superseded");
      entry.controller = new AbortController();
      return entry.controller;
    },
    abort(sid, reason = "stop") {
      const entry = entries.get(sid);
      if (!entry) return;
      entry.controller.abort(reason);
    },
    abortAll(reason) {
      const sids = [...entries.keys()];
      for (const sid of sids) runtime.abort(sid, reason);
      return sids;
    },
  };
  return runtime;
}
