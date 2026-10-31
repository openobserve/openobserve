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
import { createExportIntervalCache, EXPORT_INTERVAL_TTL_MS } from "./metricExportInterval";

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
});
