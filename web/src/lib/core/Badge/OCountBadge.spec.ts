// Copyright 2026 OpenObserve Inc.

import { describe, it, expect } from "vitest";
import { mount } from "@vue/test-utils";
import OCountBadge from "./OCountBadge.vue";

describe("OCountBadge", () => {
  it("renders a 16 px round tabular count, neutral by default", () => {
    const w = mount(OCountBadge, { props: { count: 3 } });
    expect(w.text()).toBe("3");
    expect(w.classes()).toEqual(
      expect.arrayContaining(["h-4", "min-w-4", "rounded-full", "tabular-nums"]),
    );
    expect(w.attributes("data-tone")).toBe("neutral");
  });

  it("caps at max", () => {
    expect(mount(OCountBadge, { props: { count: 120 } }).text()).toBe("99+");
    expect(mount(OCountBadge, { props: { count: 12, max: 9 } }).text()).toBe("9+");
    expect(mount(OCountBadge, { props: { count: 99 } }).text()).toBe("99");
  });

  it("is solid red only for the err tone", () => {
    expect(mount(OCountBadge, { props: { count: 1, tone: "err" } }).classes()).toContain(
      "bg-badge-error-solid-bg",
    );
    expect(mount(OCountBadge, { props: { count: 1, tone: "accent" } }).classes()).toContain(
      "bg-badge-primary-solid-bg",
    );
  });
});
