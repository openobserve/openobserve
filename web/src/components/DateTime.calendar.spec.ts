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

describe("DateTime calendar", () => {
  let wrapper: VueWrapper<InstanceType<typeof DateTime>> | null = null;

  const createWrapper = (props: Record<string, unknown> = {}) => {
    wrapper = mount(DateTime, {
      props: { calendarPresets: true, ...props },
      attachTo: document.body,
      global: { plugins: [i18n, store] },
    });
    return wrapper;
  };

  // The calendar sits behind Pick dates, so these tests open the panel straight into it.
  const openMenu = async () => {
    wrapper!.vm.onMenuOpenChange(true);
    wrapper!.vm.menuOpen = true;
    wrapper!.vm.openCalendar();
    await flushPromises();
  };

  // jsdom matches attribute values case-insensitively, which would confuse 1-m (minutes) with 1-M (months).
  const el = (dataTest: string) =>
    Array.from(document.querySelectorAll<HTMLButtonElement>("[data-test]")).find(
      (node) => node.getAttribute("data-test") === dataTest,
    ) ?? null;

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

  describe("calendar token behaviour", () => {
    it("returns to the applied period when the panel closes without Apply", async () => {
      createWrapper({ autoApply: false, defaultRelativeTime: "calendar:month:0" });
      await flushPromises();
      await openMenu();

      wrapper!.vm.setRelativeDate("h", 1);
      await flushPromises();
      wrapper!.vm.onMenuOpenChange(false);
      wrapper!.vm.menuOpen = false;
      await flushPromises();

      expect(wrapper!.vm.calendarToken).toBe("calendar:month:0");
      expect(wrapper!.vm.triggerLabel).toBe("This month");
      expect(el("date-time-next-btn")?.disabled).toBe(true);
    });

    it("drops the calendar token when a rolling period or chip is chosen", async () => {
      createWrapper({ autoApply: true, defaultRelativeTime: "calendar:day:0" });
      await flushPromises();

      wrapper!.vm.setRelativeDate("h", 3);
      expect(wrapper!.vm.calendarToken).toBeNull();
      expect(lastEmit().relativeTimePeriod).toBe("3h");

      wrapper!.vm.setRelativeTime("calendar:day:0");
      wrapper!.vm.pickChip("24h");
      expect(wrapper!.vm.calendarToken).toBeNull();
      expect(lastEmit().relativeTimePeriod).toBe("24h");
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
      expect(wrapper!.vm.triggerLabel).toBe("Last 3 days");
    });

    it("runs the minute clock only while a calendar range can be on screen", async () => {
      const minuteTimers = () =>
        setTimeoutSpy.mock.calls.filter(([fn]) => (fn as () => void).name === "tickClock").length;
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
      const clearIntervalSpy = vi.spyOn(globalThis, "clearTimeout");

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
      setTimeoutSpy.mockRestore();
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
      expect(wrapper!.vm.triggerLabel).toBe("Previous month");

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
      expect(storedHistory()).toEqual([{ relative: "calendar:month:-2" }]);
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
      expect(wrapper!.vm.triggerTooltip?.stamps).toMatch(/Oct 4, 2026.*00:00.*Oct 8, 2026.*08:30/);

      vi.setSystemTime(new Date("2026-10-08T04:00:00Z"));
      await wrapper!.find('[data-test="date-time-btn"]').trigger("mouseenter");
      expect(wrapper!.vm.triggerTooltip?.stamps).toMatch(/Oct 8, 2026.*09:30/);
      expect(wrapper!.vm.triggerTooltip?.detail).toBe("UTC+05:30 · live · 4d 9h");
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

      calendar().vm.$emit("update:pendingDate", "2026/10/03");
      wrapper!.vm.selectedTime.startTime = "09:15:00";
      wrapper!.vm.selectedTime.endTime = "10:30:00";
      await flushPromises();
      expect(wrapper!.vm.triggerLabel).toBe("Last 15 minutes");
      el("date-time-apply-btn")!.click();
      await flushPromises();

      expect(wrapper!.vm.triggerLabel).toBe("Oct 3, 09:15 – 10:30");
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
      calendar().vm.$emit("update:pendingDate", "2026/10/03");
      await flushPromises();

      wrapper!.vm.onMenuOpenChange(false);
      wrapper!.vm.menuOpen = false;
      await flushPromises();

      expect(wrapper!.vm.pendingDay).toBeNull();
      expect(wrapper!.vm.triggerLabel).toBe(applied);
    });

    it("applies nothing on an auto-apply picker that closes on a pending day without Apply (V1)", async () => {
      createWrapper({ autoApply: true });
      await flushPromises();
      await openMenu();
      const emitsBefore = (wrapper!.emitted("on:date-change") ?? []).length;

      calendar().vm.$emit("update:pendingDate", "2026/10/03");
      wrapper!.vm.selectedTime.startTime = "09:15:00";
      wrapper!.vm.selectedTime.endTime = "10:30:00";
      await flushPromises();
      expect((wrapper!.emitted("on:date-change") ?? []).length).toBe(emitsBefore);

      wrapper!.vm.onMenuOpenChange(false);
      wrapper!.vm.menuOpen = false;
      await flushPromises();
      expect((wrapper!.emitted("on:date-change") ?? []).length).toBe(emitsBefore);
      expect(wrapper!.vm.selectedType).toBe("relative");
      expect(wrapper!.vm.triggerLabel).toBe("Last 15 minutes");
    });

    it("applies a range completed by the second click only on Apply (V1)", async () => {
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
      expect(wrapper!.vm.triggerLabel).toBe("Last 15 minutes");

      wrapper!.vm.applyAndClose();
      await flushPromises();
      expect(lastEmit()).toMatchObject({ valueType: "absolute" });
      expect(wrapper!.vm.selectedDate).toEqual({ from: "2026/10/03", to: "2026/10/05" });
    });

    it("shows Start/End as HH:MM and previews a time while it is typed, before the field commits it", async () => {
      createWrapper({
        autoApply: true,
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2026-10-07T03:30:00Z"),
          endTime: micros("2026-10-07T06:30:00Z"),
        },
      });
      await flushPromises();
      await openMenu();
      const startField = el("datetime-start-time")!.querySelector("input")!;
      expect(startField.value).toBe("09:00");
      const emits = (wrapper!.emitted("on:date-change") ?? []).length;
      // Vue drops an event stamped no later than its listener was attached, and Date is frozen here.
      const typeInto = async (text: string) => {
        vi.setSystemTime(Date.now() + 1000);
        startField.value = text;
        startField.dispatchEvent(new Event("input", { bubbles: true }));
        await flushPromises();
      };

      await typeInto("10:15");

      expect(el("date-time-resolved-name")?.textContent).toBe("Oct 7, 10:15 – 12:00");
      expect((wrapper!.emitted("on:date-change") ?? []).length).toBe(emits);

      await typeInto("1030");
      expect(el("date-time-resolved-name")?.textContent).toBe("Oct 7, 10:30 – 12:00");

      await typeInto("10:15:30.250");
      expect(el("date-time-preview-note")?.textContent).toBe(
        "Seconds only here; type ms in the bar",
      );

      vi.setSystemTime(Date.now() + 1000);
      startField.dispatchEvent(new FocusEvent("blur"));
      await flushPromises();
      expect(wrapper!.vm.typedFieldTime).toBeNull();
      expect(el("date-time-resolved-name")?.textContent).toBe("Oct 7, 09:00 – 12:00");
    });

    it("previews a clicked day with the same next-midnight end it applies", async () => {
      createWrapper({ autoApply: true });
      await flushPromises();
      await openMenu();

      el("daterangecalendar-cell-2026-10-03")!.click();
      await flushPromises();
      expect(wrapper!.vm.pendingDay).toBe("2026/10/03");
      expect(el("date-time-resolved-duration")?.textContent?.trim()).toBe("1d");
      expect(wrapper!.vm.stepTooltip.prev.title).toBe("Previous 1d");

      wrapper!.vm.applyAndClose();
      await flushPromises();
      expect(lastEmit()).toMatchObject({
        startTime: micros("2026-10-02T18:30:00Z"),
        endTime: micros("2026-10-03T18:30:00Z"),
      });
    });

    it("drops a half-picked day on Escape and stays in the calendar, then returns to the list", async () => {
      createWrapper({ autoApply: true });
      await flushPromises();
      await openMenu();
      wrapper!.vm.openCalendar();
      await flushPromises();
      const emitsBefore = (wrapper!.emitted("on:date-change") ?? []).length;

      const cell = el("daterangecalendar-cell-2026-10-03")!;
      cell.click();
      await flushPromises();
      expect(wrapper!.vm.pendingDay).toBe("2026/10/03");
      cell.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await flushPromises();

      expect(wrapper!.vm.pendingDay).toBeNull();
      expect(wrapper!.vm.menuOpen).toBe(true);
      expect(wrapper!.vm.calendarMode).toBe(true);
      expect((wrapper!.emitted("on:date-change") ?? []).length).toBe(emitsBefore);

      cell.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await flushPromises();
      expect(wrapper!.vm.calendarMode).toBe(false);
      expect(wrapper!.vm.menuOpen).toBe(true);
    });

    it("turns a single day clicked from a relative range into that whole day", async () => {
      createWrapper({ autoApply: true });
      await flushPromises();
      await openMenu();

      calendar().vm.$emit("update:pendingDate", "2026/10/03");
      await flushPromises();
      wrapper!.vm.applyAndClose();
      await flushPromises();

      expect(wrapper!.vm.triggerLabel).toBe("Oct 3");
      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-10-02T18:30:00Z"),
        endTime: micros("2026-10-03T18:30:00Z"),
      });
    });

    it("spans whole days for a two-click range picked from a relative range", async () => {
      createWrapper({ autoApply: true });
      await flushPromises();
      await openMenu();

      calendar().vm.$emit("update:pendingDate", "2026/10/03");
      await flushPromises();
      calendar().vm.$emit("update:startDate", "2026/10/03");
      calendar().vm.$emit("update:endDate", "2026/10/05");
      calendar().vm.$emit("update:pendingDate", null);
      await flushPromises();
      wrapper!.vm.applyAndClose();
      await flushPromises();

      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-10-02T18:30:00Z"),
        endTime: micros("2026-10-05T18:30:00Z"),
      });
    });

    it("starts a clicked day at 00:00 even when the absolute range had other times (V2)", async () => {
      createWrapper({
        autoApply: true,
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2026-10-06T03:45:00Z"),
          endTime: micros("2026-10-06T05:00:00Z"),
        },
      });
      await flushPromises();
      await openMenu();

      calendar().vm.$emit("update:pendingDate", "2026/10/03");
      await flushPromises();
      expect(wrapper!.vm.selectedTime).toEqual({ startTime: "00:00:00", endTime: "23:59:59" });
      wrapper!.vm.applyAndClose();
      await flushPromises();

      expect(lastEmit()).toMatchObject({
        startTime: micros("2026-10-02T18:30:00Z"),
        endTime: micros("2026-10-03T18:30:00Z"),
      });
    });

    it("shows a picked day's end as 23:59 in the End field, like the label, and applies the whole day", async () => {
      createWrapper({ autoApply: false });
      await flushPromises();
      await openMenu();

      calendar().vm.$emit("update:pendingDate", "2026/10/03");
      await flushPromises();
      const end = document.querySelector<HTMLInputElement>(
        '[data-test="datetime-end-time"] input',
      )!;
      expect(end.value).toBe("23:59");
      wrapper!.vm.applyAndClose();
      await flushPromises();
      expect(lastEmit()).toMatchObject({ endTime: micros("2026-10-03T18:30:00Z") });
    });

    const closeMenu = async () => {
      wrapper!.vm.onMenuOpenChange(false);
      wrapper!.vm.menuOpen = false;
      await flushPromises();
    };

    const apply = async () => {
      wrapper!.vm.applyAndClose();
      await flushPromises();
    };

    it("takes a click on today from a relative range as today so far", async () => {
      createWrapper({ autoApply: true });
      await flushPromises();
      await openMenu();

      el("daterangecalendar-cell-2026-10-08")!.click();
      await flushPromises();
      expect(wrapper!.vm.pendingDay).toBe("2026/10/08");
      await apply();

      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-10-07T18:30:00Z"),
        endTime: micros("2026-10-08T03:00:00Z"),
      });
    });

    it("starts a range from a click on the applied single day", async () => {
      createWrapper({
        autoApply: true,
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2026-10-03T18:30:00Z"),
          endTime: micros("2026-10-04T18:30:00Z"),
        },
      });
      await flushPromises();
      await openMenu();

      el("daterangecalendar-cell-2026-10-04")!.click();
      await flushPromises();
      expect(wrapper!.vm.pendingDay).toBe("2026/10/04");
      // Reka completes a range only for the hovered day, as in a browser.
      const second = el("daterangecalendar-cell-2026-10-06")!;
      second.dispatchEvent(new MouseEvent("mouseenter"));
      await flushPromises();
      second.click();
      await flushPromises();
      await apply();

      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-10-03T18:30:00Z"),
        endTime: micros("2026-10-06T18:30:00Z"),
      });
    });

    it("stages the whole clicked day when the kept times would run backwards on it", async () => {
      createWrapper({
        autoApply: true,
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2026-10-06T14:30:00Z"),
          endTime: micros("2026-10-06T20:30:00Z"),
        },
      });
      await flushPromises();
      await openMenu();

      calendar().vm.$emit("update:pendingDate", "2026/10/03");
      await flushPromises();

      expect(wrapper!.vm.selectedTime).toMatchObject({
        startTime: "00:00:00",
        endTime: "23:59:59",
      });
      expect(el("date-time-resolved")?.textContent).not.toContain("0s");
      await apply();
      expect(wrapper!.vm.triggerLabel).toBe("Oct 3");
      expect(lastEmit()).toMatchObject({
        startTime: micros("2026-10-02T18:30:00Z"),
        endTime: micros("2026-10-03T18:30:00Z"),
      });
    });

    it("restores the kept times when a staged whole day closes without Apply", async () => {
      createWrapper({
        autoApply: false,
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2026-10-06T14:30:00Z"),
          endTime: micros("2026-10-06T20:30:00Z"),
        },
      });
      await flushPromises();
      await openMenu();

      calendar().vm.$emit("update:pendingDate", "2026/10/03");
      await flushPromises();
      await closeMenu();

      expect(wrapper!.vm.selectedTime).toMatchObject({
        startTime: "20:00:00",
        endTime: "02:00:00",
      });
    });
  });

  describe("Start and End fields", () => {
    const timeField = (dataTest: string) =>
      document.querySelector<HTMLInputElement>(`[data-test="${dataTest}"] input`)!;
    const commit = async (dataTest: string, value: string) => {
      const input = timeField(dataTest);
      input.value = value;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await flushPromises();
    };
    const absoluteProps = (autoApply: boolean) => ({
      autoApply,
      defaultType: "absolute",
      defaultAbsoluteTime: {
        startTime: micros("2026-10-06T07:00:00Z"),
        endTime: micros("2026-10-06T09:00:00Z"),
      },
    });

    it("refuses an End before Start, says so and reverts the field", async () => {
      createWrapper(absoluteProps(true));
      await flushPromises();
      await openMenu();
      const emitsBefore = (wrapper!.emitted("on:date-change") ?? []).length;

      await commit("datetime-end-time", "10:00:00");

      expect((wrapper!.emitted("on:date-change") ?? []).length).toBe(emitsBefore);
      expect(wrapper!.vm.selectedTime).toMatchObject({
        startTime: "12:30:00",
        endTime: "14:30:00",
      });
      expect(timeField("datetime-end-time").value).toBe("14:30");
      expect(
        document
          .querySelector('[data-test="datetime-end-time"][role="group"]')
          ?.getAttribute("aria-invalid"),
      ).toBe("true");
      expect(document.body.textContent).toContain("End must be after start.");

      await commit("datetime-end-time", "15:00:00");
      expect(document.body.textContent).not.toContain("End must be after start.");
      expect((wrapper!.emitted("on:date-change") ?? []).length).toBe(emitsBefore);
      wrapper!.vm.applyAndClose();
      await flushPromises();
      expect(lastEmit()).toMatchObject({ endTime: micros("2026-10-06T09:30:00Z") });
    });

    it("moves End with a Start typed past it, keeping the duration", async () => {
      createWrapper(absoluteProps(true));
      await flushPromises();
      await openMenu();

      await commit("datetime-start-time", "15:00:00");

      expect(wrapper!.vm.selectedTime).toMatchObject({
        startTime: "15:00:00",
        endTime: "17:00:00",
      });
      wrapper!.vm.applyAndClose();
      await flushPromises();
      expect(lastEmit()).toMatchObject({
        startTime: micros("2026-10-06T09:30:00Z"),
        endTime: micros("2026-10-06T11:30:00Z"),
      });
      expect(document.body.textContent).not.toContain("End must be after start.");
    });

    it("stops a moved End at now", async () => {
      createWrapper({
        autoApply: true,
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2026-10-08T00:30:00Z"),
          endTime: micros("2026-10-08T01:30:00Z"),
        },
      });
      await flushPromises();
      await openMenu();

      await commit("datetime-start-time", "08:00:00");
      wrapper!.vm.applyAndClose();
      await flushPromises();

      expect(lastEmit()).toMatchObject({
        startTime: micros("2026-10-08T02:30:00Z"),
        endTime: micros("2026-10-08T03:00:00Z"),
      });
    });

    it("refuses a Start in the future and says so", async () => {
      createWrapper({
        autoApply: true,
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2026-10-08T00:30:00Z"),
          endTime: micros("2026-10-08T01:30:00Z"),
        },
      });
      await flushPromises();
      await openMenu();
      const emitsBefore = (wrapper!.emitted("on:date-change") ?? []).length;

      await commit("datetime-start-time", "08:45:00");

      expect((wrapper!.emitted("on:date-change") ?? []).length).toBe(emitsBefore);
      expect(wrapper!.vm.selectedTime.startTime).toBe("06:00:00");
      expect(timeField("datetime-start-time").value).toBe("06:00");
      expect(document.body.textContent).toContain("That is in the future. Latest is now.");
      expect(document.body.textContent).not.toContain("End must be after start.");
    });

    it("keeps a later Start typed on a clicked day inside that whole day (V2)", async () => {
      createWrapper(absoluteProps(true));
      await flushPromises();
      await openMenu();
      wrapper!
        .findComponent({ name: "ODateRangeCalendar" })
        .vm.$emit("update:pendingDate", "2026/10/03");
      await flushPromises();

      await commit("datetime-start-time", "23:00:00");

      expect(wrapper!.vm.pendingDay).toBe("2026/10/03");
      wrapper!.vm.applyAndClose();
      await flushPromises();
      expect(wrapper!.vm.selectedDate).toEqual({ from: "2026/10/03", to: "2026/10/03" });
      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-10-03T17:30:00Z"),
        endTime: micros("2026-10-03T18:30:00Z"),
      });
    });

    it("never applies a reversed range in Apply mode", async () => {
      createWrapper(absoluteProps(false));
      await flushPromises();
      await openMenu();

      await commit("datetime-end-time", "10:00:00");
      el("date-time-apply-btn")!.click();
      await flushPromises();

      const payload = lastEmit() as { startTime: number; endTime: number };
      expect(payload.endTime).toBeGreaterThan(payload.startTime);
      expect(payload).toMatchObject({
        startTime: micros("2026-10-06T07:00:00Z"),
        endTime: micros("2026-10-06T09:00:00Z"),
      });
    });

    it("blocks Apply and Enter on unreadable Start text and says how to type a time", async () => {
      createWrapper(absoluteProps(false));
      await flushPromises();
      await openMenu();
      const emits = (wrapper!.emitted("on:date-change") ?? []).length;

      await commit("datetime-start-time", "noon-ish");

      expect(el("date-time-apply-btn")!.disabled).toBe(true);
      expect(document.body.textContent).toContain("Enter a time as HH:MM.");
      expect(el("date-time-input-examples")?.textContent).toBe("for example 09:30 or 09:30:15");
      expect(
        document.querySelectorAll('[data-test="datetime-start-time"] [role="alert"]'),
      ).toHaveLength(0);
      timeField("datetime-start-time").dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
      await flushPromises();
      expect(wrapper!.vm.menuOpen).toBe(true);
      expect((wrapper!.emitted("on:date-change") ?? []).length).toBe(emits);

      await commit("datetime-start-time", "08:00");
      expect(el("date-time-apply-btn")!.disabled).toBe(false);
      expect(document.body.textContent).not.toContain("Enter a time as HH:MM.");
    });

    it("keeps the fields on the resolved range when the clock moves on", async () => {
      createWrapper({ autoApply: true });
      await flushPromises();
      await openMenu();
      expect(wrapper!.vm.selectedTime).toMatchObject({
        startTime: "08:15:00",
        endTime: "08:30:00",
      });

      vi.setSystemTime(new Date("2026-10-08T03:01:30Z"));
      wrapper!.vm.refreshTooltipNow();
      await flushPromises();

      expect(wrapper!.vm.selectedTime).toMatchObject({
        startTime: "08:16:30",
        endTime: "08:31:30",
      });
      expect(el("date-time-resolved")?.textContent).toContain("08:16 – 08:31");
    });
  });

  describe("one selection", () => {
    it("shows the applied calendar range in the Absolute column on open and applies nothing", async () => {
      createWrapper({ autoApply: true, defaultRelativeTime: "calendar:day:0" });
      await flushPromises();
      const emitsBefore = (wrapper!.emitted("on:date-change") ?? []).length;
      await openMenu();

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

    it("keeps typed times while the clock ticks", async () => {
      createWrapper({ autoApply: true, defaultRelativeTime: "calendar:day:0" });
      await flushPromises();
      await openMenu();

      wrapper!.vm.onStartTimeEdit("06:00:00");
      wrapper!.vm.onEndTimeEdit("07:00:00");
      await flushPromises();
      vi.setSystemTime(new Date("2026-10-08T03:05:00Z"));
      wrapper!.vm.refreshTooltipNow();
      await flushPromises();

      expect(wrapper!.vm.selectedTime).toEqual({ startTime: "06:00:00", endTime: "07:00:00" });
    });

    it("keeps the exact period end when the zone changes while the seeded fields are shown", async () => {
      createWrapper({ autoApply: false, defaultRelativeTime: "calendar:month:-1" });
      await flushPromises();
      await openMenu();

      store.state.timezone = "UTC";
      expect(wrapper!.vm.getConsumableDateTime()).toMatchObject({
        startTime: micros("2026-09-01T00:00:00Z"),
        endTime: micros("2026-10-01T00:00:00Z"),
      });
    });

    it("applies the edited seeded range on Apply, not while it is edited (V1)", async () => {
      createWrapper({ autoApply: true, defaultRelativeTime: "calendar:month:-1" });
      await flushPromises();
      await openMenu();
      expect(wrapper!.vm.selectedDate).toEqual({ from: "2026/09/01", to: "2026/09/30" });
      expect(wrapper!.vm.selectedTime).toEqual({ startTime: "00:00:00", endTime: "23:59:59" });

      const emitsBefore = (wrapper!.emitted("on:date-change") ?? []).length;
      wrapper!.vm.onStartTimeEdit("06:00:00");
      wrapper!.vm.onEndTimeEdit("23:00:00");
      await flushPromises();
      expect((wrapper!.emitted("on:date-change") ?? []).length).toBe(emitsBefore);

      wrapper!.vm.applyAndClose();
      await flushPromises();
      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-09-01T00:30:00Z"),
        endTime: micros("2026-09-30T17:30:00Z"),
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

    it.each([
      ["prev", "2026-10-02T18:30:00Z", "2026-10-03T18:30:00Z"],
      ["next", "2026-10-04T18:30:00Z", "2026-10-05T18:30:00Z"],
    ])("steps a whole day by a whole day with %s", async (direction, start, end) => {
      createWrapper({
        autoApply: true,
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2026-10-03T18:30:00Z"),
          endTime: micros("2026-10-04T18:30:00Z"),
        },
      });
      await flushPromises();

      el(`date-time-${direction}-btn`)!.click();
      await flushPromises();

      expect(lastEmit()).toMatchObject({ startTime: micros(start), endTime: micros(end) });
      expect(wrapper!.vm.selectedTime).toMatchObject({
        startTime: "00:00:00",
        endTime: "23:59:59",
      });
    });

    it("steps a two-day range back by two whole days", async () => {
      createWrapper({
        autoApply: true,
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2026-10-02T18:30:00Z"),
          endTime: micros("2026-10-04T18:30:00Z"),
        },
      });
      await flushPromises();

      el("date-time-prev-btn")!.click();
      await flushPromises();

      expect(lastEmit()).toMatchObject({
        startTime: micros("2026-09-30T18:30:00Z"),
        endTime: micros("2026-10-02T18:30:00Z"),
      });
    });
  });

  describe("bounds and whole days", () => {
    const calendar = () => wrapper!.findComponent({ name: "ODateRangeCalendar" });

    it("shifts a short window that starts at midnight today by its own length, not a whole day", async () => {
      createWrapper({
        autoApply: true,
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2026-10-07T18:30:00Z"),
          endTime: micros("2026-10-07T19:00:00Z"),
        },
      });
      await flushPromises();

      el("date-time-prev-btn")!.click();
      await flushPromises();

      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-10-07T18:00:00Z"),
        endTime: micros("2026-10-07T18:30:00Z"),
      });
    });

    it("refuses a whole-day step longer than the page's query-range limit", async () => {
      createWrapper({
        autoApply: true,
        queryRangeRestrictionInHour: 24,
        queryRangeRestrictionMsg: "Max 24 hours",
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2026-10-04T18:30:00Z"),
          endTime: micros("2026-10-06T18:30:00Z"),
        },
      });
      await flushPromises();
      const before = (wrapper!.emitted("on:date-change") ?? []).length;

      el("date-time-prev-btn")!.click();
      await flushPromises();

      expect((wrapper!.emitted("on:date-change") ?? []).length).toBe(before);
      expect(wrapper!.vm.selectedDate).toMatchObject({ from: "2026/10/05", to: "2026/10/06" });
    });

    it("leaves out Recent entries the picker could not show and keeps valid legacy ones", async () => {
      seedHistory([
        { startUs: micros("1970-01-01T00:00:00Z"), endUs: micros("1970-01-02T00:00:00Z") },
        { startUs: micros("3000-01-01T00:00:00Z"), endUs: micros("3000-01-02T00:00:00Z") },
        { startUs: micros("2026-10-05T00:00:00Z"), endUs: micros("2026-10-04T00:00:00Z") },
        hourRange(1),
      ]);
      const stored = JSON.parse(localStorage.getItem(HISTORY_KEY)!);
      stored.splice(3, 0, { relative: "999999M" }, { relative: "121M" }, { relative: "2h" });
      localStorage.setItem(HISTORY_KEY, JSON.stringify(stored));
      createWrapper();
      wrapper!.vm.onMenuOpenChange(true);
      wrapper!.vm.menuOpen = true;
      await flushPromises();

      const shown = Array.from(
        document.querySelectorAll("[role='option'][data-test^='date-time-list-recent-']"),
      ).map((node) => node.getAttribute("data-test"));
      expect(shown).toEqual(["date-time-list-recent-4", "date-time-list-recent-5"]);
      expect(el("date-time-list-recent-4")?.textContent).toContain("Last 2 hours");
    });

    it("steps Next from yesterday to today so far, and Prev back to yesterday", async () => {
      createWrapper({
        autoApply: true,
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2026-10-06T18:30:00Z"),
          endTime: micros("2026-10-07T18:30:00Z"),
        },
      });
      await flushPromises();
      expect(el("date-time-next-btn")?.disabled).toBe(false);

      el("date-time-next-btn")!.click();
      await flushPromises();
      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-10-07T18:30:00Z"),
        endTime: micros("2026-10-08T03:00:00Z"),
      });
      expect(wrapper!.vm.selectedTime).toEqual({ startTime: "00:00:00", endTime: "08:30:00" });
      expect(el("date-time-next-btn")?.disabled).toBe(true);

      el("date-time-prev-btn")!.click();
      await flushPromises();
      expect(lastEmit()).toMatchObject({
        startTime: micros("2026-10-06T18:30:00Z"),
        endTime: micros("2026-10-07T18:30:00Z"),
      });
    });

    it("ends a click on today at now, as the Today row does", async () => {
      createWrapper({ autoApply: false });
      await flushPromises();
      await openMenu();

      calendar().vm.$emit("update:pendingDate", "2026/10/08");
      await flushPromises();
      expect(wrapper!.vm.selectedTime).toEqual({ startTime: "00:00:00", endTime: "08:30:00" });
      calendar().vm.$emit("update:pendingDate", "2026/10/03");
      await flushPromises();
      expect(wrapper!.vm.selectedTime).toEqual({ startTime: "00:00:00", endTime: "23:59:59" });
      calendar().vm.$emit("update:pendingDate", "2026/10/08");
      await flushPromises();
      el("date-time-apply-btn")!.click();
      await flushPromises();

      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-10-07T18:30:00Z"),
        endTime: micros("2026-10-08T03:00:00Z"),
      });
    });

    it("ends a two-click range that reaches today at now", async () => {
      createWrapper({ autoApply: true });
      await flushPromises();
      await openMenu();

      calendar().vm.$emit("update:pendingDate", "2026/10/06");
      await flushPromises();
      calendar().vm.$emit("update:startDate", "2026/10/06");
      calendar().vm.$emit("update:endDate", "2026/10/08");
      calendar().vm.$emit("update:pendingDate", null);
      await flushPromises();
      wrapper!.vm.applyAndClose();
      await flushPromises();

      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-10-05T18:30:00Z"),
        endTime: micros("2026-10-08T03:00:00Z"),
      });
    });
  });
});
