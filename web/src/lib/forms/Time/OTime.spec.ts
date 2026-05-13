// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OTime from "./OTime.vue";

describe("OTime", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("should render a time field group", () => {
    wrapper = mount(OTime, { attachTo: document.body });
    expect(wrapper.find('[role="group"]').exists()).toBe(true);
  });

  it("should render the label", () => {
    wrapper = mount(OTime, {
      attachTo: document.body,
      props: { label: "Meeting time" },
    });
    expect(wrapper.text()).toContain("Meeting time");
  });

  it("should render label slot content", () => {
    wrapper = mount(OTime, {
      attachTo: document.body,
      slots: { label: "Custom label" },
    });
    expect(wrapper.text()).toContain("Custom label");
  });

  it("should render an error message", () => {
    wrapper = mount(OTime, {
      attachTo: document.body,
      props: { errorMessage: "Pick a time" },
    });
    expect(wrapper.text()).toContain("Pick a time");
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
  });

  it("should set aria-invalid when errorMessage is provided", () => {
    wrapper = mount(OTime, {
      attachTo: document.body,
      props: { errorMessage: "Required" },
    });
    expect(wrapper.find('[role="group"]').attributes("aria-invalid")).toBe(
      "true",
    );
  });

  it("should render help text when no error", () => {
    wrapper = mount(OTime, {
      attachTo: document.body,
      props: { helpText: "HH:MM format" },
    });
    expect(wrapper.text()).toContain("HH:MM format");
  });

  it("should render a clear button when clearable and value set", () => {
    wrapper = mount(OTime, {
      attachTo: document.body,
      props: { clearable: true, modelValue: "12:00" },
    });
    expect(wrapper.find('[aria-label="Clear"]').exists()).toBe(true);
  });

  it("should not render clear button when modelValue is empty", () => {
    wrapper = mount(OTime, {
      attachTo: document.body,
      props: { clearable: true, modelValue: "" },
    });
    expect(wrapper.find('[aria-label="Clear"]').exists()).toBe(false);
  });

  it("should emit empty string and 'clear' when clear button pressed", async () => {
    wrapper = mount(OTime, {
      attachTo: document.body,
      props: { clearable: true, modelValue: "12:00" },
    });
    await wrapper.find('[aria-label="Clear"]').trigger("click");
    expect(wrapper.emitted("update:modelValue")![0][0]).toBe("");
    expect(wrapper.emitted("clear")).toBeTruthy();
  });

  it("should apply disabled state to the field group", () => {
    wrapper = mount(OTime, {
      attachTo: document.body,
      props: { disabled: true },
    });
    const group = wrapper.find('[role="group"]');
    expect(group.exists()).toBe(true);
    expect(group.attributes("aria-disabled")).toBe("true");
  });

  it("should accept a valid modelValue without error", () => {
    expect(() => {
      wrapper = mount(OTime, {
        attachTo: document.body,
        props: { modelValue: "14:30" },
      });
    }).not.toThrow();
    expect(wrapper.find('[role="group"]').exists()).toBe(true);
  });

  it("should accept min and max props without error", () => {
    expect(() => {
      wrapper = mount(OTime, {
        attachTo: document.body,
        props: { min: "08:00", max: "18:00" },
      });
    }).not.toThrow();
  });

  it("should display the current time value in the trigger", () => {
    wrapper = mount(OTime, {
      attachTo: document.body,
      props: { modelValue: "09:30" },
    });
    expect(wrapper.find('[role="group"]').text()).toContain("09:30");
  });

  it("should render the clock face popup after opening", async () => {
    wrapper = mount(OTime, { attachTo: document.body });
    await wrapper.find('[role="group"]').trigger("click");
    await wrapper.vm.$nextTick();
    expect(document.body.querySelector('[data-test="otime-popup"]')).toBeTruthy();
  });

  it("should render the clock face SVG inside the popup", async () => {
    wrapper = mount(OTime, { attachTo: document.body });
    await wrapper.find('[role="group"]').trigger("click");
    await wrapper.vm.$nextTick();
    expect(
      document.body.querySelector('[data-test="otime-clock-face"]'),
    ).toBeTruthy();
  });

  it("should render a Close button in the popup", async () => {
    wrapper = mount(OTime, { attachTo: document.body });
    await wrapper.find('[role="group"]').trigger("click");
    await wrapper.vm.$nextTick();
    expect(
      document.body.querySelector('[data-test="otime-close"]'),
    ).toBeTruthy();
  });
});
