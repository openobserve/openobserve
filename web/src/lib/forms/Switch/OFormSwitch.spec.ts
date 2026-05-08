// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
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
});
