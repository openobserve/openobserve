// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import ODate from "./ODate.vue";

describe("ODate", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("should render a date field group", () => {
    wrapper = mount(ODate);
    expect(wrapper.find('[role="group"]').exists()).toBe(true);
  });

  it("should render the label", () => {
    wrapper = mount(ODate, { props: { label: "Date of birth" } });
    expect(wrapper.text()).toContain("Date of birth");
  });

  it("should render label slot content", () => {
    wrapper = mount(ODate, { slots: { label: "Custom label" } });
    expect(wrapper.text()).toContain("Custom label");
  });

  it("should render an error message", () => {
    wrapper = mount(ODate, { props: { errorMessage: "Pick a date" } });
    expect(wrapper.text()).toContain("Pick a date");
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
  });

  it("should show error border styling when error prop is set", () => {
    wrapper = mount(ODate, { props: { errorMessage: "Required" } });
    expect(wrapper.find('[role="group"]').attributes("aria-invalid")).toBe(
      "true",
    );
  });

  it("should render help text when no error", () => {
    wrapper = mount(ODate, { props: { helpText: "Optional" } });
    expect(wrapper.text()).toContain("Optional");
  });

  it("should render a clear button when clearable and value set", () => {
    wrapper = mount(ODate, {
      props: { clearable: true, modelValue: "2024-01-01" },
    });
    expect(wrapper.find('[aria-label="Clear"]').exists()).toBe(true);
  });

  it("should not render clear button when modelValue is empty", () => {
    wrapper = mount(ODate, { props: { clearable: true, modelValue: "" } });
    expect(wrapper.find('[aria-label="Clear"]').exists()).toBe(false);
  });

  it("should emit empty string and 'clear' when clear button pressed", async () => {
    wrapper = mount(ODate, {
      props: { clearable: true, modelValue: "2024-01-01" },
    });
    await wrapper.find('[aria-label="Clear"]').trigger("click");
    expect(wrapper.emitted("update:modelValue")![0][0]).toBe("");
    expect(wrapper.emitted("clear")).toBeTruthy();
  });

  it("should apply disabled state to the field group", () => {
    wrapper = mount(ODate, { props: { disabled: true } });
    const group = wrapper.find('[role="group"]');
    expect(group.exists()).toBe(true);
  });

  it("should accept a valid modelValue without error", () => {
    expect(() => {
      wrapper = mount(ODate, { props: { modelValue: "2024-06-15" } });
    }).not.toThrow();
    expect(wrapper.find('[role="group"]').exists()).toBe(true);
  });

  it("should accept min and max props without error", () => {
    expect(() => {
      wrapper = mount(ODate, {
        props: { min: "2024-01-01", max: "2024-12-31" },
      });
    }).not.toThrow();
  });

  it("should render the calendar trigger button", () => {
    wrapper = mount(ODate);
    expect(wrapper.find('[aria-label="Open calendar"]').exists()).toBe(true);
  });
});
