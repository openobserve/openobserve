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
import { timeRangeHistoryKey } from "@/composables/useTimeRangeHistory";

// Thursday 2026-10-08 08:30 in Asia/Calcutta.
const NOW = new Date("2026-10-08T03:00:00Z");
const IST = "Asia/Calcutta";
const micros = (iso: string) => Date.parse(iso) * 1000;
const HISTORY_KEY = timeRangeHistoryKey("default", "example@gmail.com");

const CALENDAR_IDS = [
  "today",
  "yesterday",
  "this-week",
  "last-week",
  "this-month",
  "last-month",
  "this-quarter",
  "last-quarter",
  "this-year",
  "last-year",
];

const SELECTED_CLASS = "bg-button-primary!";

describe("DateTime rail", () => {
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
    wrapper!.vm.onMenuOpenChange(true);
    wrapper!.vm.menuOpen = true;
    await flushPromises();
  };

  // jsdom matches attribute values case-insensitively, which would confuse 1-m (minutes) with 1-M (months).
  const el = (dataTest: string) =>
    Array.from(document.querySelectorAll<HTMLButtonElement>("[data-test]")).find(
      (node) => node.getAttribute("data-test") === dataTest,
    ) ?? null;

  const calendarItem = (id: string) => el(`date-time-rail-calendar-${id}`);

  const lastEmit = () => {
    const events = wrapper!.emitted("on:date-change") as unknown[][];
    return events[events.length - 1][0] as Record<string, unknown>;
  };

  const storedHistory = () => JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");

  const seedHistory = (entries: { startUs: number; endUs: number }[]) =>
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));

  const hourRange = (hoursAgo: number) => ({
    startUs: micros("2026-10-08T00:00:00Z") - hoursAgo * 3_600_000_000,
    endUs: micros("2026-10-08T00:30:00Z") - hoursAgo * 3_600_000_000,
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    store.state.timezone = IST;
    store.state.savedViewFlag = false;
    localStorage.clear();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
    localStorage.clear();
    vi.useRealTimers();
  });

  describe("layout", () => {
    it("shows Recent and the ten calendar ranges beside the unchanged picker", async () => {
      createWrapper();
      await openMenu();

      expect(el("date-time-rail")).not.toBeNull();
      expect(el("date-time-rail-recent-empty")?.textContent?.trim()).toBe(
        "Ranges you apply will show up here.",
      );
      for (const id of CALENDAR_IDS) expect(calendarItem(id)).not.toBeNull();
      expect(calendarItem("today")?.textContent).toContain("Today");
      expect(calendarItem("today")?.textContent).toContain("so far");
      expect(calendarItem("last-month")?.textContent?.trim()).toBe("Last month");
      expect(el("date-time-relative-15-m-btn")).not.toBeNull();
      expect(el("date-time-relative-tab")).not.toBeNull();
    });

    it("keeps Recent but drops the calendar section without calendarPresets", async () => {
      createWrapper({ calendarPresets: false });
      await openMenu();

      expect(el("date-time-rail")).not.toBeNull();
      for (const id of CALENDAR_IDS) expect(calendarItem(id)).toBeNull();
      expect(wrapper!.vm.calendarRailItems).toBeNull();
    });

    it("has no rail on a date-only picker", async () => {
      createWrapper({ disableRelative: true });
      await openMenu();

      expect(el("date-time-rail")).toBeNull();
    });
  });

  describe("calendar items", () => {
    it("applies a range on click without Apply, and closes the panel", async () => {
      createWrapper({ autoApply: false });
      await flushPromises();
      await openMenu();
      const hidesBefore = (wrapper!.emitted("hide") ?? []).length;

      calendarItem("this-month")!.click();
      await flushPromises();

      expect(lastEmit()).toMatchObject({
        relativeTimePeriod: "calendar:month:0",
        startTime: micros("2026-09-30T18:30:00Z"),
        endTime: micros("2026-10-08T03:00:00Z"),
        valueType: "relative",
      });
      expect(wrapper!.vm.menuOpen).toBe(false);
      expect((wrapper!.emitted("hide") ?? []).length).toBe(hidesBefore + 1);
      expect(wrapper!.vm.triggerLabel).toBe("This month");
      expect(wrapper!.vm.triggerTooltip).toBe(
        "2026/10/01 00:00:00 - 2026/10/08 08:30:00 (Asia/Calcutta)",
      );
    });

    it("keeps a rail item and a grid chip mutually exclusive", async () => {
      createWrapper({ autoApply: true });
      await flushPromises();
      await openMenu();
      expect(el("date-time-relative-15-m-btn")?.className).toContain(SELECTED_CLASS);

      calendarItem("yesterday")!.click();
      await openMenu();
      expect(calendarItem("yesterday")?.className).toContain(SELECTED_CLASS);
      expect(calendarItem("today")?.className).not.toContain(SELECTED_CLASS);
      expect(el("date-time-relative-15-m-btn")?.className).not.toContain(SELECTED_CLASS);

      el("date-time-relative-3-h-btn")!.click();
      await flushPromises();
      expect(calendarItem("yesterday")?.className).not.toContain(SELECTED_CLASS);
      expect(el("date-time-relative-3-h-btn")?.className).toContain(SELECTED_CLASS);
      expect(lastEmit().relativeTimePeriod).toBe("3h");
    });

    it("disables ranges longer than the query-range limit and explains why", async () => {
      createWrapper({ queryRangeRestrictionInHour: 24, queryRangeRestrictionMsg: "Max 24h" });
      await openMenu();

      expect(calendarItem("today")?.disabled).toBe(false);
      expect(calendarItem("yesterday")?.disabled).toBe(false);
      expect(calendarItem("this-week")?.disabled).toBe(true);
      expect(calendarItem("last-year")?.disabled).toBe(true);
    });

    it("moves between rail items with the arrow keys and stays out of the grid", async () => {
      seedHistory([hourRange(1)]);
      createWrapper();
      await openMenu();

      const press = (dataTest: string, key: string) => {
        const from = el(dataTest)!;
        from.focus();
        from.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
        return document.activeElement?.getAttribute("data-test");
      };

      expect(press("date-time-rail-recent-0", "ArrowDown")).toBe("date-time-rail-calendar-today");
      expect(press("date-time-rail-calendar-today", "ArrowDown")).toBe(
        "date-time-rail-calendar-yesterday",
      );
      expect(press("date-time-rail-calendar-today", "ArrowUp")).toBe("date-time-rail-recent-0");
      expect(press("date-time-rail-calendar-last-year", "ArrowDown")).toBe(
        "date-time-rail-calendar-last-year",
      );
      expect(press("date-time-rail-calendar-today", "ArrowRight")).toBe(
        "date-time-rail-calendar-today",
      );
    });
  });

  describe("calendar token behaviour", () => {
    it("returns to the applied period when the panel closes without Apply", async () => {
      createWrapper({ autoApply: false, defaultRelativeTime: "calendar:month:0" });
      await flushPromises();
      await openMenu();

      el("date-time-relative-1-h-btn")!.click();
      await flushPromises();
      wrapper!.vm.onMenuOpenChange(false);
      wrapper!.vm.menuOpen = false;
      await flushPromises();

      expect(wrapper!.vm.calendarToken).toBe("calendar:month:0");
      expect(wrapper!.vm.triggerLabel).toBe("This month");
      expect(el("date-time-next-btn")?.disabled).toBe(true);
    });

    it("drops the calendar token when a rolling chip or custom value is chosen", async () => {
      createWrapper({ autoApply: true, defaultRelativeTime: "calendar:day:0" });
      await flushPromises();

      wrapper!.vm.setRelativeDate("h", 3);
      expect(wrapper!.vm.calendarToken).toBeNull();
      expect(lastEmit().relativeTimePeriod).toBe("3h");

      wrapper!.vm.setRelativeTime("calendar:day:0");
      wrapper!.vm.relativeValue = 7;
      wrapper!.vm.onCustomPeriodSelect();
      expect(wrapper!.vm.calendarToken).toBeNull();
      expect(lastEmit().relativeTimePeriod).toBe("7h");
    });

    it("reads a calendar token from defaultRelativeTime and setSavedDate", async () => {
      createWrapper({ defaultRelativeTime: "calendar:quarter:-2" });
      await flushPromises();
      expect(wrapper!.vm.triggerLabel).toBe("Q2 2026");
      expect(lastEmit()).toMatchObject({
        relativeTimePeriod: "calendar:quarter:-2",
        startTime: micros("2026-03-31T18:30:00Z"),
        endTime: micros("2026-06-30T18:30:00.000Z"),
      });

      wrapper!.vm.setSavedDate({ type: "relative", relativeTimePeriod: "calendar:year:-2" });
      expect(wrapper!.vm.triggerLabel).toBe("2024");
    });

    it("keeps a calendar token as its absolute dates when the picker has no calendar presets", async () => {
      createWrapper({ calendarPresets: false, defaultRelativeTime: "calendar:month:0" });
      await flushPromises();

      expect(wrapper!.vm.calendarToken).toBeNull();
      expect(wrapper!.vm.selectedType).toBe("absolute");
      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        relativeTimePeriod: null,
        startTime: micros("2026-09-30T18:30:00Z"),
        endTime: micros("2026-10-08T03:00:00Z"),
      });
      expect(lastEmit().relativeTimePeriod).not.toBe("15m");
    });

    it("converts a calendar token restored through setSavedDate on a picker without presets", async () => {
      createWrapper({ calendarPresets: false });
      await flushPromises();

      wrapper!.vm.setSavedDate({ type: "relative", relativeTimePeriod: "calendar:day:-1" });
      expect(wrapper!.vm.selectedType).toBe("absolute");
      expect(wrapper!.vm.getConsumableDateTime()).toMatchObject({
        startTime: micros("2026-10-06T18:30:00Z"),
        endTime: micros("2026-10-07T18:30:00Z"),
      });
    });

    it("leaves an applied absolute range alone when a stale calendar token rides along", async () => {
      createWrapper({
        calendarPresets: false,
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2026-10-01T00:00:00Z"),
          endTime: micros("2026-10-01T01:00:00Z"),
        },
        defaultRelativeTime: "calendar:month:-1",
      });
      await flushPromises();

      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-10-01T00:00:00Z"),
        endTime: micros("2026-10-01T01:00:00Z"),
      });
    });

    it("refuses a shift into a period longer than the query-range limit", async () => {
      createWrapper({
        autoApply: true,
        defaultRelativeTime: "calendar:day:0",
        queryRangeRestrictionInHour: 12,
        queryRangeRestrictionMsg: "Max 12 hours",
      });
      await flushPromises();
      const emitsBefore = (wrapper!.emitted("on:date-change") ?? []).length;

      el("date-time-prev-btn")!.click();
      await flushPromises();

      expect(wrapper!.vm.calendarToken).toBe("calendar:day:0");
      expect((wrapper!.emitted("on:date-change") ?? []).length).toBe(emitsBefore);
    });

    it("clamps a calendar range to the largest allowed window when a limit arrives", async () => {
      createWrapper({ autoApply: true, defaultRelativeTime: "calendar:month:-1" });
      await flushPromises();

      await wrapper!.setProps({ queryRangeRestrictionInHour: 72 });
      await flushPromises();

      expect(wrapper!.vm.calendarToken).toBeNull();
      expect(lastEmit().relativeTimePeriod).toBe("3d");
      expect(wrapper!.vm.triggerLabel).toBe("Past 3 Days");
    });

    it("runs the minute clock only while a calendar range can be on screen", async () => {
      const minuteTimers = () => setIntervalSpy.mock.calls.filter(([, ms]) => ms === 60_000).length;
      const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
      const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

      createWrapper({ calendarPresets: false });
      await flushPromises();
      expect(minuteTimers()).toBe(0);
      wrapper!.unmount();
      wrapper = null;

      createWrapper({ defaultRelativeTime: "15m" });
      await flushPromises();
      expect(minuteTimers()).toBe(0);
      await openMenu();
      expect(minuteTimers()).toBe(1);
      wrapper!.unmount();
      wrapper = null;
      expect(clearIntervalSpy).toHaveBeenCalled();

      createWrapper({ defaultRelativeTime: "calendar:day:-2" });
      await flushPromises();
      expect(minuteTimers()).toBe(2);
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    });

    it("moves an older period's label to the right day once the clock passes midnight", async () => {
      createWrapper({ autoApply: false, defaultRelativeTime: "calendar:day:-2" });
      await flushPromises();
      expect(wrapper!.vm.triggerLabel).toBe("Oct 6");

      vi.setSystemTime(new Date("2026-10-09T03:00:00Z"));
      wrapper!.vm.refreshTooltipNow();
      await flushPromises();
      expect(wrapper!.vm.triggerLabel).toBe("Oct 7");
    });

    it("steps a calendar period by its own unit with the shift arrows", async () => {
      createWrapper({ autoApply: false, defaultRelativeTime: "calendar:month:0" });
      await flushPromises();
      expect(el("date-time-next-btn")?.disabled).toBe(true);

      el("date-time-prev-btn")!.click();
      await flushPromises();
      expect(lastEmit()).toMatchObject({ relativeTimePeriod: "calendar:month:-1" });
      expect(wrapper!.vm.triggerLabel).toBe("Last month");

      el("date-time-prev-btn")!.click();
      await flushPromises();
      expect(lastEmit()).toMatchObject({
        relativeTimePeriod: "calendar:month:-2",
        startTime: micros("2026-07-31T18:30:00Z"),
        endTime: micros("2026-08-31T18:30:00.000Z"),
      });
      expect(wrapper!.vm.triggerLabel).toBe("Aug 2026");
      expect(el("date-time-next-btn")?.disabled).toBe(false);

      el("date-time-next-btn")!.click();
      await flushPromises();
      expect(lastEmit().relativeTimePeriod).toBe("calendar:month:-1");
      expect(storedHistory()).toEqual([]);
    });

    it("re-resolves the same token in a new timezone", async () => {
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

    it("drops a restored calendar period that exceeds the query-range limit", async () => {
      createWrapper({
        autoApply: true,
        defaultRelativeTime: "calendar:year:0",
        queryRangeRestrictionInHour: 24,
      });
      await flushPromises();

      expect(wrapper!.vm.calendarToken).toBeNull();
      expect(lastEmit().relativeTimePeriod).not.toMatch(/^calendar:/);
    });
  });

  describe("single clicked day", () => {
    const calendar = () => wrapper!.findComponent({ name: "ODateRangeCalendar" });

    it("applies the clicked day, not the old dates, when Apply is pressed", async () => {
      createWrapper({ autoApply: false });
      await flushPromises();
      await openMenu();
      el("date-time-absolute-tab")!.click();
      await flushPromises();

      calendar().vm.$emit("update:pendingDate", "2026/10/03");
      wrapper!.vm.selectedTime.startTime = "09:15:00";
      wrapper!.vm.selectedTime.endTime = "10:30:00";
      await flushPromises();
      expect(wrapper!.vm.triggerLabel).toBe("2026/10/03 09:15:00 - 2026/10/03 10:30:00");
      el("date-time-apply-btn")!.click();
      await flushPromises();

      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-10-03T03:45:00Z"),
        endTime: micros("2026-10-03T05:00:00Z"),
      });
    });

    it("drops an unapplied pending day from the label when the panel closes without Apply", async () => {
      createWrapper({ autoApply: false });
      await flushPromises();
      const applied = wrapper!.vm.triggerLabel;
      await openMenu();
      el("date-time-absolute-tab")!.click();
      await flushPromises();
      calendar().vm.$emit("update:pendingDate", "2026/10/03");
      await flushPromises();

      wrapper!.vm.onMenuOpenChange(false);
      wrapper!.vm.menuOpen = false;
      await flushPromises();

      expect(wrapper!.vm.pendingDay).toBeNull();
      expect(wrapper!.vm.triggerLabel).toBe(applied);
    });

    it("holds auto-apply while the day is pending and applies that day on close", async () => {
      createWrapper({ autoApply: true });
      await flushPromises();
      await openMenu();
      el("date-time-absolute-tab")!.click();
      await flushPromises();
      const emitsBefore = (wrapper!.emitted("on:date-change") ?? []).length;

      calendar().vm.$emit("update:pendingDate", "2026/10/03");
      wrapper!.vm.selectedTime.startTime = "09:15:00";
      wrapper!.vm.selectedTime.endTime = "10:30:00";
      await flushPromises();
      expect((wrapper!.emitted("on:date-change") ?? []).length).toBe(emitsBefore);

      wrapper!.vm.onMenuOpenChange(false);
      wrapper!.vm.menuOpen = false;
      await flushPromises();
      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-10-03T03:45:00Z"),
        endTime: micros("2026-10-03T05:00:00Z"),
      });
      expect(wrapper!.vm.selectedType).toBe("absolute");
    });

    it("applies a range completed by the second click as before", async () => {
      createWrapper({ autoApply: true });
      await flushPromises();
      await openMenu();
      el("date-time-absolute-tab")!.click();
      await flushPromises();

      calendar().vm.$emit("update:pendingDate", "2026/10/03");
      await flushPromises();
      calendar().vm.$emit("update:startDate", "2026/10/03");
      calendar().vm.$emit("update:endDate", "2026/10/05");
      calendar().vm.$emit("update:pendingDate", null);
      await flushPromises();

      expect(lastEmit()).toMatchObject({ valueType: "absolute" });
      expect(wrapper!.vm.selectedDate).toEqual({ from: "2026/10/03", to: "2026/10/05" });
    });
  });

  describe("semantics", () => {
    it("labels the Recent and Calendar sections as groups of lists", async () => {
      seedHistory([hourRange(1), hourRange(2)]);
      createWrapper();
      await openMenu();

      const groups = Array.from(
        document.querySelectorAll('[data-test="date-time-rail"] [role="group"]'),
      );
      const names = groups.map((g) =>
        document.getElementById(g.getAttribute("aria-labelledby") ?? "")?.textContent?.trim(),
      );
      expect(names).toEqual(["Recent", "Calendar"]);
      expect(groups[0].querySelectorAll('[role="list"] > [role="listitem"]')).toHaveLength(2);
      expect(groups[1].querySelectorAll('[role="list"] > [role="listitem"]')).toHaveLength(10);
    });
  });

  describe("tabs", () => {
    it("seeds the Absolute tab with the applied calendar range and applies nothing", async () => {
      createWrapper({ autoApply: true, defaultRelativeTime: "calendar:day:0" });
      await flushPromises();
      await openMenu();
      const emitsBefore = (wrapper!.emitted("on:date-change") ?? []).length;

      el("date-time-absolute-tab")!.click();
      await flushPromises();

      expect(wrapper!.vm.selectedDate).toEqual({ from: "2026/10/08", to: "2026/10/08" });
      expect(wrapper!.vm.selectedTime).toEqual({ startTime: "00:00:00", endTime: "08:30:00" });
      expect((wrapper!.emitted("on:date-change") ?? []).length).toBe(emitsBefore);

      wrapper!.vm.onMenuOpenChange(false);
      wrapper!.vm.menuOpen = false;
      await flushPromises();
      expect(wrapper!.vm.selectedType).toBe("relative");
      expect(wrapper!.vm.triggerLabel).toBe("Today");
      expect((wrapper!.emitted("on:date-change") ?? []).length).toBe(emitsBefore);
    });

    it("keeps typed times while the clock ticks; only switching to the tab seeds the fields", async () => {
      createWrapper({ autoApply: true, defaultRelativeTime: "calendar:day:0" });
      await flushPromises();
      await openMenu();
      el("date-time-absolute-tab")!.click();
      await flushPromises();

      wrapper!.vm.selectedTime.startTime = "09:00:00";
      wrapper!.vm.selectedTime.endTime = "10:00:00";
      await flushPromises();
      vi.setSystemTime(new Date("2026-10-08T03:05:00Z"));
      wrapper!.vm.refreshTooltipNow();
      await flushPromises();

      expect(wrapper!.vm.selectedTime).toEqual({ startTime: "09:00:00", endTime: "10:00:00" });
    });

    it("keeps the exact period end when the zone changes while the seeded fields are shown", async () => {
      createWrapper({ autoApply: false, defaultRelativeTime: "calendar:month:-1" });
      await flushPromises();
      await openMenu();
      el("date-time-absolute-tab")!.click();
      await flushPromises();

      store.state.timezone = "UTC";
      expect(wrapper!.vm.getConsumableDateTime()).toMatchObject({
        startTime: micros("2026-09-01T00:00:00Z"),
        endTime: micros("2026-10-01T00:00:00Z"),
      });
    });

    it("applies the seeded range once the user edits it", async () => {
      createWrapper({ autoApply: true, defaultRelativeTime: "calendar:month:-1" });
      await flushPromises();
      await openMenu();

      el("date-time-absolute-tab")!.click();
      await flushPromises();
      expect(wrapper!.vm.selectedDate).toEqual({ from: "2026/09/01", to: "2026/09/30" });
      expect(wrapper!.vm.selectedTime).toEqual({ startTime: "00:00:00", endTime: "23:59:59" });

      wrapper!.vm.selectedTime.startTime = "06:00:00";
      await flushPromises();
      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-09-01T00:30:00Z"),
        endTime: micros("2026-09-30T18:30:00Z"),
      });

      wrapper!.vm.selectedTime.endTime = "23:00:00";
      await flushPromises();
      expect(lastEmit()).toMatchObject({ endTime: micros("2026-09-30T17:30:00Z") });
    });
  });

  describe("shift arrows on an auto-applied picker", () => {
    it("steps a calendar period back and forward, › off only at the current period", async () => {
      createWrapper({ autoApply: true, defaultRelativeTime: "calendar:month:-1" });
      await flushPromises();
      expect(el("date-time-prev-btn")?.disabled).toBe(false);
      expect(el("date-time-next-btn")?.disabled).toBe(false);

      el("date-time-prev-btn")!.click();
      await flushPromises();
      expect(lastEmit().relativeTimePeriod).toBe("calendar:month:-2");
      expect(wrapper!.vm.triggerLabel).toBe("Aug 2026");

      el("date-time-next-btn")!.click();
      el("date-time-next-btn")!.click();
      await flushPromises();
      expect(lastEmit().relativeTimePeriod).toBe("calendar:month:0");
      expect(el("date-time-next-btn")?.disabled).toBe(true);
    });
  });

  describe("height", () => {
    it("caps the panel to the space the popover has and scrolls the presets inside it", async () => {
      createWrapper();
      await openMenu();

      const menu = document.querySelector("#date-time-menu")!;
      expect(menu.className).toContain("max-h-[calc(var(--reka-popper-available-height");
      expect(document.querySelector("#date-time-menu .o-tab-panels")?.className).toContain(
        "overflow-y-auto",
      );
    });
  });

  describe("recent history", () => {
    const applyAbsolute = async () => {
      wrapper!.vm.setDateType("absolute");
      wrapper!.vm.selectedDate.from = "2026/10/07";
      wrapper!.vm.selectedDate.to = "2026/10/07";
      wrapper!.vm.selectedTime.startTime = "10:00:00";
      wrapper!.vm.selectedTime.endTime = "11:30:00";
      await flushPromises();
      el("date-time-apply-btn")!.click();
      await flushPromises();
    };

    it("records an absolute range when Apply is pressed", async () => {
      createWrapper({ autoApply: false });
      await flushPromises();
      await openMenu();

      await applyAbsolute();

      expect(storedHistory()).toEqual([
        { startUs: micros("2026-10-07T04:30:00Z"), endUs: micros("2026-10-07T06:00:00Z") },
      ]);
    });

    it("does not record relative or calendar ranges", async () => {
      createWrapper({ autoApply: false });
      await flushPromises();
      await openMenu();

      el("date-time-relative-1-h-btn")!.click();
      el("date-time-apply-btn")!.click();
      await openMenu();
      calendarItem("last-week")!.click();
      await flushPromises();

      expect(storedHistory()).toEqual([]);
    });

    it("records an auto-applied absolute range once, when the panel closes", async () => {
      createWrapper({ autoApply: true });
      await flushPromises();
      await openMenu();

      wrapper!.vm.setDateType("absolute");
      wrapper!.vm.selectedTime.startTime = "01:00:00";
      await flushPromises();
      wrapper!.vm.selectedTime.startTime = "02:00:00";
      await flushPromises();
      expect(storedHistory()).toEqual([]);

      wrapper!.vm.onMenuOpenChange(false);
      expect(storedHistory()).toHaveLength(1);
    });

    it("records a chart drag-zoom but not a restored saved range", async () => {
      createWrapper({ autoApply: true });
      await flushPromises();

      wrapper!.vm.setSavedDate({
        type: "absolute",
        startTime: micros("2026-10-06T00:00:00Z"),
        endTime: micros("2026-10-06T01:00:00Z"),
      });
      expect(storedHistory()).toEqual([]);

      wrapper!.vm.setCustomDate("absolute", {
        start: Date.parse("2026-10-07T00:00:00Z"),
        end: Date.parse("2026-10-07T00:10:00Z"),
      });
      expect(storedHistory()).toHaveLength(1);
    });

    it("lists ranges newest first and applies one on click, moving it to the top", async () => {
      seedHistory([hourRange(1), hourRange(30)]);
      createWrapper({ autoApply: false });
      await flushPromises();
      await openMenu();

      expect(el("date-time-rail-recent-0")?.textContent?.trim()).toBe(
        "2026/10/08 04:30:00 - 2026/10/08 05:00:00",
      );
      expect(el("date-time-rail-recent-1")?.textContent?.trim()).toBe(
        "2026/10/06 23:30:00 - 2026/10/06 23:59:59",
      );

      el("date-time-rail-recent-1")!.click();
      await flushPromises();

      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: hourRange(30).startUs,
        endTime: hourRange(30).endUs,
      });
      expect(wrapper!.vm.menuOpen).toBe(false);
      expect(storedHistory()).toEqual([hourRange(30), hourRange(1)]);

      await openMenu();
      expect(el("date-time-rail-recent-0")?.className).toContain(SELECTED_CLASS);
      expect(el("date-time-relative-15-m-btn")).toBeNull();
    });

    it("keeps the × out of the Tab order and removes the focused row with Delete", async () => {
      vi.useRealTimers();
      seedHistory([hourRange(1), hourRange(2), hourRange(3)]);
      createWrapper();
      await openMenu();

      expect(el("date-time-rail-recent-0-remove")?.getAttribute("tabindex")).toBe("-1");
      const row = el("date-time-rail-recent-1")!;
      row.focus();
      row.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
      await flushPromises();

      expect(storedHistory()).toEqual([hourRange(1), hourRange(3)]);
      expect(document.activeElement?.getAttribute("data-test")).toBe("date-time-rail-recent-1");
    });

    it("reaches a row's remove button with ArrowRight and returns with ArrowLeft", async () => {
      vi.useRealTimers();
      seedHistory([hourRange(1), hourRange(2)]);
      createWrapper();
      await openMenu();
      const key = (target: HTMLElement, k: string) =>
        target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));

      const row = el("date-time-rail-recent-1")!;
      row.focus();
      key(row, "ArrowRight");
      const remove = el("date-time-rail-recent-1-remove")!;
      expect(document.activeElement).toBe(remove);
      expect(remove.getAttribute("aria-label")).toBe(
        `Remove ${row.textContent?.trim()} from recent ranges`,
      );

      key(remove, "ArrowLeft");
      expect(document.activeElement).toBe(el("date-time-rail-recent-1"));

      key(el("date-time-rail-recent-1")!, "ArrowRight");
      el("date-time-rail-recent-1-remove")!.click();
      await flushPromises();
      expect(storedHistory()).toEqual([hourRange(1)]);
      expect(document.activeElement?.getAttribute("data-test")).toBe("date-time-rail-recent-0");
    });

    it("lets a row over the query-range limit be removed by keyboard, then moves focus on", async () => {
      vi.useRealTimers();
      seedHistory([
        { startUs: micros("2026-10-01T00:00:00Z"), endUs: micros("2026-10-03T00:00:00Z") },
      ]);
      createWrapper({ queryRangeRestrictionInHour: 24 });
      await openMenu();

      const row = el("date-time-rail-recent-0")!;
      expect(row.hasAttribute("disabled")).toBe(false);
      expect(row.getAttribute("aria-disabled")).toBe("true");
      expect(row.getAttribute("tabindex")).toBe("0");
      const hintId = row.getAttribute("aria-describedby")!;
      expect(document.getElementById(hintId)?.textContent).toContain("Delete");
      expect(row.hasAttribute("aria-keyshortcuts")).toBe(false);

      row.focus();
      row.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
      await flushPromises();

      expect(storedHistory()).toEqual([]);
      expect(document.activeElement?.getAttribute("data-test")).toBe(
        "date-time-rail-calendar-today",
      );
    });

    it.each([
      ["without calendar presets", { calendarPresets: false }],
      ["when every calendar item is over the limit", { queryRangeRestrictionInHour: 0.001 }],
    ])("keeps focus inside the rail after removing the last row %s", async (_label, props) => {
      vi.useRealTimers();
      seedHistory([hourRange(1)]);
      createWrapper(props);
      await openMenu();

      const row = el("date-time-rail-recent-0")!;
      row.focus();
      row.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
      await flushPromises();

      expect(storedHistory()).toEqual([]);
      expect(document.activeElement?.getAttribute("data-test")).toBe("date-time-rail");
    });

    it("opens on the first rail item and keeps the rail a single Tab stop", async () => {
      vi.useRealTimers();
      seedHistory([1, 2, 3, 4].map(hourRange));
      createWrapper();
      await openMenu();

      expect(document.activeElement?.getAttribute("data-test")).toBe("date-time-rail-recent-0");
      const tabbable = () =>
        Array.from(document.querySelectorAll("[data-date-time-rail-item]"))
          .filter((node) => node.getAttribute("tabindex") === "0")
          .map((node) => node.getAttribute("data-test"));
      expect(tabbable()).toEqual(["date-time-rail-recent-0"]);
      expect(el("date-time-rail-recent-0-remove")?.getAttribute("tabindex")).toBe("-1");

      const press = (key: string) =>
        document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      press("ArrowDown");
      press("ArrowDown");
      press("ArrowDown");
      await flushPromises();
      expect(document.activeElement?.getAttribute("data-test")).toBe(
        "date-time-rail-recent-toggle",
      );
      expect(tabbable()).toEqual(["date-time-rail-recent-toggle"]);
      press("ArrowDown");
      await flushPromises();
      expect(document.activeElement?.getAttribute("data-test")).toBe(
        "date-time-rail-calendar-today",
      );
      expect(tabbable()).toEqual(["date-time-rail-calendar-today"]);
      expect(el("date-time-relative-tab")?.getAttribute("tabindex")).not.toBe("-1");
    });

    it("opens on the first calendar item when there is no recent range", async () => {
      createWrapper();
      await openMenu();

      expect(document.activeElement?.getAttribute("data-test")).toBe(
        "date-time-rail-calendar-today",
      );
    });

    it("recalls a range ending at midnight as that day's last second and still queries the exact end", async () => {
      const day = {
        startUs: micros("2026-10-05T18:30:00Z"),
        endUs: micros("2026-10-06T18:30:00Z"),
      };
      seedHistory([day]);
      createWrapper({ autoApply: false });
      await flushPromises();
      await openMenu();

      el("date-time-rail-recent-0")!.click();
      await flushPromises();

      expect(wrapper!.vm.selectedDate).toEqual({ from: "2026/10/06", to: "2026/10/06" });
      expect(wrapper!.vm.selectedTime).toEqual({ startTime: "00:00:00", endTime: "23:59:59" });
      expect(lastEmit()).toMatchObject({ startTime: day.startUs, endTime: day.endUs });
      expect(storedHistory()).toEqual([day]);
    });

    it("removes a range with its × button", async () => {
      seedHistory([hourRange(1), hourRange(2)]);
      createWrapper();
      await openMenu();

      el("date-time-rail-recent-0-remove")!.click();
      await flushPromises();

      expect(storedHistory()).toEqual([hourRange(2)]);
      expect(el("date-time-rail-recent-1")).toBeNull();
    });

    it("shows three ranges with Show more, and all of them after a click or Enter", async () => {
      // Vue drops a handler's events stamped before it attached, which a faked Date clock gets wrong.
      vi.useRealTimers();
      seedHistory([1, 2, 3, 4, 5].map(hourRange));
      createWrapper();
      await openMenu();

      const toggle = el("date-time-rail-recent-toggle")!;
      expect(toggle.tagName).toBe("BUTTON");
      expect(toggle.textContent?.trim()).toBe("Show more");
      expect(el("date-time-rail-recent-2")).not.toBeNull();
      expect(el("date-time-rail-recent-3")).toBeNull();

      toggle.click();
      await flushPromises();
      expect(el("date-time-rail-recent-4")).not.toBeNull();
      expect(el("date-time-rail-recent-toggle")?.textContent?.trim()).toBe("Show less");
      expect(el("date-time-rail-recent-list")?.className).not.toContain("overflow");
      expect(el("date-time-rail")?.className).toContain("overflow-y-auto");
      expect(el("date-time-rail")?.className).toContain("absolute");

      el("date-time-rail-recent-toggle")!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      await flushPromises();
      expect(el("date-time-rail-recent-3")).toBeNull();
      expect(el("date-time-rail-recent-toggle")?.textContent?.trim()).toBe("Show more");
    });

    it("keeps at most 15 ranges in the rail after 20 applies", async () => {
      vi.useRealTimers();
      createWrapper({ autoApply: true });
      await flushPromises();
      for (let n = 1; n <= 20; n++) {
        wrapper!.vm.setCustomDate("absolute", {
          start: Date.parse("2026-10-01T00:00:00Z") + n * 3_600_000,
          end: Date.parse("2026-10-01T00:30:00Z") + n * 3_600_000,
        });
      }
      await openMenu();
      el("date-time-rail-recent-toggle")!.click();
      await flushPromises();

      expect(storedHistory()).toHaveLength(15);
      expect(document.querySelectorAll("[data-date-time-rail-recent]")).toHaveLength(15);
    });

    it("has no Show more link for three ranges or fewer", async () => {
      seedHistory([1, 2, 3].map(hourRange));
      createWrapper();
      await openMenu();

      expect(el("date-time-rail-recent-2")).not.toBeNull();
      expect(el("date-time-rail-recent-toggle")).toBeNull();
    });

    it("starts collapsed every time the panel opens", async () => {
      seedHistory([1, 2, 3, 4].map(hourRange));
      createWrapper();
      await openMenu();
      el("date-time-rail-recent-toggle")!.click();
      await flushPromises();
      expect(el("date-time-rail-recent-3")).not.toBeNull();

      wrapper!.vm.menuOpen = false;
      await flushPromises();
      await openMenu();
      expect(el("date-time-rail-recent-3")).toBeNull();
    });

    it("disables a recent range longer than the query-range limit", async () => {
      seedHistory([
        { startUs: micros("2026-10-01T00:00:00Z"), endUs: micros("2026-10-03T00:00:00Z") },
      ]);
      createWrapper({ queryRangeRestrictionInHour: 24 });
      await openMenu();

      expect(el("date-time-rail-recent-0")?.getAttribute("aria-disabled")).toBe("true");
    });
  });
});
