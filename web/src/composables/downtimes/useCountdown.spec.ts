// Copyright 2026 OpenObserve Inc.

import { effectScope, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCountdown } from "./useCountdown";

const NOW = Date.parse("2026-09-17T14:00:00Z");
const micros = (ms: number) => ms * 1000;

const run = (endsAt: () => number | null) => {
  const scope = effectScope();
  const api = scope.run(() => useCountdown(endsAt))!;
  return { ...api, stop: () => scope.stop() };
};

describe("useCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it("moves once per minute boundary, not every second", () => {
    const { remainingSecs, stop } = run(() => micros(NOW + 3 * 60_000 + 20_000));
    expect(remainingSecs.value).toBe(200);
    vi.advanceTimersByTime(19_000);
    expect(remainingSecs.value).toBe(200);
    vi.advanceTimersByTime(1_100);
    expect(remainingSecs.value).toBe(179);
    vi.advanceTimersByTime(60_000);
    expect(remainingSecs.value).toBe(119);
    stop();
  });

  it("wakes at the end in the last minute and then stops", () => {
    const { remainingSecs, stop } = run(() => micros(NOW + 30_000));
    expect(remainingSecs.value).toBe(30);
    vi.advanceTimersByTime(30_100);
    expect(remainingSecs.value).toBeLessThanOrEqual(0);
    expect(vi.getTimerCount()).toBe(0);
    stop();
  });

  it("follows a new end and is null without one", async () => {
    const end = ref<number | null>(micros(NOW + 90_000));
    const { remainingSecs, stop } = run(() => end.value);
    expect(remainingSecs.value).toBe(90);
    end.value = null;
    await Promise.resolve();
    expect(remainingSecs.value).toBeNull();
    end.value = micros(NOW + 2 * 3600_000);
    await Promise.resolve();
    expect(remainingSecs.value).toBe(7200);
    stop();
  });

  it("clears its timer when the scope goes away", () => {
    const { stop } = run(() => micros(NOW + 10 * 60_000));
    expect(vi.getTimerCount()).toBe(1);
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
