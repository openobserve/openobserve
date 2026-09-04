// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { h } from "vue";
import OFormSwitch from "./OFormSwitch.vue";
import OForm from "../Form/OForm.vue";
import { z } from "zod";

describe("OFormSwitch", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders inside OForm without errors", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { enabled: false } },
      slots: {
        default: '<OFormSwitch name="enabled" label="Enable feature" />',
      },
      global: {
        components: { OFormSwitch },
      },
    });
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.find("button").exists()).toBe(true);
  });

  // Schema-only: validation comes from the OForm :schema; submit reveals it.
  it("shows schema error after submit when enabled is true", async () => {
    wrapper = mount(OForm, {
      props: {
        defaultValues: { enabled: false },
        schema: z.object({
          enabled: z.boolean().refine((v) => v !== true, "Not allowed"),
        }),
      },
      slots: {
        default: () => h(OFormSwitch, { name: "enabled", label: "Enable" }),
      },
      global: { components: { OFormSwitch } },
    });
    const form = (
      wrapper.vm as unknown as {
        form: {
          handleSubmit: () => Promise<unknown>;
          setFieldValue: (n: string, v: unknown) => void;
        };
      }
    ).form;
    form.setFieldValue("enabled", true);
    await form.handleSubmit();
    await flushPromises();
    expect(wrapper.text()).toContain("Not allowed");
  });
});
