// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OColor from "./OColor.vue";

describe("OColor", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders a hex text input and a hidden color input", () => {
    wrapper = mount(OColor);
    expect(wrapper.find("input[type='text']").exists()).toBe(true);
    expect(wrapper.find("input[type='color']").exists()).toBe(true);
  });

  it("renders the label", () => {
    wrapper = mount(OColor, { props: { label: "Brand color" } });
    expect(wrapper.text()).toContain("Brand color");
  });

  it("emits update:modelValue when the hex text input is typed", async () => {
    wrapper = mount(OColor);
    await wrapper.find("input[type='text']").setValue("#ff0000");
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toBe("#ff0000");
  });

  it("emits update:modelValue when the color picker changes", async () => {
    wrapper = mount(OColor);
    await wrapper.find("input[type='color']").setValue("#00ff00");
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toBe("#00ff00");
  });

  it("falls back to #000000 swatch for invalid input", () => {
    wrapper = mount(OColor, { props: { modelValue: "not-a-color" } });
    const color = wrapper.find("input[type='color']").element as HTMLInputElement;
    expect(color.value).toBe("#000000");
  });

  it("uses modelValue as swatch when valid", () => {
    wrapper = mount(OColor, { props: { modelValue: "#abcdef" } });
    const color = wrapper.find("input[type='color']").element as HTMLInputElement;
    expect(color.value).toBe("#abcdef");
  });

  it("makes the hex input editable by default (typing is allowed)", () => {
    wrapper = mount(OColor);
    expect(
      wrapper.find("input[type='text']").attributes("readonly"),
    ).toBeUndefined();
  });

  it("makes the hex input read-only when readonly is true", () => {
    wrapper = mount(OColor, { props: { readonly: true } });
    expect(
      wrapper.find("input[type='text']").attributes("readonly"),
    ).toBeDefined();
  });

  it("pairs the swatch label with the hidden color input via for=", () => {
    wrapper = mount(OColor, { props: { label: "Brand" } });
    const colorInput = wrapper.find("input[type='color']");
    const colorId = colorInput.attributes("id");
    expect(colorId).toBeDefined();
    const swatchLabel = wrapper
      .findAll("label")
      .find((l) => l.attributes("for") === colorId);
    expect(swatchLabel?.exists()).toBe(true);
  });

  it("disables the input", () => {
    wrapper = mount(OColor, { props: { disabled: true } });
    expect(
      wrapper.find("input[type='text']").attributes("disabled"),
    ).toBeDefined();
    expect(
      wrapper.find("input[type='color']").attributes("disabled"),
    ).toBeDefined();
  });

  it("renders the error message", () => {
    wrapper = mount(OColor, { props: { errorMessage: "Invalid color" } });
    expect(wrapper.text()).toContain("Invalid color");
  });

  it("emits empty value when clear button pressed", async () => {
    wrapper = mount(OColor, {
      props: { clearable: true, modelValue: "#abcdef" },
    });
    await wrapper.find('[aria-label="Clear"]').trigger("click");
    expect(wrapper.emitted("update:modelValue")![0][0]).toBe("");
  });
});
