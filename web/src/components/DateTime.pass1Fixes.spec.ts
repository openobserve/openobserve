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

vi.mock("@/utils/timeInputFailure", () => ({ reportParseFailure: vi.fn() }));

// Mon 2026-11-16 10:00 UTC; the picker zone is IST.
const NOW = new Date("2026-11-16T10:00:00Z");
const IST = "Asia/Calcutta";
const micros = (iso: string) => Date.parse(iso) * 1000;
const HISTORY_KEY = timeRangeHistoryKey("default", "example@gmail.com");
const tr = (key: string, params: Record<string, unknown> = {}) =>
  String((i18n.global.t as unknown as (k: string, p: object) => string)(key, params));

const i18nLocale = i18n.global.locale as unknown as { value: string };

describe("DateTime pass-1 fixes", () => {
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
  const el = (dataTest: string) => document.querySelector<HTMLElement>(`[data-test="${dataTest}"]`);
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
  const typeInBar = async (text: string) => {
    const field = el("date-time-input-field") as HTMLInputElement;
    field.value = text;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 150));
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
    localStorage.clear();
    previousLocale = i18nLocale.value;
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
    localStorage.clear();
    i18nLocale.value = previousLocale;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("A-1 field text in a non-English UI", () => {
    it("reads back a time edited in the prefilled French field and keeps Apply enabled", async () => {
      i18nLocale.value = "fr";
      createWrapper({
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2026-02-10T03:30:00Z"),
          endTime: micros("2026-02-10T06:30:00Z"),
        },
      });
      await flushPromises();
      await openCalendar();

      const shown = input("datetime-start-time").value;
      expect(shown).toContain("09:00");
      await commit("datetime-start-time", shown.replace("09:00", "09:30"));

      expect(wrapper!.vm.unreadableFields.start).toBe(false);
      expect(el("date-time-apply-btn")!.hasAttribute("disabled")).toBe(false);
      expect(held().start).toBe(micros("2026-02-10T04:00:00Z"));
    });

    it("reads every prefilled text back in each shipped UI language", async () => {
      const at = micros("2025-12-31T18:29:59.001Z");
      for (const locale of ["fr", "de", "ja", "zh-cn", "ru", "th", "ar"]) {
        i18nLocale.value = locale;
        createWrapper({
          defaultType: "absolute",
          defaultAbsoluteTime: { startTime: at, endTime: micros("2026-11-16T09:59:59Z") },
        });
        await flushPromises();
        const text = wrapper!.vm.startFieldText;
        expect(wrapper!.vm.readFieldText("start", text), `${locale}: ${text}`).toBe(at);
        wrapper!.unmount();
        wrapper = null;
        document.body.innerHTML = "";
      }
    });
  });

  describe("A-2 End edit past maxDate", () => {
    it("refuses an End typed past maxDate and keeps the range", async () => {
      createWrapper({
        defaultType: "absolute",
        maxDate: "2026/11/10",
        defaultAbsoluteTime: {
          startTime: micros("2026-11-09T04:30:00Z"),
          endTime: micros("2026-11-09T06:30:00Z"),
        },
      });
      await flushPromises();
      await openCalendar();
      await commit("datetime-end-time", "Nov 12, 10:00");

      expect(wrapper!.vm.timeFieldError?.field).toBe("end");
      expect(held()).toEqual({
        start: micros("2026-11-09T04:30:00Z"),
        end: micros("2026-11-09T06:30:00Z"),
      });
    });

    it("still takes an End on maxDate's last second", async () => {
      createWrapper({
        defaultType: "absolute",
        maxDate: "2026/11/10",
        defaultAbsoluteTime: {
          startTime: micros("2026-11-09T04:30:00Z"),
          endTime: micros("2026-11-09T06:30:00Z"),
        },
      });
      await flushPromises();
      await openCalendar();
      await commit("datetime-end-time", "Nov 10, 23:59:59");

      expect(wrapper!.vm.timeFieldError).toBeNull();
      expect(held().end).toBe(micros("2026-11-10T18:30:00Z"));
    });
  });

  describe("A-3 typed milliseconds on a clicked day", () => {
    it("keeps Start's milliseconds when End is edited before the day is applied", async () => {
      createWrapper();
      await flushPromises();
      await openCalendar();
      wrapper!.vm.onCalendarPendingDay("2026/11/10");
      await flushPromises();

      await commit("datetime-start-time", "09:00:00.123");
      await commit("datetime-end-time", "10:00");

      expect(input("datetime-start-time").value).toBe("Nov 10, 09:00:00.123");
      wrapper!.vm.onApplyClick();
      await flushPromises();
      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-11-10T03:30:00.123Z"),
        endTime: micros("2026-11-10T04:30:00Z"),
      });
    });
  });

  describe("A-4 typed fixed range that a Recent row names", () => {
    it("still lists a row for the typed range", async () => {
      localStorage.setItem(
        HISTORY_KEY,
        JSON.stringify([
          { startUs: micros("2026-11-03T18:30:00Z"), endUs: micros("2026-11-06T18:30:00Z") },
        ]),
      );
      createWrapper();
      await flushPromises();
      await openMenu();
      expect(
        wrapper!.vm.shownRows.some((row: { label: string }) => row.label === "Nov 4 – 6"),
      ).toBe(true);

      await typeInBar("Nov 4 – 6");

      expect(wrapper!.vm.shownRows.length).toBeGreaterThan(0);
      expect(el("date-time-list-reading")).not.toBeNull();
    });
  });

  describe("A-5 Becomes tooltip of an ended calendar period", () => {
    it("names what the same period resolves to on the change day", async () => {
      createWrapper({
        preset: "dashboard",
        range: { kind: "calendar", unit: "quarter", offset: -2 },
      });
      await flushPromises();
      await openMenu();

      const hint = wrapper!.vm.resolvedLine.changes?.hint;
      expect(hint).toBe(tr("dateTime.becomesOn", { dates: "Jul 1 – Sep 30, 2026", when: "Jan 1" }));
    });

    it("keeps the running period for the previous one", async () => {
      createWrapper({
        preset: "dashboard",
        range: { kind: "calendar", unit: "quarter", offset: -1 },
      });
      await flushPromises();
      await openMenu();

      const hint = wrapper!.vm.resolvedLine.changes?.hint;
      expect(hint).toBe(tr("dateTime.becomesOn", { dates: "Oct 1 – Dec 31, 2026", when: "Jan 1" }));
    });
  });
});
