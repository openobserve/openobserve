// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OToggle from "./OToggle.vue";

describe("OToggle", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders without errors", () => {
    wrapper = mount(OToggle);
    expect(wrapper.exists()).toBe(true);
  });

  it("renders label when prop is provided", () => {
    wrapper = mount(OToggle, { props: { label: "Enable notifications" } });
    expect(wrapper.text()).toContain("Enable notifications");
  });

  it("renders label slot when provided", () => {
    wrapper = mount(OToggle, {
      slots: { label: "<strong>Custom</strong>" },
    });
    expect(wrapper.html()).toContain("Custom");
  });

  it("emits update:modelValue with true when toggled on", async () => {
    wrapper = mount(OToggle, { props: { modelValue: false } });
    await wrapper.find("button").trigger("click");
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toBe(true);
  });

  it("emits change event when toggled", async () => {
    wrapper = mount(OToggle, { props: { modelValue: false } });
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("change")).toBeTruthy();
  });

  it("is disabled when disabled prop is true", () => {
    wrapper = mount(OToggle, { props: { disabled: true } });
    expect(wrapper.find("button").attributes("disabled")).toBeDefined();
  });

  it("applies sm track size classes", () => {
    wrapper = mount(OToggle, { props: { size: "sm" } });
    expect(wrapper.find("button").classes()).toContain("tw:w-7");
  });

  it("applies md track size classes by default", () => {
    wrapper = mount(OToggle);
    expect(wrapper.find("button").classes()).toContain("tw:w-9");
  });

  it("applies lg track size classes", () => {
    wrapper = mount(OToggle, { props: { size: "lg" } });
    expect(wrapper.find("button").classes()).toContain("tw:w-11");
  });

  it("renders label before switch when labelPlacement is start", () => {
    wrapper = mount(OToggle, {
      props: { label: "My label", labelPlacement: "start" },
    });
    expect(wrapper.find("label").classes()).toContain("tw:flex-row-reverse");
  });

  it("renders checked icon text when provided", () => {
    wrapper = mount(OToggle, {
      props: { modelValue: true, checkedIcon: "check" },
    });
    expect(wrapper.text()).toContain("check");
  });
});
