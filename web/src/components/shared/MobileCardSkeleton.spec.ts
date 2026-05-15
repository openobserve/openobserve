// Copyright 2026 OpenObserve Inc.
// Licensed under AGPL v3.

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import MobileCardSkeleton from "./MobileCardSkeleton.vue";

describe("MobileCardSkeleton", () => {
  it("renders the requested number of skeleton rows", () => {
    const wrapper = mount(MobileCardSkeleton, { props: { count: 3 } });
    expect(wrapper.findAll(".mobile-card-skeleton__row")).toHaveLength(3);
  });

  it("defaults to 4 rows when count is omitted", () => {
    const wrapper = mount(MobileCardSkeleton);
    expect(wrapper.findAll(".mobile-card-skeleton__row")).toHaveLength(4);
  });

  it("exposes aria-busy=true for assistive tech", () => {
    const wrapper = mount(MobileCardSkeleton);
    expect(wrapper.attributes("aria-busy")).toBe("true");
    expect(wrapper.attributes("aria-live")).toBe("polite");
  });

  it("applies the custom height to every row", () => {
    const wrapper = mount(MobileCardSkeleton, {
      props: { count: 2, height: "90px" },
    });
    wrapper
      .findAll(".mobile-card-skeleton__row")
      .forEach((row) => expect(row.attributes("style")).toContain("height: 90px"));
  });
});
