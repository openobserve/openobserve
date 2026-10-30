// Copyright 2026 OpenObserve Inc.

import { describe, expect, it, vi } from "vitest";
import { onBeforeAppReload, runBeforeAppReloadHooks } from "./beforeAppReload";

describe("beforeAppReload", () => {
  it("runs every registered hook and waits for async ones", async () => {
    const order: string[] = [];
    const stopA = onBeforeAppReload(() => {
      order.push("a");
    });
    const stopB = onBeforeAppReload(async () => {
      await Promise.resolve();
      order.push("b");
    });

    await runBeforeAppReloadHooks();
    expect(order.sort()).toEqual(["a", "b"]);
    stopA();
    stopB();
  });

  it("does not run a hook after its unregister function is called", async () => {
    const hook = vi.fn();
    const stop = onBeforeAppReload(hook);
    stop();

    await runBeforeAppReloadHooks();
    expect(hook).not.toHaveBeenCalled();
  });

  it("resolves even when a hook throws or rejects", async () => {
    const stopThrow = onBeforeAppReload(() => {
      throw new Error("boom");
    });
    const stopReject = onBeforeAppReload(() => Promise.reject(new Error("later")));
    const survivor = vi.fn();
    const stopSurvivor = onBeforeAppReload(survivor);

    await expect(runBeforeAppReloadHooks()).resolves.toBeUndefined();
    expect(survivor).toHaveBeenCalledTimes(1);
    stopThrow();
    stopReject();
    stopSurvivor();
  });
});
