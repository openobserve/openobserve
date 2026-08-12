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
 * useDbmCountCache — the sibling-tab badge counts, fetched once per window.
 *
 * The six DBM views are separate ROUTES, so every tab switch is a full remount
 * and each page independently re-fetches all five or six badge counts. Six
 * switches cost ~30 count requests for numbers that have not moved. And a count
 * is not cheap: measured live, `/activity` costs 1880ms for the full read and
 * 1739ms for `?size=1` — the price is the SCAN (dbm_server holds 2.77M
 * irrelevant rows beside ~22K DBM records), not the rows returned, so there is
 * no cheaper count to fetch instead. Every badge pays close to full price.
 *
 * ## Keyed on the window, not on a clock
 *
 * There is no TTL here on purpose. A TTL caches stale truth — it hands back a
 * number that may genuinely have changed and hopes the interval was short
 * enough. The claim this cache makes is narrower and actually true: the SAME
 * window over the SAME org is the same question, so it has the same answer.
 * When the reader moves the window the key changes and everything refetches;
 * that is the design working, not a miss.
 *
 * ## Why the RANGE and not the resolved bounds
 *
 * `useDbmScope.refresh()` re-pins `anchor` to `Date.now()` at the top of every
 * `load()`, so a relative window's resolved microsecond bounds are DIFFERENT on
 * every single load — verified: two `refresh()` calls 5ms apart produce
 * different `endTime`s. A key built from `current.startTime/endTime` would
 * therefore never hit once, and the cache would be dead code that still looked
 * correct. The key is the `DbmRange` — the thing the reader actually chose —
 * which is stable across loads for a relative period and already pinned for an
 * absolute one.
 *
 * ## What it stores
 *
 * Whole fetched VALUES, opaque to this module. The badges are not plain
 * numbers: capped endpoints produce a `DbmCountClaim` (`{count, complete}`) so
 * the badge can render `65+` rather than `65`. Storing the object rather than a
 * number is what keeps the `+` alive across a hit — a cache that remembered
 * only the total would drop the truncation flag silently, and the number would
 * still look right.
 *
 * ## What it refuses to store
 *
 * Failures. A rejection is re-thrown to the caller and nothing is written, so
 * the next reader gets a real attempt. Caching a failure as a value — and
 * especially as `0` — would turn "we could not count" into "there are none",
 * which is the lie `Promise.allSettled` was introduced to avoid.
 *
 * ## The request-sequence guard is untouched
 *
 * This cache never decides what a page renders; it only decides whether a fetch
 * goes out. Call sites still `begin()`/`current()` a token and still check
 * `isStale(token)` before writing, exactly as before — a cached value returns
 * through the same await and hits the same staleness check. Because the key
 * includes the window, a hit can only ever be a value for the window the caller
 * asked about, so the cache cannot hand back a superseded window's numbers.
 */

import type { DbmRange } from "@/composables/dbm/useDbmScope";

/**
 * The identity of a count read: which page, which org, over which window.
 *
 * Relative and absolute are tagged distinctly so a `1h` period and an absolute
 * range that happens to span an hour never collide — the first slides with the
 * clock and the second does not, so they are different questions.
 *
 * **`scope` is not decoration.** Each page's fetcher returns its OWN shape, and
 * the shapes are not the same: Table health also carries `blockingSamples` for
 * the high-impact-blocker rule, which no other page fetches. Keyed on org and
 * window alone, six pages shared one entry, so whichever loaded first decided
 * what the others got — land on Deadlocks, switch to Table health, and it read
 * `badges.blockingSamples` as `undefined` and threw
 * `samples is not iterable` out of `chainsFromSamples`.
 *
 * Scoping per page keeps the win (a tab switch still costs nothing on a repeat
 * visit) while making a cross-shape hit impossible rather than merely unlikely.
 */
export const countCacheKey = (scope: string, org: string, range: DbmRange): string =>
  range.type === "absolute"
    ? `${scope}|${org}|abs|${range.startTime}|${range.endTime}`
    : `${scope}|${org}|rel|${range.relativeTimePeriod ?? ""}`;

