// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OCheckboxGroup from "./OCheckboxGroup.vue";
import OCheckbox from "./OCheckbox.vue";

describe("OCheckboxGroup", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders without errors", () => {
    wrapper = mount(OCheckboxGroup);
    expect(wrapper.exists()).toBe(true);
  });

  it("renders slotted checkboxes", () => {
    wrapper = mount(OCheckboxGroup, {
      props: { modelValue: [] },
      slots: {
        default: [
          '<OCheckbox value="a" label="A" />',
          '<OCheckbox value="b" label="B" />',
        ],
      },
      global: { components: { OCheckbox } },
    });
    expect(wrapper.findAllComponents(OCheckbox)).toHaveLength(2);
  });

  it("emits update:modelValue when a child checkbox is toggled", async () => {
    wrapper = mount(OCheckboxGroup, {
      props: { modelValue: [] },
      slots: { default: '<OCheckbox value="a" label="A" />' },
      global: { components: { OCheckbox } },
    });
    await wrapper.find("button").trigger("click");
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toContain("a");
  });
});
