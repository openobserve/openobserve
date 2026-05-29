// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OCheckbox from "./OCheckbox.vue";

describe("OCheckbox", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders without errors", () => {
    wrapper = mount(OCheckbox);
    expect(wrapper.exists()).toBe(true);
  });

  it("renders a label when provided via prop", () => {
    wrapper = mount(OCheckbox, { props: { label: "Accept terms" } });
    expect(wrapper.text()).toContain("Accept terms");
  });

  it("renders a label slot when provided", () => {
    wrapper = mount(OCheckbox, {
      slots: { label: "<span>Custom label</span>" },
    });
    expect(wrapper.html()).toContain("Custom label");
  });

  it("emits update:modelValue with true when clicked on unchecked checkbox", async () => {
    wrapper = mount(OCheckbox, { props: { modelValue: false } });
    await wrapper.find("button").trigger("click");
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toBe(true);
  });

  it("is disabled when disabled prop is true", () => {
    wrapper = mount(OCheckbox, { props: { disabled: true } });
    const root = wrapper.find("button");
    expect(root.attributes("disabled")).toBeDefined();
  });

  it("applies sm size classes", () => {
    wrapper = mount(OCheckbox, { props: { size: "sm" } });
    expect(wrapper.find("button").classes()).toContain("tw:size-3.5");
  });

  it("applies xs size classes", () => {
    wrapper = mount(OCheckbox, { props: { size: "xs" } });
    expect(wrapper.find("button").classes()).toContain("tw:size-3");
  });

  it("applies md size classes by default", () => {
    wrapper = mount(OCheckbox);
    expect(wrapper.find("button").classes()).toContain("tw:size-4");
  });

  it("supports val alias with array model", async () => {
    wrapper = mount(OCheckbox, {
      props: {
        modelValue: ["a"],
        val: "b",
      },
    });

    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("update:modelValue")?.[0]?.[0]).toEqual(["a", "b"]);
  });

  it("supports custom true/false values", async () => {
    wrapper = mount(OCheckbox, {
      props: {
        modelValue: "N",
        trueValue: "Y",
        falseValue: "N",
      },
    });

    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("update:modelValue")?.[0]?.[0]).toBe("Y");
  });

});
