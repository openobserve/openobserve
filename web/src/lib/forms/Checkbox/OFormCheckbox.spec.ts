// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { h } from "vue";
import OFormCheckbox from "./OFormCheckbox.vue";
import OForm from "../Form/OForm.vue";
import { z } from "zod";

describe("OFormCheckbox", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders inside OForm without errors", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { accepted: false } },
      slots: {
        default: '<OFormCheckbox name="accepted" label="Accept terms" />',
      },
      global: {
        components: { OFormCheckbox },
      },
    });
    expect(wrapper.exists()).toBe(true);
  });

  // Schema-only: validation comes from the OForm :schema. Submit-then-change
  // timing keeps errors hidden until the first submit, then they show.
  it("shows schema error after submit when unchecked", async () => {
    wrapper = mount(OForm, {
      props: {
        defaultValues: { accepted: false },
        schema: z.object({
          accepted: z.boolean().refine((v) => v === true, "Required"),
        }),
      },
      slots: {
        default: () => h(OFormCheckbox, { name: "accepted", label: "Accept terms" }),
      },
      global: { components: { OFormCheckbox } },
    });
    await (
      wrapper.vm as unknown as { form: { handleSubmit: () => Promise<unknown> } }
    ).form.handleSubmit();
    await flushPromises();
    expect(wrapper.text()).toContain("Required");
  });
});
