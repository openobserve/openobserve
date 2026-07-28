// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import type { BrowserStep } from "@/types/synthetics";
import { liftJourney, needsLift } from "./liftJourney";

function step(overrides: Partial<BrowserStep> = {}): BrowserStep {
  return {
    id: "s1",
    action: "click",
    name: "Sign In",
    selector: '[data-test="login-sign-in"]',
    selectorType: "TestID",
    code: "",
    ...overrides,
  };
}

describe("liftJourney", () => {
  // ── Locator bundle (spec P2.6.2) ─────────────────────────────────────────

  it("turns a single selector into a one-candidate bundle", () => {
    const { steps } = liftJourney([step()]);
    expect(steps[0].locator).toEqual({
      candidates: [{ kind: "test_attribute", value: '[data-test="login-sign-in"]' }],
      user_override: null,
    });
  });

  it("maps every selector type onto its locator kind", () => {
    const cases = [
      ["TestID", "test_attribute"],
      ["Role", "role"],
      ["Text", "text"],
      ["CSS", "css"],
      ["XPath", "xpath"],
    ] as const;
    for (const [selectorType, kind] of cases) {
      const { steps } = liftJourney([step({ selectorType })]);
      expect(steps[0].locator?.candidates[0].kind, selectorType).toBe(kind);
    }
  });

  // A hand-authored step has no recorded selector type. CSS is the only safe
  // assumption — guessing `test_attribute` would put a brittle selector at the
  // top of the stability ordering.
  it("falls back to css when the selector type is unknown", () => {
    const { steps } = liftJourney([step({ selectorType: undefined, selector: "#login > button" })]);
    expect(steps[0].locator?.candidates[0].kind).toBe("css");
  });

  it("leaves an existing locator bundle alone", () => {
    const existing = {
      candidates: [{ kind: "role" as const, value: "role=button" }],
      user_override: null,
    };
    const { steps } = liftJourney([step({ locator: existing })]);
    expect(steps[0].locator).toBe(existing);
  });

  // ── Timeout stamp ────────────────────────────────────────────────────────

  it("clears the recorder's 10s stamp so the runner default applies", () => {
    const { steps } = liftJourney([step({ timeout: 10000 })]);
    expect(steps[0].timeout).toBeUndefined();
  });

  // Any other value was a deliberate choice and must survive the lift.
  it("preserves an author-set timeout", () => {
    const { steps } = liftJourney([step({ timeout: 45000 })]);
    expect(steps[0].timeout).toBe(45000);
  });

  // ── Retired actions (spec X-9) ───────────────────────────────────────────

  it("drops retired actions, which cannot exist in version 2", () => {
    const journey = [
      step({ id: "s1", action: "navigate", value: "https://example.com", selector: undefined }),
      step({ id: "s2", action: "wait", selector: undefined }),
      step({ id: "s3", action: "scroll", selector: undefined }),
      step({ id: "s4", action: "screenshot", selector: undefined }),
      step({ id: "s5", action: "hover" }),
      step({ id: "s6", action: "click" }),
    ];
    const { steps } = liftJourney(journey);
    expect(steps.map((s) => s.id)).toEqual(["s1", "s6"]);
  });

  // Dropping a step is a real behaviour change. It must be surfaced so an
  // author sees it in the preview instead of discovering it from a diff.
  it("reports every drop with a reason", () => {
    const { changes } = liftJourney([step({ id: "s2", action: "wait", selector: undefined })]);
    const drop = changes.find((c) => c.kind === "step_dropped");
    expect(drop).toBeDefined();
    expect(drop!.stepId).toBe("s2");
    expect(drop!.detail).toMatch(/sleep/i);
  });

  // ── Sleeps become settle budgets (spec P3.4.3 / T3-6) ────────────────────

  it("converts a sleep into a settle budget on the preceding step", () => {
    const { steps, changes } = liftJourney([
      step({ id: "s1", action: "click" }),
      step({ id: "s2", action: "wait", timeout: 30000, selector: undefined }),
      step({ id: "s3", action: "assert" }),
    ]);
    expect(steps.map((s) => s.id)).toEqual(["s1", "s3"]);
    expect(steps[0].settle?.budget_ms).toBe(30000);
    const converted = changes.find((c) => c.kind === "sleep_converted");
    expect(converted?.stepId).toBe("s2");
    expect(converted?.detail).toMatch(/settle budget/i);
  });

  // The duration is the one piece of a sleep that carries author intent — "this
  // step needs longer than usual". Dropping it would silently tighten the run.
  it("keeps the author's duration, reading it from value when timeout is unset", () => {
    const { steps } = liftJourney([
      step({ id: "s1", action: "click" }),
      step({ id: "s2", action: "wait", value: "5000", selector: undefined }),
    ]);
    expect(steps[0].settle?.budget_ms).toBe(5000);
  });

  it("clamps a converted budget into the range the server accepts", () => {
    const { steps } = liftJourney([
      step({ id: "s1", action: "click" }),
      step({ id: "s2", action: "wait", timeout: 120000, selector: undefined }),
    ]);
    expect(steps[0].settle?.budget_ms).toBe(60000);
  });

  // Nothing to attach it to, so it is a plain drop rather than a silent no-op.
  it("drops a leading sleep, since there is no step whose settling it describes", () => {
    const { steps, changes } = liftJourney([
      step({ id: "s1", action: "wait", timeout: 30000, selector: undefined }),
      step({ id: "s2", action: "click" }),
    ]);
    expect(steps.map((s) => s.id)).toEqual(["s2"]);
    expect(changes.some((c) => c.kind === "step_dropped")).toBe(true);
    expect(changes.some((c) => c.kind === "sleep_converted")).toBe(false);
  });

  it("explains hover separately, since dropping it can change behaviour", () => {
    const { changes } = liftJourney([step({ id: "s5", action: "hover" })]);
    expect(changes[0].detail).toMatch(/re-record/i);
  });

  // ── Change reporting drives the preview (P2.6.3) ─────────────────────────

  it("reports a change for every modification it makes", () => {
    const { changes } = liftJourney([step({ timeout: 10000 })]);
    expect(changes.map((c) => c.kind).sort()).toEqual(["locator_created", "timeout_cleared"]);
  });

  it("is a no-op on an already-lifted journey", () => {
    const once = liftJourney([step({ timeout: 10000 })]);
    const twice = liftJourney(once.steps);
    expect(twice.noop).toBe(true);
    expect(twice.changes).toEqual([]);
  });

  it("is idempotent", () => {
    const once = liftJourney([step({ timeout: 10000 })]).steps;
    const twice = liftJourney(once).steps;
    expect(twice).toEqual(once);
  });

  it("does not mutate the input", () => {
    const original = step({ timeout: 10000 });
    const snapshot = JSON.parse(JSON.stringify(original));
    liftJourney([original]);
    expect(JSON.parse(JSON.stringify(original))).toEqual(snapshot);
  });

  // ── needsLift ────────────────────────────────────────────────────────────

  it("detects when a journey needs lifting", () => {
    expect(needsLift([step({ timeout: 10000 })])).toBe(true);
    expect(needsLift(liftJourney([step({ timeout: 10000 })]).steps)).toBe(false);
  });

  it("handles an empty journey", () => {
    expect(liftJourney([])).toEqual({ steps: [], changes: [], noop: true });
  });
});
