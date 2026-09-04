// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { h } from "vue";
import OFormOptionGroup from "./OFormOptionGroup.vue";
import OForm from "../Form/OForm.vue";
import { z } from "zod";

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

  it("shows schema error after submit when nothing selected", async () => {
    wrapper = mount(OForm, {
      props: {
        defaultValues: { fruits: [] as string[] },
        schema: z.object({
          fruits: z.array(z.string()).min(1, "Pick one"),
        }),
      },
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
    await (
      wrapper.vm as unknown as { form: { handleSubmit: () => Promise<unknown> } }
    ).form.handleSubmit();
    await flushPromises();
    expect(wrapper.text()).toContain("Pick one");
  });
});
