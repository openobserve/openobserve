// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { h } from "vue";
import OFormColor from "./OFormColor.vue";
import OForm from "../Form/OForm.vue";

describe("OFormColor", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders inside OForm without errors", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { brand: "#3b82f6" } },
      slots: {
        default: () => h(OFormColor, { name: "brand", label: "Brand" }),
      },
      global: { components: { OFormColor } },
    });
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.find("input[type='text']").exists()).toBe(true);
  });

  it("propagates the default value", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { brand: "#abcdef" } },
      slots: {
        default: () => h(OFormColor, { name: "brand" }),
      },
      global: { components: { OFormColor } },
    });
    const text = wrapper.find("input[type='text']").element as HTMLInputElement;
    expect(text.value).toBe("#abcdef");
  });

  it("shows validator error after typing an invalid hex", async () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { brand: "" } },
      slots: {
        default: () =>
          h(OFormColor, {
            name: "brand",
            validators: [
              (v: string) =>
                v && !/^#[0-9a-fA-F]{6}$/.test(v) ? "Invalid hex" : undefined,
            ],
          }),
      },
      global: { components: { OFormColor } },
    });
    const text = wrapper.find("input[type='text']");
    await text.setValue("xyz");
    await text.trigger("blur");
    await flushPromises();
    expect(wrapper.text()).toContain("Invalid hex");
  });
});
