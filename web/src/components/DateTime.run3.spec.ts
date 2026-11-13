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

const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastMock }));

const NOW = new Date("2026-11-12T15:54:10Z");
const IST = "Asia/Calcutta";
const micros = (iso: string) => Date.parse(iso) * 1000;
const HISTORY_KEY = timeRangeHistoryKey("default", "example@gmail.com");

describe("DateTime QA run 3", () => {
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

  describe("C7 lit chip", () => {
    it("applies the lit chip again and closes on a real click", async () => {
      createWrapper({ defaultRelativeTime: "15m" });
      await flushPromises();
      await openMenu();
      const before = emits();

      el("date-time-chip-15m")!.click();
      await flushPromises();

      expect(emits()).toBe(before + 1);
      expect(lastEmit()).toMatchObject({
        relativeTimePeriod: "15m",
        userChangedValue: true,
        rerun: true,
      });
      expect(wrapper!.vm.menuOpen).toBe(false);
    });
  });

  describe("C2 Apply follows the bar", () => {
    const openCalendarWithPicks = async () => {
      createWrapper(fixedProps("2026-11-10T00:00:00Z", "2026-11-10T01:00:00Z"));
      await flushPromises();
      await openMenu();
      wrapper!.vm.openCalendar();
      await flushPromises();
    };
    const applyButton = () => el("date-time-apply-btn") as HTMLButtonElement;

    it("turns Apply off for unreadable text even after calendar picks", async () => {
      await openCalendarWithPicks();
      await typeInBar("asdf");

      expect(applyButton().disabled).toBe(true);
      expect(String(wrapper!.vm.applyBlockedReason)).toBe("Didn’t catch that");
    });

    it("turns Apply off for a future-only reading even after calendar picks", async () => {
      await openCalendarWithPicks();
      await typeInBar("tomorrow");

      expect(applyButton().disabled).toBe(true);
      expect(String(wrapper!.vm.applyBlockedReason)).toBe("That is in the future. Latest is now.");
    });

    it("lets a readable typed range apply before any calendar pick", async () => {
      createWrapper({ defaultRelativeTime: "15m" });
      await flushPromises();
      await openMenu();
      wrapper!.vm.openCalendar();
      await flushPromises();
      await typeInBar("Nov 4 - 6");

      expect(applyButton().disabled).toBe(false);
      applyButton().click();
      await flushPromises();
      expect(lastEmit()).toMatchObject({ startTime: micros("2026-11-03T18:30:00Z") });
    });
  });

  describe("P8 pin name field", () => {
    it("stretches the name field over the free width and shows the Enter key", async () => {
      localStorage.setItem(
        HISTORY_KEY,
        JSON.stringify([
          { startUs: micros("2026-11-12T10:00:00Z"), endUs: micros("2026-11-12T10:02:00Z") },
        ]),
      );
      createWrapper();
      await openMenu();

      wrapper!.vm.pinRecentRow("recent-0");
      await flushPromises();

      const input = el("date-time-list-pin-name-input")!;
      expect(input.parentElement!.className).toContain("grid-cols-[minmax(0,1fr)]");
      const row = input.closest("[role=option]")!;
      expect(row.querySelector("kbd")).not.toBeNull();
    });
  });

  describe("S7 deep links", () => {
    it("opens a link with an empty period and no readable dates on the default live range", async () => {
      createWrapper({
        defaultType: "absolute",
        defaultAbsoluteTime: { startTime: NaN, endTime: NaN },
      });
      await flushPromises();

      expect(lastEmit()).toMatchObject({ valueType: "relative", relativeTimePeriod: "15m" });
      expect(toastMock).not.toHaveBeenCalled();
    });

    it("refuses a link range wholly in a later year with a warning", async () => {
      createWrapper(fixedProps("2030-01-01T00:00:00Z", "2030-01-02T00:00:00Z"));
      await flushPromises();

      expect(lastEmit()).toMatchObject({ endTime: NOW.getTime() * 1000 });
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: "warning" }));
    });
  });

  describe("fresh#14 live trigger dates", () => {
    it("turns the dashboard trigger's dates over on the minute without a new apply", async () => {
      vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
      vi.setSystemTime(new Date("2026-11-12T15:54:10Z"));
      createWrapper({ defaultRelativeTime: "15m", preset: "dashboard" });
      await flushPromises();
      expect(String(wrapper!.vm.triggerLabel)).toContain("21:24");

      vi.advanceTimersByTime(60_000);
      await flushPromises();

      expect(String(wrapper!.vm.triggerLabel)).toContain("21:25");
    });

    it("never truncates the dashboard name; the dates give way first", async () => {
      createWrapper({ defaultRelativeTime: "24h", preset: "dashboard" });
      await flushPromises();
      expect(el("date-time-trigger-name")!.textContent).toBe("Last 24 hours");
      expect(el("date-time-trigger-name")!.className).toContain("shrink-0");
      expect(el("date-time-trigger-name")!.className).not.toContain("truncate");
      expect(el("date-time-trigger-dates")!.className).toContain("text-ellipsis");
    });
  });

  describe("D-EMPTY", () => {
    it("shows the examples when there are no calendar rows and nothing recent", async () => {
      createWrapper({ calendarPresets: false });
      await openMenu();

      expect(el("date-time-list-heading")!.textContent).toContain("No match yet");
      el("date-time-list-example-0")!.click();
      await flushPromises();
      expect((el("date-time-input-field") as HTMLInputElement).value).toBe("2h");
    });
  });

  describe("D-UNDO", () => {
    it("marks the undo of a drag-zoom so the page runs the range it returns to", async () => {
      createWrapper({ defaultRelativeTime: "1h", undoable: true });
      await flushPromises();
      wrapper!.vm.setCustomDate("absolute", {
        start: Date.parse("2026-11-12T15:00:00Z"),
        end: Date.parse("2026-11-12T15:20:00Z"),
      });
      await flushPromises();

      el("date-time-undo-btn")!.click();
      await flushPromises();

      expect(lastEmit()).toMatchObject({ relativeTimePeriod: "1h", rerun: true });
    });

    it("leaves a plain step undo unmarked", async () => {
      createWrapper({ defaultRelativeTime: "1h", undoable: true });
      await flushPromises();
      wrapper!.vm.shiftTimeRange("prev");
      await flushPromises();

      el("date-time-undo-btn")!.click();
      await flushPromises();

      expect(lastEmit().rerun).toBeUndefined();
    });
  });

  describe("visual", () => {
    it("never truncates a live name in the summary row", async () => {
      createWrapper({ defaultRelativeTime: "1d" });
      await openMenu();

      expect(el("date-time-resolved-name")!.className).toContain("shrink-0");
      expect(el("date-time-resolved-name")!.className).not.toContain("truncate");
    });

    it("leaves Start and End empty in the calendar until a pick from a live range", async () => {
      createWrapper({ defaultRelativeTime: "15m" });
      await openMenu();
      wrapper!.vm.openCalendar();
      await flushPromises();

      const start = document.querySelector<HTMLInputElement>(
        '[data-test="datetime-start-time"] input',
      )!;
      expect(start.value).toBe("");
      expect(start.placeholder).toBe("Start");
    });

    it("gives a disabled row's reason readable secondary text", async () => {
      createWrapper({ retentionDays: 3 });
      await openMenu();

      const reason = document.querySelector<HTMLElement>('[data-test$="-reason"]');
      expect(reason?.className).toContain("text-text-secondary");
    });
  });

  describe("visual #8 typed rows", () => {
    it("lights the first row a filter leaves, as Enter takes it", async () => {
      createWrapper();
      await openMenu();
      await typeInBar("prev");

      const lit = document.querySelectorAll("#date-time-menu [aria-selected='true']");
      expect(lit).toHaveLength(1);
      expect(lit[0].textContent).toContain("Previous");
      expect(lit[0].querySelector("kbd")).not.toBeNull();
    });
  });

  describe("fresh#9 end of day", () => {
    it("labels an exclusive midnight end as the End field's last minute, not the next midnight", async () => {
      createWrapper(fixedProps("2026-11-05T04:00:00Z", "2026-11-07T18:30:00Z"));
      await flushPromises();

      expect(wrapper!.vm.triggerLabel).toBe("Nov 5, 09:30 – Nov 7, 23:59");
    });
  });
});
