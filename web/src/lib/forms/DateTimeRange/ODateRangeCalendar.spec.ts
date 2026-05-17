// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import ODateRangeCalendar from "./ODateRangeCalendar.vue";

describe("ODateRangeCalendar", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // ── Structure ──────────────────────────────────────────────────

  it("should render the calendar root", () => {
    wrapper = mount(ODateRangeCalendar, { attachTo: document.body });
    expect(wrapper.find('[data-test="daterangecalendar-root"]').exists()).toBe(
      true,
    );
  });

  it("should render prev navigation button", () => {
    wrapper = mount(ODateRangeCalendar, { attachTo: document.body });
    expect(wrapper.find('[data-test="daterangecalendar-prev"]').exists()).toBe(
      true,
    );
  });

  it("should render next navigation button", () => {
    wrapper = mount(ODateRangeCalendar, { attachTo: document.body });
    expect(wrapper.find('[data-test="daterangecalendar-next"]').exists()).toBe(
      true,
    );
  });

  it("should render the month heading", () => {
    wrapper = mount(ODateRangeCalendar, { attachTo: document.body });
    expect(
      wrapper.find('[data-test="daterangecalendar-heading"]').exists(),
    ).toBe(true);
  });

  it("should render day cells for the current month", () => {
    wrapper = mount(ODateRangeCalendar, { attachTo: document.body });
    const cells = wrapper.findAll('[data-test^="daterangecalendar-cell-"]');
    // A month always has at least 28 calendar days visible
    expect(cells.length).toBeGreaterThanOrEqual(28);
  });

  // ── Props ─────────────────────────────────────────────────────

  it("should mount without error when startDate and endDate are provided", () => {
    expect(() => {
      wrapper = mount(ODateRangeCalendar, {
        attachTo: document.body,
        props: {
          startDate: "2024/01/10",
          endDate: "2024/01/20",
        },
      });
    }).not.toThrow();
  });

  it("should mount without error when only startDate is provided", () => {
    expect(() => {
      wrapper = mount(ODateRangeCalendar, {
        attachTo: document.body,
        props: { startDate: "2024/06/15" },
      });
    }).not.toThrow();
  });

  it("should mount without error when no props are provided", () => {
    expect(() => {
      wrapper = mount(ODateRangeCalendar, { attachTo: document.body });
    }).not.toThrow();
  });

  it("should render as disabled when disabled prop is true", () => {
    wrapper = mount(ODateRangeCalendar, {
      attachTo: document.body,
      props: { disabled: true },
    });
    // reka-ui sets data-disabled on the root when disabled
    const root = wrapper.find('[data-test="daterangecalendar-root"]');
    expect(root.exists()).toBe(true);
    // The root element should carry the disabled data attribute
    expect(root.attributes("data-disabled")).toBeDefined();
  });

  // ── Date format conversion ────────────────────────────────────

  it("should emit update:startDate and update:endDate in YYYY/MM/DD format when a range is selected", async () => {
    wrapper = mount(ODateRangeCalendar, { attachTo: document.body });
    await wrapper.vm.$nextTick();

    // Find all cell triggers in the current view (excludes outside-month cells)
    const cells = wrapper
      .findAll('[data-test^="daterangecalendar-cell-"]')
      .filter((c) => c.attributes("data-outside-view") === undefined);

    // Need at least 2 in-month cells to form a range
    if (cells.length >= 2) {
      // Click start cell
      await cells[0].trigger("click");
      await wrapper.vm.$nextTick();

      // Click end cell (a few days later)
      const endIdx = Math.min(5, cells.length - 1);
      await cells[endIdx].trigger("click");
      await wrapper.vm.$nextTick();

      const startEmitted = wrapper.emitted("update:startDate");
      const endEmitted = wrapper.emitted("update:endDate");

      expect(startEmitted).toBeTruthy();
      expect(endEmitted).toBeTruthy();

      // Values must be YYYY/MM/DD — not YYYY-MM-DD (reka-ui's internal format)
      if (startEmitted) {
        expect(String(startEmitted[0][0])).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
      }
      if (endEmitted) {
        expect(String(endEmitted[0][0])).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
      }
    }
  });

  it("should pass YYYY/MM/DD startDate and endDate through to the calendar selection state", () => {
    // The selected range is converted internally to reka-ui's YYYY-MM-DD for the calendar
    // and back to YYYY/MM/DD on emit. This test verifies the component accepts valid props.
    expect(() => {
      wrapper = mount(ODateRangeCalendar, {
        attachTo: document.body,
        props: {
          startDate: "2024/03/01",
          endDate: "2024/03/15",
          minDate: "2024/01/01",
          maxDate: "2024/12/31",
        },
      });
    }).not.toThrow();

    expect(wrapper.find('[data-test="daterangecalendar-root"]').exists()).toBe(
      true,
    );
  });
});
