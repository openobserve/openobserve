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

/**
 * The metrics explorer's preview-query scheduler.
 *
 * A 2,000-metric org must never fire 2,000 queries. Only cards inside (or within
 * one viewport of) the scroll window enqueue work, at most `concurrency` run at
 * once, and everything else queues. Scroll-away, filter changes and dialog
 * closes cancel in-flight work rather than letting it land on a card nobody is
 * looking at.
 *
 * Results are cached on the fully-resolved query string, so a ⚙ function
 * override — which changes that string — naturally invalidates just that
 * metric's preview, with no separate invalidation bookkeeping.
 */

/** Fixed, so perf runs are reproducible. */
export const PREVIEW_CONCURRENCY = 6;

/** Bounded, cleared on org switch. */
export const PREVIEW_CACHE_SIZE = 200;

/** Cache TTL when auto-refresh is off. */
export const DEFAULT_CACHE_TTL_MS = 60_000;

/** Dialog tiles outrank background grid work while the dialog is open. */
export const PRIORITY = { DIALOG: 0, VISIBLE: 1, PREFETCH: 2 };

interface CacheEntry {
  value: any;
  expiresAt: number;
}

/** One caller waiting on a job. Several owners can share a single request. */
interface Waiter {
  owner: string;
  resolve: (v: any) => void;
  reject: (e: any) => void;
}

interface PendingJob {
  key: string;
  priority: number;
  run: (signal: AbortSignal) => Promise<any>;
  controller: AbortController;
  /**
   * Everyone awaiting this key.
   *
   * The queue dedupes by key, so two cards whose effective variants generate the
   * SAME PromQL share one request. That makes a key a poor identity for a
   * *card*: an unscoped `cancel(key)` would abort a request another, still
   * visible, card is waiting on, and that card would hang on its skeleton
   * forever. So cancellation is per-owner — the job is aborted only once the
   * last owner has let go.
   */
  waiters: Waiter[];
  /** Whether this job's result may enter the LRU. */
  cache: boolean;

  /**
   * Set the moment the job is settled — by completion OR by cancellation.
   *
   * Cancellation must not depend on the job function honouring its signal: a
   * non-abortable promise would otherwise never settle, so the caller would
   * hang forever and the concurrency slot would leak, eventually deadlocking
   * the queue. So `cancel` settles the job itself and this flag makes the
   * (possibly much later) real completion a no-op.
   */
  settled: boolean;
}

export interface RunOptions {
  /** Who wants this result. Only this owner's interest is dropped by `cancel`. */
  owner?: string;
  /**
   * Whether the response belongs in the LRU. Default true.
   *
   * `false` for work that is scheduled here for the CONCURRENCY LIMIT and the
   * cancellation, but whose result is not chart data — label values, say. The LRU
   * is sized for chart results; letting anything else in means a fan-out evicts
   * the charts a user is looking at.
   */
  cache?: boolean;
  /**
   * Bypass the cached ANSWER, but still cache the new one. Default false.
   *
   * This is what a refresh means, and it is not `cache: false` — that one also
   * refuses to store the result, so the next card to ask the same question would
   * re-fetch it too.
   */
  refresh?: boolean;
}

export interface PreviewQueue {
  run<T>(
    key: string,
    priority: number,
    fn: (signal: AbortSignal) => Promise<T>,
    /** An owner string, or the full options bag. */
    opts?: string | RunOptions,
  ): Promise<T>;
  /** Drops one owner's interest; aborts the request only if nobody else wants it. */
  cancel(key: string, owner?: string): void;
  cancelAll(): void;
  /** Drop one cached response, so the next request for it really runs. */
  invalidate(key: string): void;
  clearCache(): void;
  setTtl(ms: number): void;
  readonly inFlight: number;
  readonly queued: number;
}

/** Thrown when a job is cancelled. Callers ignore these rather than showing an error. */
export class PreviewCancelledError extends Error {
  constructor(key: string) {
    super(`preview cancelled: ${key}`);
    this.name = "PreviewCancelledError";
  }
}

export function isCancelled(error: any): boolean {
  return (
    error instanceof PreviewCancelledError ||
    error?.name === "PreviewCancelledError" ||
    error?.name === "CanceledError" || // axios
    error?.name === "AbortError" ||
    error?.code === "ERR_CANCELED"
  );
}

