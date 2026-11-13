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
import { timeRangePinsKey } from "@/composables/useTimeRangePins";
import { LATEST_INSTANT_US } from "@/composables/useTimeRangeLimits";

const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastMock }));

const NOW = new Date("2026-11-12T15:54:10Z");
const IST = "Asia/Calcutta";
const micros = (iso: string) => Date.parse(iso) * 1000;
const HISTORY_KEY = timeRangeHistoryKey("default", "example@gmail.com");
const PINS_KEY = timeRangePinsKey("default", "example@gmail.com");

describe("DateTime QA run 2", () => {
  let wrapper: VueWrapper<InstanceType<typeof DateTime>> | null = null;

  const createWrapper = (props: Record<string, unknown> = {}) => {
    wrapper = mount(DateTime, {
      props: { autoApply: true, calendarPresets: true, ...props },
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

  const el = (dataTest: string) =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-test]")).find(
      (node) => node.getAttribute("data-test") === dataTest,
    ) ?? null;

  const emits = () => (wrapper!.emitted("on:date-change") ?? []).length;

  const lastEmit = () => {
    const events = wrapper!.emitted("on:date-change") as unknown[][];
    return events[events.length - 1][0] as Record<string, unknown>;
  };

  const history = () => JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");

  const typeInBar = async (text: string) => {
    const field = el("date-time-input-field") as HTMLInputElement;
    field.value = text;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 150));
    await flushPromises();
  };

  const fixedProps = (from: string, to: string) => ({
    defaultType: "absolute",
    defaultAbsoluteTime: { startTime: micros(from), endTime: micros(to) },
  });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    store.state.timezone = IST;
    store.state.savedViewFlag = false;
    localStorage.clear();
    toastMock.mockReset();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
    localStorage.clear();
    vi.useRealTimers();
  });

  describe("S1 S7 URL ranges", () => {
    it("cuts a URL end in year 9999 to the last instant every zone can show", async () => {
      createWrapper(fixedProps("2026-11-12T10:00:00Z", "9999-12-31T23:00:00Z"));
      await flushPromises();

      expect(lastEmit()).toMatchObject({
        startTime: micros("2026-11-12T10:00:00Z"),
        endTime: LATEST_INSTANT_US,
      });
      expect(String(wrapper!.vm.triggerLabel)).toContain("9999");
    });

    it("falls back to the default for a URL range starting before 1970", async () => {
      createWrapper(fixedProps("1967-01-01T00:00:00Z", "2026-11-12T10:00:00Z"));
      await flushPromises();

      expect(lastEmit()).toMatchObject({ endTime: NOW.getTime() * 1000 });
      expect(toastMock).toHaveBeenCalled();
    });
  });

  describe("S5 return to live", () => {
    it("goes back to live after more steps back than the undo stack holds", async () => {
      createWrapper({ defaultRelativeTime: "1h", undoable: true });
      await flushPromises();

      for (let i = 0; i < 20; i += 1) wrapper!.vm.shiftTimeRange("prev");
      for (let i = 0; i < 20 && wrapper!.vm.selectedType !== "relative"; i += 1) {
        wrapper!.vm.shiftTimeRange("next");
      }
      await flushPromises();

      expect(wrapper!.vm.selectedType).toBe("relative");
      expect(lastEmit()).toMatchObject({ relativeTimePeriod: "1h" });
    });
  });

  it("goes back to the live range it last left, after a zoom out", async () => {
    createWrapper({ defaultRelativeTime: "1h", undoable: true });
    await flushPromises();

    wrapper!.vm.zoomOut();
    wrapper!.vm.shiftTimeRange("prev");
    wrapper!.vm.shiftTimeRange("next");
    await flushPromises();

    expect(lastEmit()).toMatchObject({ valueType: "relative", relativeTimePeriod: "2h" });
  });

  describe("C2 Apply with typed text", () => {
    it("applies the typed range, not the calendar's, when the bar holds a reading", async () => {
      createWrapper(fixedProps("2026-11-10T00:00:00Z", "2026-11-10T01:00:00Z"));
      await flushPromises();
      await openMenu();
      wrapper!.vm.openCalendar();
      await flushPromises();
      await typeInBar("Nov 4 - 6");

      el("date-time-apply-btn")!.click();
      await flushPromises();

      expect(lastEmit()).toMatchObject({
        startTime: micros("2026-11-03T18:30:00Z"),
        endTime: micros("2026-11-06T18:30:00Z"),
      });
      expect(wrapper!.vm.menuOpen).toBe(false);
    });

    it("turns Apply off with the reason while the bar holds a refused reading", async () => {
      createWrapper(fixedProps("2026-11-10T00:00:00Z", "2026-11-10T01:00:00Z"));
      await flushPromises();
      await openMenu();
      wrapper!.vm.openCalendar();
      await flushPromises();
      await typeInBar("2026-11-20 - 2026-11-22");

      expect((el("date-time-apply-btn") as HTMLButtonElement).disabled).toBe(true);
      expect(String(wrapper!.vm.applyBlockedReason)).toBe("That is in the future. Latest is now.");
    });
  });

  describe("C7 lit chip", () => {
    it("applies the lit chip again and closes when it is clicked", async () => {
      createWrapper({ defaultRelativeTime: "15m" });
      await flushPromises();
      await openMenu();
      expect(wrapper!.vm.litChip).toBe("15m");
      const before = emits();

      wrapper!.vm.onChipToggle(undefined);
      await flushPromises();

      expect(emits()).toBe(before + 1);
      expect(lastEmit()).toMatchObject({ relativeTimePeriod: "15m", userChangedValue: true });
      expect(wrapper!.vm.menuOpen).toBe(false);
    });
  });

  describe("C8 dates-only trigger", () => {
    it("labels a dates-only picker with the v2 dates, not the legacy yyyy/MM/dd pair", async () => {
      createWrapper({
        ...fixedProps("2026-11-03T18:30:00Z", "2026-11-04T18:29:59Z"),
        disableRelative: true,
      });
      await flushPromises();

      expect(wrapper!.vm.triggerLabel).toBe("Nov 4");
    });
  });

  describe("P1 sub-second Recent and pins", () => {
    it("applies a stored Recent range with its milliseconds", async () => {
      const startUs = micros("2026-11-12T10:00:00.948Z");
      const endUs = micros("2026-11-12T11:00:00.579Z");
      localStorage.setItem(HISTORY_KEY, JSON.stringify([{ startUs, endUs }]));
      createWrapper();
      await openMenu();

      el("date-time-list-recent-0")!.click();
      await flushPromises();

      expect(lastEmit()).toMatchObject({ startTime: startUs, endTime: endUs });
    });
  });

  describe("P6 replaced ranges enter Recent", () => {
    it("keeps a link's range in Recent once the user steps away from it", async () => {
      createWrapper(fixedProps("2026-11-12T10:00:00Z", "2026-11-12T11:00:00Z"));
      await flushPromises();
      expect(history()).toEqual([]);

      wrapper!.vm.shiftTimeRange("prev");
      await flushPromises();

      expect(history()[0]).toEqual({
        startUs: micros("2026-11-12T10:00:00Z"),
        endUs: micros("2026-11-12T11:00:00Z"),
      });
    });

    it("records only the range in force at open, not each auto-applied edit", async () => {
      createWrapper({ defaultRelativeTime: "2d" });
      await flushPromises();
      await openMenu();

      wrapper!.vm.setRelativeDate("h", 5, true);
      wrapper!.vm.setRelativeDate("h", 7, true);
      await flushPromises();

      expect(history()).toEqual([{ relative: "2d" }]);
    });
  });

  describe("S8 limits arriving late", () => {
    it("says so when a late range limit cuts the applied range", async () => {
      createWrapper({ defaultRelativeTime: "7d" });
      await flushPromises();

      await wrapper!.setProps({ queryRangeRestrictionInHour: 24 });
      await flushPromises();

      expect(lastEmit()).toMatchObject({ relativeTimePeriod: "1d" });
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: "warning" }));
    });
  });

  describe("P8 pin naming and row tooltips", () => {
    it("shows the range beside the name field and v2 stamps with an offset in the tooltip", async () => {
      const startUs = micros("2026-11-12T10:00:00Z");
      const endUs = micros("2026-11-12T10:02:00Z");
      localStorage.setItem(HISTORY_KEY, JSON.stringify([{ startUs, endUs }]));
      createWrapper();
      await openMenu();

      const recentRow = wrapper!.vm.shownRows.find(
        (row: { kind: string }) => row.kind === "recent",
      );
      expect(recentRow?.tooltip).toContain("UTC+05:30");
      expect(recentRow?.tooltip).not.toContain("Asia/Calcutta");
      expect(recentRow?.tooltip).not.toMatch(/\d{4}\/\d{2}\/\d{2}/);

      wrapper!.vm.pinRecentRow("recent-0");
      await flushPromises();

      expect(JSON.parse(localStorage.getItem(PINS_KEY)!)).toHaveLength(1);
      expect(el("date-time-list-pin-range")?.textContent).toBe("Nov 12, 15:30 – 15:32");
      expect(el("date-time-list-pin-name")?.className).toContain("w-full");
    });
  });
});
