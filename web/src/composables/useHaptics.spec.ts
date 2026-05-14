// Copyright 2026 OpenObserve Inc.
// Licensed under AGPL v3.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHaptics } from "./useHaptics";

describe("useHaptics", () => {
  const originalVibrate = (globalThis.navigator as any).vibrate;

  afterEach(() => {
    (globalThis.navigator as any).vibrate = originalVibrate;
  });

  it("reports supportsVibrate=false when Vibration API is absent", () => {
    // @ts-expect-error — intentionally clear
    (globalThis.navigator as any).vibrate = undefined;
    const { supportsVibrate, vibrate } = useHaptics();
    expect(supportsVibrate.value).toBe(false);
    // Should no-op without throwing.
    expect(() => vibrate()).not.toThrow();
  });

  it("calls navigator.vibrate with the selection duration by default", () => {
    const spy = vi.fn();
    (globalThis.navigator as any).vibrate = spy;
    const { vibrate } = useHaptics();
    vibrate();
    expect(spy).toHaveBeenCalledWith(8);
  });

  it("maps impact and warning kinds to their patterns", () => {
    const spy = vi.fn();
    (globalThis.navigator as any).vibrate = spy;
    const { vibrate } = useHaptics();
    vibrate("impact");
    vibrate("warning");
    expect(spy).toHaveBeenNthCalledWith(1, 14);
    expect(spy).toHaveBeenNthCalledWith(2, [8, 40, 8]);
  });

  it("swallows vibrate() throws so callers never need to guard", () => {
    (globalThis.navigator as any).vibrate = () => {
      throw new Error("denied");
    };
    const { vibrate } = useHaptics();
    expect(() => vibrate("impact")).not.toThrow();
  });
});
