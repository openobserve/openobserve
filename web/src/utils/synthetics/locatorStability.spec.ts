// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import type { LocatorCandidate } from "@/types/synthetics";
import {
  isFrameworkGeneratedId,
  isFullyPositional,
  isPositionalSelector,
} from "./locatorStability";

const c = (kind: LocatorCandidate["kind"], value: string): LocatorCandidate => ({ kind, value });

describe("isPositionalSelector", () => {
  it("recognises every positional shape the generator emits", () => {
    // `nth=` engine token — chooseFirstSelector's last resort.
    expect(isPositionalSelector('[data-test="row"] >> nth=1')).toBe(true);
    // Chained CSS positional — joinTokens.
    expect(isPositionalSelector("div >> :nth-match(button, 2)")).toBe(true);
    // Ancestor-chain positional — cssFallback.
    expect(isPositionalSelector("body > div:nth-child(3) > span")).toBe(true);
  });

  it("does not flag a stable selector", () => {
    expect(isPositionalSelector('[data-test="login-sign-in"]')).toBe(false);
    expect(isPositionalSelector('internal:role=button[name="Sign In"i]')).toBe(false);
  });

  it("treats `nth` inside recorded text as content, not an index", () => {
    expect(isPositionalSelector('internal:text="10th anniversary"i')).toBe(false);
  });
});

describe("isFullyPositional", () => {
  it("is true only when the recorder could not identify the element at all", () => {
    expect(
      isFullyPositional([
        c("test_attribute", '[data-test="row"] >> nth=1'),
        c("css", "div >> internal:has-text=/^Acme$/ >> nth=0"),
      ]),
    ).toBe(true);
  });

  it("is false when any candidate is unambiguous", () => {
    expect(
      isFullyPositional([
        c("test_attribute", '[data-test="row"] >> nth=1'),
        c("role", 'internal:role=button[name="Save"i]'),
      ]),
    ).toBe(false);
  });

  it("is false for an empty bundle — nothing to report", () => {
    expect(isFullyPositional([])).toBe(false);
  });
});

describe("isFrameworkGeneratedId", () => {
  it("recognises per-render ids from the component libraries in use", () => {
    expect(isFrameworkGeneratedId("#reka-popover-trigger-v-21")).toBe(true);
    expect(isFrameworkGeneratedId("#radix-:r3:")).toBe(true);
    expect(isFrameworkGeneratedId('[id=":r1a\\:"]')).toBe(true);
    expect(isFrameworkGeneratedId("div[_ngcontent-abc-c12]")).toBe(true);
    expect(isFrameworkGeneratedId(".css-1q2w3e4")).toBe(true);
    expect(isFrameworkGeneratedId('[data-v-7ba5bd90]')).toBe(true);
  });

  // Upstream's own isGuidLike happens to catch Vue's useId() output while the
  // counter stays under three digits, and stops at #v-100 — so these slipped
  // through on exactly the long-lived pages where they matter most.
  it("catches Vue useId() past the point isGuidLike gives up", () => {
    expect(isFrameworkGeneratedId("#v-0")).toBe(true);
    expect(isFrameworkGeneratedId("#v-99")).toBe(true);
    expect(isFrameworkGeneratedId("#v-100")).toBe(true);
    expect(isFrameworkGeneratedId("#v-1-2")).toBe(true);
  });

  it("leaves author-written ids and classes alone", () => {
    expect(isFrameworkGeneratedId("#main-content")).toBe(false);
    expect(isFrameworkGeneratedId(".css-grid-wrapper")).toBe(false);
    expect(isFrameworkGeneratedId('[data-test="login-sign-in"]')).toBe(false);
    expect(isFrameworkGeneratedId("#version-banner")).toBe(false);
  });
});

// The ranking mirror is gone. `rankCandidates` and `LOCATOR_KIND_RANK` copied
// the recorder's sort so the editor could show what it would produce; the
// recorder does not sort any more, and the order is the author's.
describe("the ranking mirror", () => {
  it("no longer exists", async () => {
    const mod = await import("./locatorStability");
    expect("rankCandidates" in mod).toBe(false);
    expect("LOCATOR_KIND_RANK" in mod).toBe(false);
  });
});
