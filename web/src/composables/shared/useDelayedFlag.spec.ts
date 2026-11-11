// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";
import { useDelayedFlag } from "./useDelayedFlag";
import * as resultsIndicator from "@/composables/useLogs/useResultsLoadingIndicator";
import { LOADER_DELAY_MS } from "@/lib/styles/motion";

describe("useDelayedFlag", () => {
  afterEach(() => vi.useRealTimers());

  it("turns on after the shared loader delay and off at once", async () => {
    vi.useFakeTimers();
    const source = ref(false);
    const scope = effectScope();
    const shown = scope.run(() => useDelayedFlag(source))!;
    source.value = true;
    await nextTick();
    vi.advanceTimersByTime(LOADER_DELAY_MS - 1);
    expect(shown.value).toBe(false);
    vi.advanceTimersByTime(1);
    expect(shown.value).toBe(true);
    source.value = false;
    await nextTick();
    expect(shown.value).toBe(false);
    scope.stop();
  });

  it("is the same function and delay Logs imports from its old path", () => {
    expect(resultsIndicator.useDelayedFlag).toBe(useDelayedFlag);
    expect(resultsIndicator.RESULTS_LOADER_DELAY_MS).toBe(LOADER_DELAY_MS);
  });
});
