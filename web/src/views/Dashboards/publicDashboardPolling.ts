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

/** How often an open, visible page re-checks the link, so a pause, revoke or edit reaches it within a minute. */
export const LIFECYCLE_MS = 60_000;
const LIFECYCLE_JITTER = 0.1;
/** How long after fresh_until a read lands, so the server already sees the result stale. */
export const STALE_GRACE_MS = 1_000;
/** Spreads the reads that open pages aim at fresh_until, so a wall screen's browsers don't arrive at once. */
export const STALE_SPREAD_MS = 5_000;
/** The floor of the server's Retry-After hint while a refresh runs. */
export const REFRESH_POLL_MIN_MS = 3_000;
/** Waits for a failure that names no Retry-After. */
export const BACKOFF_MS = [5_000, 10_000, 30_000, 60_000];
/** setTimeout fires at once past this many ms (about 24.8 days), so longer waits are chunked. */
export const MAX_TIMER_MS = 2_147_483_647;

type Headers = Record<string, unknown> | null | undefined;

const header = (headers: Headers, name: string): string | null => {
  const value = headers?.[name];
  return value === null || value === undefined ? null : String(value);
};

/** Server clock minus local clock, read from the response's Date header; 0 without one. */
export function clockOffsetMs(headers: Headers, localNowMs: number): number {
  const serverNow = Date.parse(header(headers, "date") ?? "");
  return Number.isNaN(serverNow) ? 0 : serverNow - localNowMs;
}

/** Retry-After as a wait in ms: delta-seconds, or an HTTP date read against the server's clock. */
export function retryAfterMs(
  headers: Headers,
  offsetMs: number,
  localNowMs: number,
): number | null {
  const value = header(headers, "retry-after")?.trim();
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - (localNowMs + offsetMs));
}

/** A server time in UTC micros as a local epoch ms, corrected for clock skew. */
export function toLocalMs(serverMicros: unknown, offsetMs: number): number | null {
  return typeof serverMicros === "number" ? serverMicros / 1000 - offsetMs : null;
}

/** Runs `fn` after `ms`, chaining timers past the setTimeout limit; returns a cancel function. */
export function setLongTimeout(fn: () => void, ms: number): () => void {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const arm = (left: number) => {
    handle = setTimeout(
      () => (left > MAX_TIMER_MS ? arm(left - MAX_TIMER_MS) : fn()),
      Math.min(left, MAX_TIMER_MS),
    );
  };
  arm(Math.max(0, ms));
  return () => clearTimeout(handle);
}

/** What one read of /data told the poller. Times are local epoch ms. */
export type PollOutcome =
  /** 200 or 304. `hintMs` is the server's Retry-After while a refresh runs; `freshForMs` the wait until fresh_until. */
  | { kind: "body"; refreshing: boolean; hintMs: number | null; freshForMs?: number | null }
  /** 202, 503 or 429. `client` marks a limit on this viewer rather than on one range. */
  | { kind: "wait"; retryAfterMs: number | null; client?: boolean }
  | { kind: "error" }
  | { kind: "final" };

export interface PollerOptions {
  check: () => Promise<PollOutcome>;
  isHidden: () => boolean;
  now?: () => number;
  random?: () => number;
}

export interface Poller {
  /** Reads at once (a new range or the first load), honouring a pending per-viewer Retry-After. */
  start: () => void;
  /** The page became visible: read at once unless a Retry-After still holds. */
  visible: () => void;
  /** The page was hidden: nothing is read until it is visible again. */
  hidden: () => void;
  stop: () => void;
}

/** The two cadences of 4.7: a lifecycle check while visible, and the server's hint while a refresh runs. */
export function createPoller(options: PollerOptions): Poller {
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  let cancel: (() => void) | null = null;
  // Each read takes a generation; an answer from an older one is dropped.
  let generation = 0;
  let failures = 0;
  let notBefore = 0;
  let clientHold = false;
  let stopped = true;

  const clear = () => {
    cancel?.();
    cancel = null;
  };

  const backoff = () => {
    failures += 1;
    return BACKOFF_MS[Math.min(failures, BACKOFF_MS.length) - 1];
  };

  const delayFor = (outcome: PollOutcome): number | null => {
    if (outcome.kind === "final") return null;
    if (outcome.kind === "error") return backoff();
    if (outcome.kind === "wait") {
      if (outcome.retryAfterMs === null) return backoff();
      failures = 0;
      return outcome.retryAfterMs;
    }
    failures = 0;
    // Jitter only shortens the lifecycle check, so it stays at most a minute.
    const lifecycle = LIFECYCLE_MS * (1 - LIFECYCLE_JITTER * random());
    if (!outcome.refreshing) {
      // The read after fresh_until starts the next build, so it must not wait out a whole lifecycle tick.
      const fresh = outcome.freshForMs;
      return fresh !== null && fresh !== undefined && fresh > 0
        ? Math.min(lifecycle, fresh + STALE_GRACE_MS + STALE_SPREAD_MS * random())
        : lifecycle;
    }
    // The server already jitters its hint; a slow build's long hint still yields to the lifecycle check.
    return Math.min(Math.max(REFRESH_POLL_MIN_MS, outcome.hintMs ?? 0), lifecycle);
  };

  const schedule = (ms: number) => {
    clear();
    if (stopped || options.isHidden()) return;
    cancel = setLongTimeout(run, ms);
  };

  async function run() {
    cancel = null;
    if (stopped || options.isHidden()) return;
    const current = ++generation;
    let outcome: PollOutcome;
    try {
      outcome = await options.check();
    } catch {
      outcome = { kind: "error" };
    }
    if (current !== generation || stopped) return;
    const delay = delayFor(outcome);
    if (delay === null) {
      stopped = true;
      clear();
      return;
    }
    const waits = outcome.kind === "wait" && outcome.retryAfterMs !== null;
    notBefore = waits ? now() + delay : 0;
    clientHold = waits && outcome.kind === "wait" && !!outcome.client;
    schedule(delay);
  }

  const readNowOrAtHold = () => {
    const wait = notBefore - now();
    if (wait > 0) schedule(wait);
    else void run();
  };

  return {
    start() {
      stopped = false;
      generation += 1;
      failures = 0;
      clear();
      // A per-range wait belongs to the range left behind; a per-viewer limit still holds.
      if (!clientHold) notBefore = 0;
      readNowOrAtHold();
    },
    visible() {
      if (stopped) return;
      clear();
      readNowOrAtHold();
    },
    hidden() {
      clear();
    },
    stop() {
      stopped = true;
      generation += 1;
      clear();
    },
  };
}
