// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
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

  it("should display the current time value in the trigger (24-hour text input)", () => {
    wrapper = mount(OTime, {
      attachTo: document.body,
      props: { modelValue: "09:30" },
    });
    // The value is bound to a plain text input (24-hour format), not the native
    // <input type="time"> which renders locale-dependent AM/PM. .text() does not
    // return input values; check the input element's value directly.
    const input = wrapper.find('input[type="text"]');
    expect(input.exists()).toBe(true);
    expect((input.element as HTMLInputElement).value).toBe("09:30");
  });

  it("should keep the displayed value in 24-hour format for afternoon times", () => {
    wrapper = mount(OTime, {
      attachTo: document.body,
      props: { modelValue: "14:30:00", withSeconds: true },
    });
    const input = wrapper.find('input[type="text"]');
    expect((input.element as HTMLInputElement).value).toBe("14:30:00");
  });

  it("should commit a valid typed value on change", async () => {
    wrapper = mount(OTime, {
      attachTo: document.body,
      props: { modelValue: "09:30" },
    });
    const input = wrapper.find('input[type="text"]');
    await input.setValue("18:45");
    await input.trigger("change");
    expect(wrapper.emitted("update:modelValue")!.at(-1)![0]).toBe("18:45");
    expect(wrapper.emitted("change")!.at(-1)![0]).toBe("18:45");
  });

  it("should reject an invalid typed value and revert to the current value", async () => {
    wrapper = mount(OTime, {
      attachTo: document.body,
      props: { modelValue: "09:30" },
    });
    const input = wrapper.find('input[type="text"]');
    await input.setValue("99:99");
    await input.trigger("change");
    // The invalid value must never be committed, and the field reverts to the
    // last valid value.
    const emits = wrapper.emitted("update:modelValue") ?? [];
    expect(emits.some((e) => e[0] === "99:99")).toBe(false);
    expect((input.element as HTMLInputElement).value).toBe("09:30");
  });

  it("should render the scroll-picker popup after opening", async () => {
    wrapper = mount(OTime, { attachTo: document.body });
    // Click the PopoverTrigger button (the clock icon button), not the role="group" div
    await wrapper.find('[aria-label="Open time picker"]').trigger("click");
    await flushPromises();
    expect(document.body.querySelector('[data-test="otime-popup"]')).toBeTruthy();
  });

  it("should render hour and minute scroll columns inside the popup", async () => {
    wrapper = mount(OTime, { attachTo: document.body });
    await wrapper.find('[aria-label="Open time picker"]').trigger("click");
    await flushPromises();
    expect(
      document.body.querySelector('[role="listbox"][aria-label="Hour"]'),
    ).toBeTruthy();
    expect(
      document.body.querySelector('[role="listbox"][aria-label="Minute"]'),
    ).toBeTruthy();
  });

  it("should render a second scroll column only when withSeconds is set", async () => {
    wrapper = mount(OTime, {
      attachTo: document.body,
      props: { withSeconds: true },
    });
    await wrapper.find('[aria-label="Open time picker"]').trigger("click");
    await flushPromises();
    expect(
      document.body.querySelector('[role="listbox"][aria-label="Second"]'),
    ).toBeTruthy();
  });

  it("should offer 24 hour options (0-23) in the hour column", async () => {
    wrapper = mount(OTime, { attachTo: document.body });
    await wrapper.find('[aria-label="Open time picker"]').trigger("click");
    await flushPromises();
    const hourCol = document.body.querySelector(
      '[role="listbox"][aria-label="Hour"]',
    );
    const options = hourCol!.querySelectorAll('[role="option"]');
    expect(options.length).toBe(24);
    expect(options[0].textContent?.trim()).toBe("00");
    expect(options[23].textContent?.trim()).toBe("23");
  });

  it("should emit the selected hour when a scroll option is clicked", async () => {
    wrapper = mount(OTime, {
      attachTo: document.body,
      props: { modelValue: "09:30" },
    });
    await wrapper.find('[aria-label="Open time picker"]').trigger("click");
    await flushPromises();
    const hourCol = document.body.querySelector(
      '[role="listbox"][aria-label="Hour"]',
    );
    const options = hourCol!.querySelectorAll('[role="option"]');
    // Click hour "14"
    (options[14] as HTMLElement).click();
    await flushPromises();
    expect(wrapper.emitted("update:modelValue")!.at(-1)![0]).toBe("14:30");
  });
});
