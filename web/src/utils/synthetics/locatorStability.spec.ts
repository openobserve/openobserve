// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import type { LocatorCandidate } from "@/types/synthetics";
import {
  isFullyPositional,
  isPositionalSelector,
  LOCATOR_KIND_RANK,
  rankCandidates,
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

describe("rankCandidates", () => {
  it("puts a verified-unique candidate ahead of a positional one of any kind", () => {
    // The observed production shape: the org-switcher's test-attribute
    // candidate carries an index, so it is NOT evidence of a unique match.
    const ranked = rankCandidates([
      c("test_attribute", '[data-test="organization-menu-item-label-item-label"] >> nth=1'),
      c("role", 'internal:role=button[name="Save draft"i]'),
    ]);
    expect(ranked[0].value).toBe('internal:role=button[name="Save draft"i]');
  });

  it("keeps the documented kind order among non-positional candidates", () => {
    const ranked = rankCandidates([
      c("xpath", "//div/span"),
      c("css", ".btn"),
      c("text", 'internal:text="Save"i'),
      c("role", 'internal:role=button[name="Save"i]'),
      c("test_attribute", '[data-test="save"]'),
    ]);
    expect(ranked.map((x) => x.kind)).toEqual(["test_attribute", "role", "text", "css", "xpath"]);
  });

  it("is stable — ties keep the generator's own order", () => {
    const ranked = rankCandidates([c("css", ".a"), c("css", ".b"), c("css", ".c")]);
    expect(ranked.map((x) => x.value)).toEqual([".a", ".b", ".c"]);
  });

  it("leaves an all-positional bundle in its original order", () => {
    // Ranking cannot help here, which is why the editor has to say so instead.
    const input = [
      c("test_attribute", '[data-test="row"] >> nth=1'),
      c("css", "div >> internal:has-text=/^Acme$/ >> nth=0"),
    ];
    expect(rankCandidates(input).map((x) => x.value)).toEqual(input.map((x) => x.value));
  });

  it("does not mutate its input", () => {
    const input = [c("css", ".b"), c("test_attribute", '[data-test="a"]')];
    const before = input.map((x) => x.value);
    rankCandidates(input);
    expect(input.map((x) => x.value)).toEqual(before);
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

describe("parity with the recorder", () => {
  it("ranks kinds identically to crx KIND_RANK", () => {
    // Mirrored from crx/src/server/recorder/locatorBundle.ts. If that file
    // changes, this assertion is the thing that catches the drift.
    expect(LOCATOR_KIND_RANK).toEqual({
      test_attribute: 0,
      role: 1,
      text: 2,
      css: 3,
      xpath: 4,
    });
  });
});
