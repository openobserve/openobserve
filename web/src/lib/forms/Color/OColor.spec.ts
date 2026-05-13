// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OColor from "./OColor.vue";

describe("OColor", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("should render a hex text input", () => {
    wrapper = mount(OColor);
    expect(wrapper.find("input[type='text']").exists()).toBe(true);
  });

  it("should render a swatch trigger button", () => {
    wrapper = mount(OColor);
    expect(wrapper.find("button[aria-label*='color']").exists()).toBe(true);
  });

  it("should render the label", () => {
    wrapper = mount(OColor, { props: { label: "Brand color" } });
    expect(wrapper.text()).toContain("Brand color");
  });

  it("should emit update:modelValue when the hex text input changes", async () => {
    wrapper = mount(OColor);
    await wrapper.find("input[type='text']").setValue("#ff0000");
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toBe("#ff0000");
  });

  it("should not render a clear button when value is empty", () => {
    wrapper = mount(OColor, { props: { clearable: true, modelValue: "" } });
    expect(wrapper.find('[aria-label="Clear"]').exists()).toBe(false);
  });

  it("should make the hex input read-only when readonly is true", () => {
    wrapper = mount(OColor, { props: { readonly: true } });
    expect(
      wrapper.find("input[type='text']").attributes("readonly"),
    ).toBeDefined();
  });

  it("should make the hex input editable by default", () => {
    wrapper = mount(OColor);
    expect(
      wrapper.find("input[type='text']").attributes("readonly"),
    ).toBeUndefined();
  });

  it("should disable the input when disabled is true", () => {
    wrapper = mount(OColor, { props: { disabled: true } });
    expect(
      wrapper.find("input[type='text']").attributes("disabled"),
    ).toBeDefined();
  });

  it("should render the error message", () => {
    wrapper = mount(OColor, { props: { errorMessage: "Invalid color" } });
    expect(wrapper.text()).toContain("Invalid color");
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
  });

  it("should render help text when no error", () => {
    wrapper = mount(OColor, { props: { helpText: "Enter a hex code" } });
    expect(wrapper.text()).toContain("Enter a hex code");
  });

  it("should emit empty string and 'clear' when clear button pressed", async () => {
    wrapper = mount(OColor, {
      props: { clearable: true, modelValue: "#abcdef" },
    });
    await wrapper.find('[aria-label="Clear"]').trigger("click");
    expect(wrapper.emitted("update:modelValue")![0][0]).toBe("");
    expect(wrapper.emitted("clear")).toBeTruthy();
  });

  it("should accept a valid hex modelValue without error", () => {
    expect(() => {
      wrapper = mount(OColor, { props: { modelValue: "#3b82f6" } });
    }).not.toThrow();
    expect(wrapper.find("input[type='text']").exists()).toBe(true);
  });

  it("should reflect the modelValue in the hex input", () => {
    wrapper = mount(OColor, { props: { modelValue: "#abcdef" } });
    const input = wrapper.find("input[type='text']").element as HTMLInputElement;
    expect(input.value).toBe("#abcdef");
  });
});
