// Copyright 2026 OpenObserve Inc.
import { afterEach, describe, expect, it } from "vitest";
import { clearServiceColorRegistry, getOrSetServiceColor } from "./serviceColorRegistry";

describe("serviceColorRegistry", () => {
  afterEach(() => {
    clearServiceColorRegistry();
  });

  it("should assign a hex color to a new service", () => {
    const color = getOrSetServiceColor("checkout-api");
    expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("should return the same color for the same service name", () => {
    const first = getOrSetServiceColor("checkout-api");
    const second = getOrSetServiceColor("checkout-api");
    expect(first).toBe(second);
  });

  it("should assign different colors to different services", () => {
    const a = getOrSetServiceColor("svc-a");
    const b = getOrSetServiceColor("svc-b");
    expect(a).not.toBe(b);
  });

  it("should assign colors sequentially (first service = index 0, second = index 1)", () => {
    const first = getOrSetServiceColor("svc-a");
    const second = getOrSetServiceColor("svc-b");
    // index 0 and index 1 from LIGHT_SPAN_COLORS must differ
    expect(first).not.toBe(second);
  });

  it("should return a fallback color for empty string", () => {
    const color = getOrSetServiceColor("");
    expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("clearServiceColorRegistry should reset all assignments", () => {
    const before = getOrSetServiceColor("svc-a");
    clearServiceColorRegistry();
    // after reset, svc-b gets index 0 — same as svc-a had before
    const after = getOrSetServiceColor("svc-b");
    expect(before).toBe(after);
  });
});
