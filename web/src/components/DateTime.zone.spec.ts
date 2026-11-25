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
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import DateTime from "@/components/DateTime.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import {
  barInput,
  lastChange,
  mountPicker,
  openMenu,
  press,
  typeInBar,
  warmRangeInput,
  type Picker,
} from "@/test/unit/helpers/dateTimePicker";

const START = Date.parse("2026-11-04T00:00:00Z") * 1000;
const END = Date.parse("2026-11-05T00:00:00Z") * 1000;
const ABSOLUTE = {
  disableRelative: true,
  autoApply: true,
  defaultAbsoluteTime: { startTime: START, endTime: END },
};

describe("DateTime pickerTimezone and hideClipboard", () => {
  let wrapper: VueWrapper<InstanceType<typeof DateTime>> | null = null;

  const createWrapper = (props: Record<string, unknown> = {}) => {
    wrapper = mount(DateTime, {
      props: { ...ABSOLUTE, ...props },
      attachTo: document.body,
      global: { plugins: [i18n, store] },
    });
    return wrapper;
  };
  const lastEmit = () => {
    const events = wrapper!.emitted("on:date-change") as unknown[][];
    return events[events.length - 1][0] as { startTime: number; endTime: number };
  };
  const inMenu = (dataTest: string) =>
    document.body.querySelector(`#date-time-menu [data-test="${dataTest}"]`);

  // The bar and the paste parser load lazily; warm them so a flush sees them mounted.
  beforeAll(async () => {
    await import("@/components/DateTimeRangeInput.vue");
    await import("@/composables/useTimeRangeInput");
  });

  beforeEach(() => {
    store.state.timezone = "UTC";
  });
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("starts on the given zone and shows its wall clock", async () => {
    createWrapper({ pickerTimezone: "Asia/Calcutta" });
    await flushPromises();
    expect(wrapper!.vm.selectedTime.startTime).toBe("05:30:00");
    expect(wrapper!.vm.timezone).toBe("Asia/Calcutta");
    expect(lastEmit().startTime).toBe(START);
  });

  /// A zone picked here changes this range only, never the timezone every other page reads.
  it("re-reads the shown times in a newly picked zone without touching the app's", async () => {
    const dispatch = store.dispatch;
    const calls: unknown[][] = [];
    store.dispatch = ((...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve();
    }) as typeof store.dispatch;
    try {
      createWrapper({ pickerTimezone: "Asia/Calcutta" });
      await flushPromises();
      wrapper!.vm.timezone = "UTC";
      await wrapper!.vm.onTimezoneChange();
      await flushPromises();

      expect(lastEmit().startTime).toBe(START + 5.5 * 3_600_000_000);
      expect(wrapper!.emitted("on:timezone-change")!.at(-1)).toEqual(["UTC"]);
      expect(store.state.timezone).toBe("UTC");
      expect(calls.some((call) => call[0] === "setTimezone")).toBe(false);
    } finally {
      store.dispatch = dispatch;
    }
  });

  it("drops the copy and paste row but keeps the zone select and the hint", async () => {
    createWrapper({ pickerTimezone: "Asia/Calcutta", hideClipboard: true, defaultOpen: true });
    await flushPromises();
    expect(inMenu("date-time-copy-btn")).toBeNull();
    expect(inMenu("date-time-paste-btn")).toBeNull();
    expect(inMenu("datetime-timezone-select")).not.toBeNull();
    expect(document.body.textContent).toContain("You can choose multiple dates");
  });

  it("keeps copy and paste and reads the app's zone by default", async () => {
    store.state.timezone = "Asia/Calcutta";
    createWrapper({ defaultOpen: true });
    await flushPromises();
    expect(wrapper!.vm.selectedTime.startTime).toBe("05:30:00");
    expect(inMenu("date-time-copy-btn")).not.toBeNull();
    expect(inMenu("date-time-paste-btn")).not.toBeNull();
  });
});

describe("DateTime zone review fixes", () => {
  let wrapper: Picker | null = null;
  const micros = (iso: string) => Date.parse(iso) * 1000;

  beforeAll(warmRangeInput);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    store.state.timezone = "UTC";
    store.state.savedViewFlag = false;
    localStorage.clear();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
    store.state.timezone = "UTC";
    vi.useRealTimers();
  });

  it("resolves a rolling day in the picker zone across a DST change", async () => {
    vi.setSystemTime(new Date("2026-03-08T16:00:00Z"));
    store.state.timezone = "America/New_York";
    wrapper = mountPicker({ autoApply: true });
    await flushPromises();
    wrapper.vm.pickRelativeChip("d", 1);
    await flushPromises();

    const change = lastChange(wrapper);
    expect(Number(change.endTime) - Number(change.startTime)).toBe(23 * 3_600_000_000);
  });

  it.each([
    [1, "2026-11-01T05:30:00Z"],
    [2, "2026-11-01T06:30:00Z"],
  ])("commits repeated-hour reading %i of a rolling day as chosen", async (downs, start) => {
    vi.setSystemTime(new Date("2026-11-02T06:30:00Z"));
    store.state.timezone = "America/New_York";
    wrapper = mountPicker({ autoApply: true });
    await openMenu(wrapper);
    await typeInBar("1d");
    for (let i = 0; i < downs; i++) await press(barInput(), "ArrowDown");
    await press(barInput(), "Enter");

    expect(lastChange(wrapper).relativeTimePeriod).toBe("1d");
    expect(Math.abs(Number(lastChange(wrapper).startTime) - micros(start))).toBeLessThan(1e6);
  });

  it("keeps the applied instants when a zone change would move them into the future", async () => {
    vi.setSystemTime(new Date("2026-10-08T03:00:00Z"));
    wrapper = mountPicker({ autoApply: true });
    await openMenu(wrapper);
    wrapper.vm.selectTab("absolute");
    wrapper.vm.selectedDate = { from: "2026/10/08", to: "2026/10/08" };
    wrapper.vm.selectedTime = { startTime: "01:00:00", endTime: "02:00:00" };
    await flushPromises();
    wrapper.vm.timezone = "America/New_York";
    await wrapper.vm.onTimezoneChange();
    await flushPromises();

    expect(lastChange(wrapper)).toMatchObject({
      startTime: micros("2026-10-08T01:00:00Z"),
      endTime: micros("2026-10-08T02:00:00Z"),
    });
    expect(wrapper.vm.gateReason).toBeNull();
  });
});
