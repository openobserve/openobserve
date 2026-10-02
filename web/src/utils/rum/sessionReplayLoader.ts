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

export type SegmentStatus = "missing" | "inFlight" | "stored" | "fetchedMissing" | "skipped";

export type SkipReason = "network" | "missing" | "parse";

/** Per-segment loader state, indexed by manifest position. */
export interface LoaderState {
  status: SegmentStatus[];
  missingCount: number[];
  skipReason: (SkipReason | null)[];
}

export interface RetryOptions {
  isCancelled: () => boolean;
  onRetry?: (attempt: number) => void;
  delays?: number[];
  wait?: (ms: number) => Promise<void>;
}

export interface ActivityTimer {
  touch: () => void;
  clear: () => void;
}

export const SEGMENT_BATCH = 25;
export const MAX_ATTEMPTS = 3;
export const RETRY_DELAYS_MS = [1000, 2000];
export const MAX_MISSING_REQUEUES = 2;
export const FIRST_BYTE_TIMEOUT_MS = 90_000;
export const IDLE_TIMEOUT_MS = 30_000;
// Parquet file not found, SQL execute error, cancelled, timed out, rate limited (infra/src/errors/mod.rs).
const TRANSIENT_SEARCH_CODES = new Set([20006, 20008, 20009, 20010, 20012]);

const defaultWait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createLoaderState(count: number): LoaderState {
  return {
    status: new Array<SegmentStatus>(count).fill("missing"),
    missingCount: new Array<number>(count).fill(0),
    skipReason: new Array<SkipReason | null>(count).fill(null),
  };
}

/** Adds `count` missing segments at the end, for manifest rows a live poll appended. */
export function extendLoaderState(state: LoaderState, count: number): void {
  for (let i = 0; i < count; i++) {
    state.status.push("missing");
    state.missingCount.push(0);
    state.skipReason.push(null);
  }
}

/** Skipped and capped segments are never fetchable, which is what stops the watchdog looping. */
export function isFetchable(state: LoaderState, index: number): boolean {
  const status = state.status[index];
  return status === "missing" || status === "fetchedMissing";
}

export function markInFlight(state: LoaderState, indexes: number[]): void {
  for (const i of indexes) state.status[i] = "inFlight";
}

export function markStored(state: LoaderState, index: number): void {
  state.status[index] = "stored";
  state.skipReason[index] = null;
}

export function markSkipped(state: LoaderState, index: number, reason: SkipReason): void {
  state.status[index] = "skipped";
  state.skipReason[index] = reason;
}

// A successful batch that did not return a segment re-queues it, at most twice, then gives up on it.
export function settleBatch(state: LoaderState, indexes: number[]): void {
  for (const i of indexes) {
    if (state.status[i] !== "inFlight") continue;
    state.missingCount[i]++;
    if (state.missingCount[i] > MAX_MISSING_REQUEUES) markSkipped(state, i, "missing");
    else state.status[i] = "fetchedMissing";
  }
}

export function failBatch(state: LoaderState, indexes: number[]): void {
  for (const i of indexes) {
    if (state.status[i] === "inFlight") markSkipped(state, i, "network");
  }
}

/** Indexes the player may take next: every one in order until the first segment still outstanding. */
export function appendableIndexes(state: LoaderState, appendedThroughIndex: number): number[] {
  const out: number[] = [];
  for (let i = appendedThroughIndex + 1; i < state.status.length; i++) {
    const status = state.status[i];
    if (status !== "stored" && status !== "skipped") break;
    out.push(i);
  }
  return out;
}

export function isSettled(state: LoaderState): boolean {
  return state.status.every((s) => s === "stored" || s === "skipped");
}

export function networkSkippedIndexes(state: LoaderState): number[] {
  const out: number[] = [];
  state.skipReason.forEach((reason, i) => {
    if (reason === "network" && state.status[i] === "skipped") out.push(i);
  });
  return out;
}

// A parse failure is never retried; only segments lost to the network go back on the queue.
export function requeueNetworkSkips(state: LoaderState): number[] {
  const indexes = networkSkippedIndexes(state);
  for (const i of indexes) {
    state.status[i] = "missing";
    state.missingCount[i] = 0;
    state.skipReason[i] = null;
  }
  return indexes;
}

/** An error carrying the HTTP status or code, so the retry policy can classify it. */
export function createQueryError(message: string, status?: number, code?: string): Error {
  return Object.assign(new Error(message), { status, code });
}

// Only failures that can succeed on a second try are retried; a bad query or a missing permission never will.
export function isRetryableError(error: any): boolean {
  if (error?.code === "timeout") return true;
  const status = errorStatus(error);
  if (status !== undefined) return status >= 500 || status === 429 || status === 401;
  return !isPermanentSearchCode(error?.code);
}

// The caller's cancel check runs after every wait, so leaving the page stops the retries too.
export async function withRetries<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const delays = options.delays ?? RETRY_DELAYS_MS;
  const wait = options.wait ?? defaultWait;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= delays.length + 1 || !isRetryableError(error)) throw error;
      await wait(delays[attempt - 1]);
      if (options.isCancelled()) throw error;
      options.onRetry?.(attempt + 1);
    }
  }
}

// A stream can stay open without sending anything, so a request with no first byte or a long silence is given up.
export function createActivityTimer(
  onTimeout: () => void,
  firstByteMs = FIRST_BYTE_TIMEOUT_MS,
  idleMs = IDLE_TIMEOUT_MS,
): ActivityTimer {
  let handle: ReturnType<typeof setTimeout> | null = setTimeout(onTimeout, firstByteMs);
  return {
    touch() {
      if (handle === null) return;
      clearTimeout(handle);
      handle = setTimeout(onTimeout, idleMs);
    },
    clear() {
      if (handle !== null) clearTimeout(handle);
      handle = null;
    },
  };
}

// Search error codes 20xxx that describe the query itself; cancel, timeout, rate limit and execution errors can pass next time.
function isPermanentSearchCode(code: unknown): boolean {
  const value = Number(code);
  if (!Number.isInteger(value) || value < 20000 || value >= 30000) return false;
  return !TRANSIENT_SEARCH_CODES.has(value);
}

function errorStatus(error: any): number | undefined {
  const status = error?.status ?? error?.response?.status;
  return typeof status === "number" && status > 0 ? status : undefined;
}
