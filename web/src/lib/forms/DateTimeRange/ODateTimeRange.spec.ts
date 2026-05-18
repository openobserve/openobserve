// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import ODateTimeRange from "./ODateTimeRange.vue";

describe("ODateTimeRange", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  it("should render a trigger button", () => {
    wrapper = mount(ODateTimeRange, { attachTo: document.body });
    expect(wrapper.find('[data-test="datetimerange-trigger"]').exists()).toBe(
      true,
    );
  });

  it("should show placeholder text in the trigger when no value set", () => {
    wrapper = mount(ODateTimeRange, {
      attachTo: document.body,
      props: { placeholder: "Pick a range" },
    });
    expect(wrapper.find('[data-test="datetimerange-trigger"]').text()).toContain(
      "Pick a range",
    );
  });

  it("should render a label when provided", () => {
    wrapper = mount(ODateTimeRange, {
      attachTo: document.body,
      props: { label: "Event window" },
    });
    expect(wrapper.text()).toContain("Event window");
  });

  it("should render label slot content", () => {
    wrapper = mount(ODateTimeRange, {
      attachTo: document.body,
      slots: { label: "Custom range label" },
    });
    expect(wrapper.text()).toContain("Custom range label");
  });

  it("should render an error message", () => {
    wrapper = mount(ODateTimeRange, {
      attachTo: document.body,
      props: { errorMessage: "End must be after start" },
    });
    expect(wrapper.text()).toContain("End must be after start");
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
  });

  it("should render help text when no error", () => {
    wrapper = mount(ODateTimeRange, {
      attachTo: document.body,
      props: { helpText: "Select a time window" },
    });
    expect(wrapper.text()).toContain("Select a time window");
  });

  it("should mount without error when absolute values provided", () => {
    expect(() => {
      wrapper = mount(ODateTimeRange, {
        attachTo: document.body,
        props: {
          mode: "absolute",
          startDate: "2024-01-01",
          startTime: "09:00",
          endDate: "2024-01-31",
          endTime: "17:00",
        },
      });
    }).not.toThrow();
  });

  it("should show relative label in trigger when mode=relative and amount>0", () => {
    wrapper = mount(ODateTimeRange, {
      attachTo: document.body,
      props: {
        mode: "relative",
        relativeUnit: "days",
        relativeAmount: 3,
      },
    });
    expect(
      wrapper.find('[data-test="datetimerange-trigger"]').text(),
    ).toContain("Past 3 Days");
  });

  it("should show absolute date range in trigger when mode=absolute", () => {
    wrapper = mount(ODateTimeRange, {
      attachTo: document.body,
      props: {
        mode: "absolute",
        startDate: "2024-06-01",
        startTime: "09:00",
        endDate: "2024-06-30",
        endTime: "17:00",
      },
    });
    const text = wrapper.find('[data-test="datetimerange-trigger"]').text();
    expect(text).toContain("2024-06-01");
    expect(text).toContain("2024-06-30");
  });

  it("should render Relative and Absolute tabs by default", async () => {
    wrapper = mount(ODateTimeRange, { attachTo: document.body });
    await wrapper.find('[data-test="datetimerange-trigger"]').trigger("click");
    await wrapper.vm.$nextTick();
    const tabs = document.body.querySelector('[data-test="datetimerange-tabs"]');
    expect(tabs).toBeTruthy();
  });

  it("should hide tabs when disableRelative is true", () => {
    wrapper = mount(ODateTimeRange, {
      attachTo: document.body,
      props: { disableRelative: true },
    });
    const tabs = document.body.querySelector('[data-test="datetimerange-tabs"]');
    expect(tabs).toBeNull();
  });

  it("should emit change with relative value when quick-select button clicked", async () => {
    wrapper = mount(ODateTimeRange, { attachTo: document.body });
    // Open the popover first
    await wrapper.find('[data-test="datetimerange-trigger"]').trigger("click");
    // Click the relative tab
    const relTab = document.body.querySelector(
      '[data-test="datetimerange-tab-relative"]',
    ) as HTMLElement | null;
    relTab?.click();
    await wrapper.vm.$nextTick();
    // Relative panel should now be visible — click a quick-select button
    const panel = document.body.querySelector(
      '[data-test="datetimerange-relative-panel"]',
    );
    const btn = panel?.querySelectorAll("button")[0] as HTMLElement | null;
    btn?.click();
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted("change")).toBeTruthy();
    const emitted = wrapper.emitted("change")![0][0] as { type: string };
    expect(emitted.type).toBe("relative");
  });

  it("should not open when disabled", async () => {
    wrapper = mount(ODateTimeRange, {
      attachTo: document.body,
      props: { disabled: true },
    });
    await wrapper.find('[data-test="datetimerange-trigger"]').trigger("click");
    // Popup should not appear
    const popup = document.body.querySelector(
      '[data-test="datetimerange-popup"]',
    );
    expect(popup).toBeNull();
  });
});
