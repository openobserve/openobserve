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
 * The shared tab-badge cache, tested by CALLING it.
 *
 * This module is pure-ish — a Map plus a key function — so it needs no page and
 * no mount. The page WIRING is pinned separately by source-read in
 * dbmCountCache.spec.ts, the convention dbmRequestGuard.spec.ts established.
 *
 * Fixtures are deliberately materially different from each other: distinct
 * periods, distinct orgs, distinct counts, distinct truncation flags. A suite
 * built on one fixture cannot tell a real cache from a hard-coded lookup, which
 * is the stub that survived five times this session.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  countCacheKey,
  DbmPartialCounts,
  useDbmCountCache,
} from "@/composables/dbm/useDbmCountCache";
import type { DbmRange } from "@/composables/dbm/useDbmScope";

const relative = (period: string): DbmRange => ({
  type: "relative",
  relativeTimePeriod: period,
  startTime: 0,
  endTime: 0,
});

const absolute = (startTime: number, endTime: number): DbmRange => ({
  type: "absolute",
  relativeTimePeriod: null,
  startTime,
  endTime,
});

describe("countCacheKey — what makes two reads the same read", () => {
  /**
   * The whole design rests on this. `useDbmScope.refresh()` re-pins `anchor` to
   * `Date.now()` at the top of every `load()`, so a relative window's resolved
   * microsecond bounds differ on EVERY load. Keying on those bounds would give a
   * cache that never hits — measured: two `refresh()` calls 5ms apart produce
   * different `endTime`s. The key is therefore the range the READER chose.
   */
  it("gives one relative period a stable key across repeated loads", () => {
    expect(countCacheKey("acme", relative("1h"))).toBe(countCacheKey("acme", relative("1h")));
  });

  it("separates different relative periods", () => {
    expect(countCacheKey("acme", relative("1h"))).not.toBe(countCacheKey("acme", relative("24h")));
  });

  it("separates different absolute windows", () => {
    expect(countCacheKey("acme", absolute(1000, 2000))).not.toBe(
      countCacheKey("acme", absolute(1000, 3000)),
    );
  });

  /** Two orgs' badge counts are different numbers about different databases. */
  it("separates organisations on an otherwise identical window", () => {
    expect(countCacheKey("acme", relative("1h"))).not.toBe(countCacheKey("globex", relative("1h")));
  });

  /**
   * A relative `1h` and an absolute range that happens to be an hour long are
   * not the same question: the absolute one is pinned, the relative one slides.
   */
  it("separates a relative period from an absolute range", () => {
    expect(countCacheKey("acme", relative("1h"))).not.toBe(countCacheKey("acme", absolute(0, 1)));
  });
});

