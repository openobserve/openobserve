// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { h } from "vue";
import OFormInput from "./OFormInput.vue";
import OForm from "../Form/OForm.vue";
import { z } from "zod";

describe("OFormInput", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders inside OForm without errors", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { name: "" } },
      slots: {
        default: '<OFormInput name="name" />',
      },
      global: {
        components: { OFormInput },
      },
    });
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.find("input").exists()).toBe(true);
  });

  it("renders a label when provided", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { email: "" } },
      slots: {
        default: '<OFormInput name="email" label="Email address" />',
      },
      global: {
        components: { OFormInput },
      },
    });
    expect(wrapper.find("label").text()).toBe("Email address");
  });

  it("shows the schema error message after submit by default", async () => {
    wrapper = mount(OForm, {
      props: {
        defaultValues: { name: "" },
        schema: z.object({ name: z.string().min(1, "Name is required") }),
      },
      slots: {
        default: () => h(OFormInput, { name: "name" }),
      },
      global: { components: { OFormInput } },
    });
    await (
      wrapper.vm as unknown as { form: { handleSubmit: () => Promise<unknown> } }
    ).form.handleSubmit();
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("Name is required");
  });

  it("suppresses the built-in error when an #error slot is provided", async () => {
    wrapper = mount(OForm, {
      props: {
        defaultValues: { name: "" },
        schema: z.object({ name: z.string().min(1, "Name is required") }),
      },
      slots: {
        // Composite-field usage: an (empty) #error slot keeps the field
        // form-owned (name=) but suppresses the inline message — the consumer
        // surfaces the error externally.
        default: () => h(OFormInput, { name: "name" }, { error: () => [] }),
      },
      global: { components: { OFormInput } },
    });
    await (
      wrapper.vm as unknown as { form: { handleSubmit: () => Promise<unknown> } }
    ).form.handleSubmit();
    await flushPromises();
    // Field still renders (and is still validated — the submit was blocked),
    // but no inline error row is shown.
    expect(wrapper.find("input").exists()).toBe(true);
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Name is required");
  });

  it("renders custom #error slot content while suppressing the built-in error", async () => {
    wrapper = mount(OForm, {
      props: {
        defaultValues: { name: "" },
        schema: z.object({ name: z.string().min(1, "Name is required") }),
      },
      slots: {
        // The #error slot OWNS the message — the consumer renders it (here in a
        // sibling); the built-in inline error is suppressed.
        default: () =>
          h(OFormInput, { name: "name" }, {
            error: () => h("div", { class: "external-error" }, "custom error"),
          }),
      },
      global: { components: { OFormInput } },
    });
    await (
      wrapper.vm as unknown as { form: { handleSubmit: () => Promise<unknown> } }
    ).form.handleSubmit();
    await flushPromises();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.find(".external-error").text()).toBe("custom error");
  });
});
