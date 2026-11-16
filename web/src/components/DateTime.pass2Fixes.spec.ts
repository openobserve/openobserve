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

vi.mock("@/utils/timeInputFailure", () => ({ reportParseFailure: vi.fn() }));

// Mon 2026-11-16 10:00 UTC; the picker zone is IST.
const NOW = new Date("2026-11-16T10:00:00Z");
const IST = "Asia/Calcutta";
const micros = (iso: string) => Date.parse(iso) * 1000;
const settings = store.state.organizationData.organizationSettings as Record<string, unknown>;

const i18nLocale = i18n.global.locale as unknown as { value: string };

describe("DateTime pass-2 fixes", () => {
  let wrapper: VueWrapper<InstanceType<typeof DateTime>> | null = null;
  let previousLocale = "en-us";

  const createWrapper = (props: Record<string, unknown> = {}) => {
    wrapper = mount(DateTime, {
      props,
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
  const openCalendar = async () => {
    await openMenu();
    wrapper!.vm.openCalendar();
    await flushPromises();
  };
  const input = (dataTest: string) =>
    document.querySelector<HTMLInputElement>(`[data-test="${dataTest}"] input`)!;
  const commit = async (dataTest: string, value: string) => {
    vi.setSystemTime(Date.now() + 1000);
    const field = input(dataTest);
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
    vi.setSystemTime(Date.now() + 1000);
    field.dispatchEvent(new Event("change", { bubbles: true }));
    await flushPromises();
  };
  const held = () => {
    const { startTime, endTime } = wrapper!.vm.getConsumableDateTime() as Record<string, number>;
    return { start: startTime, end: endTime };
  };
  const lastEmit = () => {
    const events = (wrapper!.emitted("on:date-change") ?? []) as unknown[][];
    return events[events.length - 1][0] as Record<string, unknown>;
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    store.state.timezone = IST;
    store.state.savedViewFlag = false;
    delete settings.fiscal_year_start_month;
    localStorage.clear();
    previousLocale = i18nLocale.value;
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
    delete settings.fiscal_year_start_month;
    localStorage.clear();
    i18nLocale.value = previousLocale;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("A-1 stepping a whole month forward with maxDate", () => {
    it("stops the stepped month at the end of maxDate", async () => {
      createWrapper({
        defaultType: "absolute",
        maxDate: "2026/11/10",
        defaultAbsoluteTime: {
          startTime: micros("2026-09-30T18:30:00Z"),
          endTime: micros("2026-10-31T18:30:00Z"),
        },
      });
      await flushPromises();

      wrapper!.vm.shiftTimeRange("next");
      await flushPromises();

      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-10-31T18:30:00Z"),
        endTime: micros("2026-11-10T18:30:00Z"),
      });
    });
  });

  describe("A-2 End typed later this year without a year", () => {
    it("keeps the year the field shows instead of reading last year", async () => {
      createWrapper({
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2026-11-16T03:30:00Z"),
          endTime: micros("2026-11-16T04:30:00Z"),
        },
      });
      await flushPromises();
      await openCalendar();
      await commit("datetime-end-time", "Nov 30, 23:00");

      expect(wrapper!.vm.timeFieldError).toBeNull();
      expect(held().end).toBe(micros("2026-11-30T17:30:00Z"));
    });

    it("still reads an earlier day this year as this year", async () => {
      createWrapper({
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2026-11-16T03:30:00Z"),
          endTime: micros("2026-11-16T04:30:00Z"),
        },
      });
      await flushPromises();
      await openCalendar();
      await commit("datetime-start-time", "Feb 3, 09:00");

      expect(wrapper!.vm.timeFieldError).toBeNull();
      expect(held().start).toBe(micros("2026-02-03T03:30:00Z"));
    });
  });

  describe("A-3 sub-second edit closed without Apply", () => {
    it("drops the typed milliseconds when the panel closes", async () => {
      createWrapper({
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2026-11-16T03:30:00Z"),
          endTime: micros("2026-11-16T04:30:00Z"),
        },
      });
      await flushPromises();
      await openCalendar();
      await commit("datetime-start-time", "Nov 16, 09:00:00.456");
      expect(held().start).toBe(micros("2026-11-16T03:30:00.456Z"));

      wrapper!.vm.onMenuOpenChange(false);
      wrapper!.vm.menuOpen = false;
      await flushPromises();

      expect(held().start).toBe(micros("2026-11-16T03:30:00Z"));
    });
  });

  describe("A-4 End more than ten years ahead", () => {
    it("refuses it, as a link with that end is refused", async () => {
      createWrapper({
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2026-11-16T03:30:00Z"),
          endTime: micros("2026-11-16T04:30:00Z"),
        },
      });
      await flushPromises();
      await openCalendar();
      await commit("datetime-end-time", "Jan 5, 2040 10:00");

      expect(wrapper!.vm.timeFieldError?.field).toBe("end");
      expect(held().end).toBe(micros("2026-11-16T04:30:00Z"));
    });
  });

  describe("A-6 fiscal-year step", () => {
    it("steps an April fiscal year back by a fiscal year across a leap day", async () => {
      settings.fiscal_year_start_month = 4;
      createWrapper({
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2024-03-31T18:30:00Z"),
          endTime: micros("2025-03-31T18:30:00Z"),
        },
      });
      await flushPromises();

      wrapper!.vm.shiftTimeRange("prev");
      await flushPromises();

      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2023-03-31T18:30:00Z"),
        endTime: micros("2024-03-31T18:30:00Z"),
      });
    });
  });
});
