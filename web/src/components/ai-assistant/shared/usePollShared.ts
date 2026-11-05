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

import { onScopeDispose, ref, watch, type Ref } from "vue";

import type { SharedChat } from "@/services/ai_chat_share";

/** How the shared page follows its source chat. */
export interface PollState {
  status: "idle" | "live" | "running" | "backoff" | "offline" | "rateLimited" | "stopped";
  intervalMs: number | null;
  /** Epoch ms of the newest committed turn; moves only when the share's content does. */
  lastChangeAt: number | null;
  /** Epoch ms the shown content was read. */
  loadedAt: number | null;
  /** Epoch ms the running turn started. */
  runningSince: number | null;
  retryInSecs: number | null;
  /** Counts real changes after the first read, so the page announces each once. */
  changes: number;
}

export interface PollResult {
  data?: SharedChat;
  error?: unknown;
}

export interface PollDeps {
  refetch(): Promise<PollResult>;
  now?(): number;
  /** Injected for tests; the page reads `document`. */
  hidden?(): boolean;
}

const RUNNING_MS = 5_000;
const LIVE_MS = 30_000;
const BACKOFF_MS = 60_000;
const BACKOFF_AFTER = 10;
const MAX_RETRY_AFTER_MS = 3_600_000;

/** Polls a live share (30 s, 5 s while a turn runs, 60 s after 10 quiet reads); snapshots never poll. */
export function usePollShared(
  query: Ref<SharedChat | undefined>,
  deps: PollDeps,
): { state: Ref<PollState>; pollNow: () => Promise<void> } {
  const now = deps.now ?? (() => Date.now());
  const hidden = deps.hidden ?? (() => typeof document !== "undefined" && document.hidden);
  const state = ref<PollState>(initialState());
  let timer: ReturnType<typeof setTimeout> | undefined;
  let quiet = 0;
  let failures = 0;
  let version: string | null = null;
  let stopped = false;
  let disposed = false;
  let inFlight = false;
  let lastRequestAt = 0;
  // A 429 or an error back-off holds across a hidden tab, so coming back can't jump the queue.
  let notBefore = 0;

  const arm = (ms: number) => {
    clearTimeout(timer);
    timer = undefined;
    if (stopped || disposed || hidden()) return;
    timer = setTimeout(() => void poll(), ms);
  };

  const schedule = (ms: number | null) => {
    state.value.intervalMs = ms;
    if (ms === null) {
      clearTimeout(timer);
      timer = undefined;
      return;
    }
    const delay = Math.max(RUNNING_MS, ms);
    arm(delay);
  };

  const poll = async () => {
    timer = undefined;
    if (inFlight || disposed) return;
    inFlight = true;
    lastRequestAt = now();
    try {
      const result = await deps.refetch();
      if (disposed || stopped) return;
      if (result.error) onError(result.error);
      else if (result.data) onData(result.data, true);
    } finally {
      inFlight = false;
    }
  };

  const onData = (chat: SharedChat, polled: boolean) => {
    const next = chat.state_version ?? String(chat.seq);
    const changed = version !== null && next !== version;
    if (changed) state.value.changes += 1;
    quiet = changed || !polled ? 0 : quiet + 1;
    failures = 0;
    notBefore = 0;
    version = next;
    state.value.loadedAt = now();
    state.value.retryInSecs = null;
    state.value.lastChangeAt = lastCommitted(chat) ?? state.value.lastChangeAt;
    state.value.runningSince = chat.active_turn ? runningSince(chat) : null;
    state.value.status = statusFor(chat, quiet);
    schedule(intervalFor(chat, quiet));
  };

  const onError = (error: unknown) => {
    const status = statusOf(error);
    if (status === 403 || status === 404) {
      stopped = true;
      state.value.status = "stopped";
      schedule(null);
      return;
    }
    if (status === 429) {
      const secs = retryAfterSecs(error);
      state.value.status = "rateLimited";
      state.value.retryInSecs = secs;
      notBefore = now() + secs * 1000;
      state.value.intervalMs = secs * 1000;
      arm(secs * 1000);
      return;
    }
    failures += 1;
    state.value.status = "offline";
    const base = Math.max(RUNNING_MS, state.value.intervalMs ?? LIVE_MS);
    const delay = Math.min(BACKOFF_MS, base * 2 ** failures);
    notBefore = now() + delay;
    arm(delay);
  };

  // A hidden tab reads nothing; coming back reads once the floor and any back-off allow it.
  const onVisibility = () => {
    if (hidden()) {
      clearTimeout(timer);
      timer = undefined;
      return;
    }
    if (stopped || state.value.intervalMs === null) return;
    const at = Math.max(lastRequestAt + RUNNING_MS, notBefore);
    arm(Math.max(0, at - now()));
  };

  watch(
    query,
    (chat, previous) => {
      if (chat && !previous) onData(chat, false);
    },
    { immediate: true },
  );

  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
  onScopeDispose(() => {
    disposed = true;
    clearTimeout(timer);
    if (typeof document !== "undefined")
      document.removeEventListener("visibilitychange", onVisibility);
  });

  // A reader's Retry goes through the poll, so its answer updates the notices like any read.
  const pollNow = async () => {
    stopped = false;
    clearTimeout(timer);
    await poll();
  };

  return { state, pollNow };
}

/** `created` of the newest turn that finished, in epoch ms; turns carry microseconds. */
export function lastCommitted(chat: SharedChat): number | null {
  const turns = chat.turns ?? [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (turn.status !== "running" && typeof turn.created === "number") return turn.created / 1000;
  }
  return null;
}

function initialState(): PollState {
  return {
    status: "idle",
    intervalMs: null,
    lastChangeAt: null,
    loadedAt: null,
    runningSince: null,
    retryInSecs: null,
    changes: 0,
  };
}

function intervalFor(chat: SharedChat, quiet: number): number | null {
  if (chat.mode !== "live") return null;
  if (chat.active_turn) return RUNNING_MS;
  return quiet >= BACKOFF_AFTER ? BACKOFF_MS : LIVE_MS;
}

function statusFor(chat: SharedChat, quiet: number): PollState["status"] {
  if (chat.mode !== "live") return "idle";
  if (chat.active_turn) return "running";
  return quiet >= BACKOFF_AFTER ? "backoff" : "live";
}

function runningSince(chat: SharedChat): number | null {
  const turn = chat.turns?.[chat.turns.length - 1];
  return turn?.status === "running" && typeof turn.created === "number"
    ? turn.created / 1000
    : null;
}

function statusOf(error: unknown): number | undefined {
  const e = error as { status?: number; response?: { status?: number } } | null;
  return e?.response?.status ?? e?.status;
}

// `Retry-After` wins over the body's `retry_after`; anything unreadable waits a minute.
function retryAfterSecs(error: unknown): number {
  const response = (
    error as { response?: { headers?: Record<string, unknown>; data?: { retry_after?: unknown } } }
  )?.response;
  const raw = response?.headers?.["retry-after"] ?? response?.data?.retry_after;
  const secs = Number(raw);
  if (!Number.isFinite(secs) || secs <= 0) return BACKOFF_MS / 1000;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(RUNNING_MS, Math.ceil(secs) * 1000)) / 1000;
}
