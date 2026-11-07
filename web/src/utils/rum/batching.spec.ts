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

import { describe, expect, it } from "vitest";
import { chunkItems, mapWithConcurrency } from "./batching";

describe("chunkItems", () => {
  it("splits into consecutive chunks with a short last one", () => {
    expect(chunkItems([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns no chunks for no items", () => {
    expect(chunkItems([], 40)).toEqual([]);
  });

  it("treats a size below 1, NaN or undefined as 1 instead of looping forever or dropping items", () => {
    expect(chunkItems(["a", "b"], 0)).toEqual([["a"], ["b"]]);
    expect(chunkItems(["a", "b"], Number.NaN)).toEqual([["a"], ["b"]]);
    expect(chunkItems(["a", "b"], undefined as unknown as number)).toEqual([["a"], ["b"]]);
  });
});

describe("mapWithConcurrency", () => {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("keeps the input order whatever order the tasks finish in", async () => {
    const result = await mapWithConcurrency([30, 10, 20], 3, async (delay) => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return delay * 2;
    });
    expect(result).toEqual([60, 20, 40]);
  });

  it("never runs more than the limit at once", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await mapWithConcurrency(
      Array.from({ length: 20 }, (_, i) => i),
      4,
      async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await tick();
        inFlight -= 1;
      },
    );
    expect(maxInFlight).toBe(4);
  });

  it("resolves to an empty list for no items", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });

  it("runs every item with a NaN limit, one at a time", async () => {
    expect(await mapWithConcurrency([1, 2, 3], Number.NaN, async (item) => item * 10)).toEqual([
      10, 20, 30,
    ]);
  });

  it("starts no further task after one rejects", async () => {
    const started: number[] = [];
    await expect(
      mapWithConcurrency([1, 2, 3, 4, 5, 6], 1, async (item) => {
        started.push(item);
        if (item === 2) throw new Error("stop");
        return item;
      }),
    ).rejects.toThrow("stop");
    expect(started).toEqual([1, 2]);
  });

  it("rejects when a task rejects, like Promise.all", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (item) => {
        if (item === 2) throw new Error("boom");
        return item;
      }),
    ).rejects.toThrow("boom");
  });
});
