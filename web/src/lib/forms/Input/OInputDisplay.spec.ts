// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OInputDisplay from "./OInputDisplay.vue";

describe("OInputDisplay", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders without errors", () => {
    wrapper = mount(OInputDisplay);
    expect(wrapper.exists()).toBe(true);
  });

  it("renders label when prop is provided", () => {
    wrapper = mount(OInputDisplay, { props: { label: "Current value" } });
    expect(wrapper.text()).toContain("Current value");
  });

  it("renders slotted content", () => {
    wrapper = mount(OInputDisplay, {
      slots: { default: "<span>slot content</span>" },
    });
    expect(wrapper.html()).toContain("slot content");
  });

  it("renders placeholder when no slot is provided", () => {
    wrapper = mount(OInputDisplay, {
      props: { placeholder: "No value selected" },
    });
    expect(wrapper.text()).toContain("No value selected");
  });

  it("shows disabled styling when disabled prop is true", () => {
    wrapper = mount(OInputDisplay, { props: { disabled: true } });
    const box = wrapper.find("div > div");
    expect(box.classes().some((c) => c.includes("disabled"))).toBe(true);
  });
});
