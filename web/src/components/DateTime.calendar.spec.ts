// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DateTime from "@/components/DateTime.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

// Thursday 2026-10-08 08:30 in Asia/Calcutta.
const NOW = new Date("2026-10-08T03:00:00Z");
const IST = "Asia/Calcutta";
const micros = (iso: string) => Date.parse(iso) * 1000;

const CALENDAR_BUTTONS = [
  "date-time-relative-today-day-btn",
  "date-time-relative-yesterday-day-btn",
  "date-time-relative-week-this-btn",
  "date-time-relative-month-this-btn",
  "date-time-relative-quarter-this-btn",
  "date-time-relative-year-this-btn",
  "date-time-relative-week-last-btn",
  "date-time-relative-month-last-btn",
  "date-time-relative-quarter-last-btn",
  "date-time-relative-year-last-btn",
];

const SELECTED_CLASS = "bg-button-primary!";

describe("DateTime calendar presets", () => {
  let wrapper: VueWrapper<InstanceType<typeof DateTime>> | null = null;

  const createWrapper = (props: Record<string, unknown> = {}) => {
    wrapper = mount(DateTime, {
      props: { calendarPresets: true, ...props },
      attachTo: document.body,
      global: { plugins: [i18n, store] },
    });
    return wrapper;
  };

  const openMenu = async () => {
    wrapper!.vm.menuOpen = true;
    await flushPromises();
  };

  // jsdom matches attribute values case-insensitively, which would confuse 1-m (minutes) with 1-M (months).
  const button = (dataTest: string) =>
    Array.from(document.querySelectorAll<HTMLButtonElement>("[data-test]")).find(
      (el) => el.getAttribute("data-test") === dataTest,
    ) ?? null;

  const lastEmit = () => {
    const events = wrapper!.emitted("on:date-change") as unknown[][];
    return events[events.length - 1][0] as Record<string, unknown>;
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    store.state.timezone = IST;
    store.state.savedViewFlag = false;
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  describe("rows", () => {
    it("renders the Day, This and Last rows after Months when calendarPresets is on", async () => {
      createWrapper();
      await openMenu();

      for (const dataTest of CALENDAR_BUTTONS) expect(button(dataTest)).not.toBeNull();
      const labels = Array.from(document.querySelectorAll(".relative-row")).map((row) =>
        row.firstElementChild?.textContent?.trim(),
      );
      expect(labels).toEqual([
        "Seconds",
        "Minutes",
        "Hours",
        "Days",
        "Weeks",
        "Months",
        "Day",
        "This",
        "Last",
        "Custom",
      ]);
      expect(button("date-time-relative-today-day-btn")?.textContent?.trim()).toBe("Today");
      expect(button("date-time-relative-quarter-last-btn")?.textContent?.trim()).toBe("Quarter");
    });

    it("renders no calendar rows without the prop", async () => {
      createWrapper({ calendarPresets: false });
      await openMenu();

      for (const dataTest of CALENDAR_BUTTONS) expect(button(dataTest)).toBeNull();
      expect(wrapper!.vm.filteredCalendarRows).toEqual([]);
    });
  });

  describe("selecting a chip", () => {
    it("emits the calendar token and its resolved range with auto-apply", async () => {
      createWrapper({ autoApply: true });
      await openMenu();

      button("date-time-relative-month-this-btn")!.click();
      await flushPromises();

      expect(lastEmit()).toMatchObject({
        relativeTimePeriod: "calendar:month:0",
        startTime: micros("2026-09-30T18:30:00Z"),
        endTime: micros("2026-10-08T03:00:00Z"),
        valueType: "relative",
      });
      expect(wrapper!.vm.triggerLabel).toBe("This month");
    });

    it("marks only the chosen chip as selected", async () => {
      createWrapper({ autoApply: true });
      await openMenu();

      expect(button("date-time-relative-15-m-btn")?.className).toContain(SELECTED_CLASS);
      button("date-time-relative-yesterday-day-btn")!.click();
      await flushPromises();

      expect(button("date-time-relative-yesterday-day-btn")?.className).toContain(SELECTED_CLASS);
      expect(button("date-time-relative-today-day-btn")?.className).not.toContain(SELECTED_CLASS);
      expect(button("date-time-relative-15-m-btn")?.className).not.toContain(SELECTED_CLASS);
      expect(wrapper!.vm.triggerLabel).toBe("Yesterday");
    });

    it("waits for Apply without auto-apply, then emits the token", async () => {
      createWrapper({ autoApply: false });
      await flushPromises();
      const emitsBefore = (wrapper!.emitted("on:date-change") ?? []).length;
      await openMenu();

      button("date-time-relative-week-last-btn")!.click();
      await flushPromises();
      expect((wrapper!.emitted("on:date-change") ?? []).length).toBe(emitsBefore);

      button("date-time-apply-btn")!.click();
      await flushPromises();
      expect(lastEmit()).toMatchObject({
        relativeTimePeriod: "calendar:week:-1",
        startTime: micros("2026-09-27T18:30:00Z"),
        endTime: micros("2026-10-04T18:29:59.999Z"),
      });
      expect(wrapper!.vm.triggerLabel).toBe("Last week");
    });

    it("keeps the applied label and tooltip when a pending selection is abandoned", async () => {
      createWrapper({ autoApply: false, defaultRelativeTime: "calendar:month:0" });
      await flushPromises();
      await openMenu();

      wrapper!.vm.setCalendarPeriod("calendar:year:-1");
      wrapper!.vm.menuOpen = false;
      await flushPromises();

      expect(wrapper!.vm.triggerLabel).toBe("This month");
      expect(wrapper!.vm.triggerTooltip).toBe(
        "2026/10/01 00:00:00 - 2026/10/08 08:30:00 (Asia/Calcutta)",
      );
    });

    it("returns to the applied period when the panel closes without Apply", async () => {
      createWrapper({ autoApply: false, defaultRelativeTime: "calendar:month:0" });
      await flushPromises();
      await openMenu();

      button("date-time-relative-month-last-btn")!.click();
      await flushPromises();
      document
        .querySelector("#date-time-menu")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await flushPromises();

      expect(wrapper!.vm.menuOpen).toBe(false);
      expect(wrapper!.vm.calendarToken).toBe("calendar:month:0");
      expect(wrapper!.vm.triggerLabel).toBe("This month");
      expect(button("date-time-next-btn")?.disabled).toBe(true);

      button("date-time-prev-btn")!.click();
      await flushPromises();
      expect(lastEmit().relativeTimePeriod).toBe("calendar:month:-1");
      expect(wrapper!.vm.triggerLabel).toBe("Last month");
    });

    it("returns to an applied rolling period when a pending calendar pick is abandoned", async () => {
      createWrapper({ autoApply: false, defaultRelativeTime: "1h" });
      await flushPromises();
      await openMenu();

      wrapper!.vm.setCalendarPeriod("calendar:week:-1");
      wrapper!.vm.onMenuOpenChange(false);

      expect(wrapper!.vm.calendarToken).toBeNull();
      expect(wrapper!.vm.getConsumableDateTime().relativeTimePeriod).toBe("1h");
    });

    it("keeps an auto-applied pick when the panel closes", async () => {
      createWrapper({ autoApply: true });
      await flushPromises();
      await openMenu();

      wrapper!.vm.setCalendarPeriod("calendar:year:0");
      wrapper!.vm.onMenuOpenChange(false);
      expect(wrapper!.vm.calendarToken).toBe("calendar:year:0");
    });

    it("drops the calendar token when a rolling chip or custom value is chosen", async () => {
      createWrapper({ autoApply: true, defaultRelativeTime: "calendar:day:0" });
      await flushPromises();

      wrapper!.vm.setRelativeDate("h", 3);
      expect(wrapper!.vm.calendarToken).toBeNull();
      expect(lastEmit().relativeTimePeriod).toBe("3h");

      wrapper!.vm.setCalendarPeriod("calendar:day:0");
      wrapper!.vm.relativeValue = 7;
      wrapper!.vm.onCustomPeriodSelect();
      expect(wrapper!.vm.calendarToken).toBeNull();
      expect(lastEmit().relativeTimePeriod).toBe("7h");
    });

    it("resolves to the absolute range once the Absolute tab is chosen", async () => {
      createWrapper({ autoApply: true, defaultRelativeTime: "calendar:day:0" });
      await flushPromises();

      wrapper!.vm.setDateType("absolute");
      expect(wrapper!.vm.getConsumableDateTime().relativeTimePeriod).toBeNull();
      expect(wrapper!.vm.triggerTooltip).toBeUndefined();
    });
  });

  describe("initial and saved values", () => {
    it("reads a calendar token from defaultRelativeTime", async () => {
      createWrapper({ defaultRelativeTime: "calendar:quarter:-2" });
      await flushPromises();

      expect(wrapper!.vm.triggerLabel).toBe("Q2 2026");
      expect(lastEmit()).toMatchObject({
        relativeTimePeriod: "calendar:quarter:-2",
        startTime: micros("2026-03-31T18:30:00Z"),
        endTime: micros("2026-06-30T18:29:59.999Z"),
      });
    });

    it("falls back like an invalid period for a malformed token", async () => {
      createWrapper({ defaultRelativeTime: "calendar:month:1" });
      await flushPromises();

      expect(wrapper!.vm.calendarToken).toBeNull();
      expect(lastEmit().relativeTimePeriod).toBe("15m");
    });

    it("ignores calendar tokens when the picker has no calendar presets", async () => {
      createWrapper({ calendarPresets: false, defaultRelativeTime: "calendar:month:0" });
      await flushPromises();

      expect(wrapper!.vm.calendarToken).toBeNull();
      expect(lastEmit().relativeTimePeriod).toBe("15m");
      expect(wrapper!.vm.triggerLabel).toBe("Past 15 Minutes");
    });

    it("restores a saved calendar period through setSavedDate", async () => {
      createWrapper();
      await flushPromises();

      wrapper!.vm.setSavedDate({ type: "relative", relativeTimePeriod: "calendar:year:-2" });
      expect(wrapper!.vm.triggerLabel).toBe("2024");
      expect(wrapper!.vm.calendarToken).toBe("calendar:year:-2");
    });

    it("keeps the calendar token when a rolling period string is invalid", async () => {
      createWrapper({ defaultRelativeTime: "calendar:day:-1" });
      await flushPromises();

      wrapper!.vm.setRelativeTime("not-a-period");
      expect(wrapper!.vm.calendarToken).toBe("calendar:day:-1");
      wrapper!.vm.setRelativeTime("2d");
      expect(wrapper!.vm.calendarToken).toBeNull();
    });
  });

  describe("search", () => {
    const visible = () =>
      wrapper!.vm.filteredCalendarRows.map((row: { key: string; chips: { key: string }[] }) => [
        row.key,
        row.chips.map((chip) => chip.key),
      ]);

    it.each([
      ["day", [["day", ["today", "yesterday"]]]],
      [
        "month",
        [
          ["this", ["month"]],
          ["last", ["month"]],
        ],
      ],
      ["THIS", [["this", ["week", "month", "quarter", "year"]]]],
      ["yester", [["day", ["yesterday"]]]],
      ["  last  ", [["last", ["week", "month", "quarter", "year"]]]],
      [
        "",
        [
          ["day", ["today", "yesterday"]],
          ["this", ["week", "month", "quarter", "year"]],
          ["last", ["week", "month", "quarter", "year"]],
        ],
      ],
    ])("matches %j", async (query, expected) => {
      createWrapper();
      wrapper!.vm.relativeSearchTerm = query;
      await flushPromises();
      expect(visible()).toEqual(expected);
    });

    it("shows the empty state only when neither rolling nor calendar rows match", async () => {
      createWrapper();
      await openMenu();

      wrapper!.vm.relativeSearchTerm = "quarter";
      await flushPromises();
      expect(wrapper!.vm.filteredRelativePeriods).toEqual([]);
      expect(document.body.textContent).not.toContain("No matching");
      expect(button("date-time-relative-quarter-this-btn")).not.toBeNull();
      expect(button("date-time-relative-week-this-btn")).toBeNull();

      wrapper!.vm.relativeSearchTerm = "zzz";
      await flushPromises();
      expect(wrapper!.vm.filteredCalendarRows).toEqual([]);
      expect(document.body.textContent).toContain(
        String(i18n.global.t("common.noMatchingRelativePresets")),
      );
    });
  });

  describe("keyboard", () => {
    const press = (dataTest: string, key: string) => {
      const from = button(dataTest)!;
      from.focus();
      from.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      return document.activeElement?.getAttribute("data-test");
    };

    it("moves through the calendar chips with the arrow grid", async () => {
      createWrapper();
      await openMenu();

      expect(press("date-time-relative-1-M-btn", "ArrowDown")).toBe(
        "date-time-relative-today-day-btn",
      );
      expect(press("date-time-relative-today-day-btn", "ArrowRight")).toBe(
        "date-time-relative-yesterday-day-btn",
      );
      expect(press("date-time-relative-yesterday-day-btn", "ArrowDown")).toBe(
        "date-time-relative-month-this-btn",
      );
      expect(press("date-time-relative-month-this-btn", "ArrowDown")).toBe(
        "date-time-relative-month-last-btn",
      );
      expect(press("date-time-relative-year-this-btn", "ArrowUp")).toBe(
        "date-time-relative-yesterday-day-btn",
      );
      expect(press("date-time-relative-today-day-btn", "ArrowUp")).toBe(
        "date-time-relative-1-M-btn",
      );
    });
  });

  describe("range shift arrows", () => {
    it("steps a calendar period by its own unit and stays a calendar token", async () => {
      createWrapper({ autoApply: false, defaultRelativeTime: "calendar:month:0" });
      await flushPromises();

      expect(wrapper!.vm.isNextShiftDisabled()).toBe(true);
      expect(button("date-time-next-btn")?.disabled).toBe(true);

      button("date-time-prev-btn")!.click();
      await flushPromises();
      expect(lastEmit()).toMatchObject({
        relativeTimePeriod: "calendar:month:-1",
        valueType: "relative",
      });
      expect(wrapper!.vm.selectedType).toBe("relative");
      expect(wrapper!.vm.triggerLabel).toBe("Last month");

      button("date-time-prev-btn")!.click();
      await flushPromises();
      expect(lastEmit()).toMatchObject({
        relativeTimePeriod: "calendar:month:-2",
        startTime: micros("2026-07-31T18:30:00Z"),
        endTime: micros("2026-08-31T18:29:59.999Z"),
      });
      expect(wrapper!.vm.triggerLabel).toBe("Aug 2026");
      expect(button("date-time-next-btn")?.disabled).toBe(false);

      button("date-time-next-btn")!.click();
      await flushPromises();
      expect(lastEmit().relativeTimePeriod).toBe("calendar:month:-1");
      expect(wrapper!.vm.triggerLabel).toBe("Last month");
    });

    it("does nothing when › is forced at offset 0 or ‹ runs out of calendar", async () => {
      createWrapper({ autoApply: true, defaultRelativeTime: "calendar:day:0" });
      await flushPromises();
      const count = (wrapper!.emitted("on:date-change") ?? []).length;

      wrapper!.vm.shiftTimeRange("next");
      wrapper!.vm.setRelativeTime("calendar:year:-2025");
      wrapper!.vm.shiftTimeRange("prev");
      expect((wrapper!.emitted("on:date-change") ?? []).length).toBe(count);
      expect(wrapper!.vm.calendarToken).toBe("calendar:year:-2025");
    });

    it("keeps today's behaviour for rolling ranges", async () => {
      createWrapper({ autoApply: false, defaultRelativeTime: "1h" });
      await flushPromises();

      expect(wrapper!.vm.isNextShiftDisabled()).toBe(true);
      wrapper!.vm.shiftTimeRange("prev");
      expect(wrapper!.vm.selectedType).toBe("absolute");
      expect(lastEmit().relativeTimePeriod).toBeNull();
    });
  });

  describe("timezone", () => {
    it("re-resolves the same token in the new timezone", async () => {
      createWrapper({ autoApply: true, defaultRelativeTime: "calendar:day:0" });
      await flushPromises();
      expect(lastEmit().startTime).toBe(micros("2026-10-07T18:30:00Z"));

      wrapper!.vm.timezone = "America/New_York";
      await wrapper!.vm.onTimezoneChange();
      await flushPromises();

      expect(lastEmit()).toMatchObject({
        relativeTimePeriod: "calendar:day:0",
        startTime: micros("2026-10-07T04:00:00Z"),
        endTime: micros("2026-10-08T03:00:00Z"),
      });
      expect(wrapper!.vm.triggerTooltip).toBe(
        "2026/10/07 00:00:00 - 2026/10/07 23:00:00 (America/New_York)",
      );
    });
  });

  describe("tooltips", () => {
    it("shows each chip's absolute range in the picker timezone", () => {
      createWrapper();
      expect(wrapper!.vm.calendarTooltip("calendar:month:-1")).toBe(
        "2026/09/01 00:00:00 - 2026/09/30 23:59:59 (Asia/Calcutta)",
      );
      expect(wrapper!.vm.calendarTooltip(null)).toBeUndefined();
    });

    it("moves an offset-0 tooltip's end to the hover time", async () => {
      createWrapper({ autoApply: true, defaultRelativeTime: "calendar:week:0" });
      await flushPromises();
      expect(wrapper!.vm.triggerTooltip).toBe(
        "2026/10/05 00:00:00 - 2026/10/08 08:30:00 (Asia/Calcutta)",
      );

      vi.setSystemTime(new Date("2026-10-08T04:00:00Z"));
      await wrapper!.find('[data-test="date-time-btn"]').trigger("mouseenter");
      expect(wrapper!.vm.triggerTooltip).toBe(
        "2026/10/05 00:00:00 - 2026/10/08 09:30:00 (Asia/Calcutta)",
      );
    });

    it("has no trigger tooltip for a rolling range", async () => {
      createWrapper({ autoApply: true });
      await flushPromises();
      expect(wrapper!.vm.triggerTooltip).toBeUndefined();
    });
  });
});
