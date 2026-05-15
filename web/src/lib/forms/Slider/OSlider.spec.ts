// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OSlider from "./OSlider.vue";

describe("OSlider", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders without errors", () => {
    wrapper = mount(OSlider);
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.find("input[type='range']").exists()).toBe(true);
  });

  it("renders the label when provided", () => {
    wrapper = mount(OSlider, { props: { label: "Volume" } });
    expect(wrapper.text()).toContain("Volume");
  });

  it("uses min as the value when modelValue is undefined", () => {
    wrapper = mount(OSlider, { props: { min: 10, max: 50 } });
    const input = wrapper.find("input").element as HTMLInputElement;
    expect(Number(input.value)).toBe(10);
  });

  it("emits update:modelValue when input changes", async () => {
    wrapper = mount(OSlider, { props: { modelValue: 20, min: 0, max: 100 } });
    const input = wrapper.find("input");
    await input.setValue("55");
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toBe(55);
  });

  it("emits change event", async () => {
    wrapper = mount(OSlider, { props: { modelValue: 20 } });
    const input = wrapper.find("input");
    (input.element as HTMLInputElement).value = "40";
    await input.trigger("change");
    expect(wrapper.emitted("change")).toBeTruthy();
    expect(wrapper.emitted("change")![0][0]).toBe(40);
  });

  it("is disabled when disabled prop is true", () => {
    wrapper = mount(OSlider, { props: { disabled: true } });
    expect(wrapper.find("input").attributes("disabled")).toBeDefined();
  });

  it("shows the value when showValue is true", () => {
    wrapper = mount(OSlider, {
      props: { modelValue: 42, showValue: true, label: "Vol" },
    });
    expect(wrapper.text()).toContain("42");
  });

  it("uses formatValue when provided", () => {
    wrapper = mount(OSlider, {
      props: {
        modelValue: 50,
        showValue: true,
        formatValue: (v: number) => `${v}%`,
      },
    });
    expect(wrapper.text()).toContain("50%");
  });

  it("shows the error message", () => {
    wrapper = mount(OSlider, { props: { errorMessage: "Too low" } });
    expect(wrapper.text()).toContain("Too low");
    expect(wrapper.find("input").attributes("aria-invalid")).toBe("true");
  });

  it("shows helpText when no error is present", () => {
    wrapper = mount(OSlider, { props: { helpText: "Pick a number" } });
    expect(wrapper.text()).toContain("Pick a number");
  });

  it("applies sm size by adjusting track height class", () => {
    wrapper = mount(OSlider, { props: { size: "sm" } });
    expect(wrapper.find("input").classes()).toContain("tw:h-1");
  });

  it("applies lg size by adjusting track height class", () => {
    wrapper = mount(OSlider, { props: { size: "lg" } });
    expect(wrapper.find("input").classes()).toContain("tw:h-2");
  });

  it("forwards the name attribute", () => {
    wrapper = mount(OSlider, { props: { name: "vol" } });
    expect(wrapper.find("input").attributes("name")).toBe("vol");
  });
});
