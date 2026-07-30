// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import type { BrowserCheck, BrowserStep } from "@/types/synthetics";
import { buildCreateBrowserTestPayload } from "./buildPayload";

function journey(): BrowserStep[] {
  return [
    { id: "s1", action: "navigate", name: "Open", value: "https://app.test" },
    {
      id: "s2",
      action: "click",
      name: "Sign in",
      locator: { candidates: [{ kind: "test_attribute", value: '[data-test="login-sign-in"]' }] },
    },
  ];
}

function check(overrides: Partial<BrowserCheck> = {}): BrowserCheck {
  return {
    name: "Cloud login",
    url: "https://app.test",
    enabled: true,
    tags: [],
    journey: journey(),
    schedule: { type: "interval", intervalValue: 5, intervalUnit: "minutes" },
    locations: ["us-east"],
    notifications: { destinations: [] },
    rum: { collect: true, sessionReplay: false },
    capture: { screenshot: "on-fail", trace: "on-fail" },
    ...overrides,
  };
}

describe("buildCreateBrowserTestPayload", () => {
  // `steps_version` existed to say which of two step formats the array was in.
  // There is only one format now, so sending the key at all would be rejected
  // as an unknown field.
  it("sends no steps_version key", () => {
    const config = buildCreateBrowserTestPayload(check()).config as Record<string, unknown>;

    expect("steps_version" in config).toBe(false);
  });

  it("builds every step through the version-2 writer", () => {
    const config = buildCreateBrowserTestPayload(check()).config as Record<string, unknown>;
    const steps = config.steps as Record<string, unknown>[];

    expect(steps.map((s) => s.action)).toEqual(["navigate", "click"]);
    expect(steps[1].locator).toEqual({
      candidates: [{ kind: "test_attribute", value: '[data-test="login-sign-in"]' }],
    });
    // The version-1 fields the editor used to carry never reach the wire.
    expect(steps[1]).not.toHaveProperty("selector");
    expect(steps[1]).not.toHaveProperty("selector_type");
    expect(steps[1]).not.toHaveProperty("code");
  });

  // The save gate rejects these before the payload is built. The throw is the
  // second line of defence, so that a gate that ever stops agreeing with the
  // writer fails loudly here instead of posting a step the server refuses.
  it("throws rather than emitting a step it cannot build", () => {
    const withRetired = check({
      journey: [...journey(), { id: "s3", action: "hover", name: "Reveal" }],
    });

    expect(() => buildCreateBrowserTestPayload(withRetired)).toThrow(/cannot be stored/);
  });
});
