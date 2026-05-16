// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { h } from "vue";
import OFormSwitch from "./OFormSwitch.vue";
import OForm from "../Form/OForm.vue";

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

  // Validator errors are gated by tanstack-form's `isTouched`, which only
  // flips on `handleBlur`. OSwitch never emits blur, so OFormSwitch must
  // call handleBlur after handleChange — otherwise errors never render.
  it("shows validator error after toggling (handleBlur fires isTouched)", async () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { enabled: false } },
      slots: {
        default: () =>
          h(OFormSwitch, {
            name: "enabled",
            label: "Enable",
            validators: [(v: unknown) => (v === true ? "Not allowed" : undefined)],
          }),
      },
      global: { components: { OFormSwitch } },
    });
    await wrapper.find("button").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("Not allowed");
  });
});
