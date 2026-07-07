// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { h } from "vue";
import OFormCombobox from "./OFormCombobox.vue";
import OForm from "../Form/OForm.vue";
import { z } from "zod";

const items = [
  { label: "Series 1", value: "series1" },
  { label: "Series 2", value: "series2" },
];

const driveSubmit = async (w: VueWrapper) => {
  await (
    w.vm as unknown as { form: { handleSubmit: () => Promise<unknown> } }
  ).form.handleSubmit();
  await flushPromises();
};

describe("OFormCombobox", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders inside OForm without errors", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { series: "" } },
      slots: {
        default: () => h(OFormCombobox, { name: "series", items }),
      },
      global: { components: { OFormCombobox } },
    });
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.find("input").exists()).toBe(true);
  });

  it("propagates the default value into the input", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { series: "series1" } },
      slots: {
        default: () => h(OFormCombobox, { name: "series", items }),
      },
      global: { components: { OFormCombobox } },
    });
    const input = wrapper.find("input").element as HTMLInputElement;
    expect(input.value).toBe("series1");
  });

  it("shows no error before the first submit (R3)", () => {
    wrapper = mount(OForm, {
      props: {
        defaultValues: { series: "" },
        schema: z.object({ series: z.string().min(1, "Series is required") }),
      },
      slots: {
        default: () => h(OFormCombobox, { name: "series", items }),
      },
      global: { components: { OFormCombobox } },
    });
    expect(wrapper.text()).not.toContain("Series is required");
  });

  it("shows the schema error after submit when empty", async () => {
    wrapper = mount(OForm, {
      props: {
        defaultValues: { series: "" },
        schema: z.object({ series: z.string().min(1, "Series is required") }),
      },
      slots: {
        default: () => h(OFormCombobox, { name: "series", items }),
      },
      global: { components: { OFormCombobox } },
    });
    await driveSubmit(wrapper);
    expect(wrapper.text()).toContain("Series is required");
  });

  it("clears the error on change after submit", async () => {
    wrapper = mount(OForm, {
      props: {
        defaultValues: { series: "" },
        schema: z.object({ series: z.string().min(1, "Series is required") }),
      },
      slots: {
        default: () => h(OFormCombobox, { name: "series", items }),
      },
      global: { components: { OFormCombobox } },
    });
    await driveSubmit(wrapper);
    expect(wrapper.text()).toContain("Series is required");

    const input = wrapper.find("input");
    await input.setValue("series1");
    await flushPromises();
    expect(wrapper.text()).not.toContain("Series is required");
  });

  it("forwards the value into the form (drives validity)", async () => {
    wrapper = mount(OForm, {
      props: {
        defaultValues: { series: "" },
        schema: z.object({ series: z.string().min(1, "Series is required") }),
      },
      slots: {
        default: () => h(OFormCombobox, { name: "series", items }),
      },
      global: { components: { OFormCombobox } },
    });
    const form = (wrapper.vm as any).form;
    expect(form.state.isValid).toBe(true); // not validated until submit

    await driveSubmit(wrapper);
    expect(form.state.isValid).toBe(false);

    form.setFieldValue("series", "series1");
    await driveSubmit(wrapper);
    expect(form.state.isValid).toBe(true);
  });
});
