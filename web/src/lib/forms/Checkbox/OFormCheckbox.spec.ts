// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
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
});
