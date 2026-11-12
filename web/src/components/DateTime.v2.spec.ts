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

const { copyMock, trackMock } = vi.hoisted(() => ({ copyMock: vi.fn(), trackMock: vi.fn() }));
vi.mock("@/utils/clipboard", () => ({ copyToClipboard: copyMock }));
vi.mock("@/utils/timeInputFailure", () => ({ reportParseFailure: trackMock }));

const NOW = new Date("2026-11-12T15:54:10Z");
const IST = "Asia/Calcutta";
const micros = (iso: string) => Date.parse(iso) * 1000;
const HISTORY_KEY = timeRangeHistoryKey("default", "example@gmail.com");

describe("DateTime v2", () => {
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

  const rows = () =>
    Array.from(
      document.querySelectorAll<HTMLElement>("[data-test='date-time-list'] [role='option']"),
    );

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

  const pressInBar = async (key: string, init: KeyboardEventInit = {}) => {
    vi.setSystemTime(Date.now() + 1000);
    el("date-time-input-field")!.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, ...init }),
    );
    await flushPromises();
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    store.state.timezone = IST;
    store.state.savedViewFlag = false;
    localStorage.clear();
    copyMock.mockReset();
    trackMock.mockReset();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
    localStorage.clear();
    vi.useRealTimers();
  });

  describe("label and trigger", () => {
    it("shows seconds on a fixed trigger and opens a two-line tooltip with stamps, zone, kind and length", async () => {
      createWrapper({
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2026-11-12T15:38:49.948Z"),
          endTime: micros("2026-11-12T15:48:49.948Z"),
        },
      });
      await flushPromises();

      expect(wrapper!.vm.triggerLabel).toBe("Nov 12, 21:08:49 – 21:18:49");
      expect(wrapper!.vm.triggerTooltip?.stamps).toContain("21:08:49.948");
      expect(wrapper!.vm.triggerTooltip?.detail).toBe("UTC+05:30 · fixed · 10m");
      expect(el("date-time-btn")!.getAttribute("aria-label")).toBe(
        "Time range: Nov 12, 21:08:49 – 21:18:49, UTC+05:30",
      );
    });

    it("keeps the exact sub-second bounds of an applied range", async () => {
      createWrapper({
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2026-11-12T15:38:49.948Z"),
          endTime: micros("2026-11-12T15:48:49.948Z"),
        },
      });
      await flushPromises();
      await openMenu();
      await typeInBar("2026-11-12T15:43:49.948Z");
      await pressInBar("Enter");

      expect(lastEmit()).toMatchObject({
        startTime: micros("2026-11-12T15:38:49.948Z"),
        endTime: micros("2026-11-12T15:48:49.948Z"),
      });
    });

    it("names a live range with its dates and an always-on zone badge on a dashboard", async () => {
      createWrapper({
        preset: "dashboard",
        zoneBadge: "always",
        defaultRelativeTime: "calendar:quarter:0",
      });
      await flushPromises();

      expect(wrapper!.vm.triggerLabel).toBe("This quarter · Oct 1 – Nov 12, 2026");
      expect(el("date-time-zone-badge")?.textContent).toBe("UTC+05:30");
    });

    it("names the window each step moves to, and says when next is already at now", async () => {
      createWrapper({ defaultRelativeTime: "15m" });
      await flushPromises();

      expect(wrapper!.vm.stepTooltip.prev.title).toBe("Previous 15m");
      expect(wrapper!.vm.stepTooltip.prev.window).toBe("Nov 12, 20:54:10 – 21:09:10");
      expect(wrapper!.vm.stepTooltip.next.title).toBe("Already at now");
      expect(wrapper!.vm.stepTooltip.zoom).toBe("Zoom out to 30m");
    });

    it("shows a funnel on the trigger and a strip note when the query narrows the range", async () => {
      createWrapper({
        narrowedByQuery: {
          startUs: micros("2026-11-12T15:45:00Z"),
          endUs: micros("2026-11-12T15:50:00Z"),
        },
      });
      await flushPromises();
      expect(el("date-time-trigger-narrowed")).not.toBeNull();
      await openMenu();
      expect(el("date-time-chips-note-narrowed")?.textContent).toContain("narrowed by query");
    });
  });

  describe("presets", () => {
    it("gives dashboards long chips and quarter-first calendar rows", async () => {
      createWrapper({ preset: "dashboard" });
      await openMenu();

      const chips = Array.from(document.querySelectorAll("[data-test^='date-time-chip-']")).map(
        (chip) => chip.getAttribute("data-test"),
      );
      expect(chips).toEqual(
        ["24h", "7d", "30d", "90d", "6mo", "1y"].map((chip) => `date-time-chip-${chip}`),
      );
      expect(rows()[0].getAttribute("data-test")).toBe("date-time-list-calendar-this-quarter");

      el("date-time-chip-6mo")!.click();
      await flushPromises();
      expect(lastEmit()).toMatchObject({ relativeTimePeriod: "6M" });
    });
  });

  describe("typing", () => {
    it("lists windows around a pasted instant, preferring ± 5 min, and applies the cursor row", async () => {
      createWrapper();
      await openMenu();
      await typeInBar("1794498229948025");

      expect(rows().map((row) => row.getAttribute("data-test"))).toEqual([
        "date-time-list-anchor-5m",
        "date-time-list-anchor-1m",
        "date-time-list-anchor-30s",
        "date-time-list-anchor-5s",
        "date-time-list-anchor-to-now",
      ]);
      expect(rows()[0].getAttribute("aria-selected")).toBe("true");
      expect(el("date-time-resolved-name")?.textContent).toBe(
        "± 5 min around Nov 12, 21:13:49.948",
      );
      expect(el("date-time-preview-note")?.textContent).toBe("read as epoch µs");

      await pressInBar("ArrowDown");
      await pressInBar("Enter");
      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: 1794498229948025 - 60_000_000,
        endTime: 1794498229948025 + 60_000_000,
      });
    });

    it("teaches the grammar with examples instead of a blank list, and an example fills the bar", async () => {
      createWrapper();
      await openMenu();
      await typeInBar("checkout");

      expect(el("date-time-list-heading")?.textContent?.trim()).toBe("No match yet. You can type:");
      expect(rows().map((row) => row.getAttribute("data-test"))).toEqual(
        [0, 1, 2, 3, 4].map((n) => `date-time-list-example-${n}`),
      );
      expect(rows().some((row) => row.getAttribute("aria-selected") === "true")).toBe(false);

      rows()[0].click();
      await flushPromises();
      expect((el("date-time-input-field") as HTMLInputElement).value).toBe("2h");
    });

    it("says why unreadable text failed on Enter and counts it without the text", async () => {
      createWrapper();
      await openMenu();
      await typeInBar("checkout");
      await pressInBar("Enter");

      expect(el("date-time-input-error")?.textContent).toContain("Didn’t catch that");
      expect(trackMock).toHaveBeenCalledWith("checkout", "unreadable");
    });

    it("previews a typed whole-day range with an exclusive end the backend reads in full", async () => {
      createWrapper();
      await openMenu();
      await typeInBar("Nov 4 - 6");
      await pressInBar("Enter");

      expect(lastEmit()).toMatchObject({
        startTime: micros("2026-11-03T18:30:00Z"),
        endTime: micros("2026-11-06T18:30:00Z"),
      });
      expect(wrapper!.vm.selectedTime).toEqual({ startTime: "00:00:00", endTime: "23:59:59" });
    });
  });

  describe("list cursor", () => {
    it("moves the one cursor with the pointer and pins or removes the cursor row by key", async () => {
      localStorage.setItem(HISTORY_KEY, JSON.stringify([{ relative: "6h" }, { relative: "3h" }]));
      createWrapper();
      await openMenu();

      const recent = el("date-time-list-recent-0")!;
      expect(el("date-time-list-recent-0-pin")).toBeNull();
      recent.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
      await flushPromises();
      expect(recent.getAttribute("aria-selected")).toBe("true");
      expect(el("date-time-list-recent-0-pin")).not.toBeNull();
      expect(el("date-time-list-recent-0-remove")).not.toBeNull();

      await pressInBar("Delete");
      expect(JSON.parse(localStorage.getItem(HISTORY_KEY)!)).toEqual([{ relative: "3h" }]);

      el("date-time-list-recent-1")?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
      await flushPromises();
      wrapper!.vm.setCursorRow(rows().findIndex((row) => row.dataset.test?.includes("recent")));
      await flushPromises();
      await pressInBar("π", { code: "KeyP", altKey: true });
      expect(wrapper!.vm.editingPinRowId).toMatch(/^pinned-/);
    });
  });

  describe("calendar", () => {
    it("disables Apply from a live range until a start is picked", async () => {
      createWrapper();
      await openMenu();
      wrapper!.vm.openCalendar();
      await flushPromises();

      expect(wrapper!.vm.applyDisabled).toBe(true);
      wrapper!.vm.onCalendarPendingDay("2026/11/04");
      await flushPromises();
      expect(wrapper!.vm.applyDisabled).toBe(false);
      expect(el("date-time-resolved-name")?.textContent).toBe("Nov 4");
      expect(el("date-time-preview-note")?.textContent).toBe("pick the end date");

      wrapper!.vm.calendarPreviewDay = "2026/11/09";
      await flushPromises();
      expect(el("date-time-resolved-name")?.textContent).toBe("Nov 4 – 9");
    });
  });

  describe("zone change", () => {
    it("redraws a fixed range in the new zone without moving its instants or querying", async () => {
      createWrapper({
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2026-11-12T10:12:10Z"),
          endTime: micros("2026-11-12T10:14:30Z"),
        },
      });
      await flushPromises();
      await openMenu();
      const emits = (wrapper!.emitted("on:date-change") ?? []).length;

      wrapper!.vm.timezone = "UTC";
      await wrapper!.vm.onTimezoneChange();
      await flushPromises();

      expect((wrapper!.emitted("on:date-change") ?? []).length).toBe(emits);
      expect(wrapper!.vm.getConsumableDateTime()).toMatchObject({
        startTime: micros("2026-11-12T10:12:10Z"),
        endTime: micros("2026-11-12T10:14:30Z"),
      });
      expect(wrapper!.vm.selectedTime).toEqual({ startTime: "10:12:10", endTime: "10:14:30" });
      expect(el("date-time-preview-note")?.textContent).toBe("same window");
    });
  });

  describe("steps", () => {
    it("returns to the live range a chain began from once ] reaches now", async () => {
      createWrapper({ defaultRelativeTime: "15m" });
      await flushPromises();

      wrapper!.vm.shiftTimeRange("prev");
      await flushPromises();
      expect(lastEmit()).toMatchObject({ valueType: "absolute" });

      wrapper!.vm.shiftTimeRange("next");
      await flushPromises();
      expect(lastEmit()).toMatchObject({ valueType: "relative", relativeTimePeriod: "15m" });
    });
  });

  describe("go live", () => {
    it("applies the live range at once on a picker that otherwise waits for Apply", async () => {
      createWrapper({
        autoApply: false,
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2026-11-12T10:00:00Z"),
          endTime: micros("2026-11-12T10:10:00Z"),
        },
      });
      await flushPromises();
      const emits = (wrapper!.emitted("on:date-change") ?? []).length;

      wrapper!.vm.goLive();
      await flushPromises();

      expect((wrapper!.emitted("on:date-change") ?? []).length).toBe(emits + 1);
      expect(lastEmit()).toMatchObject({ valueType: "relative", relativeTimePeriod: "10m" });
      expect(wrapper!.vm.triggerLabel).toBe("Last 10 minutes");
    });
  });

  describe("copy", () => {
    it("copies a live range as its name and stamps, which the bar reads back", async () => {
      createWrapper({ defaultRelativeTime: "15m" });
      await openMenu();
      el("date-time-copy-btn")!.click();

      expect(copyMock.mock.calls[0][0]).toBe(
        "Last 15 minutes (2026-11-12 21:09 – 21:24 UTC+05:30)",
      );
    });
  });
});
