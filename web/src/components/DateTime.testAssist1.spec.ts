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
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

const NOW = new Date("2026-11-16T10:00:00Z");
const IST = "Asia/Calcutta";
const tr = (key: string) => String((i18n.global.t as unknown as (k: string) => string)(key));

describe("DateTime test-assist pass 1 (B3, B6, B7)", () => {
  let wrapper: VueWrapper<InstanceType<typeof DateTime>> | null = null;

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
  const typeInto = async (dataTest: string, value: string) => {
    const field = input(dataTest);
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
  };
  const commit = async (dataTest: string, value: string) => {
    await typeInto(dataTest, value);
    input(dataTest).dispatchEvent(new Event("change", { bubbles: true }));
    input(dataTest).dispatchEvent(new FocusEvent("blur"));
    await flushPromises();
  };

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
    vi.restoreAllMocks();
  });

  describe("B3: trigger tooltip", () => {
    const focusTrigger = async (focusVisible: boolean) => {
      const button = el("date-time-btn")!;
      const matches = button.matches.bind(button);
      vi.spyOn(button, "matches").mockImplementation((selector: string) =>
        selector === ":focus-visible" ? focusVisible : matches(selector),
      );
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], now: NOW });
      button.dispatchEvent(new FocusEvent("focus"));
      vi.advanceTimersByTime(450);
      vi.useFakeTimers({ toFake: ["Date"], now: NOW });
      await flushPromises();
    };

    it("stays closed when focus returns to the trigger after a mouse pick", async () => {
      createWrapper();
      await flushPromises();
      await focusTrigger(false);
      expect(wrapper!.vm.triggerTooltipOpen).toBe(false);
    });

    it("opens on keyboard focus", async () => {
      createWrapper();
      await flushPromises();
      await focusTrigger(true);
      expect(wrapper!.vm.triggerTooltipOpen).toBe(true);
    });
  });

  describe("B6: Start field from a live range", () => {
    it("keeps unreadable text in the field with its error", async () => {
      createWrapper();
      await flushPromises();
      await openCalendar();
      await commit("datetime-start-time", "garbage");

      expect(input("datetime-start-time").value).toBe("garbage");
      expect(el("date-time-input-error")?.textContent).toContain(tr("common.timeRangeInputError"));
    });

    it("keeps every keystroke typed after an unreadable entry, and Tab takes it", async () => {
      createWrapper();
      await flushPromises();
      await openCalendar();
      await commit("datetime-start-time", "garbage");

      for (const typed of ["N", "No", "Nov", "Nov 15", "Nov 15 2pm"]) {
        await typeInto("datetime-start-time", typed);
        expect(input("datetime-start-time").value).toBe(typed);
      }
      await commit("datetime-start-time", "Nov 15 2pm");

      expect(input("datetime-start-time").value).toBe("Nov 15, 14:00");
      expect(input("datetime-end-time").value).not.toBe("");
      expect(el("date-time-input-error")).toBeNull();
      expect(el("date-time-resolved-name")?.textContent?.trim()).not.toBe("");
    });
  });

  describe("B7: unreadable paste", () => {
    it.each(["not a date range at all", "2026-01-01T25:00"])(
      "says it did not catch %s and keeps the range",
      async (text) => {
        createWrapper();
        await openMenu();
        Object.assign(navigator.clipboard, { readText: () => Promise.resolve(text) });
        const emitsBefore = (wrapper!.emitted("on:date-change") ?? []).length;

        await wrapper!.vm.pasteRange();
        await flushPromises();

        expect(el("date-time-input-error")?.textContent).toContain(
          tr("common.timeRangeInputError"),
        );
        expect(wrapper!.emitted("on:date-change") ?? []).toHaveLength(emitsBefore);
        expect(wrapper!.vm.getConsumableDateTime().relativeTimePeriod).toBe("15m");
        Reflect.deleteProperty(navigator.clipboard, "readText");
      },
    );
  });

  describe("TC-02: Next after a pasted fixed range", () => {
    it("steps the pasted window forward instead of returning to the live range it replaced", async () => {
      const startUs = 1_784_800_800_000_000;
      const endUs = 1_784_804_400_000_000;
      const hourUs = 3_600_000_000;
      createWrapper();
      await openMenu();
      Object.assign(navigator.clipboard, {
        readText: () => Promise.resolve(`${startUs} - ${endUs}`),
      });
      await wrapper!.vm.pasteRange();
      await flushPromises();
      wrapper!.vm.onApplyClick();
      await flushPromises();
      Reflect.deleteProperty(navigator.clipboard, "readText");

      wrapper!.vm.shiftTimeRange("next");
      await flushPromises();

      const events = (wrapper!.emitted("on:date-change") ?? []) as unknown[][];
      expect(events[events.length - 1][0]).toMatchObject({
        valueType: "absolute",
        startTime: startUs + hourUs,
        endTime: endUs + hourUs,
      });
    });
  });
});
