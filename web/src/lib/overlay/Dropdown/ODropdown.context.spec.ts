// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, vi } from "vitest";
import { setActiveOverlay, clearActiveOverlay } from "./ODropdown.context";

describe("single-active-overlay coordinator", () => {
  it("should close the previously-active overlay when a new one opens", () => {
    const closeA = vi.fn();
    const closeB = vi.fn();

    setActiveOverlay(closeA);
    expect(closeA).not.toHaveBeenCalled();

    // Opening B closes A.
    setActiveOverlay(closeB);
    expect(closeA).toHaveBeenCalledTimes(1);
    expect(closeB).not.toHaveBeenCalled();
  });

  it("should not close an overlay when it re-registers itself", () => {
    const closeA = vi.fn();
    setActiveOverlay(closeA);
    setActiveOverlay(closeA);
    expect(closeA).not.toHaveBeenCalled();
  });

  it("should clear only when the overlay is still the active one", () => {
    const closeA = vi.fn();
    const closeB = vi.fn();

    setActiveOverlay(closeA);
    setActiveOverlay(closeB); // B is now active, A already closed
    closeA.mockClear();

    // A closing afterwards must not disturb B's active registration.
    clearActiveOverlay(closeA);
    const closeC = vi.fn();
    setActiveOverlay(closeC);
    expect(closeB).toHaveBeenCalledTimes(1);
  });

  it("should leave no active overlay after the active one clears", () => {
    const closeA = vi.fn();
    const closeB = vi.fn();

    setActiveOverlay(closeA);
    clearActiveOverlay(closeA);

    // With nothing active, opening B must not call any stale close fn.
    setActiveOverlay(closeB);
    expect(closeA).not.toHaveBeenCalled();
    expect(closeB).not.toHaveBeenCalled();
  });
});
