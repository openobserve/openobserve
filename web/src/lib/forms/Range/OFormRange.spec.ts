// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { h } from "vue";
import OFormRange from "./OFormRange.vue";
import OForm from "../Form/OForm.vue";

describe("OFormRange", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders inside OForm without errors", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { priceRange: { min: 20, max: 80 } } },
      slots: {
        default: () =>
          h(OFormRange, {
            name: "priceRange",
            min: 0,
            max: 100,
            label: "Price",
          }),
      },
      global: { components: { OFormRange } },
    });
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.findAll("input[type='range']")).toHaveLength(2);
  });

  it("renders default values from the form", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { priceRange: { min: 15, max: 65 } } },
      slots: {
        default: () =>
          h(OFormRange, { name: "priceRange", min: 0, max: 100 }),
      },
      global: { components: { OFormRange } },
    });
    const inputs = wrapper.findAll("input");
    expect(Number((inputs[0].element as HTMLInputElement).value)).toBe(15);
    expect(Number((inputs[1].element as HTMLInputElement).value)).toBe(65);
  });

  it("shows validator error after change", async () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { priceRange: { min: 10, max: 20 } } },
      slots: {
        default: () =>
          h(OFormRange, {
            name: "priceRange",
            min: 0,
            max: 100,
            validators: [
              (v: { min: number; max: number }) =>
                v.max - v.min < 30 ? "Range too narrow" : undefined,
            ],
          }),
      },
      global: { components: { OFormRange } },
    });
    const inputs = wrapper.findAll("input");
    await inputs[1].setValue("25");
    await flushPromises();
    expect(wrapper.text()).toContain("Range too narrow");
  });
});
