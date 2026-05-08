// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OInput from "./OInput.vue";

describe("OInput", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders without errors", () => {
    wrapper = mount(OInput);
    expect(wrapper.exists()).toBe(true);
  });

  it("renders a text input by default", () => {
    wrapper = mount(OInput);
    expect(wrapper.find("input").attributes("type")).toBe("text");
  });

  it("renders a textarea when type is textarea", () => {
    wrapper = mount(OInput, { props: { type: "textarea" } });
    expect(wrapper.find("textarea").exists()).toBe(true);
    expect(wrapper.find("input").exists()).toBe(false);
  });

  it("renders label when prop is provided", () => {
    wrapper = mount(OInput, { props: { label: "Username" } });
    expect(wrapper.find("label").text()).toBe("Username");
  });

  it("emits update:modelValue on input", async () => {
    wrapper = mount(OInput, { props: { modelValue: "" } });
    await wrapper.find("input").setValue("hello");
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toBe("hello");
  });

  it("shows error message when provided", () => {
    wrapper = mount(OInput, { props: { errorMessage: "Required field" } });
    expect(wrapper.text()).toContain("Required field");
  });

  it("shows hint when provided", () => {
    wrapper = mount(OInput, { props: { hint: "Enter your name" } });
    expect(wrapper.text()).toContain("Enter your name");
  });

  it("shows clear button when clearable and value is non-empty", () => {
    wrapper = mount(OInput, {
      props: { clearable: true, modelValue: "hello" },
    });
    expect(wrapper.find('button[aria-label="Clear"]').exists()).toBe(true);
  });

  it("does not show clear button when value is empty", () => {
    wrapper = mount(OInput, { props: { clearable: true, modelValue: "" } });
    expect(wrapper.find('button[aria-label="Clear"]').exists()).toBe(false);
  });

  it("emits clear event when clear button is clicked", async () => {
    wrapper = mount(OInput, {
      props: { clearable: true, modelValue: "hello" },
    });
    await wrapper.find('button[aria-label="Clear"]').trigger("click");
    expect(wrapper.emitted("clear")).toBeTruthy();
    expect(wrapper.emitted("update:modelValue")![0][0]).toBe("");
  });

  it("is disabled when disabled prop is true", () => {
    wrapper = mount(OInput, { props: { disabled: true } });
    expect(wrapper.find("input").attributes("disabled")).toBeDefined();
  });

  it("shows counter when maxlength is set", () => {
    wrapper = mount(OInput, {
      props: { maxlength: 20, modelValue: "hello" },
    });
    expect(wrapper.text()).toContain("5/20");
  });

  it("emits debounced update when debounce is set", async () => {
    vi.useFakeTimers();

    wrapper = mount(OInput, {
      props: { modelValue: "", debounce: 200 },
    });

    await wrapper.find("input").setValue("hello");
    expect(wrapper.emitted("update:modelValue")).toBeFalsy();

    vi.advanceTimersByTime(200);
    expect(wrapper.emitted("update:modelValue")?.[0]?.[0]).toBe("hello");

    vi.useRealTimers();
  });
});
