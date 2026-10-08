// @vitest-environment jsdom
// Copyright 2026 OpenObserve Inc.

import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import OBanner from "./OBanner.vue";

const stubs = { OIcon: true };

describe("OBanner — preserveWhitespace", () => {
  // Off by default: every existing caller of OBanner keeps its exact current
  // layout unless it opts in.
  it("does not force wrapping by default", () => {
    const wrapper = mount(OBanner, {
      props: { variant: "error" },
      slots: { default: "a very long unbroken run of text" },
      global: { stubs },
    });
    const row = wrapper.get(":scope > div:first-child");
    const content = row.get(":scope > div:last-child");
    expect(content.classes()).not.toContain("whitespace-pre-wrap");
    expect(content.classes()).not.toContain("min-w-0");
    expect(row.classes()).not.toContain("min-w-0");
  });

  // The actual fix: preserve newlines/spaces, allow a long unbroken token to
  // wrap, and let the flex row shrink far enough for that wrapping to ever
  // kick in (min-w-0) — without min-w-0 the wrap classes alone do nothing.
  it("wraps content and lets the row shrink when set", () => {
    const wrapper = mount(OBanner, {
      props: { variant: "error", preserveWhitespace: true },
      slots: { default: "a very long unbroken run of text" },
      global: { stubs },
    });
    const row = wrapper.get(":scope > div:first-child");
    const content = row.get(":scope > div:last-child");
    expect(row.classes()).toContain("min-w-0");
    expect(content.classes()).toContain("min-w-0");
    expect(content.classes()).toContain("whitespace-pre-wrap");
    expect(content.classes()).toContain("wrap-break-word");
  });
});

describe("OBanner — textSize and colors", () => {
  it("keeps the compact bar scale unless a size is asked for", () => {
    const bar = mount(OBanner, { props: { bar: true }, global: { stubs } });
    expect(bar.classes()).toContain("text-compact");

    const large = mount(OBanner, { props: { bar: true, textSize: "large" }, global: { stubs } });
    expect(large.classes()).toContain("text-base");
    expect(large.classes()).not.toContain("text-compact");
  });

  it("paints runtime colours in place of the variant's tokens", () => {
    const wrapper = mount(OBanner, {
      props: { bar: true, variant: "info", colors: { background: "#1E3A8A", text: "#FFFFFF" } },
      global: { stubs },
    });

    expect(wrapper.classes()).not.toContain("bg-banner-info-bg");
    expect(wrapper.classes()).toContain("bg-banner-custom-bg");
    expect(wrapper.attributes("style")).toContain("--color-banner-custom-bg: #1E3A8A");
  });
});