export function createPreviewQueue(
  concurrency: number = PREVIEW_CONCURRENCY,
): PreviewQueue {
  const cache = new Map<string, CacheEntry>();
  const waiting: PendingJob[] = [];
  const active = new Map<string, PendingJob>();
  let ttlMs = DEFAULT_CACHE_TTL_MS;

  const cacheGet = (key: string): CacheEntry | undefined => {
    const hit = cache.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
      cache.delete(key);
      return undefined;
    }
    // Refresh LRU recency.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  };

  const cacheSet = (key: string, value: any) => {
    cache.set(key, { value, expiresAt: Date.now() + ttlMs });
    while (cache.size > PREVIEW_CACHE_SIZE) {
      // Map preserves insertion order, so the first key is the least recently used.
      const oldest = cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  };

  /** Settles a job as cancelled and frees its slot immediately. */
  const abandon = (job: PendingJob) => {
    if (job.settled) return;
    job.settled = true;
    job.controller.abort();
    active.delete(job.key);
    for (const waiter of job.waiters) {
      waiter.reject(new PreviewCancelledError(job.key));
    }
    job.waiters = [];
  };

  const settle = (job: PendingJob, fn: (w: Waiter) => void) => {
    if (job.settled) return false;
    job.settled = true;
    active.delete(job.key);
    for (const waiter of job.waiters) fn(waiter);
    job.waiters = [];
    return true;
  };

  const pump = () => {
    while (active.size < concurrency && waiting.length > 0) {
      waiting.sort((a, b) => a.priority - b.priority);
      const job = waiting.shift()!;
      active.set(job.key, job);

      // `run` is caller-supplied and typed to return a promise, but nothing
      // stops it throwing SYNCHRONOUSLY before it ever gets that far — building
      // the query rejects an invalid label name, for one. Called bare, that
      // throw escapes pump() entirely: the job is already in `active`, and
      // neither handler below is attached yet, so `settle` never runs and the
      // slot is never given back. `concurrency` such throws and the queue is
      // wedged for the rest of the session — no card ever loads a preview again.
      //
      // Caught here rather than by dispatching through `Promise.resolve()`,
      // which would also work but would make `run` start a microtask late. It
      // starts synchronously today, and callers rely on that: cancelling a job
      // that has not been dispatched yet is a different code path from
      // cancelling one in flight.
      let running: Promise<any>;
      try {
        running = job.run(job.controller.signal);
      } catch (error) {
        // The slot is handed back by `settle`, so the loop simply moves on to
        // the next job — no need to re-enter `pump`.
        settle(job, (w) => w.reject(error));
        continue;
      }

      Promise.resolve(running)
        .then((value) => {
          // Already cancelled: this result belongs to a filter/time state the
          // user has left, so it must neither resolve anyone nor populate the
          // cache.
          if (job.settled) return;
          if (job.cache) cacheSet(job.key, value);
          settle(job, (w) => w.resolve(value));
          pump();
        })
        .catch((error) => {
          if (job.settled) return;
          const failure = job.controller.signal.aborted
            ? new PreviewCancelledError(job.key)
            : error;
          settle(job, (w) => w.reject(failure));
          pump();
        });
    }
  };

  /** Attaches a waiter to an existing job and hands back its promise. */
  const attach = <T>(job: PendingJob, owner: string) =>
    new Promise<T>((resolve, reject) => {
      job.waiters.push({ owner, resolve, reject });
    });

  /**
   * Drops `owner`'s waiter. Returns true when nobody is left waiting, so the
   * caller can abandon the job.
   */
  const dropWaiter = (job: PendingJob, owner: string): boolean => {
    const index = job.waiters.findIndex((w) => w.owner === owner);
    if (index >= 0) {
      const [waiter] = job.waiters.splice(index, 1);
      waiter.reject(new PreviewCancelledError(job.key));
    }
    return job.waiters.length === 0;
  };

  let anonymousOwner = 0;

  return {
    run<T>(
      key: string,
      priority: number,
      fn: (signal: AbortSignal) => Promise<T>,
      opts?: string | RunOptions,
    ) {
      const { owner, cache = true, refresh = false }: RunOptions =
        typeof opts === "string" ? { owner: opts } : (opts ?? {});

      if (cache && !refresh) {
        const cached = cacheGet(key);
        if (cached) return Promise.resolve(cached.value as T);
      }

      const ownerId = owner ?? `anon:${++anonymousOwner}`;

      // Same key already running or queued: join it rather than issuing a second
      // identical request.
      // Whoever joins, the STRICTEST intent wins: if any participant says this
      // result does not belong in the LRU, it does not go in. The one caller that
      // passes `cache: false` does it to keep label-value strings out of a cache
      // sized for chart results.
      const join = <U>(job: PendingJob): Promise<U> => {
        job.cache = job.cache && cache;
        return attach<U>(job, ownerId);
      };

      const running = active.get(key);
      if (running) return join<T>(running);

      const pending = waiting.find((j) => j.key === key);
      if (pending) {
        // Re-prioritize: a queued prefetch that becomes visible should jump.
        pending.priority = Math.min(pending.priority, priority);
        return join<T>(pending);
      }

      return new Promise<T>((resolve, reject) => {
        waiting.push({
          key,
          priority,
          run: fn,
          cache,
          controller: new AbortController(),
          waiters: [{ owner: ownerId, resolve, reject }],
          settled: false,
        });
        pump();
      });
    },

    cancel(key: string, owner?: string) {
      const running = active.get(key);
      if (running) {
        // With no owner given, cancel outright (time/filter change semantics).
        if (!owner || dropWaiter(running, owner)) {
          abandon(running);
          pump(); // the freed slot goes to whatever is queued behind it
        }
      }

      const index = waiting.findIndex((j) => j.key === key);
      if (index >= 0) {
        const job = waiting[index];
        if (!owner || dropWaiter(job, owner)) {
          waiting.splice(index, 1);
          job.settled = true;
          for (const waiter of job.waiters) {
            waiter.reject(new PreviewCancelledError(key));
          }
          job.waiters = [];
        }
      }
    },

    cancelAll() {
      for (const job of [...active.values()]) abandon(job);
      const queued = waiting.splice(0, waiting.length);
      for (const job of queued) {
        job.settled = true;
        for (const waiter of job.waiters) {
          waiter.reject(new PreviewCancelledError(job.key));
        }
        job.waiters = [];
      }
    },

    invalidate(key: string) {
      cache.delete(key);
    },

    clearCache() {
      cache.clear();
    },

    setTtl(ms: number) {
      ttlMs = Math.max(1000, ms || DEFAULT_CACHE_TTL_MS);
    },

    get inFlight() {
      return active.size;
    },
    get queued() {
      return waiting.length;
    },
  };
}
