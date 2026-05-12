// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import ORadioGroup from "./ORadioGroup.vue";
import ORadio from "./ORadio.vue";

describe("ORadioGroup", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders without errors", () => {
    wrapper = mount(ORadioGroup);
    expect(wrapper.exists()).toBe(true);
  });

  it("emits update:modelValue when a radio is clicked", async () => {
    wrapper = mount(ORadioGroup, {
      props: { modelValue: "" },
      slots: {
        default: [
          '<ORadio value="a" label="A" />',
          '<ORadio value="b" label="B" />',
        ],
      },
      global: { components: { ORadio } },
    });
    await wrapper.findAll("button")[0].trigger("click");
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toBe("a");
  });

  it("preserves numeric value type on emit", async () => {
    wrapper = mount(ORadioGroup, {
      props: { modelValue: 0 },
      slots: {
        default: '<ORadio :value="2" label="Two" />',
      },
      global: { components: { ORadio } },
    });

    await wrapper.find("button").trigger("click");
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(typeof emitted![0][0]).toBe("number");
    expect(emitted![0][0]).toBe(2);
  });

  it("renders vertical layout by default", () => {
    wrapper = mount(ORadioGroup);
    expect(wrapper.find("div[role]").classes()).toContain("tw:flex-col");
  });

  it("renders horizontal layout when orientation is horizontal", () => {
    wrapper = mount(ORadioGroup, {
      props: { orientation: "horizontal" },
    });
    expect(wrapper.find("div[role]").classes()).toContain("tw:flex-row");
  });
});