describe("useDbmCountCache — a tab switch must fire nothing", () => {
  beforeEach(() => {
    useDbmCountCache().clear();
  });

  it("calls the fetcher once and serves the second reader from cache", async () => {
    const cache = useDbmCountCache();
    const fetcher = vi.fn().mockResolvedValue({ deadlocks: 12 });

    const first = await cache.read("acme", relative("1h"), fetcher);
    const second = await cache.read("acme", relative("1h"), fetcher);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ deadlocks: 12 });
    expect(second).toEqual({ deadlocks: 12 });
  });

  /**
   * Materially different values per key: a hard-coded lookup returning one
   * canned object would pass a same-value suite and fail this one.
   */
  it("keeps different windows' counts apart", async () => {
    const cache = useDbmCountCache();
    const hourly = vi.fn().mockResolvedValue({ deadlocks: 12 });
    const daily = vi.fn().mockResolvedValue({ deadlocks: 907 });

    expect(await cache.read("acme", relative("1h"), hourly)).toEqual({ deadlocks: 12 });
    expect(await cache.read("acme", relative("24h"), daily)).toEqual({ deadlocks: 907 });
    // …and both are still individually cached, not overwritten by the other.
    expect(await cache.read("acme", relative("1h"), hourly)).toEqual({ deadlocks: 12 });
    expect(await cache.read("acme", relative("24h"), daily)).toEqual({ deadlocks: 907 });
    expect(hourly).toHaveBeenCalledTimes(1);
    expect(daily).toHaveBeenCalledTimes(1);
  });

  it("refetches when the window changes", async () => {
    const cache = useDbmCountCache();
    const fetcher = vi.fn().mockResolvedValueOnce({ n: 1 }).mockResolvedValueOnce({ n: 2 });

    await cache.read("acme", relative("1h"), fetcher);
    await cache.read("acme", relative("6h"), fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  /**
   * REQUIREMENT 3. A refresh button is the reader saying "the numbers may have
   * moved" — the one case where same-window-means-same-data is not a fact.
   */
  it("bypasses the cache on an explicit refresh, and re-seeds it", async () => {
    const cache = useDbmCountCache();
    const fetcher = vi.fn().mockResolvedValueOnce({ n: 1 }).mockResolvedValueOnce({ n: 2 });

    expect(await cache.read("acme", relative("1h"), fetcher)).toEqual({ n: 1 });
    expect(await cache.read("acme", relative("1h"), fetcher, { force: true })).toEqual({ n: 2 });
    expect(fetcher).toHaveBeenCalledTimes(2);

    // The forced read replaces the entry rather than merely skipping it — the
    // next tab switch must not serve the value the refresh superseded.
    expect(await cache.read("acme", relative("1h"), fetcher)).toEqual({ n: 2 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  /**
   * REQUIREMENT 4. A rejection must not be remembered — not as a value, and
   * emphatically not as zero. The next reader must get a real attempt.
   */
  it("does not cache a failure, and lets the next read retry", async () => {
    const cache = useDbmCountCache();
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("500"))
      .mockResolvedValueOnce({ deadlocks: 65 });

    await expect(cache.read("acme", relative("1h"), fetcher)).rejects.toThrow("500");
    expect(await cache.read("acme", relative("1h"), fetcher)).toEqual({ deadlocks: 65 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("remembers a failure as nothing at all, never as zero", async () => {
    const cache = useDbmCountCache();
    const fetcher = vi.fn().mockRejectedValue(new Error("500"));

    await expect(cache.read("acme", relative("1h"), fetcher)).rejects.toThrow("500");

    expect(cache.peek("acme", relative("1h"))).toBeUndefined();
  });

  /**
   * REQUIREMENT 5. The badge renders `65+` from `{count, complete:false}`. A
   * cache that kept only the number would silently drop the `+` on every hit
   * after the first — the honesty regression is invisible precisely because the
   * number is still right.
   */
  it("preserves the truncation flag through a cache hit", async () => {
    const cache = useDbmCountCache();
    const capped = { deadlockCount: { count: 65, complete: false } };
    const fetcher = vi.fn().mockResolvedValue(capped);

    await cache.read("acme", relative("1h"), fetcher);
    const hit = await cache.read("acme", relative("1h"), fetcher);

    expect(hit).toEqual({ deadlockCount: { count: 65, complete: false } });
    expect((hit as typeof capped).deadlockCount.complete).toBe(false);
  });

  /** A complete count must not come back claiming to be capped either. */
  it("preserves a complete claim as complete", async () => {
    const cache = useDbmCountCache();
    const fetcher = vi.fn().mockResolvedValue({ blockedCount: { count: 7, complete: true } });

    await cache.read("acme", relative("1h"), fetcher);
    const hit = await cache.read("acme", relative("1h"), fetcher);

    expect(hit).toEqual({ blockedCount: { count: 7, complete: true } });
  });

  /**
   * REQUIREMENT 2. Two pages mounting in the same tick must not both fetch —
   * that is the exact scenario the cache exists for, and a naive
   * check-then-fetch cache would miss it because neither has resolved yet.
   */
  it("shares one in-flight request between simultaneous readers", async () => {
    const cache = useDbmCountCache();
    let resolve: (v: unknown) => void = () => {};
    const fetcher = vi.fn().mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );

    const a = cache.read("acme", relative("1h"), fetcher);
    const b = cache.read("acme", relative("1h"), fetcher);
    resolve({ n: 5 });

    expect(await a).toEqual({ n: 5 });
    expect(await b).toEqual({ n: 5 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  /** A shared in-flight failure must not be cached by either reader. */
  it("does not cache a shared in-flight failure", async () => {
    const cache = useDbmCountCache();
    const fetcher = vi.fn().mockRejectedValue(new Error("boom"));

    const a = cache.read("acme", relative("1h"), fetcher);
    const b = cache.read("acme", relative("1h"), fetcher);
    await expect(a).rejects.toThrow("boom");
    await expect(b).rejects.toThrow("boom");

    expect(cache.peek("acme", relative("1h"))).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  /**
   * The measured claim in the brief: six tab switches over one window fire the
   * count fan-out ONCE, not six times.
   */
  it("fires one fan-out across six tab visits on one window", async () => {
    const cache = useDbmCountCache();
    const fetcher = vi.fn().mockResolvedValue({ deadlockCount: { count: 3, complete: true } });

    for (let visit = 0; visit < 6; visit += 1) {
      await cache.read("acme", relative("1h"), fetcher);
    }

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  /**
   * A partly-failed fan-out must not be cached, but its partial result must
   * still be available to render. `Promise.allSettled` never rejects, so
   * without this the blanks would be stored and served for the whole window.
   */
  it("does not cache a partial fan-out, but hands the partial back", async () => {
    const cache = useDbmCountCache();
    const partial = { deadlockCount: { count: 4, complete: true }, blockedCount: null };
    // `mockRejectedValue`, not `…Once`: the point is that the SECOND read also
    // fetches, so the mock has to answer twice. With `…Once` the second call
    // returned undefined and the failure was the fixture's, not the cache's.
    const fetcher = vi.fn().mockRejectedValue(new DbmPartialCounts(partial));

    await expect(cache.read("acme", relative("1h"), fetcher)).rejects.toBeInstanceOf(
      DbmPartialCounts,
    );
    await expect(cache.read("acme", relative("1h"), fetcher)).rejects.toMatchObject({
      badges: partial,
    });

    // Nothing was stored, so the next reader fetches rather than inheriting
    // the blank badge.
    expect(cache.peek("acme", relative("1h"))).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  /** State really is shared module-wide — two call sites, one cache. */
  it("serves a value one composable instance stored to another instance", async () => {
    const fetcher = vi.fn().mockResolvedValue({ n: 9 });

    await useDbmCountCache().read("acme", relative("1h"), fetcher);
    expect(await useDbmCountCache().read("acme", relative("1h"), fetcher)).toEqual({ n: 9 });

    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
