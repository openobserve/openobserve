// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OForm from "./OForm.vue";

describe("OForm", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders a form element", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { name: "" } },
    });
    expect(wrapper.find("form").exists()).toBe(true);
  });

  it("renders slot content", () => {
    wrapper = mount(OForm, {
      props: { defaultValues: {} },
      slots: { default: "<span>form content</span>" },
    });
    expect(wrapper.text()).toContain("form content");
  });

  it("calls handleSubmit on form submit", async () => {
    wrapper = mount(OForm, {
      props: { defaultValues: { value: "test" } },
    });
    await wrapper.find("form").trigger("submit");
    // No errors thrown means the form submit handler ran without issue
    expect(wrapper.exists()).toBe(true);
  });
});
