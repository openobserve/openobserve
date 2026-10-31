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

import { describe, expect, it, vi } from "vitest";
import {
  createExportIntervalCache,
  EXPORT_INTERVAL_TTL_MS,
  MAX_EXPORT_INTERVAL_ENTRIES,
} from "./metricExportInterval";

const clock = () => {
  let t = 0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

describe("export interval cache", () => {
  it("measures once per key while the answer is fresh", async () => {
    const time = clock();
    const cache = createExportIntervalCache(EXPORT_INTERVAL_TTL_MS, time.now);
    const measure = vi.fn().mockResolvedValue(60);

    expect(await cache.detect("org|m", measure)).toBe(60);
    time.advance(EXPORT_INTERVAL_TTL_MS - 1);
    expect(await cache.detect("org|m", measure)).toBe(60);
    expect(measure).toHaveBeenCalledTimes(1);

    expect(await cache.detect("other|m", measure)).toBe(60);
    expect(measure).toHaveBeenCalledTimes(2);
  });

  it("shares one measurement between concurrent requests", async () => {
    const cache = createExportIntervalCache();
    let resolve!: (v: number) => void;
    const measure = vi.fn(() => new Promise<number>((r) => (resolve = r)));

    const first = cache.detect("org|m", measure);
    const second = cache.detect("org|m", measure);
    resolve(15);

    expect(await Promise.all([first, second])).toEqual([15, 15]);
    expect(measure).toHaveBeenCalledTimes(1);
  });

  it("measures again once the TTL lapses, and keeps the stale answer readable meanwhile", async () => {
    const time = clock();
    const cache = createExportIntervalCache(EXPORT_INTERVAL_TTL_MS, time.now);
    await cache.detect("org|m", () => Promise.resolve(60));
    time.advance(EXPORT_INTERVAL_TTL_MS);

    let resolve!: (v: number) => void;
    const remeasured = cache.detect("org|m", () => new Promise<number>((r) => (resolve = r)));
    expect(cache.peek("org|m")).toBe(60);
    resolve(30);
    expect(await remeasured).toBe(30);
    expect(cache.peek("org|m")).toBe(30);
  });

  it("caches an undetectable interval, but not a cancelled measurement", async () => {
    const cache = createExportIntervalCache();
    await expect(
      cache.detect("org|a", () => Promise.reject(new Error("cancelled"))),
    ).rejects.toThrow();
    expect(cache.peek("org|a")).toBeUndefined();
    const retry = vi.fn().mockResolvedValue(null);
    expect(await cache.detect("org|a", retry)).toBeNull();
    expect(await cache.detect("org|a", retry)).toBeNull();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(cache.peek("org|a")).toBeNull();
  });

  it("forgets the least recently measured stream past the entry cap", async () => {
    const cache = createExportIntervalCache();
    for (let i = 0; i <= MAX_EXPORT_INTERVAL_ENTRIES; i++) {
      await cache.detect(`org|m${i}`, () => Promise.resolve(15));
    }
    expect(cache.peek("org|m0")).toBeUndefined();
    expect(cache.peek("org|m1")).toBe(15);
    expect(cache.peek(`org|m${MAX_EXPORT_INTERVAL_ENTRIES}`)).toBe(15);
  });

  describe("in storage", () => {
    const memoryStorage = () => {
      const items = new Map<string, string>();
      return {
        getItem: (k: string) => items.get(k) ?? null,
        setItem: (k: string, v: string) => void items.set(k, v),
        items,
      } as unknown as Storage & { items: Map<string, string> };
    };

    it("answers a reload within the TTL without measuring, per org", async () => {
      const time = clock();
      const storage = memoryStorage();
      const first = createExportIntervalCache(EXPORT_INTERVAL_TTL_MS, time.now, () => storage);
      await first.detect("org1|m", () => Promise.resolve(60));
      await first.detect("org2|m", () => Promise.resolve(15));
      expect([...storage.items.keys()].sort()).toEqual([
        "o2-metrics-export-intervals:org1",
        "o2-metrics-export-intervals:org2",
      ]);

      const reloaded = createExportIntervalCache(EXPORT_INTERVAL_TTL_MS, time.now, () => storage);
      const measure = vi.fn().mockResolvedValue(30);
      expect(reloaded.peek("org1|m")).toBe(60);
      expect(await reloaded.detect("org1|m", measure)).toBe(60);
      expect(await reloaded.detect("org2|m", measure)).toBe(15);
      expect(measure).not.toHaveBeenCalled();
    });

    it("coalesces a burst of measurements into one write, without expired entries", async () => {
      vi.useFakeTimers();
      try {
        const time = clock();
        const storage = memoryStorage();
        const setItem = vi.spyOn(storage, "setItem");
        const cache = createExportIntervalCache(
          EXPORT_INTERVAL_TTL_MS,
          time.now,
          () => storage,
          1000,
        );
        await cache.detect("org|old", () => Promise.resolve(60));
        time.advance(EXPORT_INTERVAL_TTL_MS);
        for (const stream of ["a", "b", "c"]) {
          await cache.detect(`org|${stream}`, () => Promise.resolve(15));
        }
        expect(setItem).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1000);
        expect(setItem).toHaveBeenCalledTimes(1);
        expect(
          Object.keys(JSON.parse(storage.items.get("o2-metrics-export-intervals:org")!)),
        ).toEqual(["a", "b", "c"]);
      } finally {
        vi.useRealTimers();
      }
    });

    it("measures again once the stored answer is past the TTL", async () => {
      const time = clock();
      const storage = memoryStorage();
      await createExportIntervalCache(EXPORT_INTERVAL_TTL_MS, time.now, () => storage).detect(
        "org|m",
        () => Promise.resolve(60),
      );
      time.advance(EXPORT_INTERVAL_TTL_MS);
      const reloaded = createExportIntervalCache(EXPORT_INTERVAL_TTL_MS, time.now, () => storage);
      expect(reloaded.peek("org|m")).toBeUndefined();
      expect(await reloaded.detect("org|m", () => Promise.resolve(30))).toBe(30);
    });

    it("keeps working in memory when storage throws or holds garbage", async () => {
      const throwing = {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      } as unknown as Storage;
      for (const storage of [
        () => throwing,
        () => {
          throw new Error("no storage");
        },
        () => ({ getItem: () => "{not json", setItem: () => {} }) as unknown as Storage,
      ]) {
        const cache = createExportIntervalCache(EXPORT_INTERVAL_TTL_MS, Date.now, storage);
        const measure = vi.fn().mockResolvedValue(15);
        expect(await cache.detect("org|m", measure)).toBe(15);
        expect(await cache.detect("org|m", measure)).toBe(15);
        expect(measure).toHaveBeenCalledTimes(1);
      }
    });
  });
});
