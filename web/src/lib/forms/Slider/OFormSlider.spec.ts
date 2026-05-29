// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { h } from "vue";
import OFormSlider from "./OFormSlider.vue";
import OForm from "../Form/OForm.vue";

describe("OFormSlider", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders inside OForm without errors", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { volume: 25 } },
      slots: {
        default: () =>
          h(OFormSlider, { name: "volume", label: "Volume", min: 0, max: 100 }),
      },
      global: { components: { OFormSlider } },
    });
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.find("input[type='range']").exists()).toBe(true);
  });

  it("renders the default value from the form", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { volume: 35 } },
      slots: {
        default: () =>
          h(OFormSlider, { name: "volume", min: 0, max: 100 }),
      },
      global: { components: { OFormSlider } },
    });
    const input = wrapper.find("input").element as HTMLInputElement;
    expect(Number(input.value)).toBe(35);
  });

  it("shows validator error after change (handleBlur fires isTouched)", async () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { volume: 50 } },
      slots: {
        default: () =>
          h(OFormSlider, {
            name: "volume",
            min: 0,
            max: 100,
            validators: [(v: number) => (v > 80 ? "Too loud" : undefined)],
          }),
      },
      global: { components: { OFormSlider } },
    });
    const input = wrapper.find("input");
    await input.setValue("95");
    await flushPromises();
    expect(wrapper.text()).toContain("Too loud");
  });
});
