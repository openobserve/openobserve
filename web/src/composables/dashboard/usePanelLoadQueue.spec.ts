import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_CONCURRENT_PANEL_LOADS,
  acquirePanelLoadSlot,
  getPanelLoadQueueStats,
  releasePanelLoadSlot,
  resetPanelLoadQueue,
} from "./usePanelLoadQueue";

describe("usePanelLoadQueue", () => {
  afterEach(() => {
    resetPanelLoadQueue();
  });

  it("admits up to the cap without queueing", async () => {
    for (let i = 0; i < MAX_CONCURRENT_PANEL_LOADS; i++) {
      await acquirePanelLoadSlot();
    }

    expect(getPanelLoadQueueStats()).toEqual({
      active: MAX_CONCURRENT_PANEL_LOADS,
      queued: 0,
    });
  });

  it("queues everything past the cap and admits it as slots free", async () => {
    for (let i = 0; i < MAX_CONCURRENT_PANEL_LOADS; i++) {
      await acquirePanelLoadSlot();
    }

    let admitted = false;
    const queued = acquirePanelLoadSlot().then(() => {
      admitted = true;
    });

    await Promise.resolve();
    expect(admitted).toBe(false);
    expect(getPanelLoadQueueStats().queued).toBe(1);

    releasePanelLoadSlot();
    await queued;

    expect(admitted).toBe(true);
    expect(getPanelLoadQueueStats()).toEqual({
      active: MAX_CONCURRENT_PANEL_LOADS,
      queued: 0,
    });
  });

  it("never admits more than the cap even when a hundred panels ask at once", async () => {
    let running = 0;
    let peak = 0;

    const panels = Array.from({ length: 100 }, () =>
      acquirePanelLoadSlot().then(async () => {
        running++;
        peak = Math.max(peak, running);
        await Promise.resolve();
        running--;
        releasePanelLoadSlot();
      }),
    );

    await Promise.all(panels);

    expect(peak).toBe(MAX_CONCURRENT_PANEL_LOADS);
    expect(getPanelLoadQueueStats()).toEqual({ active: 0, queued: 0 });
  });

  it("gives up a queued place when the panel's load is aborted", async () => {
    for (let i = 0; i < MAX_CONCURRENT_PANEL_LOADS; i++) {
      await acquirePanelLoadSlot();
    }

    const controller = new AbortController();
    const queued = acquirePanelLoadSlot(controller.signal);
    expect(getPanelLoadQueueStats().queued).toBe(1);

    controller.abort();

    await expect(queued).rejects.toThrow("Aborted waiting for a panel load slot");
    expect(getPanelLoadQueueStats().queued).toBe(0);

    // The freed slot goes to the next panel, not to the abandoned one.
    releasePanelLoadSlot();
    expect(getPanelLoadQueueStats().active).toBe(MAX_CONCURRENT_PANEL_LOADS - 1);
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(acquirePanelLoadSlot(controller.signal)).rejects.toThrow(
      "Aborted waiting for a panel load slot",
    );
    expect(getPanelLoadQueueStats()).toEqual({ active: 0, queued: 0 });
  });

  it("does not let an unmatched release inflate the pool", async () => {
    releasePanelLoadSlot();
    releasePanelLoadSlot();

    expect(getPanelLoadQueueStats().active).toBe(0);

    for (let i = 0; i < MAX_CONCURRENT_PANEL_LOADS; i++) {
      await acquirePanelLoadSlot();
    }
    let admitted = false;
    acquirePanelLoadSlot().then(() => {
      admitted = true;
    });
    await Promise.resolve();

    expect(admitted).toBe(false);
  });
});
