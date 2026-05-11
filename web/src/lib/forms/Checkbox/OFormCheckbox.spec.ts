// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { h } from "vue";
import OFormCheckbox from "./OFormCheckbox.vue";
import OForm from "../Form/OForm.vue";

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

  // Validator errors are gated by tanstack-form's `isTouched`, which only
  // flips on `handleBlur`. OCheckbox never emits blur, so OFormCheckbox must
  // call handleBlur after handleChange — otherwise errors never render.
  it("shows validator error after toggling (handleBlur fires isTouched)", async () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { accepted: false } },
      slots: {
        default: () =>
          h(OFormCheckbox, {
            name: "accepted",
            label: "Accept terms",
            validators: [
              (v: unknown) => (v !== true ? "Required" : undefined),
            ],
          }),
      },
      global: { components: { OFormCheckbox } },
    });
    // First click toggles to true (passes validation, no error)
    await wrapper.find("button").trigger("click");
    await flushPromises();
    // Toggle back to false — validator should now fail and error should show
    await wrapper.find("button").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("Required");
  });
});
