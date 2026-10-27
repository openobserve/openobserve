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

import { reactive } from "vue";

import type { Sid } from "./assistantStore.types";

export const POLL_FAST_MS = 4_000;
export const POLL_SLOW_MS = 15_000;
export const POLL_FAST_FOR_MS = 60_000;
export const POLL_STOP_MS = 10 * 60_000;
/** Without Web Locks, a chat followed by hints alone is released when no hint has spoken for this long. */
export const HINT_STALE_MS = 150_000;

/** How this tab follows a turn another tab or device runs. */
export interface ElsewhereView {
  /** `stalled`: ten minutes of polling, so it stopped and asks for a Refresh. */
  mode: "tail" | "polling" | "stalled" | "hint";
  approval: boolean;
  turnId: string | null;
}

export interface ElsewhereDeps {
  now(): number;
  hidden(): boolean;
  onVisibility(cb: () => void): () => void;
  locks: Pick<LockManager, "request"> | null;
  /** One incremental read of the chat; `"gone"` when the server no longer has it. */
  poll(sid: Sid): Promise<{ running: boolean; approval: boolean; turnId: string | null } | "gone">;
  /** The server's resumable tail for the lock holder; absent on today's server. */
  tail?(sid: Sid, signal: AbortSignal): Promise<void>;
  ended(sid: Sid): void;
  /** The chat was deleted while this tab followed it. */
  gone?(sid: Sid): void;
}

interface Watcher {
  startedAt: number;
  timer?: ReturnType<typeof setTimeout>;
  polls: boolean;
  release?: () => void;
  requesting?: boolean;
  inFlight: boolean;
  readAt: number;
}

export interface Elsewhere {
  views: Readonly<Record<Sid, ElsewhereView>>;
  /** `polls: false` follows a browser-only chat by hints and the turn lock alone. */
  start(sid: Sid, view: Omit<ElsewhereView, "mode">, opts?: { polls?: boolean }): void;
  stop(sid: Sid): void;
  refresh(sid: Sid): void;
  /** Whether this tab holds the chat's tail lock, for tests and the one-tail rule. */
  holdsTail(sid: Sid): boolean;
  dispose(): void;
}

/** Polls at 4 s, 15 s after a minute, never while hidden, and stops loudly at ten minutes; one tail per chat per browser. */
export function createElsewhere(deps: ElsewhereDeps): Elsewhere {
  const views = reactive<Record<Sid, ElsewhereView>>({});
  const watchers = new Map<Sid, Watcher>();

  const schedule = (sid: Sid) => {
    const watcher = watchers.get(sid);
    if (!watcher || !watcher.polls || deps.hidden()) return;
    clearTimeout(watcher.timer);
    const age = deps.now() - watcher.startedAt;
    if (age >= POLL_STOP_MS) {
      if (views[sid]) views[sid].mode = "stalled";
      watcher.release?.();
      return;
    }
    watcher.timer = setTimeout(() => void tick(sid), delayOf(watcher));
  };

  const delayOf = (watcher: Watcher) =>
    deps.now() - watcher.startedAt < POLL_FAST_FOR_MS ? POLL_FAST_MS : POLL_SLOW_MS;

  // Hints alone and no turn lock to wait on: every hint re-arms it, so a tab that died never keeps Send locked.
  const armStale = (sid: Sid) => {
    const watcher = watchers.get(sid);
    if (!watcher || watcher.polls || deps.locks) return;
    clearTimeout(watcher.timer);
    watcher.timer = setTimeout(() => {
      if (watchers.get(sid) !== watcher) return;
      stop(sid);
      deps.ended(sid);
    }, HINT_STALE_MS);
  };

  const tick = async (sid: Sid) => {
    const watcher = watchers.get(sid);
    if (!watcher || watcher.inFlight) return;
    watcher.inFlight = true;
    watcher.readAt = deps.now();
    let result: Awaited<ReturnType<ElsewhereDeps["poll"]>> | null = null;
    try {
      result = await deps.poll(sid);
    } catch {
      result = null;
    }
    watcher.inFlight = false;
    if (watchers.get(sid) !== watcher) return;
    if (result === "gone") {
      stop(sid);
      deps.gone?.(sid);
      return;
    }
    if (result && !result.running) {
      stop(sid);
      deps.ended(sid);
      return;
    }
    if (result && views[sid]) {
      views[sid].approval = result.approval;
      views[sid].turnId = result.turnId ?? views[sid].turnId;
    }
    takeTail(sid);
    schedule(sid);
  };

  // Only a free lock is taken, so a hidden holder hands over and two tabs never both tail.
  const takeTail = (sid: Sid) => {
    const watcher = watchers.get(sid);
    if (!deps.locks || !watcher || watcher.release || watcher.requesting || deps.hidden()) return;
    watcher.requesting = true;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    void deps.locks
      .request(`o2-assistant-tail:${sid}`, { ifAvailable: true }, async (lock) => {
        watcher.requesting = false;
        if (!lock || watchers.get(sid) !== watcher) return;
        const controller = new AbortController();
        watcher.release = () => {
          controller.abort();
          watcher.release = undefined;
          release();
        };
        if (deps.tail && views[sid]) {
          views[sid].mode = "tail";
          void deps.tail(sid, controller.signal).catch(() => undefined);
        }
        await held;
      })
      .catch(() => {
        watcher.requesting = false;
      });
  };

  const stop = (sid: Sid) => {
    const watcher = watchers.get(sid);
    if (watcher) {
      clearTimeout(watcher.timer);
      watcher.release?.();
    }
    watchers.delete(sid);
    delete views[sid];
  };

  // A tab coming back reads at once only when its back-off is due; a stopped watcher waits for Refresh.
  const offVisibility = deps.onVisibility(() => {
    for (const [sid, watcher] of watchers) {
      if (!watcher.polls) continue;
      if (deps.hidden()) {
        clearTimeout(watcher.timer);
        watcher.release?.();
        if (deps.tail && views[sid]?.mode === "tail") views[sid].mode = "polling";
      } else if (views[sid]?.mode !== "stalled") {
        if (deps.now() - watcher.readAt >= delayOf(watcher)) void tick(sid);
        else schedule(sid);
      }
    }
  });

  return {
    views,
    start(sid, view, opts = {}) {
      const polls = opts.polls ?? true;
      const known = watchers.get(sid);
      if (known && views[sid]) {
        views[sid].approval = view.approval;
        views[sid].turnId = view.turnId ?? views[sid].turnId;
        armStale(sid);
        return;
      }
      watchers.set(sid, { startedAt: deps.now(), polls, inFlight: false, readAt: 0 });
      views[sid] = { ...view, mode: polls ? "polling" : "hint" };
      takeTail(sid);
      schedule(sid);
      armStale(sid);
    },
    stop,
    refresh(sid) {
      const watcher = watchers.get(sid);
      if (!watcher) return;
      watcher.startedAt = deps.now();
      if (views[sid]?.mode === "stalled") views[sid].mode = "polling";
      void tick(sid);
    },
    holdsTail: (sid) => !!watchers.get(sid)?.release,
    dispose() {
      offVisibility();
      for (const sid of [...watchers.keys()]) stop(sid);
    },
  };
}
