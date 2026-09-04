// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import ORange from "./ORange.vue";

describe("ORange", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders two range inputs", () => {
    wrapper = mount(ORange);
    const inputs = wrapper.findAll("input[type='range']");
    expect(inputs).toHaveLength(2);
  });

  it("uses min/max defaults when modelValue is undefined", () => {
    wrapper = mount(ORange, { props: { min: 0, max: 100 } });
    const inputs = wrapper.findAll("input");
    expect(Number((inputs[0].element as HTMLInputElement).value)).toBe(0);
    expect(Number((inputs[1].element as HTMLInputElement).value)).toBe(100);
  });

  it("emits update:modelValue when min thumb changes", async () => {
    wrapper = mount(ORange, {
      props: { modelValue: { min: 10, max: 80 }, min: 0, max: 100 },
    });
    const inputs = wrapper.findAll("input");
    await inputs[0].setValue("25");
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toEqual({ min: 25, max: 80 });
  });

  it("emits update:modelValue when max thumb changes", async () => {
    wrapper = mount(ORange, {
      props: { modelValue: { min: 10, max: 80 }, min: 0, max: 100 },
    });
    const inputs = wrapper.findAll("input");
    await inputs[1].setValue("90");
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toEqual({ min: 10, max: 90 });
  });

  it("clamps min to never exceed max", async () => {
    wrapper = mount(ORange, {
      props: { modelValue: { min: 10, max: 50 }, min: 0, max: 100 },
    });
    const inputs = wrapper.findAll("input");
    await inputs[0].setValue("80");
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted![0][0]).toEqual({ min: 50, max: 50 });
  });

  it("clamps max to never go below min", async () => {
    wrapper = mount(ORange, {
      props: { modelValue: { min: 30, max: 80 }, min: 0, max: 100 },
    });
    const inputs = wrapper.findAll("input");
    await inputs[1].setValue("10");
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted![0][0]).toEqual({ min: 30, max: 30 });
  });

  it("disables both inputs when disabled is true", () => {
    wrapper = mount(ORange, { props: { disabled: true } });
    const inputs = wrapper.findAll("input");
    expect(inputs[0].attributes("disabled")).toBeDefined();
    expect(inputs[1].attributes("disabled")).toBeDefined();
  });

  it("renders the label", () => {
    wrapper = mount(ORange, { props: { label: "Price range" } });
    expect(wrapper.text()).toContain("Price range");
  });

  it("renders the value pair when showValue is true", () => {
    wrapper = mount(ORange, {
      props: { modelValue: { min: 20, max: 70 }, showValue: true },
    });
    expect(wrapper.text()).toContain("20");
    expect(wrapper.text()).toContain("70");
  });

  it("shows error message", () => {
    wrapper = mount(ORange, { props: { errorMessage: "Invalid range" } });
    expect(wrapper.text()).toContain("Invalid range");
  });
});
