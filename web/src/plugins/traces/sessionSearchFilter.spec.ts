// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";

import { buildSessionSearchFilter, combineSessionFilters } from "./sessionSearchFilter";

describe("buildSessionSearchFilter", () => {
  it("returns an empty predicate for an empty or whitespace-only term", () => {
    expect(buildSessionSearchFilter("")).toBe("");
    expect(buildSessionSearchFilter("   ")).toBe("");
  });

  it("matches session id or user id, case-insensitively", () => {
    expect(buildSessionSearchFilter("acme")).toBe(
      "(str_match_ignore_case(gen_ai_conversation_id, 'acme')" +
        " OR str_match_ignore_case(user_id, 'acme'))",
    );
  });

  it("trims the term before building the predicate", () => {
    expect(buildSessionSearchFilter("  acme  ")).toBe(buildSessionSearchFilter("acme"));
  });

  it("escapes single quotes so a term cannot break out of the SQL literal", () => {
    expect(buildSessionSearchFilter("o'brien")).toBe(
      "(str_match_ignore_case(gen_ai_conversation_id, 'o''brien')" +
        " OR str_match_ignore_case(user_id, 'o''brien'))",
    );
    expect(buildSessionSearchFilter("' OR 1=1 --")).toContain("''' OR 1=1 --'");
  });
});

describe("combineSessionFilters", () => {
  it("returns an empty string when nothing is active", () => {
    expect(combineSessionFilters()).toBe("");
    expect(combineSessionFilters("", "  ")).toBe("");
  });

  it("passes a lone clause through unwrapped", () => {
    expect(combineSessionFilters("", "a = 'b'")).toBe("a = 'b'");
  });

  it("parenthesises and ANDs multiple clauses so precedence cannot leak", () => {
    expect(combineSessionFilters("a = 'b' AND c = 'd'", "x OR y")).toBe(
      "(a = 'b' AND c = 'd') AND (x OR y)",
    );
  });
});
