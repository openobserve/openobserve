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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref, type EffectScope } from "vue";
import { useKioskRefresh, type UseKioskRefresh } from "./useKioskRefresh";

const setHidden = (hidden: boolean) => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event("visibilitychange"));
};

const setOnline = (online: boolean) => {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
};

describe("useKioskRefresh", () => {
  let api: UseKioskRefresh;
  let scope: EffectScope | null = null;
  const enabled = ref(false);
  const intervalSeconds = ref(10);
  const isLoading = ref(false);
  const refresh = vi.fn();
  const cancel = vi.fn();

  const setup = async (on = true, probe?: () => Promise<boolean>) => {
    scope = effectScope();
    api = scope.run(() =>
      useKioskRefresh({ enabled, intervalSeconds, isLoading, refresh, cancel, probe }),
    )!;
    enabled.value = on;
    await nextTick();
  };

  // Mimics one dashboard load: panels start loading, then finish.
  const finishLoad = async () => {
    isLoading.value = true;
    await nextTick();
    isLoading.value = false;
    await nextTick();
    vi.advanceTimersByTime(300);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    enabled.value = false;
    intervalSeconds.value = 10;
    isLoading.value = false;
    refresh.mockReset();
    cancel.mockReset();
    setOnline(true);
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  });

  afterEach(() => {
    api?.stop();
    scope?.stop();
    scope = null;
    enabled.value = false;
    vi.useRealTimers();
  });

  it("does nothing while kiosk is off", async () => {
    await setup(false);
    api.onTick();
    vi.advanceTimersByTime(60000);
    expect(refresh).not.toHaveBeenCalled();
    expect(api.health.value).toEqual({ level: "ok" });
  });

  it("refreshes on its own every interval and records the success", async () => {
    await setup();
    await finishLoad();
    expect(api.lastSuccessAt.value).not.toBeNull();

    vi.advanceTimersByTime(10000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("skips a tick while a normal slow query is still loading", async () => {
    await setup();
    await finishLoad();
    api.onTick();
    isLoading.value = true;
    await nextTick();
    refresh.mockClear();

    vi.advanceTimersByTime(10000);
    expect(refresh).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("cancels a hung query and refreshes anyway, then says so", async () => {
    await setup();
    await finishLoad();
    api.onTick();
    isLoading.value = true;
    await nextTick();
    refresh.mockClear();

    vi.advanceTimersByTime(40000);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);

    isLoading.value = false;
    await nextTick();
    vi.advanceTimersByTime(300);
    expect(api.health.value).toEqual({ level: "warn", kind: "hung" });
  });

  it("counts failing panels and clears them when they recover", async () => {
    await setup();
    api.registry.register("a");
    api.registry.register("b");
    api.registry.report("a", { message: "stream not found", code: 400 });
    await finishLoad();
    expect(api.health.value).toEqual({ level: "warn", kind: "failing", count: 1 });

    api.registry.report("a", { message: "" });
    await nextTick();
    expect(api.health.value).toEqual({ level: "ok" });
  });

  it("backs off while every panel fails with a server error and refreshes as soon as the network is back", async () => {
    await setup();
    api.registry.register("a");
    api.registry.report("a", { message: "502 Bad Gateway", code: 502 });
    await finishLoad();

    const health = api.health.value;
    expect(health.level).toBe("bad");
    expect(health).toMatchObject({ kind: "unreachable", retryInSeconds: 5 });

    // The regular tick does not pile on while the retry timer owns refreshes.
    refresh.mockClear();
    vi.advanceTimersByTime(4000);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(refresh).toHaveBeenCalledTimes(1);

    refresh.mockClear();
    window.dispatchEvent(new Event("online"));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not treat a client error on every panel as an outage", async () => {
    await setup();
    api.registry.register("a");
    api.registry.report("a", { message: "bad query", code: 400 });
    await finishLoad();
    expect(api.health.value).toEqual({ level: "warn", kind: "failing", count: 1 });
  });

  it("marks the screen stale when nothing succeeded for twice the interval", async () => {
    await setup();
    await finishLoad();
    const since = api.lastSuccessAt.value;
    isLoading.value = true;
    await nextTick();
    vi.advanceTimersByTime(21000);
    expect(api.health.value).toEqual({ level: "bad", kind: "stale", since });
  });

  it("pauses while the tab is hidden and refreshes once when it is shown again", async () => {
    await setup();
    await finishLoad();
    setHidden(true);
    expect(api.health.value).toEqual({ level: "paused" });

    vi.advanceTimersByTime(30000);
    expect(refresh).not.toHaveBeenCalled();

    setHidden(false);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("restarts its ticker when the interval changes", async () => {
    await setup();
    await finishLoad();
    intervalSeconds.value = 60;
    await nextTick();
    vi.advanceTimersByTime(30000);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("counts down to the next tick and starts over after it fires", async () => {
    const start = Date.UTC(2026, 9, 22, 23, 16, 0);
    vi.setSystemTime(start);
    await setup();
    expect(api.countdown.value).toEqual({
      remainingMs: 10000,
      totalMs: 10000,
      at: start + 10000,
      retrying: false,
    });
    vi.advanceTimersByTime(4000);
    expect(api.countdown.value).toMatchObject({ remainingMs: 6000, at: start + 10000 });
    vi.advanceTimersByTime(6000);
    expect(api.countdown.value).toMatchObject({ remainingMs: 10000, at: start + 20000 });
  });

  it("counts down to the retry during an outage", async () => {
    await setup();
    api.registry.register("a");
    api.registry.report("a", { message: "502 Bad Gateway", code: 502 });
    await finishLoad();
    expect(api.countdown.value).toMatchObject({ remainingMs: 5000, totalMs: 5000, retrying: true });
    const retryIn = (api.countdown.value?.at ?? 0) - Date.now();
    expect(retryIn).toBeGreaterThan(4000);
    expect(retryIn).toBeLessThanOrEqual(5000);
    vi.advanceTimersByTime(2000);
    // The clock ticks once a second, so the countdown is accurate to a second.
    expect(api.countdown.value?.totalMs).toBe(5000);
    expect(api.countdown.value?.remainingMs).toBeGreaterThanOrEqual(3000);
    expect(api.countdown.value?.remainingMs).toBeLessThan(4000);
  });

  it("has no countdown while auto-refresh is off, the tab is hidden or kiosk is off", async () => {
    await setup(false);
    expect(api.countdown.value).toBeNull();
    enabled.value = true;
    intervalSeconds.value = 0;
    await nextTick();
    expect(api.countdown.value).toBeNull();
    intervalSeconds.value = 10;
    await nextTick();
    setHidden(true);
    expect(api.countdown.value).toBeNull();
    setHidden(false);
  });

  it("forces a real load when the first paint came from the browser cache", async () => {
    await setup();
    vi.advanceTimersByTime(3300);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(api.lastSuccessAt.value).toBeNull();

    await finishLoad();
    expect(api.lastSuccessAt.value).not.toBeNull();
  });

  it("checks the backend first and fires no refresh while it is down, so panels keep their last render", async () => {
    const probe = vi.fn().mockResolvedValue(false);
    await setup(true, probe);
    await finishLoad();
    await vi.advanceTimersByTimeAsync(2000);
    refresh.mockClear();
    probe.mockClear();

    await vi.advanceTimersByTimeAsync(10000);
    expect(probe).toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(api.health.value).toMatchObject({ level: "bad", kind: "unreachable" });
    expect(api.registry.outage.value).toBe(true);

    probe.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(12000);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh at all while the browser is offline", async () => {
    await setup();
    await finishLoad();
    setOnline(false);
    vi.advanceTimersByTime(10000);
    expect(refresh).not.toHaveBeenCalled();
    expect(api.health.value).toMatchObject({ level: "bad", kind: "unreachable" });

    setOnline(true);
    window.dispatchEvent(new Event("online"));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("treats a finished cycle as an outage when the backend stopped answering mid-way", async () => {
    const probe = vi.fn().mockResolvedValue(true);
    await setup(true, probe);
    await finishLoad();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.lastSuccessAt.value).not.toBeNull();

    refresh.mockClear();
    probe.mockResolvedValueOnce(true).mockResolvedValue(false);
    await vi.advanceTimersByTimeAsync(10000);
    expect(refresh).toHaveBeenCalledTimes(1);
    await finishLoad();
    await vi.advanceTimersByTimeAsync(2000);
    expect(api.health.value).toMatchObject({ level: "bad", kind: "unreachable" });
  });

  it("does not call one slow health check an outage: a miss is confirmed before the screen says so", async () => {
    const probe = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    await setup(true, probe);
    await finishLoad();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.health.value.level).not.toBe("bad");

    await vi.advanceTimersByTimeAsync(2000);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(api.health.value.level).toBe("ok");
    expect(api.lastSuccessAt.value).not.toBeNull();
  });
});
