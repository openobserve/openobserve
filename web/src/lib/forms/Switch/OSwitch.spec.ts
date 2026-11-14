// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import OSwitch from "./OSwitch.vue";

describe("OSwitch", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("renders without errors", () => {
    wrapper = mount(OSwitch);
    expect(wrapper.exists()).toBe(true);
  });

  it("renders label when prop is provided", () => {
    wrapper = mount(OSwitch, { props: { label: "Enable notifications" } });
    expect(wrapper.text()).toContain("Enable notifications");
  });

  it("names an unlabelled switch from aria-label on the switch itself", () => {
    wrapper = mount(OSwitch, { attrs: { "aria-label": "Built-in bot rule" } });
    expect(wrapper.find('[role="switch"]').attributes("aria-label")).toBe("Built-in bot rule");
    expect(wrapper.attributes("aria-label")).toBeUndefined();
  });

  it("renders label slot when provided", () => {
    wrapper = mount(OSwitch, {
      slots: { label: "<strong>Custom</strong>" },
    });
    expect(wrapper.html()).toContain("Custom");
  });

  it("emits update:modelValue with true when toggled on", async () => {
    wrapper = mount(OSwitch, { props: { modelValue: false } });
    await wrapper.find("button").trigger("click");
    const emitted = wrapper.emitted("update:modelValue");
    expect(emitted).toBeTruthy();
    expect(emitted![0][0]).toBe(true);
  });

  it("emits change event when toggled", async () => {
    wrapper = mount(OSwitch, { props: { modelValue: false } });
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("change")).toBeTruthy();
  });

  it("is disabled when disabled prop is true", () => {
    wrapper = mount(OSwitch, { props: { disabled: true } });
    expect(wrapper.find("button").attributes("disabled")).toBeDefined();
  });

  it("has one 28 x 16 track with a 12 px thumb", () => {
    wrapper = mount(OSwitch, { props: { modelValue: false } });
    const track = wrapper.find('[role="switch"]');
    expect(track.classes()).toEqual(expect.arrayContaining(["w-7", "h-4"]));
    expect(track.find("span").classes()).toContain("size-3");
  });

  it("toggles", async () => {
    wrapper = mount(OSwitch, { props: { modelValue: false } });
    expect(wrapper.find("button").attributes("role")).toBe("switch");
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("update:modelValue")![0][0]).toBe(true);
  });

  it("mirrors the checked-thumb offset for RTL", () => {
    wrapper = mount(OSwitch, { props: { modelValue: true } });
    const thumb = wrapper.find('[role="switch"]').find("span");

    expect(thumb.classes()).toContain("translate-x-3");
    expect(thumb.classes()).toContain("rtl:-translate-x-3");
  });

  it("parks the thumb at the reading edge while unchecked", () => {
    wrapper = mount(OSwitch, { props: { modelValue: false } });
    const thumb = wrapper.find('[role="switch"]').find("span");

    expect(thumb.classes()).toContain("translate-x-0");
    expect(thumb.classes().some((className) => className.startsWith("rtl:"))).toBe(false);
  });

  it('renders the label before the switch when labelPosition is "start"', () => {
    wrapper = mount(OSwitch, {
      props: { label: "My label", labelPosition: "start" },
    });
    expect(wrapper.element.classList.contains("flex-row-reverse")).toBe(true);
  });

  it("emits a boolean when the model is a truthy non-boolean", async () => {
    wrapper = mount(OSwitch, { props: { modelValue: "yes" } });
    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("update:modelValue")![0][0]).toBe(false);
  });

  it("renders a description under the label", () => {
    wrapper = mount(OSwitch, {
      props: { label: "Ingest app_logs", description: "Pausing drops new events" },
    });
    expect(wrapper.text()).toContain("Pausing drops new events");
  });

  it("sets aria-labelledby on the button when a label is provided", () => {
    wrapper = mount(OSwitch, { props: { label: "Notifications" } });
    const labelledby = wrapper.find("button").attributes("aria-labelledby");
    expect(labelledby).toBeDefined();
    expect(wrapper.find(`#${labelledby}`).exists()).toBe(true);
    expect(wrapper.find(`#${labelledby}`).text()).toBe("Notifications");
  });

  it("does not set aria-labelledby when no label is provided", () => {
    wrapper = mount(OSwitch);
    expect(wrapper.find("button").attributes("aria-labelledby")).toBeUndefined();
  });

  it("state text follows the value and is absent by default", async () => {
    const rows = [
      { props: { modelValue: true }, text: undefined },
      { props: { modelValue: true, stateText: true }, text: "On" },
      { props: { modelValue: false, stateText: true }, text: "Off" },
      { props: { modelValue: 0, stateText: true }, text: "Off" },
      { props: { modelValue: "yes", stateText: true }, text: "On" },
    ];
    for (const row of rows) {
      const sw = mount(OSwitch, {
        props: row.props,
        attrs: { "data-test": "sw", "aria-label": "Feature" },
      });
      const state = sw.find('[data-test="sw-state"]');
      expect(state.exists()).toBe(row.text !== undefined);
      if (row.text !== undefined) {
        expect(state.text()).toBe(row.text);
        expect(state.attributes("aria-hidden")).toBe("true");
      }
      sw.unmount();
    }

    wrapper = mount(OSwitch, {
      props: { modelValue: false, stateText: true },
      attrs: { "data-test": "sw", "aria-label": "Feature" },
    });
    await wrapper.find("button").trigger("click");
    expect(wrapper.find('[data-test="sw-state"]').text()).toBe("On");
  });

  it("toggles when the wrapper div (label gap) is clicked", async () => {
    wrapper = mount(OSwitch, {
      props: { modelValue: false, label: "Notifications" },
    });
    await wrapper.trigger("click");
    expect(wrapper.emitted("update:modelValue")![0][0]).toBe(true);
  });
});
