// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { h } from "vue";
import OFormOptionGroup from "./OFormOptionGroup.vue";
import OForm from "../Form/OForm.vue";

const fruits = [
  { value: "apple", label: "Apple" },
  { value: "banana", label: "Banana" },
];

describe("OFormOptionGroup", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders inside OForm without errors (radio)", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { fruit: "" } },
      slots: {
        default: () =>
          h(OFormOptionGroup, {
            name: "fruit",
            type: "radio",
            options: fruits,
            label: "Fruit",
          }),
      },
      global: { components: { OFormOptionGroup } },
    });
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.findAll("[role='radio']").length).toBe(2);
  });

  it("renders inside OForm without errors (checkbox)", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { fruits: [] as string[] } },
      slots: {
        default: () =>
          h(OFormOptionGroup, {
            name: "fruits",
            type: "checkbox",
            options: fruits,
          }),
      },
      global: { components: { OFormOptionGroup } },
    });
    expect(wrapper.findAll("[role='checkbox']").length).toBe(2);
  });

  it("shows validator error after selection", async () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { fruits: [] as string[] } },
      slots: {
        default: () =>
          h(OFormOptionGroup, {
            name: "fruits",
            type: "checkbox",
            options: fruits,
            validators: [
              (v: string | number | (string | number)[] | undefined) =>
                !Array.isArray(v) || v.length === 0 ? "Pick one" : undefined,
            ],
          }),
      },
      global: { components: { OFormOptionGroup } },
    });
    const boxes = wrapper.findAll("[role='checkbox']");
    await boxes[0].trigger("click");
    await boxes[0].trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("Pick one");
  });
});
