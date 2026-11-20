// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OCheckbox from "./OCheckbox.vue";

describe("OCheckbox", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders without errors", () => {
    wrapper = mount(OCheckbox);
    expect(wrapper.exists()).toBe(true);
  });

  // The label re-clicks the box when a click's target leaves the page mid-click, re-checking it.
  it.each([
    [true, "checked"],
    ["indeterminate", "indeterminate"],
  ] as const)("lets a click on the %s mark reach the box itself", (modelValue) => {
    wrapper = mount(OCheckbox, { props: { modelValue } });
    const mark = wrapper.find('[role="checkbox"] > span');
    expect(mark.exists()).toBe(true);
    expect(mark.classes()).toContain("pointer-events-none");
  });

  it("renders a label when provided via prop", () => {
    wrapper = mount(OCheckbox, { props: { label: "Accept terms" } });
    expect(wrapper.text()).toContain("Accept terms");
  });

  it("names the control with ariaLabel when there is no visible label", () => {
    // A checkbox on a card cannot carry visible text, and the wrapping <label>
    // does not name a `button[role=checkbox]` — only an explicit aria-label on
    // that button does.
    wrapper = mount(OCheckbox, { props: { ariaLabel: "Select Pod OOM Killed" } });
    expect(wrapper.find('[role="checkbox"]').attributes("aria-label")).toBe(
      "Select Pod OOM Killed",
    );
  });

  it("leaves the control unnamed by aria when a visible label is used instead", () => {
    wrapper = mount(OCheckbox, { props: { label: "Accept terms" } });
    expect(wrapper.find('[role="checkbox"]').attributes("aria-label")).toBeUndefined();
  });

  it("renders a label slot when provided", () => {
    wrapper = mount(OCheckbox, {
      slots: { label: "<span>Custom label</span>" },
    });
    expect(wrapper.html()).toContain("Custom label");
  });

  it("emits update:modelValue with true when clicked on unchecked checkbox", async () => {
    wrapper = mount(OCheckbox, { props: { modelValue: false } });
    await wrapper.find("button").trigger("click");
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toBe(true);
  });

  it("is disabled when disabled prop is true", () => {
    wrapper = mount(OCheckbox, { props: { disabled: true } });
    const root = wrapper.find("button");
    expect(root.attributes("disabled")).toBeDefined();
  });

  it("has one 16 px box with the chip radius", () => {
    wrapper = mount(OCheckbox);
    const classes = wrapper.find("button").classes();
    expect(classes).toContain("size-4");
    expect(classes).toContain("rounded-chip");
  });

  it("toggles a value in an array model", async () => {
    wrapper = mount(OCheckbox, {
      props: {
        modelValue: ["a"],
        value: "b",
      },
    });

    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("update:modelValue")?.[0]?.[0]).toEqual(["a", "b"]);
  });

  it("shows the mixed state from the indeterminate prop and checks on click", async () => {
    wrapper = mount(OCheckbox, { props: { modelValue: false, indeterminate: true } });
    const box = wrapper.find("button");
    expect(box.attributes("aria-checked")).toBe("mixed");
    expect(box.attributes("data-state")).toBe("indeterminate");
    await box.trigger("click");
    expect(wrapper.emitted("update:modelValue")?.[0]?.[0]).toBe(true);
  });

  it("renders a description under the label", () => {
    wrapper = mount(OCheckbox, {
      props: { label: "Notify on resolve", description: "Send a message when it clears" },
    });
    expect(wrapper.text()).toContain("Send a message when it clears");
  });

  it("supports custom true/false values", async () => {
    wrapper = mount(OCheckbox, {
      props: {
        modelValue: "N",
        trueValue: "Y",
        falseValue: "N",
      },
    });

    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("update:modelValue")?.[0]?.[0]).toBe("Y");
  });
});
