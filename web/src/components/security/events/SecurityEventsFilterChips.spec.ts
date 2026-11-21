// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import i18n from "@/locales";
import type { FieldFilter } from "@/utils/security/eventQuery";
import SecurityEventsFilterChips from "./SecurityEventsFilterChips.vue";

const chipText = (filter: FieldFilter) =>
  mount(SecurityEventsFilterChips, {
    props: { filters: [filter] },
    global: { plugins: [i18n] },
  })
    .find('[data-test="security-events-filter-0"]')
    .text()
    .replace(/\s+/g, " ");

describe("SecurityEventsFilterChips", () => {
  it("reads a null test as Is Null / Is Not Null", () => {
    expect(chipText({ field: "user", op: "is_null", value: "null" })).toContain("user Is Null");
    expect(chipText({ field: "user", op: "is_not_null", value: "null" })).toContain(
      "user Is Not Null",
    );
  });

  it("shows an operator named like a prototype member as written, not as a null test (F9)", () => {
    const op = "constructor" as FieldFilter["op"];
    const text = chipText({ field: "user", op, value: "x" });
    expect(text).toContain("user constructor x");
    expect(text).not.toContain("Is Null");
    expect(chipText({ field: "user", op: "toString" as FieldFilter["op"], value: "y" })).toContain(
      "user toString y",
    );
  });

  it("keeps the symbols of the value operators", () => {
    expect(chipText({ field: "user", op: "!=", value: "root" })).toContain("user ≠ root");
  });
});
