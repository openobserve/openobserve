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
    expect(wrapper.find('[role="group"]').attributes("aria-invalid")).toBe("true");
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
    // The time value is bound to the native <input type="time"> via :value prop
    // .text() does not return input values; check the input element's value attribute
    const input = wrapper.find('input[type="time"]');
    expect(input.exists()).toBe(true);
    expect(input.element.value).toBe("09:30");
  });

  it("should render the clock face popup after opening", async () => {
    wrapper = mount(OTime, { attachTo: document.body });
    // Click the PopoverTrigger button (the clock icon button), not the role="group" div
    await wrapper.find('[aria-label="Open time picker"]').trigger("click");
    await flushPromises();
    expect(document.body.querySelector('[data-test="otime-popup"]')).toBeTruthy();
  });

  it("should render the clock face SVG inside the popup", async () => {
    wrapper = mount(OTime, { attachTo: document.body });
    await wrapper.find('[aria-label="Open time picker"]').trigger("click");
    await flushPromises();
    expect(document.body.querySelector('[data-test="otime-clock-face"]')).toBeTruthy();
  });

  it("should render a Close button in the popup", async () => {
    wrapper = mount(OTime, { attachTo: document.body });
    await wrapper.find('[aria-label="Open time picker"]').trigger("click");
    await flushPromises();
    expect(document.body.querySelector('[data-test="otime-close"]')).toBeTruthy();
  });

  describe("format24", () => {
    const openPopup = async (w: VueWrapper) => {
      await w.find('[aria-label="Open time picker"]').trigger("click");
      await flushPromises();
    };

    it("renders a text input instead of a native time input", () => {
      wrapper = mount(OTime, {
        attachTo: document.body,
        props: { format24: true, modelValue: "13:30" },
      });
      expect(wrapper.find('input[type="time"]').exists()).toBe(false);
      const input = wrapper.find('input[type="text"]');
      expect(input.exists()).toBe(true);
      expect((input.element as HTMLInputElement).value).toBe("13:30");
    });

    it("normalises and emits a typed HH:MM value", async () => {
      wrapper = mount(OTime, {
        attachTo: document.body,
        props: { format24: true, modelValue: "" },
      });
      const input = wrapper.find('input[type="text"]');
      (input.element as HTMLInputElement).value = "7:05";
      await input.trigger("change");
      expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["07:05"]);
    });

    it("reverts an unparseable or out-of-range entry without emitting", async () => {
      wrapper = mount(OTime, {
        attachTo: document.body,
        props: { format24: true, modelValue: "09:00" },
      });
      const input = wrapper.find('input[type="text"]');
      (input.element as HTMLInputElement).value = "25:99";
      await input.trigger("change");
      expect(wrapper.emitted("update:modelValue")).toBeUndefined();
      expect((input.element as HTMLInputElement).value).toBe("09:00");
    });

    it("hides the AM/PM toggle in the popup", async () => {
      wrapper = mount(OTime, {
        attachTo: document.body,
        props: { format24: true },
      });
      await openPopup(wrapper);
      expect(document.body.querySelector('[aria-label="AM"]')).toBeNull();
      expect(document.body.querySelector('[aria-label="PM"]')).toBeNull();
    });

    it("renders a dual-ring hour face with 24 hour targets", async () => {
      wrapper = mount(OTime, {
        attachTo: document.body,
        props: { format24: true },
      });
      await openPopup(wrapper);
      const face = document.body.querySelector('[data-test="otime-clock-face"]')!;
      const numbers = Array.from(face.querySelectorAll("text")).map((t) => t.textContent?.trim());
      expect(numbers).toHaveLength(24);
      expect(numbers).toContain("00");
      expect(numbers).toContain("13");
      expect(numbers).toContain("23");
    });

    it("selects an inner-ring hour directly (no AM/PM math)", async () => {
      wrapper = mount(OTime, {
        attachTo: document.body,
        props: { format24: true, modelValue: "" },
      });
      await openPopup(wrapper);
      const face = document.body.querySelector('[data-test="otime-clock-face"]')!;
      const target = Array.from(face.querySelectorAll('g[role="button"]')).find(
        (g) => g.querySelector("text")?.textContent?.trim() === "22",
      )!;
      (target as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushPromises();
      expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["22:00"]);
    });

    it("keeps the 12-hour face and AM/PM by default", async () => {
      wrapper = mount(OTime, { attachTo: document.body });
      await openPopup(wrapper);
      const face = document.body.querySelector('[data-test="otime-clock-face"]')!;
      expect(face.querySelectorAll("text")).toHaveLength(12);
      expect(document.body.querySelector('[aria-label="AM"]')).toBeTruthy();
    });
  });
});
