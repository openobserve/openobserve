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

import { defineComponent, h, KeepAlive, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import DateTime from "@/components/DateTime.vue";
import { timeRangeHistoryKey } from "@/composables/useTimeRangeHistory";
import i18n from "@/locales";
import { MAX_RANGE_TEXT_UNITS } from "@/utils/date";
import store from "@/test/unit/helpers/store";
import {
  barInput,
  barState,
  changes,
  el,
  lastChange,
  mountPicker,
  openMenu,
  press,
  typeInBar,
  warmRangeInput,
  type Picker,
} from "@/test/unit/helpers/dateTimePicker";

const NOW = new Date("2026-10-08T03:00:00Z");
const micros = (iso: string) => Date.parse(iso) * 1000;
const timeOf = (ms: number) => new Date(ms).toISOString().slice(11, 19);
const HISTORY_KEY = timeRangeHistoryKey("default", "example@gmail.com");
const SPAN_MESSAGE = "Longer than this stream's query limit of 3 days.";

describe("DateTime validity gate", () => {
  let wrapper: Picker | null = null;

  const create = (props: Record<string, unknown> = {}) => {
    wrapper = mountPicker({ queryRangeRestrictionInHour: 72, ...props });
    return wrapper;
  };

  const customField = () => el<HTMLInputElement>("date-time-custom-value-field")!;

  const typeCustom = async (value: string) => {
    customField().value = value;
    customField().dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
  };

  const setAbsolute = async (start: string, end: string) => {
    const [fromDate, fromTime] = start.split(" ");
    const [toDate, toTime] = end.split(" ");
    wrapper!.vm.selectTab("absolute");
    wrapper!.vm.selectedDate = { from: fromDate, to: toDate };
    wrapper!.vm.selectedTime = { startTime: fromTime, endTime: toTime };
    await flushPromises();
  };

  beforeAll(warmRangeInput);

  beforeEach(() => {
    // A frozen clock makes Vue drop every listener after the first for one event, so it creeps instead.
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    store.state.timezone = "UTC";
    store.state.savedViewFlag = false;
    localStorage.clear();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("refuses a custom value over the limit with the reason, a red field and the applied label", async () => {
    create({ autoApply: true, defaultRelativeTime: "2h" });
    await openMenu(wrapper!);
    const before = changes(wrapper!).length;
    await typeCustom("200");
    await press(customField(), "Enter");

    expect(changes(wrapper!).length).toBe(before);
    expect(el("date-time-gate-message")!.textContent).toContain(SPAN_MESSAGE);
    expect(el("date-time-gate-message")!.getAttribute("role")).toBe("alert");
    expect(customField().value).toBe("200");
    expect(customField().getAttribute("aria-invalid")).toBe("true");
    expect(wrapper!.vm.menuOpen).toBe(true);
    expect(wrapper!.vm.triggerLabel).toBe("Past 2 Hours");
  });

  it("disables Apply for a range that ends before it starts", async () => {
    create({ autoApply: false, queryRangeRestrictionInHour: 0 });
    await openMenu(wrapper!);
    await setAbsolute("2026/10/08 02:00:00", "2026/10/08 01:00:00");

    expect(el<HTMLButtonElement>("date-time-apply-btn")!.disabled).toBe(true);
    expect(el("date-time-gate-message")!.textContent).toContain("Start must be before end.");
  });

  it("emits nothing for a reversed range on an auto host", async () => {
    create({ autoApply: true, queryRangeRestrictionInHour: 0 });
    await openMenu(wrapper!);
    const before = changes(wrapper!).length;
    await setAbsolute("2026/10/08 02:00:00", "2026/10/08 01:00:00");

    expect(changes(wrapper!).length).toBe(before);
  });

  it.each([
    ["exactly the limit", "2026/10/05 02:00:00", "valid", null],
    ["one second over it", "2026/10/05 01:59:59", "blocked", "max-span"],
  ])("treats %s the same in the panel and the bar", async (_, start, bar, gate) => {
    create({ autoApply: false });
    await openMenu(wrapper!);
    await setAbsolute(start, "2026/10/08 02:00:00");
    expect(wrapper!.vm.gateReason).toBe(gate);

    await typeInBar(`${start.replace(/\//g, "-")} - 2026-10-08 02:00:00`);
    expect(barState()).toBe(bar);
  });

  it("commits a custom value under the limit as typed, without a clamp", async () => {
    create({ autoApply: true });
    await openMenu(wrapper!);
    wrapper!.vm.relativePeriod = "m";
    await typeCustom("90");
    await press(customField(), "Enter");

    expect(lastChange(wrapper!).relativeTimePeriod).toBe("90m");
  });

  it("puts back the applied selection and records nothing when it closes while blocked", async () => {
    vi.spyOn(Storage.prototype, "setItem");
    create({ autoApply: true, defaultRelativeTime: "2h" });
    await openMenu(wrapper!);
    const applied = { ...wrapper!.vm.selectedDate };
    await setAbsolute("2026/10/01 00:00:00", "2026/10/08 00:00:00");
    expect(wrapper!.vm.gateReason).toBe("max-span");

    wrapper!.vm.menuOpen = false;
    wrapper!.vm.onMenuOpenChange(false);
    await flushPromises();

    expect(wrapper!.vm.selectedType).toBe("relative");
    expect(wrapper!.vm.relativeValue).toBe(2);
    expect(wrapper!.vm.selectedDate).toEqual(applied);
    expect(wrapper!.vm.gateReason).toBeNull();
    const writes = vi
      .mocked(Storage.prototype.setItem)
      .mock.calls.filter(([key]) => key === HISTORY_KEY);
    expect(writes).toHaveLength(0);
  });

  it("still emits a range over the limit set by the host", async () => {
    create({
      autoApply: true,
      defaultType: "absolute",
      defaultAbsoluteTime: {
        startTime: micros("2026-10-01T00:00:00Z"),
        endTime: micros("2026-10-08T00:00:00Z"),
      },
    });
    await flushPromises();
    expect(lastChange(wrapper!)).toMatchObject({ startTime: micros("2026-10-01T00:00:00Z") });

    wrapper!.vm.setAbsoluteTime(micros("2026-09-01T00:00:00Z"), micros("2026-10-01T00:00:00Z"));
    wrapper!.vm.refresh();
    await flushPromises();
    const september = changes(wrapper!).filter(
      (c) => c.startTime === micros("2026-09-01T00:00:00Z"),
    );
    expect(september.map((c) => c.userChangedValue)).toContain(false);
  });

  it("lets the echo of a host-set one-microsecond window through", async () => {
    create({ autoApply: true, queryRangeRestrictionInHour: 0 });
    await flushPromises();
    wrapper!.vm.selectTab("absolute");
    await flushPromises();
    const before = changes(wrapper!).length;
    const ts = micros("2026-10-07T10:00:00Z") + 777;

    wrapper!.vm.setAbsoluteTime(ts, ts + 1);
    await flushPromises();

    expect(wrapper!.vm.gateReason).toBe("order");
    expect(changes(wrapper!).length).toBe(before + 1);
  });

  it("refuses a user edit that puts a host-set range over the limit back", async () => {
    create({
      autoApply: true,
      defaultType: "absolute",
      defaultAbsoluteTime: {
        startTime: micros("2026-10-01T00:00:00Z"),
        endTime: micros("2026-10-08T00:00:00Z"),
      },
    });
    await flushPromises();
    await openMenu(wrapper!);
    const before = changes(wrapper!).length;

    wrapper!.vm.selectedTime = { ...wrapper!.vm.selectedTime, startTime: "01:00:00" };
    await flushPromises();
    wrapper!.vm.selectedTime = { ...wrapper!.vm.selectedTime, startTime: "00:00:00" };
    await flushPromises();

    expect(wrapper!.vm.gateReason).toBe("max-span");
    expect(changes(wrapper!).length).toBe(before);
  });

  it.each([
    ["90m", 1, "60m"],
    ["3d", 36, "1d"],
  ])(
    "moves %s under a limit tightened to %i h to %s, which passes the gate, once",
    async (applied, hours, clamped) => {
      create({ autoApply: true, queryRangeRestrictionInHour: 0, defaultRelativeTime: applied });
      await flushPromises();
      const before = changes(wrapper!).length;

      await wrapper!.setProps({ queryRangeRestrictionInHour: hours });
      await flushPromises();

      expect(changes(wrapper!).length).toBe(before + 1);
      expect(lastChange(wrapper!).relativeTimePeriod).toBe(clamped);
      expect(wrapper!.vm.gateReason).toBeNull();
    },
  );

  it("enables a chip by the span the gate measures, not a nominal month", async () => {
    create({ autoApply: true, queryRangeRestrictionInHour: 730 });
    await openMenu(wrapper!);

    expect(el<HTMLButtonElement>("date-time-relative-1-M-btn")!.disabled).toBe(false);
    expect(el<HTMLButtonElement>("date-time-relative-2-M-btn")!.disabled).toBe(true);
    el("date-time-relative-1-M-btn")!.click();
    await flushPromises();
    expect(lastChange(wrapper!).relativeTimePeriod).toBe("1M");
  });

  it("refuses a range that ends after now in the panel, the bar and paste without a future maxDate", async () => {
    create({ autoApply: false, queryRangeRestrictionInHour: 0 });
    await openMenu(wrapper!);
    await setAbsolute("2026/10/08 02:00:00", "2026/10/08 05:00:00");

    expect(wrapper!.vm.gateReason).toBe("future");
    expect(el<HTMLButtonElement>("date-time-apply-btn")!.disabled).toBe(true);
    expect(el("date-time-gate-message")!.textContent).toContain(
      "2026/10/08 05:00:00 is in the future.",
    );

    await typeInBar("2026-10-08 02:00:00 - 2026-10-08 05:00:00");
    expect(barState()).toBe("blocked");
    await press(barInput(), "ArrowDown");
    await press(barInput(), "Enter");
    const fixed = lastChange(wrapper!);
    expect(fixed.startTime).toBe(micros("2026-10-08T02:00:00Z"));
    expect(fixed.endTime).toBeGreaterThanOrEqual(micros("2026-10-08T03:00:00Z"));
    expect(fixed.endTime).toBeLessThanOrEqual(Date.now() * 1000);

    const before = changes(wrapper!).length;
    await openMenu(wrapper!);
    await wrapper!.vm.onPickerPaste(pasteEvent("2026-10-08T02:00:00Z - 2026-10-08T05:00:00Z"));
    await flushPromises();
    expect(barState()).toBe("blocked");
    expect(changes(wrapper!).length).toBe(before);
  });

  it("lets a range end after now when the host passes a future maxDate", async () => {
    create({ autoApply: false, queryRangeRestrictionInHour: 0, maxDate: "2026/10/10" });
    await openMenu(wrapper!);
    await setAbsolute("2026/10/08 02:00:00", "2026/10/09 05:00:00");
    expect(wrapper!.vm.gateReason).toBeNull();

    await typeInBar("2026-10-08 02:00:00 - 2026-10-09 05:00:00");
    expect(barState()).toBe("valid");
  });

  describe("date-only end", () => {
    const calendar = () => wrapper!.findComponent({ name: "ODateRangeCalendar" });

    const pickRange = async (from: string, to: string) => {
      calendar().vm.$emit("update:start-date", from);
      calendar().vm.$emit("update:end-date", to);
      await flushPromises();
    };

    const typeEnd = (time: string) =>
      wrapper!
        .findAllComponents({ name: "OTime" })
        .find((c) => c.attributes("data-test") === "datetime-end-time")!
        .vm.$emit("update:modelValue", time);

    const apply = async () => {
      el("date-time-apply-btn")!.click();
      await flushPromises();
      return lastChange(wrapper!);
    };

    it("ends a picked today at now instead of refusing it", async () => {
      create({ autoApply: false, queryRangeRestrictionInHour: 0 });
      await openMenu(wrapper!);
      wrapper!.vm.selectTab("absolute");
      await flushPromises();
      await pickRange("2026/10/01", "2026/10/08");
      expect(wrapper!.vm.gateReason).toBeNull();

      const applied = await apply();
      expect(applied.startTime).toBe(micros("2026-10-01T02:45:00Z"));
      expect(applied.endTime).toBeGreaterThanOrEqual(micros("2026-10-08T03:00:00Z"));
      expect(applied.endTime).toBeLessThanOrEqual(Date.now() * 1000);
    });

    it("ends a whole-day end on today at now and keeps the end field", async () => {
      create({ autoApply: false, queryRangeRestrictionInHour: 0 });
      await openMenu(wrapper!);
      wrapper!.vm.selectTab("absolute");
      await flushPromises();
      typeEnd("23:59:59");
      await pickRange("2026/10/01", "2026/10/08");
      expect(wrapper!.vm.gateReason).toBeNull();

      const applied = await apply();
      expect(wrapper!.vm.selectedTime.endTime).toBe("23:59:59");
      expect(applied.endTime).toBeGreaterThanOrEqual(micros("2026-10-08T03:00:00Z"));
      expect(applied.endTime).toBeLessThanOrEqual(Date.now() * 1000);
    });

    it("ends today at now after the host restored a whole-day range", async () => {
      create({ autoApply: false, queryRangeRestrictionInHour: 0, defaultType: "absolute" });
      await flushPromises();
      wrapper!.vm.setAbsoluteTime(micros("2026-10-01T00:00:00Z"), micros("2026-10-05T23:59:59Z"));
      await flushPromises();
      await openMenu(wrapper!);
      expect(wrapper!.vm.selectedType).toBe("absolute");

      await pickRange("2026/10/06", "2026/10/08");
      expect(wrapper!.vm.gateReason).toBeNull();
      const applied = await apply();
      expect(applied.endTime).toBeGreaterThanOrEqual(micros("2026-10-08T03:00:00Z"));
      expect(applied.endTime).toBeLessThanOrEqual(Date.now() * 1000);
    });

    it("keeps a host end time on the next date pick", async () => {
      create({ autoApply: false, queryRangeRestrictionInHour: 0, defaultType: "absolute" });
      await flushPromises();
      wrapper!.vm.setAbsoluteTime(micros("2026-10-05T09:00:00Z"), micros("2026-10-05T14:30:00Z"));
      await flushPromises();
      await openMenu(wrapper!);

      await pickRange("2026/10/03", "2026/10/06");
      expect(wrapper!.vm.selectedTime).toEqual({ startTime: "09:00:00", endTime: "14:30:00" });
      const applied = await apply();
      expect(applied.startTime).toBe(micros("2026-10-03T09:00:00Z"));
      expect(applied.endTime).toBe(micros("2026-10-06T14:30:00Z"));
    });

    it("keeps a Recent row's end time on the next date pick", async () => {
      localStorage.setItem(
        HISTORY_KEY,
        JSON.stringify([
          { startUs: micros("2026-10-05T09:00:00Z"), endUs: micros("2026-10-05T14:30:00Z") },
        ]),
      );
      create({ autoApply: false, queryRangeRestrictionInHour: 0 });
      await openMenu(wrapper!);
      el("date-time-rail-recent-0")!.click();
      await flushPromises();
      expect(lastChange(wrapper!).endTime).toBe(micros("2026-10-05T14:30:00Z"));

      await openMenu(wrapper!);
      await pickRange("2026/10/03", "2026/10/06");
      const applied = await apply();
      expect(applied.startTime).toBe(micros("2026-10-03T09:00:00Z"));
      expect(applied.endTime).toBe(micros("2026-10-06T14:30:00Z"));
    });

    it("labels a pending day with the end Apply commits", async () => {
      create({ autoApply: false, queryRangeRestrictionInHour: 0, defaultType: "absolute" });
      await flushPromises();
      wrapper!.vm.setAbsoluteTime(micros("2026-10-05T09:00:00Z"), micros("2026-10-05T14:30:00Z"));
      await flushPromises();
      await openMenu(wrapper!);

      calendar().vm.$emit("update:pending-date", "2026/10/06");
      await flushPromises();
      expect(wrapper!.vm.triggerLabel).toBe("2026/10/06 09:00:00 - 2026/10/06 14:30:00");
      expect((await apply()).endTime).toBe(micros("2026-10-06T14:30:00Z"));
    });

    it("labels a pending today with the now its whole-day end is clipped to", async () => {
      create({ autoApply: false, queryRangeRestrictionInHour: 0 });
      await openMenu(wrapper!);
      wrapper!.vm.selectTab("absolute");
      await flushPromises();
      typeEnd("23:59:59");

      calendar().vm.$emit("update:pending-date", "2026/10/08");
      await flushPromises();
      expect(wrapper!.vm.gateReason).toBeNull();
      expect(wrapper!.vm.triggerLabel).toMatch(/^2026\/10\/08 02:45:00 - 2026\/10\/08 03:00:0\d$/);
      const applied = await apply();
      expect(wrapper!.vm.triggerLabel).toBe(
        `2026/10/08 02:45:00 - 2026/10/08 ${timeOf(applied.endTime / 1000)}`,
      );
    });

    it("moves an open panel's clipped end with the clock", async () => {
      create({ autoApply: false, queryRangeRestrictionInHour: 0 });
      await openMenu(wrapper!);
      wrapper!.vm.selectTab("absolute");
      await flushPromises();
      typeEnd("23:59:59");
      await pickRange("2026/10/01", "2026/10/08");

      vi.setSystemTime(new Date("2026-10-08T03:00:30Z"));
      await vi.waitFor(
        () => expect(wrapper!.vm.triggerLabel).toMatch(/ - 2026\/10\/08 03:00:3\d$/),
        { timeout: 3000 },
      );
      const applied = await apply();
      expect(applied.endTime).toBeGreaterThanOrEqual(micros("2026-10-08T03:00:30Z"));
      expect(wrapper!.vm.triggerLabel).toBe(
        `2026/10/01 02:45:00 - 2026/10/08 ${timeOf(applied.endTime / 1000)}`,
      );
    });

    it("ticks the clock only while a whole-day end is clipped to now", async () => {
      create({ autoApply: false, queryRangeRestrictionInHour: 0 });
      await openMenu(wrapper!);
      const ticks = () => vi.mocked(setInterval).mock.calls.filter(([, ms]) => ms === 1000).length;
      vi.spyOn(globalThis, "setInterval");

      await setAbsolute("2026/10/01 00:00:00", "2026/10/05 23:59:59");
      expect(ticks()).toBe(0);

      await setAbsolute("2026/10/08 00:00:00", "2026/10/08 23:59:59");
      expect(ticks()).toBe(1);
    });

    it("stops the gate clock while its view is kept alive and resumes it on return", async () => {
      const setSpy = vi.spyOn(globalThis, "setInterval");
      const clearSpy = vi.spyOn(globalThis, "clearInterval");
      const liveTicks = () => {
        const cleared = new Set(clearSpy.mock.calls.map(([id]) => id));
        return setSpy.mock.calls.filter(
          ([, ms], i) => ms === 1000 && !cleared.has(setSpy.mock.results[i].value),
        ).length;
      };
      const shown = ref(true);
      const picker = ref<InstanceType<typeof DateTime> | null>(null);
      const host = mount(
        defineComponent({
          setup: () => () =>
            h(KeepAlive, null, [
              shown.value
                ? h(DateTime, { calendarPresets: true, autoApply: false, ref: picker })
                : null,
            ]),
        }),
        { attachTo: document.body, global: { plugins: [i18n, store] } },
      );
      const vm = picker.value!;
      vm.onMenuOpenChange(true);
      vm.menuOpen = true;
      vm.selectTab("absolute");
      vm.selectedDate = { from: "2026/10/08", to: "2026/10/08" };
      vm.selectedTime = { startTime: "00:00:00", endTime: "23:59:59" };
      await flushPromises();
      expect(liveTicks()).toBe(1);

      shown.value = false;
      await flushPromises();
      expect(liveTicks()).toBe(0);

      shown.value = true;
      await flushPromises();
      expect(liveTicks()).toBe(1);
      host.unmount();
    });

    it("keeps each Recent row's text when only the gate clock ticks", async () => {
      localStorage.setItem(
        HISTORY_KEY,
        JSON.stringify([
          { startUs: micros("2026-10-05T09:00:00Z"), endUs: micros("2026-10-05T14:30:00Z") },
        ]),
      );
      create({ autoApply: false, queryRangeRestrictionInHour: 0 });
      await openMenu(wrapper!);
      await setAbsolute("2026/10/08 00:00:00", "2026/10/08 23:59:59");
      const before = wrapper!.vm.recentRailItems[0];

      wrapper!.vm.gateNow += 1000;
      await flushPromises();
      expect(wrapper!.vm.recentRailItems[0].compact).toBe(before.compact);
      expect(wrapper!.vm.recentRailItems[0].tooltip).toBe(before.tooltip);
    });

    it("ignores a host period over the input cap or with text before the number", async () => {
      create({ autoApply: false, defaultRelativeTime: "2h" });
      await flushPromises();
      wrapper!.vm.setRelativeTime(`30m${" ".repeat(MAX_RANGE_TEXT_UNITS)}`);
      wrapper!.vm.setRelativeTime("x45m");

      expect(wrapper!.vm.relativeValue).toBe(2);
      expect(wrapper!.vm.relativePeriod).toBe("h");
    });

    it("refuses a future start with a whole-day end as future, not as order", async () => {
      create({ autoApply: false, queryRangeRestrictionInHour: 0 });
      await openMenu(wrapper!);
      await setAbsolute("2026/10/08 09:00:00", "2026/10/08 23:59:59");

      expect(wrapper!.vm.gateReason).toBe("future");
      expect(el("date-time-gate-message")!.textContent).toContain(
        "2026/10/08 09:00:00 is in the future.",
      );
    });

    it("records nothing when an unchanged whole-day range on today closes later", async () => {
      create({ autoApply: true, queryRangeRestrictionInHour: 0, defaultType: "absolute" });
      await flushPromises();
      wrapper!.vm.setAbsoluteTime(micros("2026-10-08T00:00:00Z"), micros("2026-10-08T23:59:59Z"));
      await flushPromises();
      vi.spyOn(Storage.prototype, "setItem");
      await openMenu(wrapper!);

      vi.setSystemTime(new Date("2026-10-08T03:00:30Z"));
      await vi.waitFor(() => expect(wrapper!.vm.triggerLabel).toMatch(/03:00:3\d$/), {
        timeout: 3000,
      });
      wrapper!.vm.menuOpen = false;
      wrapper!.vm.onMenuOpenChange(false);
      await flushPromises();

      const writes = vi
        .mocked(Storage.prototype.setItem)
        .mock.calls.filter(([key]) => key === HISTORY_KEY);
      expect(writes).toHaveLength(0);
    });

    it("keeps a whole-day end after now when the host passes a future maxDate", async () => {
      create({ autoApply: false, queryRangeRestrictionInHour: 0, maxDate: "2026/10/10" });
      await openMenu(wrapper!);
      wrapper!.vm.selectTab("absolute");
      await flushPromises();
      typeEnd("23:59:59");
      await pickRange("2026/10/01", "2026/10/08");
      expect(wrapper!.vm.gateReason).toBeNull();
      expect((await apply()).endTime).toBe(micros("2026-10-08T23:59:59Z"));
    });

    it("still refuses an end time the user set after now, with the reason", async () => {
      create({ autoApply: false, queryRangeRestrictionInHour: 0 });
      await openMenu(wrapper!);
      wrapper!.vm.selectTab("absolute");
      await flushPromises();
      typeEnd("05:00:00");
      await pickRange("2026/10/01", "2026/10/08");

      expect(wrapper!.vm.selectedTime.endTime).toBe("05:00:00");
      expect(wrapper!.vm.gateReason).toBe("future");
      expect(el("date-time-gate-message")!.textContent).toContain(
        "2026/10/08 05:00:00 is in the future.",
      );
    });
    it("refuses a host end time that lands after now once its date becomes today", async () => {
      create({ autoApply: false, queryRangeRestrictionInHour: 0, defaultType: "absolute" });
      await flushPromises();
      wrapper!.vm.setAbsoluteTime(micros("2026-10-05T09:00:00Z"), micros("2026-10-05T14:30:00Z"));
      await flushPromises();
      await openMenu(wrapper!);

      await pickRange("2026/10/07", "2026/10/08");
      expect(wrapper!.vm.gateReason).toBe("future");
      expect(el("date-time-gate-message")!.textContent).toContain(
        "2026/10/08 14:30:00 is in the future.",
      );
    });
  });

  it("clears a future verdict once now passes the end, without an edit", async () => {
    create({ autoApply: false, queryRangeRestrictionInHour: 0 });
    await openMenu(wrapper!);
    await setAbsolute("2026/10/08 02:00:00", "2026/10/08 03:00:10");
    expect(wrapper!.vm.gateReason).toBe("future");

    vi.setSystemTime(new Date("2026-10-08T03:00:20Z"));
    await vi.waitFor(() => expect(wrapper!.vm.gateReason).toBeNull(), { timeout: 3000 });
    expect(el<HTMLButtonElement>("date-time-apply-btn")!.disabled).toBe(false);
  });

  it("applies a saved absolute range the host restores, even over the limit", async () => {
    create({ autoApply: true });
    await flushPromises();
    wrapper!.vm.selectTab("absolute");
    await flushPromises();
    const before = changes(wrapper!).length;

    wrapper!.vm.setSavedDate({
      type: "absolute",
      selectedDate: { from: "2026/10/01", to: "2026/10/07" },
      selectedTime: { startTime: "00:00:00", endTime: "00:00:00" },
    });
    await flushPromises();

    expect(changes(wrapper!).length).toBe(before + 1);
    expect(lastChange(wrapper!).startTime).toBe(micros("2026-10-01T00:00:00Z"));
  });

  it("ends the gate at the midnight after maxDate and the step at its last second", async () => {
    create({ autoApply: false, queryRangeRestrictionInHour: 0, maxDate: "2026/10/08" });
    await openMenu(wrapper!);
    expect(wrapper!.vm.rangeLimits.maxEndUs).toBe(micros("2026-10-09T00:00:00Z"));

    await setAbsolute("2026/10/08 22:00:00", "2026/10/08 23:00:00");
    wrapper!.vm.shiftTimeRange("next");
    await flushPromises();
    expect(wrapper!.vm.selectedTime.endTime).toBe("23:59:59");
  });

  it("names maxDate's last second, not the day after, in the bar's after-max hint", async () => {
    create({ autoApply: false, queryRangeRestrictionInHour: 0, maxDate: "2026/10/08" });
    await openMenu(wrapper!);
    await typeInBar("2026-10-08 02:00:00 - 2026-10-09 05:00:00");

    expect(barState()).toBe("blocked");
    expect(el("date-time-range-status")!.textContent).toContain(
      "Pick a range that ends by Thu, Oct 8, 23:59:59",
    );
  });

  it("keeps the bar's input free of the panel gate", async () => {
    create({ autoApply: true });
    await openMenu(wrapper!);

    expect(barInput()).not.toBeNull();
    expect(el("date-time-gate-message")).toBeNull();
  });
});

function pasteEvent(text: string): ClipboardEvent {
  const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
  Object.defineProperty(event, "target", { value: document.body });
  return event;
}

describe("DateTime validity gate review fixes", () => {
  let wrapper: Picker | null = null;

  const create = (props: Record<string, unknown> = {}) => {
    wrapper = mountPicker(props);
    return wrapper;
  };

  const setAbsolute = async (start: string, end: string) => {
    const [fromDate, fromTime] = start.split(" ");
    const [toDate, toTime] = end.split(" ");
    wrapper!.vm.selectTab("absolute");
    wrapper!.vm.selectedDate = { from: fromDate, to: toDate };
    wrapper!.vm.selectedTime = { startTime: fromTime, endTime: toTime };
    await flushPromises();
  };

  const close = async () => {
    wrapper!.vm.menuOpen = false;
    wrapper!.vm.onMenuOpenChange(false);
    await flushPromises();
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    store.state.timezone = "UTC";
    store.state.savedViewFlag = false;
    localStorage.clear();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("re-emits the applied range on refresh, never the open draft", async () => {
    create({ autoApply: false, defaultRelativeTime: "15m" });
    await openMenu(wrapper!);
    await setAbsolute("2026/10/08 02:00:00", "2026/10/08 01:00:00");
    wrapper!.vm.refresh();
    await flushPromises();

    expect(lastChange(wrapper!)).toMatchObject({
      valueType: "relative",
      relativeTimePeriod: "15m",
    });
    await close();
    expect(wrapper!.vm.selectedType).toBe("relative");
  });

  it("re-checks the exact bounds Apply emits after the clock has moved", async () => {
    vi.setSystemTime(new Date("2026-10-08T02:00:00Z"));
    create({ autoApply: false, queryRangeRestrictionInHour: 3 });
    await openMenu(wrapper!);
    wrapper!.vm.calendarToken = "calendar:day:0";
    await flushPromises();
    expect(wrapper!.vm.gateReason).toBeNull();
    const before = changes(wrapper!).length;

    vi.setSystemTime(new Date("2026-10-08T03:30:00Z"));
    wrapper!.vm.applyAndClose();
    await flushPromises();

    expect(changes(wrapper!).length).toBe(before);
  });

  it("emits the end the gate clamped for clock skew", async () => {
    create({ autoApply: false, queryRangeRestrictionInHour: 2 });
    await openMenu(wrapper!);
    await setAbsolute("2026/10/08 01:30:00", "2026/10/08 03:00:03");
    expect(wrapper!.vm.gateReason).toBeNull();
    wrapper!.vm.applyAndClose();
    await flushPromises();

    const end = Number(lastChange(wrapper!).endTime);
    expect(end).toBeLessThan(micros("2026-10-08T03:00:03Z"));
    expect(end).toBeLessThanOrEqual(Date.now() * 1000);
  });

  it("announces a changed range, not every tick of a clipped whole-day end", async () => {
    create({ autoApply: true });
    await openMenu(wrapper!);
    await setAbsolute("2026/10/08 00:00:00", "2026/10/08 23:59:59");
    const live = el("date-time-range-live")!;
    const first = live.textContent;
    expect(first).toContain("2026/10/08 00:00:00");

    vi.setSystemTime(new Date("2026-10-08T03:00:30Z"));
    await vi.waitFor(() => expect(wrapper!.vm.triggerLabel).toMatch(/03:00:3\d$/), {
      timeout: 3000,
    });
    expect(live.textContent).toBe(first);
  });

  it("applies a future range that became valid while open when the panel closes", async () => {
    create({ autoApply: true });
    await openMenu(wrapper!);
    await setAbsolute("2026/10/08 01:00:00", "2026/10/08 02:00:00");
    const before = changes(wrapper!).length;
    await setAbsolute("2026/10/08 02:00:00", "2026/10/08 03:00:20");
    expect(wrapper!.vm.gateReason).toBe("future");
    expect(changes(wrapper!).length).toBe(before);

    vi.setSystemTime(new Date("2026-10-08T03:00:30Z"));
    await vi.waitFor(() => expect(wrapper!.vm.gateReason).toBeNull(), { timeout: 3000 });
    await close();

    expect(changes(wrapper!).length).toBe(before + 1);
    expect(lastChange(wrapper!).endTime).toBe(micros("2026-10-08T03:00:20Z"));
  });
});
