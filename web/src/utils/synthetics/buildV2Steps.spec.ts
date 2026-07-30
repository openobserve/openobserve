// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import type { BrowserStep } from "@/types/synthetics";
import { buildV2Step, buildV2Steps, isSaveableJourney } from "./buildV2Steps";

function step(overrides: Partial<BrowserStep> = {}): BrowserStep {
  return {
    id: "s2",
    action: "click",
    name: "Sign In",
    selector: '[data-test="login-sign-in"]',
    locator: {
      candidates: [{ kind: "test_attribute", value: '[data-test="login-sign-in"]' }],
    },
    ...overrides,
  };
}

const nav = (): BrowserStep => ({
  id: "s1",
  action: "navigate",
  name: "Open",
  value: "https://example.com",
});

describe("isSaveableJourney", () => {
  it("accepts a journey whose every element step carries a bundle", () => {
    expect(isSaveableJourney([nav(), step()])).toBe(true);
  });

  // All-or-nothing: a half-recorded journey has no honest shape. Storing it
  // would fail validation on the bundle-less steps, and there is no longer a
  // version-1 shape to fall back to.
  it("rejects a journey where one step has no bundle", () => {
    expect(isSaveableJourney([nav(), step(), step({ id: "s3", locator: undefined })])).toBe(false);
  });

  it("rejects a journey containing a retired action", () => {
    expect(isSaveableJourney([nav(), step(), step({ id: "s3", action: "wait" })])).toBe(false);
  });

  it("accepts a page-level assertion with no element at all", () => {
    const urlAssert = step({
      id: "s3",
      action: "assert",
      locator: undefined,
      selector: undefined,
      assertion: { kind: "url_matches", expected: "**/web/**" },
    });
    expect(isSaveableJourney([nav(), urlAssert])).toBe(true);
  });

  it("rejects an empty journey", () => {
    expect(isSaveableJourney([])).toBe(false);
  });
});

describe("buildV2Step", () => {
  // The server validates steps with deny_unknown_fields, so a stray `code` or
  // `selectorType` would be a 400 rather than a harmless extra.
  it("emits only fields the schema knows", () => {
    const wire = buildV2Step(step());
    expect(Object.keys(wire).sort()).toEqual(["action", "id", "locator", "name"]);
  });

  it("translates the UI action names onto the v2 vocabulary", () => {
    expect(buildV2Step(step({ action: "type", value: "omkar" })).action).toBe("fill");
    expect(buildV2Step(step({ action: "check" })).action).toBe("check");
    expect(buildV2Step(step({ action: "upload" })).action).toBe("upload");
    expect(buildV2Step(nav()).action).toBe("navigate");
  });

  it("routes the single UI value into the field each action expects", () => {
    expect(buildV2Step(nav()).url).toBe("https://example.com");
    expect(buildV2Step(step({ action: "press", value: "Enter" })).key).toBe("Enter");
    expect(buildV2Step(step({ action: "type", value: "omkar" })).value).toBe("omkar");
  });

  it("carries a pin, which the runner uses exclusively", () => {
    const wire = buildV2Step(
      step({
        locator: {
          candidates: [{ kind: "test_attribute", value: "#a" }],
          user_override: { kind: "css", value: "#pinned" },
        },
      }),
    );
    expect(wire.locator?.user_override).toEqual({ kind: "css", value: "#pinned" });
  });

  it("carries the settle block and defaults a signal to advisory", () => {
    const wire = buildV2Step(
      step({
        settle: {
          navigation: { url_pattern: "**/web/**" },
          responses: [{ url_pattern: "**/auth/login", method: "POST" }],
          observed_duration_ms: 1800,
          budget_ms: 30000,
        },
      }),
    );
    expect(wire.settle?.navigation).toEqual({ url_pattern: "**/web/**" });
    expect(wire.settle?.responses).toEqual([
      { url_pattern: "**/auth/login", method: "POST", required: false },
    ]);
    expect(wire.settle?.observed_duration_ms).toBe(1800);
    expect(wire.settle?.budget_ms).toBe(30000);
  });

  // Validation requires an assertion on every assert step. Defaulting here means
  // an author who never opened the assertion editor gets the step's original
  // meaning rather than a 400.
  it("gives an assert step with no typed assertion its original meaning", () => {
    expect(buildV2Step(step({ action: "assert" })).assertion).toEqual({ kind: "element_visible" });
  });

  it("carries a typed assertion verbatim", () => {
    const wire = buildV2Step(
      step({
        action: "assert",
        assertion: { kind: "element_attribute", attribute: "href", expected: "/web/" },
      }),
    );
    expect(wire.assertion).toEqual({
      kind: "element_attribute",
      attribute: "href",
      expected: "/web/",
    });
  });

  it("sends flow control only when it is set", () => {
    expect(buildV2Step(step()).optional).toBeUndefined();
    expect(buildV2Step(step()).always_run).toBeUndefined();
    expect(buildV2Step(step({ optional: true })).optional).toBe(true);
    expect(buildV2Step(step({ alwaysRun: true })).always_run).toBe(true);
  });

  // Absence means "use the runner's per-category default"; sending a number the
  // author never chose is how the 10s stamp caused the original failures.
  it("sends a timeout only when the author set one", () => {
    expect(buildV2Step(step()).timeout_ms).toBeUndefined();
    expect(buildV2Step(step({ timeout: 45000 })).timeout_ms).toBe(45000);
  });

  it("refuses to build a step that cannot be stored", () => {
    expect(() => buildV2Step(step({ action: "hover" }))).toThrow(/cannot be stored/);
  });

  it("maps a whole journey in order", () => {
    expect(buildV2Steps([nav(), step()]).map((s) => s.id)).toEqual(["s1", "s2"]);
  });
});

// SE-18 regression. The gate is all-or-nothing, so one hand-added step without a
// locator used to flip an entire recorded journey to version 1, sending every
// other step's bundle, settle and assertion down the untyped path. It now blocks
// the save instead — and a seeded bundle plus an author-supplied pin still passes.
describe("SE-18: a completed manual step does not block the save", () => {
  it("stays saveable when a hand-added step names its element via locator", () => {
    const journey: BrowserStep[] = [
      { id: "s1", action: "navigate", name: "Open app", value: "https://example.com" },
      {
        id: "s2",
        action: "click",
        name: "Sign in",
        locator: { candidates: [], user_override: { kind: "css", value: "#sign-in" } },
      },
    ];
    expect(isSaveableJourney(journey)).toBe(true);
  });
});