export interface DbmCountReadOptions {
  /** Skip the cached value and refetch. What a refresh button passes. */
  force?: boolean;
}

/**
 * Some badges in the fan-out could not be read.
 *
 * The pages fetch their badges with `Promise.allSettled` so one dead endpoint
 * blanks ONE badge instead of abandoning the other four. But `allSettled` never
 * rejects, so without this the cache would happily store a fan-out in which
 * every badge failed and serve those blanks to every later tab switch on the
 * window — remembering "we could not count" as if it were the count.
 *
 * So a page throws this instead: the cache stores nothing (a rejection is never
 * remembered), and the page catches it and still renders the partial result it
 * carries. Failures are shown but not cached; the next reader gets a real
 * attempt.
 */
export class DbmPartialCounts<T = unknown> extends Error {
  constructor(readonly badges: T) {
    super("dbm: at least one badge count failed");
    this.name = "DbmPartialCounts";
  }
}

/**
 * The badges to render from a cached read that may have partly failed.
 *
 * `DbmPartialCounts` carries the partial result so the page can still paint the
 * badges it did get; anything else is a real failure and paints nothing. Shared
 * because all six pages need exactly this recovery, and a `.catch` written out
 * per page is six chances to accidentally swallow a genuine error.
 */
export const badgesFrom = async <T>(read: Promise<T>): Promise<T | null> =>
  read.catch((err: unknown) => (err instanceof DbmPartialCounts ? (err.badges as T) : null));

export interface DbmCountCache {
  /**
   * The counts for this org and window, fetching only if they are not already
   * held. Concurrent callers for one key share a single request.
   */
  read: <T>(
    org: string,
    range: DbmRange,
    fetcher: () => Promise<T>,
    options?: DbmCountReadOptions,
  ) => Promise<T>;
  /** What is held for this key, without fetching. `undefined` if nothing is. */
  peek: <T>(org: string, range: DbmRange) => T | undefined;
  /** Drop everything. */
  clear: () => void;
}

/**
 * Module scope, deliberately: the tabs are separate ROUTES, so component state
 * dies on every switch and only a module-level binding survives the remount —
 * verified, not assumed. A plain `Map` rather than a `ref` because nothing
 * renders the cache itself; pages copy values into their own reactive refs.
 */
const settled = new Map<string, unknown>();

/** Requests currently in flight, so two pages mounting together fetch once. */
const inFlight = new Map<string, Promise<unknown>>();

/**
 * @param scope which page's badge set this is. Required, and required to be
 * distinct per page: see `countCacheKey` for the crash that a shared key
 * produced. Passing the same scope from two pages with different payload
 * shapes reintroduces it.
 */
export function useDbmCountCache(scope: string): DbmCountCache {
  const read = async <T>(
    org: string,
    range: DbmRange,
    fetcher: () => Promise<T>,
    options: DbmCountReadOptions = {},
  ): Promise<T> => {
    const key = countCacheKey(scope, org, range);

    if (!options.force) {
      if (settled.has(key)) return settled.get(key) as T;
      const pending = inFlight.get(key);
      if (pending) return pending as Promise<T>;
    }

    const request = fetcher()
      .then((value) => {
        // Only a SUCCESS is remembered. A forced read overwrites, so the value
        // a refresh superseded can never be served to the next tab switch.
        settled.set(key, value);
        return value;
      })
      .finally(() => {
        // Cleared on both paths, so a rejection leaves nothing behind at all —
        // not a value, not a zero, not a poisoned promise.
        if (inFlight.get(key) === request) inFlight.delete(key);
      });

    inFlight.set(key, request);
    return request;
  };

  const peek = <T>(org: string, range: DbmRange): T | undefined =>
    settled.get(countCacheKey(scope, org, range)) as T | undefined;

  const clear = () => {
    settled.clear();
    inFlight.clear();
  };

  return { read, peek, clear };
}
