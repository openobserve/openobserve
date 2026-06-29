// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { resolveBadge, normalizeKey, BADGE_GROUPS } from "./badgeGroups";

describe("badgeGroups", () => {
  it("normalizes separators and case", () => {
    expect(normalizeKey("Real-Time")).toBe("realtime");
    expect(normalizeKey("real_time")).toBe("realtime");
    expect(normalizeKey("realTime")).toBe("realtime");
  });

  it("resolves alertType to icon mode with the right colour + icon", () => {
    const r = resolveBadge("alertType", "realTime");
    expect(r.mode).toBe("icon");
    expect(r.variant).toBe("blue-soft");
    expect(r.icon).toBe("bolt");
    expect(r.dot).toBe(false);
    expect(r.label).toBe("Real-time");
  });

  it("resolves alertStatus to dot mode (no icon)", () => {
    const r = resolveBadge("alertStatus", "active");
    expect(r.mode).toBe("dot");
    expect(r.variant).toBe("success-soft");
    expect(r.dot).toBe(true);
    expect(r.icon).toBeUndefined();
  });

  it("resolves logLevel to plain mode (no dot, no icon)", () => {
    const r = resolveBadge("logLevel", "error");
    expect(r.mode).toBe("plain");
    expect(r.variant).toBe("error-soft");
    expect(r.dot).toBe(false);
    expect(r.icon).toBeUndefined();
  });

  it("uses generic semantic mapping for unknown group", () => {
    expect(resolveBadge(undefined, "failed").variant).toBe("error-soft");
    expect(resolveBadge("nope", "active").variant).toBe("success-soft");
  });

  it("falls back to generic engine for unknown value in a known group", () => {
    // "weird" isn't a registered alertStatus → generic neutral
    const r = resolveBadge("alertStatus", "weird");
    expect(r.mode).toBe("dot");
    expect(r.variant).toBe("default-soft");
  });

  it("invoice 'open' is informational (blue), not a warning", () => {
    expect(resolveBadge("invoiceStatus", "open").variant).toBe("blue-soft");
  });

  it("every registry value config has a variant", () => {
    for (const group of Object.values(BADGE_GROUPS)) {
      for (const cfg of Object.values(group.values)) {
        expect(cfg.variant).toBeTruthy();
      }
    }
  });
});
