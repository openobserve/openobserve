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

    it("is filtered by the picker search", async () => {
      createWrapper();
      await openMenu();

      wrapper!.vm.relativeSearchTerm = "month";
      await flushPromises();
      expect(wrapper!.vm.calendarRailItems.map((item: { id: string }) => item.id)).toEqual([
        "this-month",
        "last-month",
      ]);
      expect(calendarItem("today")).toBeNull();

      wrapper!.vm.relativeSearchTerm = "zzz";
      await flushPromises();
      expect(wrapper!.vm.calendarRailItems).toEqual([]);
      expect(document.body.textContent).not.toContain("Calendar");
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

      wrapper!.vm.setCalendarPeriod("calendar:day:0");
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
        endTime: micros("2026-06-30T18:29:59.999Z"),
      });

      wrapper!.vm.setSavedDate({ type: "relative", relativeTimePeriod: "calendar:year:-2" });
      expect(wrapper!.vm.triggerLabel).toBe("2024");
    });

    it("ignores calendar tokens when the picker has no calendar presets", async () => {
      createWrapper({ calendarPresets: false, defaultRelativeTime: "calendar:month:0" });
      await flushPromises();

      expect(wrapper!.vm.calendarToken).toBeNull();
      expect(lastEmit().relativeTimePeriod).toBe("15m");
      expect(wrapper!.vm.triggerLabel).toBe("Past 15 Minutes");
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
        endTime: micros("2026-08-31T18:29:59.999Z"),
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

    it("applies the seeded range once the user edits it", async () => {
      createWrapper({ autoApply: true, defaultRelativeTime: "calendar:month:-1" });
      await flushPromises();
      await openMenu();

      el("date-time-absolute-tab")!.click();
      await flushPromises();
      expect(wrapper!.vm.selectedDate).toEqual({ from: "2026/09/01", to: "2026/09/30" });
      expect(wrapper!.vm.selectedTime).toEqual({ startTime: "00:00:00", endTime: "23:59:59" });

      wrapper!.vm.selectedTime.endTime = "12:00:00";
      await flushPromises();
      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-08-31T18:30:00Z"),
        endTime: micros("2026-09-30T06:30:00Z"),
      });
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

      expect(el("date-time-rail-recent-0")?.textContent?.trim()).toBe("Oct 8 · 04:30–05:00");
      expect(el("date-time-rail-recent-1")?.textContent?.trim()).toBe("Oct 6 23:30–00:00+1d");

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

      expect(el("date-time-rail-recent-0")?.disabled).toBe(true);
    });
  });
});
