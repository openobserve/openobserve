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
];

const pressed = (node: Element | null) => node?.getAttribute("aria-pressed") === "true";

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
    it("explains an empty Recent list and shows the eight calendar ranges in four rows", async () => {
      createWrapper();
      await openMenu();

      expect(el("date-time-helpers")).not.toBeNull();
      expect(el("date-time-rail-recent-empty")?.textContent?.trim()).toBe(
        "Ranges you apply will show up here.",
      );
      for (const id of CALENDAR_IDS) expect(calendarItem(id)).not.toBeNull();
      expect(calendarItem("today")?.textContent).toContain("Today");
      expect(calendarItem("last-month")?.textContent).toContain("Last month");
      expect(el("date-time-rail-calendar-today-hint")?.textContent).toBe("· Oct 8");
      expect(el("date-time-rail-calendar-yesterday-hint")?.textContent).toBe("· Oct 7");
      expect(el("date-time-rail-calendar-this-month-hint")?.textContent).toBe("· Oct 1 – 8");
      expect(el("date-time-rail-calendar-last-quarter-hint")?.textContent).toBe("· Jul 1 – Sep 30");
      expect(
        Array.from(document.querySelectorAll("[data-date-time-rail-calendar]")).map((node) =>
          node.getAttribute("data-test"),
        ),
      ).toEqual(CALENDAR_IDS.map((id) => `date-time-rail-calendar-${id}`));
      expect(el("date-time-relative-15-m-btn")).not.toBeNull();
      expect(el("date-time-relative-tab")).toBeNull();
    });
    it("labels the groups in one muted, sentence-case style", async () => {
      seedHistory([hourRange(1)]);
      createWrapper();
      await openMenu();

      const recent = el("date-time-rail-recent-header")!;
      expect(recent.className).toContain("text-text-secondary");
      expect(recent.className).not.toContain("uppercase");
      expect(recent.className).not.toContain("tracking-wide");
    });
    it("gives Quick ranges its own surface beside Custom range", async () => {
      createWrapper();
      await openMenu();

      expect(el("date-time-quick-ranges")?.className).toContain("bg-surface-panel");
      expect(el("date-time-custom-range")).not.toBeNull();
    });
    it("keeps the remove button always visible", async () => {
      seedHistory([hourRange(1)]);
      createWrapper();
      await openMenu();

      expect(el("date-time-rail-recent-0-remove")?.className).not.toContain("opacity-0");
      expect(el("date-time-rail-recent-0-remove")?.className).toContain("text-text-secondary!");
    });

    it("gives every timezone option a UTC offset suffix and the zone name as its list label", async () => {
      createWrapper({ autoApply: false });
      await openMenu();

      const options = wrapper!.vm.timezoneSelectOptions as {
        label: string;
        listLabel?: string;
        suffix?: string;
        value: string;
      }[];
      const kolkata = options.find((o) => o.value === "Asia/Calcutta")!;
      expect(kolkata.suffix).toBe("UTC+05:30");
      expect(kolkata.listLabel).toBe("Asia/Calcutta");
      expect(kolkata.label).toBe("Asia/Calcutta (UTC+05:30)");
      expect(options.find((o) => o.value === "UTC")?.suffix).toBe("UTC+00:00");
      expect(options.every((o) => o.suffix?.startsWith("UTC"))).toBe(true);
    });

    it("has no Cancel button and shows the timezone offset", async () => {
      createWrapper({ autoApply: false });
      await openMenu();

      wrapper!.vm.timezone = IST;
      await flushPromises();
      expect(el("date-time-range-tz")?.textContent).toContain("Asia/Calcutta (UTC+05:30)");
      expect(el("date-time-apply-btn")).not.toBeNull();
    });

    it("keeps Recent but drops the calendar section without calendarPresets", async () => {
      createWrapper({ calendarPresets: false });
      await openMenu();

      expect(el("date-time-helpers")).not.toBeNull();
      for (const id of CALENDAR_IDS) expect(calendarItem(id)).toBeNull();
      expect(wrapper!.vm.calendarRailItems).toBeNull();
    });

    it("has no helpers on a date-only picker", async () => {
      createWrapper({ disableRelative: true });
      await openMenu();

      expect(el("date-time-helpers")).toBeNull();
    });
  });

  describe("calendar items", () => {
    it("applies a range on click on an applying host, and closes the panel", async () => {
      createWrapper({ autoApply: true });
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
        "2026-10-01 00:00:00 – 2026-10-08 08:30:00\n7d 8h · Asia/Calcutta (UTC+05:30)",
      );
    });

    it("fills the draft on a host that does not apply, and applies it on Apply", async () => {
      createWrapper({ autoApply: false });
      await flushPromises();
      await openMenu();
      const before = (wrapper!.emitted("on:date-change") ?? []).length;

      calendarItem("this-month")!.click();
      await flushPromises();
      expect(wrapper!.vm.menuOpen).toBe(true);
      expect((wrapper!.emitted("on:date-change") ?? []).length).toBe(before);
      expect(pressed(calendarItem("this-month"))).toBe(true);

      el("date-time-apply-btn")!.click();
      await flushPromises();
      expect(lastEmit()).toMatchObject({ relativeTimePeriod: "calendar:month:0" });
      expect(wrapper!.vm.menuOpen).toBe(false);
    });
    it("keeps a calendar chip and a relative chip mutually exclusive", async () => {
      createWrapper({ autoApply: true });
      await flushPromises();
      await openMenu();
      expect(pressed(el("date-time-relative-15-m-btn"))).toBe(true);

      calendarItem("yesterday")!.click();
      await openMenu();
      expect(pressed(calendarItem("yesterday"))).toBe(true);
      expect(pressed(calendarItem("today"))).toBe(false);
      expect(pressed(el("date-time-relative-15-m-btn"))).toBe(false);

      el("date-time-relative-4-h-btn")!.click();
      await openMenu();
      expect(pressed(calendarItem("yesterday"))).toBe(false);
      expect(pressed(el("date-time-relative-4-h-btn"))).toBe(true);
      expect(lastEmit().relativeTimePeriod).toBe("4h");
    });
    it("disables ranges longer than the query-range limit and explains why", async () => {
      createWrapper({ queryRangeRestrictionInHour: 24, queryRangeRestrictionMsg: "Max 24h" });
      await openMenu();

      expect(calendarItem("today")?.disabled).toBe(false);
      expect(calendarItem("yesterday")?.disabled).toBe(false);
      expect(calendarItem("this-week")?.disabled).toBe(true);
      expect(calendarItem("last-quarter")?.disabled).toBe(true);
    });

    it("moves inside the calendar group with the arrows, Home and End, and leaves Recent to its own group", async () => {
      vi.useRealTimers();
      seedHistory([hourRange(1)]);
      createWrapper();
      await openMenu();

      const press = (dataTest: string, key: string) => {
        const from = el(dataTest)!;
        from.focus();
        from.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
        return document.activeElement?.getAttribute("data-test");
      };

      expect(press("date-time-rail-calendar-today", "ArrowDown")).toBe(
        "date-time-rail-calendar-yesterday",
      );
      expect(press("date-time-rail-calendar-yesterday", "ArrowRight")).toBe(
        "date-time-rail-calendar-this-week",
      );
      expect(press("date-time-rail-calendar-this-week", "ArrowUp")).toBe(
        "date-time-rail-calendar-yesterday",
      );
      expect(press("date-time-rail-calendar-today", "End")).toBe(
        "date-time-rail-calendar-last-quarter",
      );
      expect(press("date-time-rail-calendar-last-quarter", "ArrowDown")).toBe(
        "date-time-rail-calendar-last-quarter",
      );
      expect(press("date-time-rail-calendar-last-quarter", "Home")).toBe(
        "date-time-rail-calendar-today",
      );
      expect(press("date-time-rail-recent-0", "ArrowDown")).toBe("date-time-rail-recent-0");
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

    it("drops the calendar token when a rolling chip or typed value is chosen", async () => {
      createWrapper({ autoApply: true, defaultRelativeTime: "calendar:day:0" });
      await flushPromises();

      wrapper!.vm.setRelativeDate("h", 3);
      expect(wrapper!.vm.calendarToken).toBeNull();
      expect(lastEmit().relativeTimePeriod).toBe("3h");

      wrapper!.vm.setRelativeTime("calendar:day:0");
      await openMenu();
      wrapper!.vm.onFieldInput("7h");
      wrapper!.vm.onFieldSubmit("7h");
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
        "2026-10-05 00:00:00 – 2026-10-08 08:30:00\n3d 8h · Asia/Calcutta (UTC+05:30)",
      );

      vi.setSystemTime(new Date("2026-10-08T04:00:00Z"));
      await wrapper!.find('[data-test="date-time-btn"]').trigger("mouseenter");
      expect(wrapper!.vm.triggerTooltip).toBe(
        "2026-10-05 00:00:00 – 2026-10-08 09:30:00\n3d 9h · Asia/Calcutta (UTC+05:30)",
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

    const setTimes = (start: string, end: string) => {
      wrapper!.vm.onDraftEdge("start", { ...wrapper!.vm.draft.start, time: start });
      wrapper!.vm.draft.end.time = end;
    };

    it("keeps Apply off while End waits, and Enter applies the clicked day", async () => {
      createWrapper({ autoApply: false });
      await flushPromises();
      const applied = wrapper!.vm.triggerLabel;
      await openMenu();

      calendar().vm.$emit("update:pendingDate", "2026/10/03");
      setTimes("09:15:00", "10:30:00");
      await flushPromises();
      expect(wrapper!.vm.triggerLabel).toBe(applied);
      expect(el("date-time-range-summary-range")!.textContent).toContain("Oct 3, 09:15:00 – …");
      expect(el("date-time-range-draft")).not.toBeNull();
      expect((el("date-time-apply-btn") as HTMLButtonElement).disabled).toBe(true);

      wrapper!.vm.submitDraft();
      await flushPromises();

      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-10-03T03:45:00Z"),
        endTime: micros("2026-10-03T05:00:00Z"),
      });
    });

    it("drops an unapplied pending day when the panel closes without Apply", async () => {
      createWrapper({ autoApply: false });
      await flushPromises();
      const applied = wrapper!.vm.triggerLabel;
      await openMenu();
      calendar().vm.$emit("update:pendingDate", "2026/10/03");
      await flushPromises();

      wrapper!.vm.onMenuOpenChange(false);
      wrapper!.vm.menuOpen = false;
      await flushPromises();

      expect(wrapper!.vm.pendingEnd).toBe(false);
      expect(wrapper!.vm.triggerLabel).toBe(applied);
    });

    it("holds auto-apply while the day is pending and applies that day on close", async () => {
      createWrapper({ autoApply: true });
      await flushPromises();
      await openMenu();
      const emitsBefore = (wrapper!.emitted("on:date-change") ?? []).length;

      calendar().vm.$emit("update:pendingDate", "2026/10/03");
      setTimes("09:15:00", "10:30:00");
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

    it("applies a range completed by the second click when the panel closes", async () => {
      createWrapper({ autoApply: true });
      await flushPromises();
      await openMenu();
      const emitsBefore = (wrapper!.emitted("on:date-change") ?? []).length;

      calendar().vm.$emit("update:pendingDate", "2026/10/03");
      await flushPromises();
      calendar().vm.$emit("update:startDate", "2026/10/03");
      calendar().vm.$emit("update:endDate", "2026/10/05");
      calendar().vm.$emit("update:pendingDate", null);
      await flushPromises();
      expect((wrapper!.emitted("on:date-change") ?? []).length).toBe(emitsBefore);

      wrapper!.vm.onMenuOpenChange(false);
      wrapper!.vm.menuOpen = false;
      await flushPromises();

      expect(lastEmit()).toMatchObject({ valueType: "absolute" });
      expect(wrapper!.vm.selectedDate).toEqual({ from: "2026/10/03", to: "2026/10/05" });
    });

    it("swaps the times with the days when the second click is before the first", async () => {
      createWrapper({ autoApply: false });
      await flushPromises();
      await openMenu();

      calendar().vm.$emit("update:pendingDate", "2026/10/05");
      setTimes("09:15:00", "10:30:00");
      calendar().vm.$emit("update:startDate", "2026/10/03");
      calendar().vm.$emit("update:endDate", "2026/10/05");
      await flushPromises();

      expect(wrapper!.vm.draft.start).toMatchObject({ date: "2026-10-03", time: "10:30:00" });
      expect(wrapper!.vm.draft.end).toMatchObject({ date: "2026-10-05", time: "09:15:00" });
    });
  });

  describe("semantics", () => {
    it("labels the Relative, Calendar and Recent groups", async () => {
      seedHistory([hourRange(1), hourRange(2)]);
      createWrapper();
      await openMenu();

      const groups = Array.from(
        document.querySelectorAll('[data-test="date-time-helpers"] [role="group"]'),
      );
      const names = groups.map(
        (g) =>
          g.getAttribute("aria-label") ??
          document.getElementById(g.getAttribute("aria-labelledby") ?? "")?.textContent?.trim(),
      );
      expect(names).toEqual(["Relative", "Calendar", "Recent"]);
      expect(groups[2].querySelectorAll('[role="list"] > [role="listitem"]')).toHaveLength(2);
    });
  });

  describe("seeded Start/End", () => {
    it("shows the applied calendar range in Start/End and applies nothing on close", async () => {
      createWrapper({ autoApply: true, defaultRelativeTime: "calendar:day:0" });
      await flushPromises();
      await openMenu();
      const emitsBefore = (wrapper!.emitted("on:date-change") ?? []).length;

      expect(wrapper!.vm.draft.start).toMatchObject({ date: "2026-10-08", time: "00:00:00" });
      expect(wrapper!.vm.draft.end).toMatchObject({ date: "2026-10-08", time: "08:30:00" });

      wrapper!.vm.onMenuOpenChange(false);
      wrapper!.vm.menuOpen = false;
      await flushPromises();
      expect(wrapper!.vm.selectedType).toBe("relative");
      expect(wrapper!.vm.triggerLabel).toBe("Today");
      expect((wrapper!.emitted("on:date-change") ?? []).length).toBe(emitsBefore);
    });

    it("keeps edited times while the clock ticks", async () => {
      createWrapper({ autoApply: true, defaultRelativeTime: "calendar:day:0" });
      await flushPromises();
      await openMenu();

      wrapper!.vm.onDraftEdge("start", { date: "2026-10-08", time: "09:00:00", offset: "" });
      await flushPromises();
      vi.setSystemTime(new Date("2026-10-08T03:05:00Z"));
      wrapper!.vm.refreshTooltipNow();
      await flushPromises();

      expect(wrapper!.vm.draft.start.time).toBe("09:00:00");
    });

    it("keeps the exact period end when the zone changes", async () => {
      createWrapper({ autoApply: false, defaultRelativeTime: "calendar:month:-1" });
      await flushPromises();
      await openMenu();

      store.state.timezone = "UTC";
      expect(wrapper!.vm.getConsumableDateTime()).toMatchObject({
        startTime: micros("2026-09-01T00:00:00Z"),
        endTime: micros("2026-10-01T00:00:00Z"),
      });
    });

    it("applies the seeded range once the user edits it, on close", async () => {
      createWrapper({ autoApply: true, defaultRelativeTime: "calendar:month:-1" });
      await flushPromises();
      await openMenu();

      expect(wrapper!.vm.draft.start).toMatchObject({ date: "2026-09-01", time: "00:00:00" });
      expect(wrapper!.vm.draft.end).toMatchObject({ date: "2026-09-30", time: "23:59:59" });

      wrapper!.vm.onDraftEdge("start", { date: "2026-09-01", time: "06:00:00", offset: "" });
      wrapper!.vm.onMenuOpenChange(false);
      wrapper!.vm.menuOpen = false;
      await flushPromises();
      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-09-01T00:30:00Z"),
        endTime: micros("2026-09-30T18:30:00Z"),
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
    it("caps the panel to the space the popover has and scrolls inside it", async () => {
      createWrapper();
      await openMenu();

      const menu = document.querySelector("#date-time-menu")!;
      expect(menu.className).toContain("max-h-[calc(var(--reka-popper-available-height");
      expect(menu.className).toContain("overflow-y-auto");
    });
  });

  describe("recent history", () => {
    const editDraft = (start: string, end: string) => {
      wrapper!.vm.onDraftEdge("start", { date: "2026-10-07", time: start, offset: "" });
      wrapper!.vm.onDraftEdge("end", { date: "2026-10-07", time: end, offset: "" });
    };

    const applyAbsolute = async () => {
      editDraft("10:00:00", "11:30:00");
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
        {
          startUs: micros("2026-10-07T04:30:00Z"),
          endUs: micros("2026-10-07T06:00:00Z"),
          zone: IST,
        },
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

      editDraft("01:00:00", "03:00:00");
      await flushPromises();
      editDraft("02:00:00", "03:00:00");
      await flushPromises();
      expect(storedHistory()).toEqual([]);

      wrapper!.vm.onMenuOpenChange(false);
      expect(storedHistory()).toHaveLength(1);
      expect(storedHistory()[0].zone).toBe(IST);
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

      expect(el("date-time-rail-recent-0")?.getAttribute("aria-label")).toBe(
        "Oct 8 · 04:30–05:00 (Oct 8, 04:30:00 – 05:00:00 UTC+05:30)",
      );
      expect(el("date-time-rail-recent-0")?.textContent).toContain("Oct 8");
      expect(el("date-time-rail-recent-0-duration")?.textContent).toBe("30m");
      expect(el("date-time-rail-recent-1")?.getAttribute("aria-label")).toBe(
        "Oct 6 · 23:30–23:59 (Oct 6, 23:30:00 – 23:59:59 UTC+05:30)",
      );
      expect(el("date-time-rail-recent-1")?.textContent).toContain("Oct 6");

      el("date-time-rail-recent-1")!.click();
      await flushPromises();
      expect(wrapper!.vm.menuOpen).toBe(true);
      el("date-time-apply-btn")!.click();
      await flushPromises();

      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: hourRange(30).startUs,
        endTime: hourRange(30).endUs,
      });
      expect(wrapper!.vm.menuOpen).toBe(false);
      expect(storedHistory()).toEqual([{ ...hourRange(30), zone: IST }, hourRange(1)]);

      await openMenu();
      expect(pressed(el("date-time-rail-recent-0"))).toBe(true);
      expect(pressed(el("date-time-relative-15-m-btn"))).toBe(false);
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
        `Remove ${row.getAttribute("aria-label")} from recent ranges`,
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
      expect(document.activeElement?.getAttribute("data-test")).toBe("date-time-relative-5-m-btn");
    });

    it.each([
      ["without calendar presets", { calendarPresets: false }],
      ["when every calendar item is over the limit", { queryRangeRestrictionInHour: 0.001 }],
    ])("keeps focus inside the helpers after removing the last row %s", async (_label, props) => {
      vi.useRealTimers();
      seedHistory([hourRange(1)]);
      createWrapper(props);
      await openMenu();

      const row = el("date-time-rail-recent-0")!;
      row.focus();
      row.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
      await flushPromises();

      expect(storedHistory()).toEqual([]);
      expect(document.activeElement?.closest('[data-test="date-time-helpers"]')).not.toBeNull();
    });

    it("opens on the field and keeps Recent a single Tab stop", async () => {
      vi.useRealTimers();
      seedHistory([1, 2, 3, 4, 5].map(hourRange));
      createWrapper();
      await openMenu();
      wrapper!.vm.onPopoverOpenAutoFocus(new Event("focus", { cancelable: true }));
      await flushPromises();

      expect(document.activeElement?.closest('[data-test="date-time-range-input"]')).not.toBeNull();
      const tabbable = () =>
        Array.from(document.querySelectorAll('[data-roving="recent"]'))
          .filter((node) => node.getAttribute("tabindex") === "0")
          .map((node) => node.getAttribute("data-test"));
      expect(tabbable()).toEqual(["date-time-rail-recent-toggle"]);
      expect(el("date-time-rail-recent-0-remove")?.getAttribute("tabindex")).toBe("-1");

      el("date-time-rail-recent-toggle")!.focus();
      const press = (key: string) =>
        document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      for (let i = 0; i < 3; i++) press("ArrowDown");
      await flushPromises();
      expect(document.activeElement?.getAttribute("data-test")).toBe("date-time-rail-recent-2");
      expect(tabbable()).toEqual(["date-time-rail-recent-2"]);
    });
    it("moves from the field to the first chip with ↓", async () => {
      vi.useRealTimers();
      createWrapper();
      await openMenu();
      const input = document.querySelector<HTMLInputElement>(
        '[data-test="date-time-range-input"] input',
      )!;
      input.focus();
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      await flushPromises();

      expect(document.activeElement?.getAttribute("data-test")).toBe("date-time-relative-15-m-btn");
    });
    it("recalls a range ending at midnight as that day's last second and still queries the exact end", async () => {
      const day = {
        startUs: micros("2026-10-05T18:30:00Z"),
        endUs: micros("2026-10-06T18:30:00Z"),
      };
      seedHistory([day]);
      createWrapper({ autoApply: true });
      await flushPromises();
      await openMenu();

      el("date-time-rail-recent-0")!.click();
      await flushPromises();

      expect(wrapper!.vm.selectedDate).toEqual({ from: "2026/10/06", to: "2026/10/06" });
      expect(wrapper!.vm.selectedTime).toEqual({ startTime: "00:00:00", endTime: "23:59:59" });
      expect(lastEmit()).toMatchObject({ startTime: day.startUs, endTime: day.endUs });
      expect(storedHistory()).toEqual([{ ...day, zone: IST }]);
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
      seedHistory([1, 2, 3, 4, 5, 6, 7, 8].map(hourRange));
      createWrapper();
      await openMenu();

      const toggle = el("date-time-rail-recent-toggle")!;
      expect(toggle.tagName).toBe("BUTTON");
      expect(toggle.textContent?.trim()).toBe("Show more");
      expect(el("date-time-rail-recent-2")).not.toBeNull();
      expect(el("date-time-rail-recent-3")).toBeNull();

      toggle.click();
      await flushPromises();
      expect(el("date-time-rail-recent-7")).not.toBeNull();
      expect(el("date-time-rail-recent-toggle")?.textContent?.trim()).toBe("Show less");

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
      seedHistory([1, 2, 3, 4, 5, 6, 7, 8].map(hourRange));
      createWrapper();
      await openMenu();
      el("date-time-rail-recent-toggle")!.click();
      await flushPromises();
      expect(el("date-time-rail-recent-6")).not.toBeNull();

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
