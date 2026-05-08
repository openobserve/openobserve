// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OSwitch from "./OSwitch.vue";

describe("OSwitch", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders without errors", () => {
    wrapper = mount(OSwitch);
    expect(wrapper.exists()).toBe(true);
  });

  it("renders label when prop is provided", () => {
    wrapper = mount(OSwitch, { props: { label: "Enable notifications" } });
    expect(wrapper.text()).toContain("Enable notifications");
  });

  it("renders label slot when provided", () => {
    wrapper = mount(OSwitch, {
      slots: { label: "<strong>Custom</strong>" },
    });
    expect(wrapper.html()).toContain("Custom");
  });

  it("emits update:modelValue with true when toggled on", async () => {
    wrapper = mount(OSwitch, { props: { modelValue: false } });
    await wrapper.find("button").trigger("click");
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toBe(true);
  });

  it("emits change event when toggled", async () => {
    wrapper = mount(OSwitch, { props: { modelValue: false } });
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("change")).toBeTruthy();
  });

  it("is disabled when disabled prop is true", () => {
    wrapper = mount(OSwitch, { props: { disabled: true } });
    expect(wrapper.find("button").attributes("disabled")).toBeDefined();
  });

  it("applies sm track size classes", () => {
    wrapper = mount(OSwitch, { props: { size: "sm" } });
    expect(wrapper.find("button").classes()).toContain("tw:w-7");
  });

  it("applies md track size classes by default", () => {
    wrapper = mount(OSwitch);
    expect(wrapper.find("button").classes()).toContain("tw:w-9");
  });

  it("applies lg track size classes", () => {
    wrapper = mount(OSwitch, { props: { size: "lg" } });
    expect(wrapper.find("button").classes()).toContain("tw:w-11");
  });

  it("renders label before switch when labelPosition is left", () => {
    wrapper = mount(OSwitch, {
      props: { label: "My label", labelPosition: "left" },
    });
    expect(wrapper.find("label").classes()).toContain("tw:flex-row-reverse");
  });

  it("emits checkedValue when toggled on with custom values", async () => {
    wrapper = mount(OSwitch, {
      props: { modelValue: "no", checkedValue: "yes", uncheckedValue: "no" },
    });
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("update:modelValue")![0][0]).toBe("yes");
  });

  it("emits uncheckedValue when toggled off with custom values", async () => {
    wrapper = mount(OSwitch, {
      props: { modelValue: "yes", checkedValue: "yes", uncheckedValue: "no" },
    });
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("update:modelValue")![0][0]).toBe("no");
  });
});
