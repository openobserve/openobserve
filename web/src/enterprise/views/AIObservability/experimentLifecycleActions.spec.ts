// Copyright 2026 OpenObserve Inc.

import { describe, expect, it, vi } from "vitest";
import { makeExperiment } from "./experimentTestFixtures";
import { createExperimentLifecycleActions } from "./experimentLifecycleActions";

describe("experiment lifecycle actions", () => {
  it("gates each action by status and serializes concurrent controls", async () => {
    let current = makeExperiment({ status: "running" });
    let busy = false;
    let release!: (value: typeof current) => void;
    const execute = vi.fn(() => new Promise<typeof current>((resolve) => (release = resolve)));
    const apply = vi.fn();
    const notify = vi.fn();
    const actions = createExperimentLifecycleActions({
      current: () => current,
      busy: () => busy,
      setBusy: (value) => (busy = value),
      execute,
      apply,
      notify,
    });

    const first = actions.cancel();
    await actions.cancel();
    await actions.retry();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith("cancel", current);

    const cancelled = makeExperiment({ ...current, status: "cancelled" });
    release(cancelled);
    await first;
    expect(apply).toHaveBeenCalledWith("cancel", cancelled);
    expect(notify).toHaveBeenCalledWith("cancel", true);

    current = cancelled;
    execute.mockResolvedValueOnce(makeExperiment({ id: "clone-1", status: "pending" }));
    await actions.clone();
    expect(execute).toHaveBeenLastCalledWith("clone", cancelled);
  });

  it("reports failures and always releases the busy guard", async () => {
    const notify = vi.fn();
    let busy = false;
    const actions = createExperimentLifecycleActions({
      current: () => makeExperiment({ status: "failed" }),
      busy: () => busy,
      setBusy: (value) => (busy = value),
      execute: vi.fn().mockRejectedValue(new Error("conflict")),
      apply: vi.fn(),
      notify,
    });

    await actions.retry();

    expect(notify).toHaveBeenCalledWith("retry", false);
    expect(busy).toBe(false);
  });
});
