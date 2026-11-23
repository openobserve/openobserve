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

  it("should give a service the same color regardless of first-seen order", () => {
    const alone = getOrSetServiceColor("svc-b");
    clearServiceColorRegistry();
    getOrSetServiceColor("svc-a");
    expect(getOrSetServiceColor("svc-b")).toBe(alone);
  });

  it("should return a fallback color for empty string", () => {
    const color = getOrSetServiceColor("");
    expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("clearServiceColorRegistry should keep colors deterministic", () => {
    const before = getOrSetServiceColor("svc-a");
    clearServiceColorRegistry();
    expect(getOrSetServiceColor("svc-a")).toBe(before);
  });
});
