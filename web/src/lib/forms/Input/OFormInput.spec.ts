// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OFormInput from "./OFormInput.vue";
import OForm from "../Form/OForm.vue";

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
});
