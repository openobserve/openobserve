// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OTextarea from "./OTextarea.vue";

describe("OTextarea", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders without errors", () => {
    wrapper = mount(OTextarea);
    expect(wrapper.exists()).toBe(true);
  });

  it("renders a textarea element", () => {
    wrapper = mount(OTextarea);
    expect(wrapper.find("textarea").exists()).toBe(true);
  });

  it("renders label when prop is provided", () => {
    wrapper = mount(OTextarea, { props: { label: "Description" } });
    expect(wrapper.find("label").text()).toBe("Description");
  });

  it("emits update:modelValue on input", async () => {
    wrapper = mount(OTextarea, { props: { modelValue: "" } });
    await wrapper.find("textarea").setValue("hello world");
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toBe("hello world");
  });

  it("shows error message when provided", () => {
    wrapper = mount(OTextarea, {
      props: { errorMessage: "Required field" },
    });
    expect(wrapper.text()).toContain("Required field");
  });

  it("shows helpText when provided", () => {
    wrapper = mount(OTextarea, {
      props: { helpText: "Enter a description" },
    });
    expect(wrapper.text()).toContain("Enter a description");
  });

  it("is disabled when disabled prop is true", () => {
    wrapper = mount(OTextarea, { props: { disabled: true } });
    expect(wrapper.find("textarea").attributes("disabled")).toBeDefined();
  });

  it("shows counter when maxlength is set", () => {
    wrapper = mount(OTextarea, {
      props: { maxlength: 200, modelValue: "hello" },
    });
    expect(wrapper.text()).toContain("5/200");
  });
});
