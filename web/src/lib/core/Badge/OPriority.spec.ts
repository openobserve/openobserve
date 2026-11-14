// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OPriority from "./OPriority.vue";

describe("OPriority", () => {
  it("renders P1–P3 as mono text with radius 4", () => {
    for (const level of [1, 2, 3] as const) {
      const w = mount(OPriority, { props: { level } });
      expect(w.text()).toBe(`P${level}`);
      expect(w.classes()).toEqual(expect.arrayContaining(["font-mono", "rounded-chip"]));
    }
  });

  it("separates the levels by weight, not hue", () => {
    expect(mount(OPriority, { props: { level: 1 } }).classes()).toContain("bg-text-heading");
    expect(mount(OPriority, { props: { level: 2 } }).classes()).toContain("ring-1");
    expect(mount(OPriority, { props: { level: 3 } }).classes()).toContain("text-text-secondary");
  });
});
