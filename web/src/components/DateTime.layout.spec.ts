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
import { getManager } from "@/lib/vue-shortcut-manager/manager";
import { timeRangeHistoryKey } from "@/composables/useTimeRangeHistory";

const { copyMock } = vi.hoisted(() => ({ copyMock: vi.fn() }));
vi.mock("@/utils/clipboard", () => ({ copyToClipboard: copyMock }));

// Thursday 2026-10-08 08:30 in Asia/Calcutta.
const NOW = new Date("2026-10-08T03:00:00Z");
const IST = "Asia/Calcutta";
const micros = (iso: string) => Date.parse(iso) * 1000;
const HISTORY_KEY = timeRangeHistoryKey("default", "example@gmail.com");

describe("DateTime layout", () => {
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

  // jsdom matches attribute values case-insensitively, which would confuse 1-m (minutes) with 1-M (months).
  const el = (dataTest: string) =>
    Array.from(document.querySelectorAll<HTMLButtonElement>("[data-test]")).find(
      (node) => node.getAttribute("data-test") === dataTest,
    ) ?? null;

  const lastEmit = () => {
    const events = wrapper!.emitted("on:date-change") as unknown[][];
    return events[events.length - 1][0] as Record<string, unknown>;
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    store.state.timezone = IST;
    store.state.savedViewFlag = false;
    localStorage.clear();
    copyMock.mockReset();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
    localStorage.clear();
    Reflect.deleteProperty(navigator.clipboard, "readText");
    vi.useRealTimers();
  });

  describe("top bar", () => {
    it("shows Live as a text button only on a fixed range, naming the rolling range it switches to", async () => {
      createWrapper({
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2026-10-08T01:00:00Z"),
          endTime: micros("2026-10-08T02:00:00Z"),
        },
      });
      await flushPromises();
      await openMenu();

      const live = el("date-time-live-btn")!;
      expect(live.getAttribute("aria-label")).toBe("Switch to Last 1h and follow now");
      expect(live.textContent?.trim()).toBe("Live");

      live.click();
      await flushPromises();

      expect(lastEmit()).toMatchObject({ valueType: "relative", relativeTimePeriod: "1h" });
      expect(el("date-time-live-btn")).toBeNull();
    });

    it("puts the paste button inside the paste box, where it pastes the clipboard", async () => {
      const payload = JSON.stringify({
        start_date: micros("2026-10-07T00:00:00Z"),
        end_date: micros("2026-10-07T01:00:00Z"),
      });
      Object.assign(navigator.clipboard, { readText: () => Promise.resolve(payload) });
      createWrapper();
      await openMenu();

      const paste = el("date-time-paste-btn")!;
      expect(el("date-time-input")!.contains(paste)).toBe(true);
      expect(paste.getAttribute("aria-label")).toBe("Paste time range");

      paste.click();
      await flushPromises();
      const field = el("date-time-input-field") as HTMLInputElement;
      expect(field.value).toBe(payload);

      // Vue drops an event stamped no later than its handler attached, which a frozen Date clock always is.
      vi.setSystemTime(Date.now() + 1000);
      field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await flushPromises();

      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-10-07T00:00:00Z"),
        endTime: micros("2026-10-07T01:00:00Z"),
      });
    });

    it("puts the copy button in the top bar, outside the paste box, where it copies the range as readable text", async () => {
      createWrapper({
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2026-10-08T01:00:00Z"),
          endTime: micros("2026-10-08T02:00:00Z"),
        },
      });
      await flushPromises();
      await openMenu();

      const copy = el("date-time-copy-btn")!;
      expect(el("date-time-top-bar")!.contains(copy)).toBe(true);
      expect(el("date-time-input")!.contains(copy)).toBe(false);
      expect(copy.getAttribute("aria-label")).toBe("Copy time range to clipboard");

      copy.click();

      expect(copyMock).toHaveBeenCalledTimes(1);
      expect(copyMock.mock.calls[0][0]).toBe("2026-10-08 06:30 – 07:30 UTC+05:30");
    });

    it("titles an exact range with its span, then its duration in a pill", async () => {
      createWrapper({
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2026-10-08T01:00:00Z"),
          endTime: micros("2026-10-08T02:00:00Z"),
        },
      });
      await flushPromises();
      await openMenu();

      expect(el("date-time-resolved-name")?.textContent).toBe("Oct 8, 06:30 – 07:30");
      expect(el("date-time-resolved-duration")?.textContent).toBe("1h");
    });
    it("shows no duration pill for a relative range, whose name already says its length", async () => {
      createWrapper();
      await openMenu();

      expect(el("date-time-resolved-name")?.textContent).toBe("Last 15 minutes");
      expect(el("date-time-resolved-duration")).toBeNull();
    });
  });

  const typeInBar = async (text: string) => {
    const field = el("date-time-input-field") as HTMLInputElement;
    field.value = text;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
    // The bar reads its text after a short pause, on the real timer.
    await new Promise((resolve) => setTimeout(resolve, 150));
    await flushPromises();
    return field;
  };

  const pressInBar = async (key: string) => {
    vi.setSystemTime(Date.now() + 1000);
    const field = el("date-time-input-field")!;
    field.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    await flushPromises();
  };

  const rows = () =>
    Array.from(
      document.querySelectorAll<HTMLElement>("[data-test='date-time-list'] [role='option']"),
    );
  const rowTests = () => rows().map((row) => row.getAttribute("data-test"));
  const rowText = (row: Element) =>
    Array.from(row.querySelectorAll(":scope > span"))
      .map((part) => part.textContent?.trim())
      .filter(Boolean)
      .join(" ");

  describe("bar-first panel", () => {
    it("keeps one fixed-size stack in list and calendar mode", async () => {
      createWrapper();
      await openMenu();

      const menu = document.getElementById("date-time-menu")!;
      expect(menu.className).toContain("h-82");
      expect(menu.className).toContain("w-110");
      expect(el("date-time-body")!.className).toContain("flex-1");
      expect(el("date-time-chips")).not.toBeNull();
      expect(el("date-time-relative-15-m-btn")).toBeNull();
      expect(el("date-time-custom-value")).toBeNull();
      expect(wrapper!.findComponent({ name: "ODateRangeCalendar" }).exists()).toBe(false);

      el("date-time-pick-dates-btn")!.click();
      await flushPromises();
      expect(wrapper!.findComponent({ name: "ODateRangeCalendar" }).exists()).toBe(true);
      expect(el("date-time-list")).toBeNull();
      expect(el("date-time-body")!.className).toContain("flex-1");
      expect(el("date-time-apply-btn")).not.toBeNull();
    });

    it("never truncates the dates and shows no zone suffix, which the zone select already names", async () => {
      createWrapper();
      await openMenu();
      const name = el("date-time-resolved-name")!;
      expect(el("date-time-resolved-range")!.className).toContain("shrink-0");
      expect(name.textContent).toBe("Last 15 minutes");
      expect(el("date-time-resolved")!.textContent).not.toMatch(/GMT|IST/);
    });

    it("tags every range that re-resolves against now as live, and an exact one as fixed", async () => {
      createWrapper({ defaultRelativeTime: "calendar:day:-1" });
      await openMenu();
      expect(el("date-time-preview-live")?.textContent).toContain("live");
      expect(el("date-time-preview-fixed")).toBeNull();
      wrapper!.vm.pickChip("1h");
      await openMenu();
      expect(el("date-time-preview-live")).not.toBeNull();
    });

    it("offers six chips that apply at once and lights only the one equal to the applied range", async () => {
      createWrapper();
      await openMenu();
      expect(
        Array.from(document.querySelectorAll("[data-test^='date-time-chip-']")).map((node) =>
          node.getAttribute("data-test"),
        ),
      ).toEqual(["15m", "1h", "4h", "24h", "7d", "30d"].map((chip) => `date-time-chip-${chip}`));
      const lit = () =>
        Array.from(
          document.querySelectorAll("[data-test^='date-time-chip-'][data-state='on']"),
        ).map((node) => node.getAttribute("data-test"));
      // The applied 15m equals a chip, so that chip alone is lit.
      expect(lit()).toEqual(["date-time-chip-15m"]);

      el("date-time-chip-4h")!.click();
      await flushPromises();
      expect(lastEmit()).toMatchObject({ valueType: "relative", relativeTimePeriod: "4h" });
      expect(wrapper!.vm.menuOpen).toBe(false);

      await openMenu();
      expect(lit()).toEqual(["date-time-chip-4h"]);
      el("date-time-list-calendar-yesterday")!.click();
      await flushPromises();
      await openMenu();
      expect(lit()).toEqual([]);
    });

    it("starts at the calendar rows on first use, each with the dates it covers", async () => {
      createWrapper();
      await openMenu();

      expect(rowTests()).toEqual(
        [
          "today",
          "yesterday",
          "this-week",
          "last-week",
          "this-month",
          "last-month",
          "this-quarter",
          "last-quarter",
          "year",
          "previous-year",
        ].map((id) => `date-time-list-calendar-${id}`),
      );
      const text = (id: string) => rowText(el(`date-time-list-calendar-${id}`)!);
      expect(text("today")).toBe("Today Oct 8, 00:00 – now");
      expect(text("yesterday")).toBe("Yesterday Oct 7");
      expect(text("this-week")).toBe("This week Oct 4 – now");
      expect(text("last-week")).toBe("Previous week Sep 27 – Oct 3");
      expect(text("last-month")).toBe("Previous month Sep 1 – 30, 2026");
      expect(text("last-quarter")).toBe("Previous quarter Jul 1 – Sep 30, 2026");
    });

    it("lists Recent once, without the applied range or anything a chip or calendar row already offers", async () => {
      localStorage.setItem(
        HISTORY_KEY,
        JSON.stringify([
          { relative: "1h" },
          { relative: "calendar:day:-1" },
          { relative: "15m" },
          { relative: "6h" },
          { startUs: micros("2026-10-07T03:30:00Z"), endUs: micros("2026-10-07T05:30:00Z") },
        ]),
      );
      createWrapper();
      await openMenu();

      const recent = rowTests().filter((id) => id?.startsWith("date-time-list-recent-"));
      expect(recent).toEqual(["date-time-list-recent-3", "date-time-list-recent-4"]);
      expect(el("date-time-list-recent-3")!.textContent).toContain("Last 6 hours");
      expect(el("date-time-list-recent-4")!.textContent).toContain("Oct 7, 09:00 – 11:00");
      expect(el("date-time-list-recent-4")!.textContent).toContain("2h");
    });

    it("keeps absolute ranges in Recent after every chip and calendar row has been picked", async () => {
      const absolute = (hour: number) => ({
        startUs: micros(`2026-10-07T0${hour}:00:00Z`),
        endUs: micros(`2026-10-07T0${hour}:30:00Z`),
      });
      localStorage.setItem(HISTORY_KEY, JSON.stringify([absolute(1), absolute(2), absolute(3)]));
      createWrapper();
      await flushPromises();

      for (const chip of ["15m", "1h", "4h", "24h", "7d", "30d"]) {
        await openMenu();
        el(`date-time-chip-${chip}`)!.click();
        await flushPromises();
      }
      for (const id of ["today", "yesterday", "this-week", "last-week", "this-month"]) {
        await openMenu();
        el(`date-time-list-calendar-${id}`)!.click();
        await flushPromises();
      }

      expect(JSON.parse(localStorage.getItem(HISTORY_KEY)!)).toEqual([
        absolute(1),
        absolute(2),
        absolute(3),
      ]);
      await openMenu();
      expect(rowTests().filter((id) => id?.startsWith("date-time-list-recent-"))).toHaveLength(3);
    });

    it("does not store a picked pin in Recent, which never shows it", async () => {
      const recent = [
        { startUs: micros("2026-10-07T01:00:00Z"), endUs: micros("2026-10-07T01:30:00Z") },
      ];
      localStorage.setItem(HISTORY_KEY, JSON.stringify(recent));
      localStorage.setItem(
        "o2.timeRangePins.default.example@gmail.com",
        JSON.stringify([
          { id: "rel", name: "", range: { relative: "6h" } },
          {
            id: "abs",
            name: "",
            range: {
              startUs: micros("2026-10-06T01:00:00Z"),
              endUs: micros("2026-10-06T02:00:00Z"),
            },
          },
        ]),
      );
      createWrapper();
      await flushPromises();

      for (const id of ["rel", "abs"]) {
        await openMenu();
        el(`date-time-list-pinned-${id}`)!.click();
        await flushPromises();
      }

      expect(lastEmit()).toMatchObject({ valueType: "absolute" });
      expect(JSON.parse(localStorage.getItem(HISTORY_KEY)!)).toEqual(recent);
    });

    it("pins a Recent row to the top, names it, and keeps it apart from Recent", async () => {
      localStorage.setItem(HISTORY_KEY, JSON.stringify([{ relative: "6h" }]));
      createWrapper();
      await openMenu();

      expect(el("date-time-list-recent-0-pin")).toBeNull();
      el("date-time-list-recent-0")!.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
      await flushPromises();
      el("date-time-list-recent-0-pin")!.click();
      await flushPromises();
      const pinned = rows()[0];
      expect(pinned.getAttribute("data-test")).toMatch(/^date-time-list-pinned-/);
      expect(el("date-time-list-recent-0")).toBeNull();
      const edit = wrapper!.findComponent({ name: "OInlineEdit" });
      expect(edit.exists()).toBe(true);

      edit.vm.$emit("commit", "Checkout outage");
      await flushPromises();
      const named = rows()[0];
      expect(named.textContent).toContain("Checkout outage");
      expect(named.textContent).toContain("Last 6 hours");
      const stored = JSON.parse(
        localStorage.getItem("o2.timeRangePins.default.example@gmail.com")!,
      );
      expect(stored).toEqual([
        expect.objectContaining({ name: "Checkout outage", range: { relative: "6h" } }),
      ]);

      named.click();
      await flushPromises();
      expect(lastEmit()).toMatchObject({ relativeTimePeriod: "6h" });

      await openMenu();
      document.querySelector<HTMLElement>("[data-test$='-unpin']")!.click();
      await flushPromises();
      expect(rowTests().some((id) => id?.startsWith("date-time-list-pinned-"))).toBe(false);
    });

    it("does not re-resolve the list when the pointer moves over its rows", async () => {
      createWrapper();
      await openMenu();
      const shown = () => el("date-time-resolved")!.textContent;
      const before = shown();

      vi.setSystemTime(Date.now() + 5 * 60_000);
      rows()[0].dispatchEvent(new MouseEvent("mouseenter"));
      rows()[1].dispatchEvent(new MouseEvent("mouseenter"));
      await flushPromises();

      expect(shown()).toBe(before);
    });

    it("greys rows and dates wholly outside retention and says why", async () => {
      createWrapper({ retentionDays: 7 });
      await openMenu();

      const lastMonth = el("date-time-list-calendar-last-month")!;
      expect(lastMonth.getAttribute("aria-disabled")).toBe("true");
      expect(lastMonth.textContent).toContain("Outside 7-day retention");
      expect(el("date-time-list-calendar-this-month")!.getAttribute("aria-disabled")).toBeNull();

      lastMonth.click();
      await flushPromises();
      expect(wrapper!.vm.calendarToken).toBeNull();

      el("date-time-pick-dates-btn")!.click();
      await flushPromises();
      const calendar = wrapper!.findComponent({ name: "ODateRangeCalendar" });
      expect(calendar.props("unavailableBefore")).toBe("2026/10/01");
      expect(calendar.props("unavailableReason")).toBe("Outside 7-day retention");
    });

    it("greys chips and rows longer than the query-range limit with its message", async () => {
      createWrapper({ queryRangeRestrictionInHour: 24, queryRangeRestrictionMsg: "Max 24 hours" });
      await openMenu();

      expect(el("date-time-chip-24h")?.hasAttribute("disabled")).toBe(false);
      expect(
        el("date-time-chip-7d")?.hasAttribute("disabled") ||
          el("date-time-chip-7d")?.getAttribute("aria-disabled") === "true",
      ).toBe(true);
      expect(el("date-time-list-calendar-last-week")!.getAttribute("aria-disabled")).toBe("true");
      expect(el("date-time-list-calendar-last-week")!.textContent).toContain("Max 1d");
      expect(el("date-time-chips-note-limit")!.textContent).toContain("Max 1d");
    });
  });

  describe("typing", () => {
    it("turns the list into suggestions for a bare number and previews the cursor row", async () => {
      createWrapper();
      await openMenu();
      await typeInBar("3");

      expect(el("date-time-chips")).toBeNull();
      expect(rows().map(rowText)).toEqual([
        "Last 3 minutes 3m ↵",
        "Last 3 hours 3h",
        "Last 3 days 3d",
        "Last 3 weeks 3w",
        "Last 3 months 3mo",
      ]);
      expect(rows()[0].getAttribute("aria-selected")).toBe("true");
      expect(el("date-time-resolved-name")?.textContent).toBe("Last 3 minutes");
      expect(lastEmit().relativeTimePeriod).toBe("15m");
    });

    it("asks months first for 15M", async () => {
      createWrapper();
      await openMenu();
      await typeInBar("15M");

      expect(
        rows().map(
          (row) => row.querySelector("span.text-text-secondary.shrink-0.tabular-nums")?.textContent,
        ),
      ).toEqual(["15mo", "15m"]);
      expect(el("date-time-resolved-name")?.textContent).toBe("Last 15 months");
    });

    it("maps a snap to its calendar row, filters the list to it and applies it on Enter", async () => {
      createWrapper();
      await openMenu();
      await typeInBar("now-1d/d");

      expect(rowTests()).toEqual(["date-time-list-calendar-yesterday"]);
      expect(el("date-time-resolved-name")?.textContent).toBe("Yesterday");
      // A calendar period re-resolves against now, so it is live, never fixed.
      expect(el("date-time-preview-live")).not.toBeNull();
      expect(el("date-time-preview-fixed")).toBeNull();

      await pressInBar("Enter");
      expect(lastEmit()).toMatchObject({ relativeTimePeriod: "calendar:day:-1" });
    });

    it("previews a snap with no calendar equivalent as fixed", async () => {
      createWrapper();
      await openMenu();
      await typeInBar("-1d@d+9h");

      expect(el("date-time-resolved-name")?.textContent).toBe("Oct 7, 09:00 – Oct 8, 08:30");
      expect(el("date-time-preview-fixed")).not.toBeNull();
    });

    it("filters by word prefix and moves from the bar into the list with the arrows", async () => {
      createWrapper();
      await openMenu();
      await typeInBar("prev");

      expect(rowTests()).toEqual([
        "date-time-list-calendar-last-week",
        "date-time-list-calendar-last-month",
        "date-time-list-calendar-last-quarter",
        "date-time-list-calendar-previous-year",
      ]);
      expect(rows()[0].querySelector("strong")?.textContent).toBe("Prev");

      await pressInBar("ArrowDown");
      await pressInBar("ArrowDown");
      expect(rows()[1].getAttribute("aria-selected")).toBe("true");
      await pressInBar("Enter");
      expect(lastEmit()).toMatchObject({ relativeTimePeriod: "calendar:month:-1" });
    });

    it("enters the list from an empty bar and backs out with Escape", async () => {
      createWrapper();
      await openMenu();

      await pressInBar("ArrowDown");
      expect(rows()[0].getAttribute("aria-selected")).toBe("true");
      await pressInBar("Escape");
      expect(rows().some((row) => row.getAttribute("aria-selected") === "true")).toBe(false);
      expect(wrapper!.vm.menuOpen).toBe(true);
    });
  });

  describe("calendar mode", () => {
    it("swaps in the calendar from Pick dates and returns to the list on Escape", async () => {
      createWrapper();
      await openMenu();
      el("date-time-pick-dates-btn")!.click();
      await flushPromises();
      expect(el("datetime-start-time")).not.toBeNull();

      el("datetime-start-time")!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await flushPromises();
      expect(wrapper!.vm.calendarMode).toBe(false);
      expect(wrapper!.vm.menuOpen).toBe(true);
      expect(el("date-time-list")).not.toBeNull();
    });

    it("opens a dates-only picker straight into its calendar", async () => {
      createWrapper({ disableRelative: true, minDate: "2026/01/01" });
      await openMenu();
      expect(wrapper!.findComponent({ name: "ODateRangeCalendar" }).exists()).toBe(true);
      expect(el("date-time-calendar-back-btn")).toBeNull();
    });
  });

  describe("trigger", () => {
    it("labels an exact range compactly and whole days without times", async () => {
      createWrapper({
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2026-10-08T01:00:00Z"),
          endTime: micros("2026-10-08T02:00:00Z"),
        },
      });
      await flushPromises();
      expect(wrapper!.vm.triggerLabel).toBe("Oct 8, 06:30 – 07:30");

      wrapper!.vm.setAbsoluteTime(micros("2026-10-02T18:30:00Z"), micros("2026-10-05T18:29:59Z"));
      wrapper!.vm.refresh();
      await flushPromises();
      expect(wrapper!.vm.triggerLabel).toBe("Oct 3 – 5");
    });

    it("shows a zone badge only when the picker's zone differs from the browser's", async () => {
      createWrapper();
      await flushPromises();
      expect(el("date-time-zone-badge")?.textContent?.trim()).toBe("UTC+05:30");
      wrapper!.unmount();

      store.state.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      createWrapper();
      await flushPromises();
      expect(el("date-time-zone-badge")).toBeNull();
    });

    it("follows a DST change in the zone select's offset", async () => {
      store.state.timezone = "America/New_York";
      vi.setSystemTime(new Date("2026-10-31T12:00:00Z"));
      createWrapper();
      await openMenu();
      expect(el("datetime-timezone-short")?.textContent?.trim()).toBe("UTC-04:00");

      wrapper!.vm.menuOpen = false;
      await flushPromises();
      vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
      await openMenu();
      expect(el("datetime-timezone-short")?.textContent?.trim()).toBe("UTC-05:00");
    });

    it("offers undo after a zoom out, naming the range it returns to", async () => {
      createWrapper();
      await flushPromises();
      expect(el("date-time-undo-btn")).toBeNull();

      el("date-time-zoom-out-btn")!.click();
      await flushPromises();
      expect(lastEmit().relativeTimePeriod).toBe("30m");
      const undo = el("date-time-undo-btn")!;
      expect(undo.getAttribute("aria-label")).toBe("Back to Last 15 minutes");

      undo.click();
      await flushPromises();
      expect(lastEmit().relativeTimePeriod).toBe("15m");
      expect(wrapper!.emitted("on:undo")).toHaveLength(1);
      expect(el("date-time-undo-btn")).toBeNull();
    });

    it("drops undo after an explicit pick", async () => {
      createWrapper();
      await flushPromises();
      el("date-time-prev-btn")!.click();
      await flushPromises();
      expect(el("date-time-undo-btn")).not.toBeNull();

      await openMenu();
      el("date-time-chip-1h")!.click();
      await flushPromises();
      expect(el("date-time-undo-btn")).toBeNull();
    });

    it.each([
      [
        "a saved view",
        (vm: any) => vm.setSavedDate({ type: "relative", relativeTimePeriod: "6h" }),
      ],
      ["a relative range", (vm: any) => vm.setRelativeTime("6h")],
      [
        "an absolute range",
        (vm: any) =>
          vm.setAbsoluteTime(micros("2026-10-07T01:00:00Z"), micros("2026-10-07T02:00:00Z")),
      ],
    ])("drops undo when the page sets %s", async (_, set) => {
      createWrapper();
      await flushPromises();
      el("date-time-zoom-out-btn")!.click();
      await flushPromises();
      expect(el("date-time-undo-btn")).not.toBeNull();

      set(wrapper!.vm);
      await flushPromises();
      expect(el("date-time-undo-btn")).toBeNull();
    });

    it("keeps undo when the page hands the zoomed range straight back", async () => {
      createWrapper();
      await flushPromises();
      el("date-time-zoom-out-btn")!.click();
      await flushPromises();

      wrapper!.vm.setSavedDate({
        type: "relative",
        relativeTimePeriod: lastEmit().relativeTimePeriod,
      });
      wrapper!.vm.setRelativeTime(lastEmit().relativeTimePeriod as string);
      await flushPromises();
      expect(el("date-time-undo-btn")).not.toBeNull();
    });

    it("keeps undo when the page answers a shift with a corrected range while it is emitted", async () => {
      const clampedStart = micros("2026-10-08T01:30:00Z");
      createWrapper({
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2026-10-08T01:00:00Z"),
          endTime: micros("2026-10-08T02:00:00Z"),
        },
        "onOn:date-change": (value: Record<string, number>) => {
          if (wrapper && value.startTime < clampedStart) {
            wrapper.vm.setAbsoluteTime(clampedStart, value.endTime);
          }
        },
      });
      await flushPromises();
      el("date-time-prev-btn")!.click();
      await flushPromises();
      expect(el("date-time-undo-btn")).not.toBeNull();
    });

    it("keeps undo when the page hands back the exact range a shift emitted", async () => {
      createWrapper({
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2026-10-08T01:00:00Z"),
          endTime: micros("2026-10-08T02:00:00Z"),
        },
      });
      await flushPromises();
      el("date-time-prev-btn")!.click();
      await flushPromises();

      const { startTime, endTime } = lastEmit();
      wrapper!.vm.setSavedDate({ type: "absolute", startTime, endTime });
      wrapper!.vm.setAbsoluteTime(startTime as number, endTime as number);
      await flushPromises();
      expect(el("date-time-undo-btn")).not.toBeNull();
    });

    it("reads a drag-zoom in the app zone when the picker keeps its own zone", async () => {
      createWrapper({ pickerTimezone: "UTC" });
      await flushPromises();
      const start = Date.UTC(2026, 9, 8, 1, 0);
      const end = Date.UTC(2026, 9, 8, 1, 30);
      // Charts shift each instant into the app zone (IST here) before handing it over.
      const shift = (ms: number) => ms + 330 * 60_000;
      wrapper!.vm.setCustomDate("absolute", { start: shift(start), end: shift(end) });
      await flushPromises();

      expect(wrapper!.vm.getConsumableDateTime()).toMatchObject({
        startTime: start * 1000,
        endTime: end * 1000,
      });
      expect(wrapper!.vm.selectedTime).toEqual({ startTime: "01:00:00", endTime: "01:30:00" });
    });

    it("bounds a drag-zoom by maxDate on true instants and cuts its end there exactly", async () => {
      createWrapper({ maxDate: "2026/10/08" });
      await flushPromises();
      const shift = (ms: number) => ms + 330 * 60_000;
      const start = Date.UTC(2026, 9, 8, 17, 0);
      const end = Date.UTC(2026, 9, 8, 19, 30);
      wrapper!.vm.setCustomDate("absolute", { start: shift(start), end: shift(end) });
      await flushPromises();

      expect(wrapper!.vm.getConsumableDateTime()).toMatchObject({
        startTime: start * 1000,
        endTime: micros("2026-10-08T18:30:00Z"),
      });
    });
  });

  describe("shortcuts", () => {
    const press = async (key: string, init: KeyboardEventInit = {}) => {
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
      await flushPromises();
    };

    it("opens on T and steps, zooms and undoes with [ ] - Z", async () => {
      createWrapper({ shortcuts: true });
      await flushPromises();

      await press("-");
      expect(lastEmit().relativeTimePeriod).toBe("30m");
      await press("z");
      expect(lastEmit().relativeTimePeriod).toBe("15m");
      await press("[");
      expect(lastEmit().valueType).toBe("absolute");
      await press("t");
      expect(wrapper!.vm.menuOpen).toBe(true);
    });

    it("leaves the keys to the page toolbar picker, never a panel picker mounted after it", async () => {
      createWrapper({ shortcuts: true });
      const toolbar = wrapper!;
      const panel = mount(DateTime, {
        props: { autoApply: true },
        attachTo: document.body,
        global: { plugins: [i18n, store] },
      });
      await flushPromises();

      await press("t");
      expect(toolbar.vm.menuOpen).toBe(true);
      expect(panel.vm.menuOpen).toBe(false);
      panel.unmount();
    });

    it("drops and retakes the keys when the page turns its shortcuts off and on", async () => {
      createWrapper({ shortcuts: true });
      await flushPromises();
      await wrapper!.setProps({ shortcuts: false });
      await press("t");
      expect(wrapper!.vm.menuOpen).toBe(false);

      await wrapper!.setProps({ shortcuts: true });
      await press("t");
      expect(wrapper!.vm.menuOpen).toBe(true);
    });

    it("binds no keys for a picker that does not own them", async () => {
      createWrapper();
      await flushPromises();
      await press("t");
      expect(wrapper!.vm.menuOpen).toBe(false);
    });

    it("copies the range on Alt+Shift+C off macOS while the panel is open, leaving the page's Ctrl+Shift+C alone", async () => {
      const manager = getManager()!;
      const scope = manager.acquireScope("traces");
      const pageCopy = vi.fn();
      const id = manager.register({ key: "ctrl+shift+c", scope: "traces", handler: pageCopy });
      try {
        createWrapper({ shortcuts: true });
        await openMenu();
        const field = el("date-time-input-field")!;
        field.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Ç",
            code: "KeyC",
            altKey: true,
            shiftKey: true,
            bubbles: true,
          }),
        );
        await flushPromises();
        expect(copyMock).toHaveBeenCalledTimes(1);
        expect(pageCopy).not.toHaveBeenCalled();

        wrapper!.vm.onMenuOpenChange(false);
        wrapper!.vm.menuOpen = false;
        await flushPromises();
        await press("C", { ctrlKey: true, shiftKey: true });
        expect(pageCopy).toHaveBeenCalledTimes(1);
        expect(copyMock).toHaveBeenCalledTimes(1);
      } finally {
        manager.unregisterById(id);
        manager.releaseScope(scope);
      }
    });
  });
});
