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
import { getManager, resetManager } from "@/lib/vue-shortcut-manager";

const copyToClipboard = vi.hoisted(() => vi.fn());
vi.mock("@/utils/clipboard", () => ({ copyToClipboard }));

// Saturday 2026-11-07 10:00 in Asia/Calcutta; the test browser runs in UTC.
const NOW = new Date("2026-11-07T04:30:00Z");
const IST = "Asia/Calcutta";
const micros = (iso: string) => Date.parse(iso) * 1000;
const HOUR_US = 3_600_000_000;

type Payload = Record<string, unknown> & { startTime: number; endTime: number };

describe("DateTime v4 panel", () => {
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

  // What reka does on an outside click (Run query included): the popover asks to close.
  const closeOutside = async () => {
    wrapper!.vm.onMenuOpenChange(false);
    wrapper!.vm.menuOpen = false;
    await flushPromises();
  };

  // jsdom matches attribute values case-insensitively, which would confuse 1-m (minutes) with 1-M (months).
  const el = (dataTest: string) =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-test]")).find(
      (node) => node.getAttribute("data-test") === dataTest,
    ) ?? null;
  const input = () =>
    document.querySelector<HTMLInputElement>('[data-test="date-time-range-input"] input')!;

  const typeText = async (text: string) => {
    input().value = text;
    input().dispatchEvent(new Event("input"));
    wrapper!.vm.onFieldDraft(text);
    await flushPromises();
  };
  const pasteText = async (text: string) => {
    tick();
    input().dispatchEvent(new Event("paste"));
    input().value = text;
    input().dispatchEvent(new Event("input"));
    await flushPromises();
  };
  // Vue skips a parent listener for an event stamped no later than its mount, which a frozen clock always is.
  const tick = () => vi.setSystemTime(Date.now() + 1);
  const pressKey = async (key: string, target: HTMLElement = input()) => {
    tick();
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    await flushPromises();
  };

  const emits = () => (wrapper!.emitted("on:date-change") ?? []) as Payload[][];
  const lastEmit = () => emits()[emits().length - 1][0];
  const lineRange = () => el("date-time-range-summary-range")?.textContent?.trim();
  const noteText = () => el("date-time-range-note")?.textContent?.trim() ?? "";

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    store.state.timezone = IST;
    store.state.savedViewFlag = false;
    localStorage.clear();
    copyToClipboard.mockClear();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
    localStorage.clear();
    resetManager();
    vi.useRealTimers();
  });

  describe("layout", () => {
    it("opens on the field holding the applied range, selected, with the hint and the two sections", async () => {
      createWrapper();
      await openMenu();
      await flushPromises();

      expect(input().value).toBe("Past 15 Minutes");
      expect(document.activeElement).toBe(input());
      expect(input().selectionStart).toBe(0);
      expect(input().selectionEnd).toBe("Past 15 Minutes".length);
      expect(el("date-time-range-hint")?.textContent).toContain("Type or paste a range");
      expect(el("date-time-quick-ranges")?.textContent).toContain("Quick ranges");
      expect(el("date-time-custom-range")?.textContent).toContain("Custom range");
      expect(lineRange()).toBe("Nov 7, 09:45:00 – 10:00:00");
      expect(el("date-time-range-kind")?.textContent).toContain("ending now");
      expect(el("date-time-zoom-out-btn")).not.toBeNull();
    });

    it("has no Relative/Absolute tabs and lays the twelve relative chips out as unit rows", async () => {
      createWrapper();
      await openMenu();

      expect(el("date-time-type-toggle")).toBeNull();
      expect(el("date-time-relative-tab")).toBeNull();
      expect(el("date-time-absolute-tab")).toBeNull();
      const chips = Array.from(
        document.querySelectorAll('[data-test="date-time-helpers-relative"] [data-test]'),
      ).map((node) => node.getAttribute("data-test"));
      expect(chips).toEqual(
        [
          "5-m",
          "15-m",
          "30-m",
          "1-h",
          "2-h",
          "4-h",
          "6-h",
          "12-h",
          "1-d",
          "2-d",
          "7-d",
          "30-d",
        ].map((id) => `date-time-relative-${id}-btn`),
      );
      expect(el("date-time-relative-4-h-btn")?.getAttribute("aria-label")).toBe("Past 4 Hours");
      expect(el("date-time-relative-4-h-btn")?.textContent?.trim()).toBe("4");
      expect(el("date-time-relative-15-m-btn")?.getAttribute("aria-pressed")).toBe("true");
    });

    it("puts calendar periods in label rows with their dates on one line", async () => {
      createWrapper();
      await openMenu();

      expect(el("date-time-helpers-calendar")?.textContent).toContain("Week");
      expect(el("date-time-rail-calendar-today")?.textContent).toContain("Today");
      expect(el("date-time-rail-calendar-today-hint")?.textContent).toContain("Nov 7");
    });

    it.each([
      [
        "hideRangeShift",
        { hideRangeShift: true },
        ["date-time-zoom-out-btn", "date-time-prev-btn"],
      ],
      ["hideClipboard", { hideClipboard: true }, ["date-time-copy-btn", "date-time-paste-btn"]],
      ["hideRelativeTimezone", { hideRelativeTimezone: true }, ["datetime-timezone-select"]],
      ["calendarPresets off", { calendarPresets: false }, ["date-time-helpers-calendar"]],
      [
        "disableRelative",
        { disableRelative: true },
        ["date-time-helpers-relative", "date-time-rail-recent-group", "date-time-quick-ranges"],
      ],
    ])("hides what %s governs", async (_name, props, hidden) => {
      createWrapper(props);
      await openMenu();

      for (const id of hidden) expect(el(id)).toBeNull();
      expect(el("date-time-range-input")).not.toBeNull();
    });

    it("uses one narrow column when there are no helpers", async () => {
      createWrapper({ disableRelative: true });
      await openMenu();

      expect(document.getElementById("date-time-menu")?.className).toContain("w-90");
    });

    it("keeps the zone select on a host with its own zone, and a pick there is emitted", async () => {
      createWrapper({ pickerTimezone: "America/New_York", disableRelative: true });
      await openMenu();

      expect(el("datetime-timezone-select")).not.toBeNull();
      expect(el("date-time-range-tz")?.textContent).toContain("America/New_York");
      wrapper!.vm.timezone = "UTC";
      await wrapper!.vm.onTimezoneChange();
      await flushPromises();

      expect(wrapper!.emitted("on:timezone-change")?.at(-1)).toEqual(["UTC"]);
      expect(el("date-time-range-tz")?.textContent).toContain("UTC");
      expect(store.state.timezone).toBe(IST);
    });

    it("shows a URL period with no chip as its label and window, with no chip marked", async () => {
      createWrapper({ defaultRelativeTime: "1w" });
      await openMenu();

      expect(input().value).toBe("Past 1 Week");
      expect(lineRange()).toBe("Oct 31, 10:00:00 – Nov 7, 10:00:00");
      expect(
        document.querySelector('[data-test^="date-time-relative-"][aria-pressed="true"]'),
      ).toBeNull();
    });
  });

  describe("commit rules on an applying host", () => {
    it("commits a chip and closes", async () => {
      createWrapper();
      await openMenu();
      el("date-time-relative-4-h-btn")!.click();
      await flushPromises();

      expect(lastEmit()).toMatchObject({ relativeTimePeriod: "4h", valueType: "relative" });
      expect(wrapper!.vm.menuOpen).toBe(false);
    });

    it("reads typed text into the draft but drops it on an outside close", async () => {
      createWrapper();
      await openMenu();
      const before = emits().length;
      await typeText("90m");

      expect(el("date-time-range-draft")).not.toBeNull();
      expect(lineRange()).toBe("Nov 7, 08:30:00 – 10:00:00");
      await closeOutside();

      expect(emits()).toHaveLength(before);
      expect(wrapper!.vm.triggerLabel).toBe("Past 15 Minutes");
    });

    it("applies typed text on Enter and closes", async () => {
      createWrapper();
      await openMenu();
      await typeText("90m");
      await pressKey("Enter");

      expect(lastEmit()).toMatchObject({ relativeTimePeriod: "90m", valueType: "relative-custom" });
      expect(wrapper!.vm.menuOpen).toBe(false);
    });

    it("applies a paste on an outside close, as Run query does", async () => {
      createWrapper();
      await openMenu();
      await pasteText("Nov 4, 13:47 - 15:52");

      expect(noteText()).toContain("Read in Asia/Calcutta");
      expect(noteText()).toContain("13:47 – 15:52");
      await closeOutside();

      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-11-04T08:17:00Z"),
        endTime: micros("2026-11-04T10:22:00Z"),
      });
    });

    it("applies a calendar or field edit on an outside close", async () => {
      createWrapper();
      await openMenu();
      wrapper!.vm.onDraftEdge("start", { date: "2026-11-06", time: "09:00:00", offset: "" });
      wrapper!.vm.onDraftEdge("end", { date: "2026-11-06", time: "17:00:00", offset: "" });
      await flushPromises();

      expect(input().value).toBe("Nov 6, 09:00 – 17:00 UTC+05:30");
      await closeOutside();

      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-11-06T03:30:00Z"),
        endTime: micros("2026-11-06T11:30:00Z"),
      });
    });

    it("discards an invalid draft on an outside close and offers Swap for it", async () => {
      createWrapper();
      await openMenu();
      const before = emits().length;
      wrapper!.vm.onDraftEdge("start", { date: "2026-11-06", time: "17:00:00", offset: "" });
      wrapper!.vm.onDraftEdge("end", { date: "2026-11-06", time: "09:00:00", offset: "" });
      await flushPromises();

      expect(el("date-time-range-swap")).not.toBeNull();
      el("date-time-range-swap")!.click();
      await flushPromises();
      expect(wrapper!.vm.draft.start.time).toBe("09:00:00");
      expect(wrapper!.vm.draft.end.time).toBe("17:00:00");

      wrapper!.vm.onDraftEdge("end", { date: "2026-11-05", time: "09:00:00", offset: "" });
      await closeOutside();
      expect(emits()).toHaveLength(before);
    });

    it("applies a zoom out at once and closes; a draft takes its slot", async () => {
      createWrapper();
      await openMenu();
      el("date-time-zoom-out-btn")!.click();
      await flushPromises();

      expect(lastEmit()).toMatchObject({ relativeTimePeriod: "30m", valueType: "relative-custom" });
      expect(wrapper!.vm.menuOpen).toBe(false);
      await openMenu();
      await pasteText("Nov 4, 13:47 - 15:52");
      expect(el("date-time-zoom-out-btn")).toBeNull();
    });
  });

  describe("field hint, notes and paste", () => {
    it("hides the hint over typed text and adds no zone note for it; a paste keeps the hint and explains the zone", async () => {
      createWrapper();
      await openMenu();
      await typeText("yesterday 09:00 - 17:00");

      expect(el("date-time-range-hint")).toBeNull();
      expect(el("date-time-range-summary")?.textContent).toContain("Read as");
      expect(el("date-time-range-note")).toBeNull();

      await pasteText("Nov 4, 13:47 - 15:52");
      expect(el("date-time-range-hint")).not.toBeNull();
      expect(el("date-time-range-summary")?.textContent).not.toContain("Read as");
      expect(noteText()).toContain("Read in Asia/Calcutta");
    });

    it("keeps a calendar draft when a paste does not read, and Esc puts the field back", async () => {
      createWrapper();
      await openMenu();
      wrapper!.vm.onDraftEdge("start", { date: "2026-11-04", time: "00:00:00", offset: "" });
      wrapper!.vm.onDraftEdge("end", { date: "2026-11-06", time: "23:59:59", offset: "" });
      await flushPromises();
      const draftText = input().value;

      await pasteText("hello there");
      expect(el("date-time-range-input-error")).not.toBeNull();
      expect(wrapper!.vm.draft.start.date).toBe("2026-11-04");
      expect((el("date-time-apply-btn") as HTMLButtonElement).disabled).toBe(false);

      await pressKey("Escape");
      expect(wrapper!.vm.menuOpen).toBe(true);
      expect(input().value).toBe(draftText);
      expect(el("date-time-range-input-error")).toBeNull();
      expect(wrapper!.vm.draft.end.date).toBe("2026-11-06");
    });

    it("applies the kept draft on an outside close after a paste that does not read, as Apply would", async () => {
      createWrapper();
      await openMenu();
      wrapper!.vm.onDraftEdge("start", { date: "2026-11-04", time: "00:00:00", offset: "" });
      wrapper!.vm.onDraftEdge("end", { date: "2026-11-06", time: "23:59:59", offset: "" });
      await flushPromises();
      await pasteText("hello there");
      expect((el("date-time-apply-btn") as HTMLButtonElement).disabled).toBe(false);
      await closeOutside();

      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-11-03T18:30:00Z"),
        endTime: micros("2026-11-06T18:30:00Z"),
      });
    });

    it("applies the kept draft on Enter after a paste that does not read, and applies nothing without one", async () => {
      createWrapper();
      await openMenu();
      const before = emits().length;
      await pasteText("hello there");
      await pressKey("Enter");
      expect(emits()).toHaveLength(before);
      expect(wrapper!.vm.menuOpen).toBe(true);

      wrapper!.vm.onDraftEdge("start", { date: "2026-11-04", time: "00:00:00", offset: "" });
      wrapper!.vm.onDraftEdge("end", { date: "2026-11-06", time: "23:59:59", offset: "" });
      await flushPromises();
      await pasteText("hello again");
      await pressKey("Enter");

      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-11-03T18:30:00Z"),
        endTime: micros("2026-11-06T18:30:00Z"),
      });
      expect(wrapper!.vm.menuOpen).toBe(false);
    });

    it("keeps the pre-paste restore point when typing after a paste that does not read", async () => {
      createWrapper();
      await openMenu();
      await pasteText("hello there");
      tick();
      input().value = "hello there!";
      input().dispatchEvent(new Event("input"));
      await flushPromises();
      await pressKey("Escape");

      expect(wrapper!.vm.menuOpen).toBe(true);
      expect(input().value).toBe("Past 15 Minutes");
    });

    it("does not read the next keystroke as a paste after a paste that inserted nothing", async () => {
      createWrapper();
      await openMenu();
      tick();
      input().dispatchEvent(new Event("paste"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      input().value = "9";
      input().dispatchEvent(new Event("input"));
      await flushPromises();

      expect(wrapper!.vm.fieldEdited).toBe(true);
      expect(wrapper!.vm.parseError).toBeNull();
    });
  });

  describe("days past today", () => {
    it("lets a host with no maxDate pick future days, and names only the earliest date in the bound error", async () => {
      createWrapper();
      await openMenu();

      const calendar = wrapper!.findComponent({ name: "ODateRangeCalendar" });
      expect(calendar.props("maxDate")).toBeUndefined();
      wrapper!.vm.onFieldStatus("startDate", "out-of-range");
      await flushPromises();
      expect(wrapper!.vm.draftErrors.start).toBe("Pick a date on or after 1999-01-01.");
    });

    it("keeps the host's maxDate as the calendar's and the error's upper bound", async () => {
      createWrapper({ maxDate: "2026/12/31", disableRelative: true, minDate: "2026/01/01" });
      await openMenu();

      const calendar = wrapper!.findComponent({ name: "ODateRangeCalendar" });
      expect(calendar.props("maxDate")).toBe("2026/12/31");
      wrapper!.vm.onFieldStatus("startDate", "out-of-range");
      await flushPromises();
      expect(wrapper!.vm.draftErrors.start).toBe("Pick a date from 2026-01-01 to 2026-12-31.");
    });
  });

  describe("Esc", () => {
    it("first restores edited text, then closes and discards, and never reaches a page or dialog shortcut", async () => {
      createWrapper();
      await openMenu();
      const pageEscape = vi.fn();
      getManager()!.register({ key: "escape", handler: pageEscape, allowInInput: true });
      const windowListener = vi.fn();
      window.addEventListener("keydown", windowListener);
      const before = emits().length;

      await typeText("90m");
      await pressKey("Escape");
      expect(input().value).toBe("Past 15 Minutes");
      expect(el("date-time-range-draft")).toBeNull();
      expect(wrapper!.vm.menuOpen).toBe(true);

      await pressKey("Escape");
      expect(wrapper!.vm.menuOpen).toBe(false);
      expect(emits()).toHaveLength(before);
      expect(pageEscape).not.toHaveBeenCalled();
      expect(windowListener).not.toHaveBeenCalled();
      window.removeEventListener("keydown", windowListener);
    });

    it("closes from a chip without applying a paste", async () => {
      createWrapper();
      await openMenu();
      const before = emits().length;
      await pasteText("Nov 4, 13:47 - 15:52");
      await pressKey("Escape", el("date-time-relative-5-m-btn")!);

      expect(wrapper!.vm.menuOpen).toBe(false);
      expect(emits()).toHaveLength(before);
    });
  });

  describe("a host that does not apply on its own", () => {
    it("fills the draft from a chip, keeps the panel open, and emits only on Apply", async () => {
      createWrapper({ autoApply: false });
      await openMenu();
      const before = emits().length;
      el("date-time-relative-1-h-btn")!.click();
      await flushPromises();

      expect(wrapper!.vm.menuOpen).toBe(true);
      expect(emits()).toHaveLength(before);
      expect(el("date-time-range-draft")?.textContent).toContain("Not applied");
      expect(input().value).toBe("Past 1 Hour");
      el("date-time-apply-btn")!.click();
      await flushPromises();

      expect(lastEmit()).toMatchObject({ relativeTimePeriod: "1h" });
      expect(wrapper!.vm.menuOpen).toBe(false);
    });

    it("drops a draft on an outside close", async () => {
      createWrapper({ autoApply: false });
      await openMenu();
      const before = emits().length;
      await pasteText("Nov 4, 13:47 - 15:52");
      await closeOutside();

      expect(emits()).toHaveLength(before);
    });

    it("applies on Enter like Apply", async () => {
      createWrapper({ autoApply: false });
      await openMenu();
      await typeText("2h");
      await pressKey("Enter");

      expect(lastEmit()).toMatchObject({ relativeTimePeriod: "2h" });
    });
  });

  describe("query-range limit", () => {
    it("runs the largest whole period the page allows and says why, with the host message", async () => {
      createWrapper({
        queryRangeRestrictionInHour: 168,
        queryRangeRestrictionMsg: "This page queries at most 7 days.",
      });
      await openMenu();
      await typeText("30d");

      expect(el("date-time-range-summary")?.getAttribute("data-mode")).toBe("runs");
      expect(el("date-time-range-summary")?.textContent).toContain("Runs");
      expect(noteText()).toContain("Past 30 Days is over this page's limit, so Past 7 Days runs.");
      expect(noteText()).toContain("This page queries at most 7 days.");
      await pressKey("Enter");

      expect(lastEmit()).toMatchObject({ relativeTimePeriod: "7d" });
    });

    it("keeps 90m as typed on a two-hour limit and disables chips over it", async () => {
      createWrapper({ queryRangeRestrictionInHour: 2 });
      await openMenu();
      expect(el("date-time-relative-4-h-btn")?.hasAttribute("disabled")).toBe(true);
      await typeText("90m");
      await pressKey("Enter");

      expect(lastEmit()).toMatchObject({ relativeTimePeriod: "90m" });
    });

    it("disables Zoom out at the cap", async () => {
      createWrapper({ queryRangeRestrictionInHour: 1, defaultRelativeTime: "1h" });
      await openMenu();

      expect(
        el("date-time-zoom-out-btn")?.getAttribute("aria-disabled") ??
          el("date-time-zoom-out-btn")?.getAttribute("disabled"),
      ).not.toBeNull();
    });
  });

  describe("zone change with an open draft", () => {
    const switchZone = async (next: string) => {
      wrapper!.vm.timezone = next;
      await wrapper!.vm.onTimezoneChange();
      await flushPromises();
    };

    it("keeps the clock times of a pasted range that named no zone, and Undo restores both", async () => {
      createWrapper();
      await openMenu();
      await pasteText("Nov 4, 13:47 - 15:52");
      await switchZone("UTC");

      expect(wrapper!.emitted("on:timezone-change")?.at(-1)).toEqual(["UTC"]);
      expect(wrapper!.vm.draft.start).toMatchObject({ date: "2026-11-04", time: "13:47:00" });
      expect(noteText()).toContain("its clock times are kept and now read in UTC");
      el("date-time-range-note-undo")!.click();
      await flushPromises();
      await flushPromises();

      expect(store.state.timezone).toBe(IST);
      expect(wrapper!.vm.draft.start.time).toBe("13:47:00");
      expect(input().value).toBe("Nov 4, 13:47 - 15:52");
    });

    it("keeps the instants of a pasted range that named its zone and rewrites the field", async () => {
      createWrapper();
      await openMenu();
      await pasteText("2026-11-04T08:17:00Z/2026-11-04T10:22:00Z");
      expect(wrapper!.vm.draft.start.time).toBe("13:47:00");
      await switchZone("UTC");

      expect(wrapper!.vm.draft.start).toMatchObject({ date: "2026-11-04", time: "08:17:00" });
      expect(input().value).toBe("Nov 4, 08:17 – 10:22");
      expect(noteText()).toContain("the same moments are kept");
      await closeOutside();
      expect(lastEmit()).toMatchObject({
        startTime: micros("2026-11-04T08:17:00Z"),
        endTime: micros("2026-11-04T10:22:00Z"),
      });
    });
  });

  describe("one pasted instant", () => {
    it("offers Around ±15m by default and applies the highlighted choice on Enter", async () => {
      createWrapper();
      await openMenu();
      await pasteText("2026-11-04T08:17:03Z");

      expect(el("date-time-range-summary")?.getAttribute("data-mode")).toBe("instant");
      expect(el("date-time-instant-around")?.getAttribute("aria-pressed")).toBe("true");
      expect(el("date-time-instant-around")?.textContent).toContain("Nov 4, 13:32:03 – 14:02:03");
      await pressKey("Enter");

      expect(lastEmit()).toMatchObject({
        startTime: micros("2026-11-04T08:02:03Z"),
        endTime: micros("2026-11-04T08:32:03Z"),
      });
    });

    it("widens Around with the window toggle, and From … to now ends when applied", async () => {
      createWrapper();
      await openMenu();
      await pasteText("2026-11-04T08:17:03Z");
      wrapper!.vm.setInstantWindow("60");
      await flushPromises();
      expect(wrapper!.vm.draft.start.time).toBe("12:47:03");

      el("date-time-instant-since")!.click();
      await flushPromises();
      expect(lastEmit()).toMatchObject({
        startTime: micros("2026-11-04T08:17:03Z"),
        endTime: micros("2026-11-07T04:30:00Z"),
      });
    });

    it("moves from the field to the choices with ↓", async () => {
      createWrapper();
      await openMenu();
      await pasteText("2026-11-04T08:17:03Z");
      await pressKey("ArrowDown");
      await flushPromises();

      expect(document.activeElement?.getAttribute("data-test")).toBe("date-time-instant-around");
    });
  });

  describe("repairs", () => {
    it("offers the next valid time for a wall time a DST change skipped", async () => {
      store.state.timezone = "America/New_York";
      createWrapper();
      await openMenu();
      wrapper!.vm.onDraftEdge("start", { date: "2026-03-08", time: "02:30:00", offset: "" });
      wrapper!.vm.onDraftEdge("end", { date: "2026-03-08", time: "05:00:00", offset: "" });
      await flushPromises();

      expect(el("date-time-range-dst-next")?.textContent).toContain("Use 03:00");
      el("date-time-range-dst-next")!.click();
      await flushPromises();
      expect(wrapper!.vm.draft.start.time).toBe("03:00:00");
      expect(el("date-time-range-dst-next")).toBeNull();
    });

    it("offers a did-you-mean rewrite that reads", async () => {
      createWrapper();
      await openMenu();
      await typeText("yesterdy");

      expect(el("date-time-range-input-error")).not.toBeNull();
      el("date-time-range-suggestion")!.click();
      await flushPromises();
      expect(input().value).toBe("yesterday");
      expect(el("date-time-range-input-error")).toBeNull();
    });

    it("keeps the applied range on the line when the text does not read", async () => {
      createWrapper({
        disableRelative: true,
        defaultAbsoluteTime: {
          startTime: micros("2026-11-06T03:30:00Z"),
          endTime: micros("2026-11-06T11:30:00Z"),
        },
      });
      await openMenu();
      await typeText("2h");

      expect(noteText()).toContain("This picker takes dates and times");
      expect(lineRange()).toBe("Nov 6, 09:00:00 – 17:00:00");
    });
  });

  describe("preview and Use these dates", () => {
    it("previews a calendar chip on the line and the calendar, and freezes it as dates", async () => {
      createWrapper();
      await openMenu();
      el("date-time-rail-calendar-last-week")!.dispatchEvent(new Event("mouseenter"));
      await flushPromises();

      expect(el("date-time-range-summary")?.getAttribute("data-mode")).toBe("preview");
      expect(lineRange()).toBe("Oct 26, 00:00:00 – Nov 1, 23:59:59");
      expect(document.querySelectorAll("[data-preview]").length).toBeGreaterThan(0);
      el("date-time-range-freeze")!.click();
      await flushPromises();

      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-10-25T18:30:00Z"),
        endTime: micros("2026-11-01T18:30:00Z"),
      });
    });

    it("ends the preview when the pointer leaves the panel", async () => {
      createWrapper();
      await openMenu();
      el("date-time-relative-2-h-btn")!.dispatchEvent(new Event("mouseenter"));
      await flushPromises();
      expect(el("date-time-range-summary")?.getAttribute("data-mode")).toBe("preview");
      document.getElementById("date-time-menu")!.dispatchEvent(new Event("pointerleave"));
      await flushPromises();

      expect(el("date-time-range-summary")?.getAttribute("data-mode")).toBe("applied");
    });
  });

  describe("Copy", () => {
    it("writes an ISO interval with offsets, to the second", async () => {
      createWrapper({
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2026-11-04T08:17:00Z"),
          endTime: micros("2026-11-04T10:22:00Z"),
        },
      });
      await openMenu();
      el("date-time-copy-btn")!.click();

      expect(copyToClipboard.mock.calls[0][0]).toBe(
        "2026-11-04T13:47:00+05:30/2026-11-04T15:52:00+05:30",
      );
    });
  });

  describe("page keys", () => {
    const pressOnPage = (key: string) =>
      document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

    it("opens with t and moves the range with [ ] and - only where the page opts in", async () => {
      createWrapper({
        pageShortcuts: true,
        defaultType: "absolute",
        defaultAbsoluteTime: {
          startTime: micros("2026-11-06T00:00:00Z"),
          endTime: micros("2026-11-06T02:00:00Z"),
        },
      });
      await flushPromises();
      pressOnPage("[");
      await flushPromises();
      expect(lastEmit()).toMatchObject({
        startTime: micros("2026-11-05T22:00:00Z"),
        endTime: micros("2026-11-06T00:00:00Z"),
      });
      pressOnPage("-");
      await flushPromises();
      expect(lastEmit().endTime - lastEmit().startTime).toBe(4 * HOUR_US);
      pressOnPage("t");
      await flushPromises();
      expect(wrapper!.vm.menuOpen).toBe(true);
    });

    it("binds nothing without the opt-in", async () => {
      createWrapper();
      await flushPromises();
      pressOnPage("t");
      await flushPromises();
      expect(wrapper!.vm.menuOpen).toBe(false);
    });
  });
});
