// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import ODate from "./ODate.vue";

describe("ODate", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders a date input", () => {
    wrapper = mount(ODate);
    const input = wrapper.find("input");
    expect(input.exists()).toBe(true);
    expect(input.attributes("type")).toBe("date");
  });

  it("renders the label", () => {
    wrapper = mount(ODate, { props: { label: "Date of birth" } });
    expect(wrapper.text()).toContain("Date of birth");
  });

  it("emits update:modelValue on input", async () => {
    wrapper = mount(ODate);
    const input = wrapper.find("input");
    await input.setValue("2024-06-15");
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toBe("2024-06-15");
  });

  it("passes through min and max attributes", () => {
    wrapper = mount(ODate, {
      props: { min: "2024-01-01", max: "2024-12-31" },
    });
    const input = wrapper.find("input");
    expect(input.attributes("min")).toBe("2024-01-01");
    expect(input.attributes("max")).toBe("2024-12-31");
  });

  it("renders an error message", () => {
    wrapper = mount(ODate, { props: { errorMessage: "Pick a date" } });
    expect(wrapper.text()).toContain("Pick a date");
    expect(wrapper.find("input").attributes("aria-invalid")).toBe("true");
  });

  it("renders help text when no error", () => {
    wrapper = mount(ODate, { props: { helpText: "Optional" } });
    expect(wrapper.text()).toContain("Optional");
  });

  it("renders a clear button when clearable and value set", () => {
    wrapper = mount(ODate, {
      props: { clearable: true, modelValue: "2024-01-01" },
    });
    expect(wrapper.find('[aria-label="Clear"]').exists()).toBe(true);
  });

  it("emits empty string and 'clear' when clear button pressed", async () => {
    wrapper = mount(ODate, {
      props: { clearable: true, modelValue: "2024-01-01" },
    });
    await wrapper.find('[aria-label="Clear"]').trigger("click");
    expect(wrapper.emitted("update:modelValue")![0][0]).toBe("");
    expect(wrapper.emitted("clear")).toBeTruthy();
  });

  it("disables the input", () => {
    wrapper = mount(ODate, { props: { disabled: true } });
    expect(wrapper.find("input").attributes("disabled")).toBeDefined();
  });
});
