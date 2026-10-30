// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";

import { createLimiter } from "./useSecurityStreamPlans";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createLimiter", () => {
  it("never runs more tasks at once than its slots, across separate callers", async () => {
    const limit = createLimiter(2);
    let active = 0;
    let peak = 0;
    const releases: (() => void)[] = [];
    const task = () =>
      limit(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active -= 1;
      });
    const first = [task(), task(), task()];
    await tick();
    expect(active).toBe(2);
    releases.shift()!();
    // A new caller arriving as a slot frees must still queue behind the waiter.
    const late = task();
    await tick();
    expect(active).toBe(2);
    while (releases.length) {
      releases.shift()!();
      await tick();
    }
    await Promise.all([...first, late]);
    expect(peak).toBe(2);
  });

  it("frees the slot when a task throws", async () => {
    const limit = createLimiter(1);
    await expect(limit(async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    await expect(limit(async () => 7)).resolves.toBe(7);
  });
});
