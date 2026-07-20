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

import { describe, it, expect, vi } from "vitest";
import {
  createPreviewQueue,
  isCancelled,
  PREVIEW_CACHE_SIZE,
  PRIORITY,
} from "./useMetricsPreviewQueue";
import { hasSamples, isAllNaN } from "./useMetricsExplorerGrid";

/** Asserts a promise rejects with a cancellation, whatever its concrete shape. */
async function expectCancelled(promise: Promise<any>) {
  const error = await promise.then(
    () => {
      throw new Error("expected the job to be cancelled, but it resolved");
    },
    (e) => e,
  );
  expect(isCancelled(error)).toBe(true);
}

/** A job that resolves only when you tell it to. */
function deferred<T = any>() {
  let resolve!: (v: T) => void;
  let reject!: (e: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("preview queue", () => {
  it("never exceeds the concurrency cap", async () => {
    const queue = createPreviewQueue(6);
    const gates = Array.from({ length: 20 }, () => deferred());
    let running = 0;
    let peak = 0;

    const jobs = gates.map((gate, i) =>
      queue.run(`k${i}`, PRIORITY.VISIBLE, async () => {
        running += 1;
        peak = Math.max(peak, running);
        const value = await gate.promise;
        running -= 1;
        return value;
      }),
    );

    // Let the first wave start.
    await Promise.resolve();
    expect(queue.inFlight).toBe(6);
    expect(queue.queued).toBe(14);

    gates.forEach((g, i) => g.resolve(i));
    await Promise.all(jobs);

    // 2,000 metrics must never mean 2,000 concurrent queries.
    expect(peak).toBeLessThanOrEqual(6);
  });

  it("runs higher-priority work first", async () => {
    const queue = createPreviewQueue(1);
    const order: string[] = [];
    const first = deferred();

    const blocker = queue.run("blocker", PRIORITY.VISIBLE, async () => {
      await first.promise;
      order.push("blocker");
    });
    // Enqueued while the slot is busy, so both wait.
    const prefetch = queue.run("prefetch", PRIORITY.PREFETCH, async () => {
      order.push("prefetch");
    });
    const dialog = queue.run("dialog", PRIORITY.DIALOG, async () => {
      order.push("dialog");
    });

    first.resolve(null);
    await Promise.all([blocker, prefetch, dialog]);

    // The dialog tile outranks background grid work.
    expect(order).toEqual(["blocker", "dialog", "prefetch"]);
  });

  it("serves a repeat key from cache without re-requesting", async () => {
    const queue = createPreviewQueue();
    const fn = vi.fn().mockResolvedValue("value");

    expect(await queue.run("k", PRIORITY.VISIBLE, fn)).toBe("value");
    expect(await queue.run("k", PRIORITY.VISIBLE, fn)).toBe("value");

    // Browsing back and forth must not re-query.
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("shares one in-flight request between duplicate keys", async () => {
    const queue = createPreviewQueue();
    const gate = deferred<string>();
    const fn = vi.fn().mockReturnValue(gate.promise);

    const a = queue.run("k", PRIORITY.VISIBLE, fn);
    const b = queue.run("k", PRIORITY.VISIBLE, fn);
    gate.resolve("v");

    expect(await a).toBe("v");
    expect(await b).toBe("v");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("aborts an in-flight job on cancel", async () => {
    const queue = createPreviewQueue();
    let seen: AbortSignal | null = null;

    const job = queue.run("k", PRIORITY.VISIBLE, (signal) => {
      seen = signal;
      return new Promise(() => {}); // never settles on its own
    });
    await Promise.resolve();

    queue.cancel("k");
    expect(seen!.aborted).toBe(true);
    await expectCancelled(job);
  });

  it("rejects a queued job on cancel without ever running it", async () => {
    const queue = createPreviewQueue(1);
    const gate = deferred();
    const blocker = queue.run("blocker", PRIORITY.VISIBLE, () => gate.promise);

    const fn = vi.fn().mockResolvedValue("v");
    const queued = queue.run("scrolled-away", PRIORITY.VISIBLE, fn);
    await Promise.resolve();

    queue.cancel("scrolled-away");
    await expectCancelled(queued);

    gate.resolve(null);
    await blocker;
    expect(fn).not.toHaveBeenCalled();
  });

  it("does not cache the result of a job cancelled mid-flight", async () => {
    // A late result belongs to a filter/time state the user has already left.
    const queue = createPreviewQueue();
    const gate = deferred<string>();
    const fn = vi.fn().mockReturnValue(gate.promise);

    const job = queue.run("k", PRIORITY.VISIBLE, fn);
    await Promise.resolve();
    queue.cancel("k");
    gate.resolve("stale");

    await expectCancelled(job);

    const fresh = vi.fn().mockResolvedValue("fresh");
    expect(await queue.run("k", PRIORITY.VISIBLE, fresh)).toBe("fresh");
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it("cancelAll clears both active and queued work", async () => {
    const queue = createPreviewQueue(2);
    const jobs = Array.from({ length: 5 }, (_, i) =>
      queue.run(`k${i}`, PRIORITY.VISIBLE, () => new Promise(() => {})),
    );
    await Promise.resolve();

    queue.cancelAll();
    for (const job of jobs) await expectCancelled(job);
    expect(queue.queued).toBe(0);
  });

  it("evicts least-recently-used entries beyond the cache bound", async () => {
    const queue = createPreviewQueue();
    for (let i = 0; i < PREVIEW_CACHE_SIZE + 1; i++) {
      await queue.run(`k${i}`, PRIORITY.VISIBLE, async () => i);
    }

    // k0 was the first inserted and never re-read, so it is gone.
    const refetch = vi.fn().mockResolvedValue("refetched");
    expect(await queue.run("k0", PRIORITY.VISIBLE, refetch)).toBe("refetched");
    expect(refetch).toHaveBeenCalledTimes(1);

    // The most recent entry is still cached.
    const notCalled = vi.fn().mockResolvedValue("x");
    await queue.run(`k${PREVIEW_CACHE_SIZE}`, PRIORITY.VISIBLE, notCalled);
    expect(notCalled).not.toHaveBeenCalled();
  });

  it("expires cache entries after the TTL", async () => {
    // Date.now is stubbed rather than using fake timers: the queue is driven by
    // promises, and faking the timer machinery here just stalls them.
    const now = vi.spyOn(Date, "now");
    try {
      now.mockReturnValue(1_000_000);

      const queue = createPreviewQueue();
      queue.setTtl(5_000);

      const fn = vi.fn().mockResolvedValue("v");
      await queue.run("k", PRIORITY.VISIBLE, fn);

      // Still inside the TTL.
      now.mockReturnValue(1_004_999);
      await queue.run("k", PRIORITY.VISIBLE, fn);
      expect(fn).toHaveBeenCalledTimes(1);

      // Past it.
      now.mockReturnValue(1_005_001);
      await queue.run("k", PRIORITY.VISIBLE, fn);
      expect(fn).toHaveBeenCalledTimes(2);
    } finally {
      now.mockRestore();
    }
  });

  it("propagates a genuine error unchanged", async () => {
    const queue = createPreviewQueue();
    const boom = new Error("429 Too Many Requests");
    const job = queue.run("k", PRIORITY.VISIBLE, () => Promise.reject(boom));

    await expect(job).rejects.toBe(boom);
    expect(isCancelled(boom)).toBe(false);
  });

  it("recognizes axios and DOM cancellation shapes", () => {
    expect(isCancelled({ name: "CanceledError" })).toBe(true);
    expect(isCancelled({ code: "ERR_CANCELED" })).toBe(true);
    expect(isCancelled({ name: "AbortError" })).toBe(true);
    expect(isCancelled(new Error("network down"))).toBe(false);
  });

  it("one failing job never blocks the others", async () => {
    const queue = createPreviewQueue(2);
    const results = await Promise.allSettled([
      queue.run("bad", PRIORITY.VISIBLE, () => Promise.reject(new Error("x"))),
      queue.run("good", PRIORITY.VISIBLE, async () => "ok"),
    ]);
    expect(results[0].status).toBe("rejected");
    expect(results[1]).toMatchObject({ status: "fulfilled", value: "ok" });
  });
});


describe("all-NaN detection", () => {
  const matrix = (values: any[][]) => ({
    resultType: "matrix",
    result: [{ metric: {}, values }],
  });

  it("flags a populated series whose samples are all NaN", () => {
    expect(isAllNaN(matrix([[1, "NaN"], [2, "NaN"]]))).toBe(true);
  });

  it("does not flag a genuinely empty result", () => {
    // No samples at all is "no data", not "underflowed to NaN" — conflating the
    // two would send us re-querying every empty metric.
    expect(isAllNaN({ resultType: "matrix", result: [] })).toBe(false);
    expect(isAllNaN(matrix([]))).toBe(false);
  });

  it("does not flag a series with even one real sample", () => {
    expect(isAllNaN(matrix([[1, "NaN"], [2, "0.5"]]))).toBe(false);
    expect(isAllNaN(matrix([[1, "0"]]))).toBe(false);
  });
});

describe("owner-scoped cancellation", () => {
  const DIALOG = "dialog-owner";

  it("does NOT abort a shared job while another owner still wants it", async () => {
    // Two cards can generate the same PromQL (an ExponentialHistogram X_bucket
    // fallback and its X_count sibling both emit sum(rate(X_count[W]))), so they
    // share one request. Card A scrolling away must not kill card B's chart.
    const queue = createPreviewQueue();
    const gate = deferred<string>();
    const fn = vi.fn().mockReturnValue(gate.promise);

    const a = queue.run("shared", PRIORITY.VISIBLE, fn, "cardA");
    const b = queue.run("shared", PRIORITY.VISIBLE, fn, "cardB");
    await Promise.resolve();

    queue.cancel("shared", "cardA");
    await expectCancelled(a);

    gate.resolve("value");
    expect(await b).toBe("value"); // B still gets its data
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("aborts the job once the LAST owner lets go", async () => {
    const queue = createPreviewQueue();
    let signal: AbortSignal | null = null;

    const a = queue.run(
      "shared",
      PRIORITY.VISIBLE,
      (s) => {
        signal = s;
        return new Promise<string>(() => {});
      },
      "cardA",
    );
    const b = queue.run(
      "shared",
      PRIORITY.VISIBLE,
      () => new Promise<string>(() => {}),
      "cardB",
    );
    await Promise.resolve();

    queue.cancel("shared", "cardA");
    expect(signal!.aborted).toBe(false); // B is still waiting on it

    queue.cancel("shared", "cardB");
    expect(signal!.aborted).toBe(true);

    await expectCancelled(a);
    await expectCancelled(b);
  });

  it("closing the dialog cannot cancel the card's own in-flight preview", async () => {
    // The dialog's default tile IS the card's default query — same cache key.
    const queue = createPreviewQueue();
    const gate = deferred<string>();

    const cardPreview = queue.run(
      "q",
      PRIORITY.VISIBLE,
      () => gate.promise,
      "node_cpu",
    );
    const dialogTile = queue.run("q", PRIORITY.DIALOG, () => gate.promise, DIALOG);
    await Promise.resolve();

    queue.cancel("q", DIALOG); // dialog closed
    await expectCancelled(dialogTile);

    gate.resolve("data");
    expect(await cardPreview).toBe("data"); // the card is untouched
  });

  it("an ownerless cancel still aborts outright (time / filter change)", async () => {
    const queue = createPreviewQueue();
    const a = queue.run(
      "k",
      PRIORITY.VISIBLE,
      () => new Promise<string>(() => {}),
      "cardA",
    );
    const b = queue.run(
      "k",
      PRIORITY.VISIBLE,
      () => new Promise<string>(() => {}),
      "cardB",
    );
    await Promise.resolve();

    queue.cancel("k");
    await expectCancelled(a);
    await expectCancelled(b);
  });
});

describe("cache opt-out", () => {
  it("keeps a { cache: false } result out of the LRU", async () => {
    // Label values are scheduled here for the concurrency limit and the
    // cancellation — not because they are chart data. Letting them into an LRU
    // sized for chart results means a fan-out evicts the charts a user is reading.
    const queue = createPreviewQueue(2);
    const fn = vi.fn(async () => "labels");

    expect(await queue.run("k", 1, fn, { cache: false })).toBe("labels");
    expect(await queue.run("k", 1, fn, { cache: false })).toBe("labels");

    // Not served from the cache: it really ran twice.
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("still caches by default, and a bare owner string still works", async () => {
    const queue = createPreviewQueue(2);
    const fn = vi.fn(async () => "chart");

    expect(await queue.run("k", 1, fn, "card-a")).toBe("chart");
    expect(await queue.run("k", 1, fn, "card-a")).toBe("chart");

    expect(fn).toHaveBeenCalledTimes(1); // second call was a cache hit
  });

  it("lets the strictest cache intent win when two callers share one job", async () => {
    // A joiner used to inherit the cache flag of whoever created the job, so
    // "should this be cached" was decided by who asked FIRST. The one caller that
    // passes `cache: false` does it to keep label-value strings out of a cache
    // sized for chart results; losing that race puts them in.
    const queue = createPreviewQueue();
    const gate = deferred();
    const fn = vi.fn(() => gate.promise);

    // Cacheable caller starts the job; a non-cacheable one joins it.
    const a = queue.run("k", 1, fn, { owner: "a" });
    const b = queue.run("k", 1, fn, { owner: "b", cache: false });
    expect(fn).toHaveBeenCalledTimes(1); // one job, two waiters

    gate.resolve("v");
    await Promise.all([a, b]);

    // `cache: false` won, so nothing was stored and the next ask re-fetches.
    await queue.run("k", 1, fn, { owner: "c" });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("{ refresh: true } bypasses the cached answer but still caches the new one", async () => {
    // What a refresh actually means. It is NOT `cache: false` — that also refuses
    // to STORE the result, so the next card asking the same question would
    // re-fetch it.
    //
    // Before this existed, "skip the cache" was true only by accident of call
    // order: the caller had to wipe the whole LRU first, and a refresh that
    // forgot got the stale answer back instantly, with nothing to indicate it.
    const queue = createPreviewQueue();
    const fn = vi.fn().mockResolvedValue("v");

    await queue.run("k", 1, fn); // populates the cache
    await queue.run("k", 1, fn); // hits it
    expect(fn).toHaveBeenCalledTimes(1);

    await queue.run("k", 1, fn, { refresh: true }); // must reach the fetcher
    expect(fn).toHaveBeenCalledTimes(2);

    await queue.run("k", 1, fn); // ...and the refreshed answer is cached
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not let an uncached run poison the key for every later cached run", async () => {
    // The first cut tracked "do not cache this" in a Set of KEYS, held for the
    // life of the queue. Two things fell out of that, and this test pins both.
    //
    // 1. The Set only ever grew. Nothing removed a key, and label-value keys
    //    embed the time range, so every range change minted a fresh permanent
    //    entry — a leak that ran for as long as the page was open.
    // 2. Worse, it was WRONG. A key that had ever been run uncached was
    //    poisoned forever: the check ran at cache-WRITE time and asked only
    //    whether the key was in the Set, never whether THIS job had asked to
    //    skip the cache. So a later `cache: true` run of the same key silently
    //    refused to cache, and re-fetched on every single call.
    //
    // The flag now rides on the job, so it dies with the job.
    const queue = createPreviewQueue();
    const fn = vi.fn().mockResolvedValue("v");

    await queue.run("k", 1, fn, { cache: false }); // (1) must not be cached
    await queue.run("k", 1, fn, { cache: true }); // (2) must POPULATE the cache
    await queue.run("k", 1, fn, { cache: true }); // (3) must HIT it

    // Not 3: the run at (3) is a cache hit. With the key-Set, "k" was poisoned
    // by (1) and (3) re-ran the fetch.
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("a job whose run function throws synchronously", () => {
  /**
   * `run` is typed to return a promise, but a synchronous throw is entirely
   * reachable — building the selector rejects an invalid label name before it
   * ever awaits anything.
   *
   * Called bare, that throw escaped `pump()` while the job was already counted
   * against the concurrency cap, so its slot was never handed back. The queue
   * lost a slot per throw and, after `concurrency` of them, wedged permanently:
   * no card would ever load a preview again for the rest of the session.
   */
  it("rejects the caller rather than throwing out of run()", async () => {
    const queue = createPreviewQueue(1);
    const boom = new Error("invalid label name");

    await expect(
      queue.run("k", 1, () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });

  it("hands the slot back, so the queue keeps working", async () => {
    // Concurrency of 1 makes the leak total and immediate: lose the only slot
    // and nothing after it can ever run.
    const queue = createPreviewQueue(1);

    await expect(
      queue.run("boom", 1, () => {
        throw new Error("sync");
      }),
    ).rejects.toThrow("sync");

    const after = vi.fn().mockResolvedValue("v");
    await expect(queue.run("next", 1, after)).resolves.toBe("v");
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("survives enough throws to have exhausted every slot", async () => {
    const queue = createPreviewQueue(2);

    for (let i = 0; i < 5; i++) {
      await expect(
        queue.run(`boom-${i}`, 1, () => {
          throw new Error("sync");
        }),
      ).rejects.toThrow("sync");
    }

    const after = vi.fn().mockResolvedValue("still here");
    await expect(queue.run("next", 1, after)).resolves.toBe("still here");
  });

  it("does not cache the failure", async () => {
    const queue = createPreviewQueue(1);

    await expect(
      queue.run("k", 1, () => {
        throw new Error("sync");
      }),
    ).rejects.toThrow("sync");

    // The same key must be free to succeed afterwards — a transient failure is
    // not an answer worth remembering.
    const retry = vi.fn().mockResolvedValue("v");
    await expect(queue.run("k", 1, retry)).resolves.toBe("v");
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
