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

import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { timeRangeHistoryKey } from "@/composables/useTimeRangeHistory";
import { openPrimaryTimeRangePicker } from "@/utils/timeRangeShortcut";
import store from "@/test/unit/helpers/store";
import type { TimeRangeReading } from "@/utils/timeRangeInput/types";
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

const toastMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: toastMock }));

const NOW = new Date("2026-10-08T03:00:00Z");
const micros = (iso: string) => Date.parse(iso) * 1000;
const HISTORY_KEY = timeRangeHistoryKey("default", "example@gmail.com");
const ABSOLUTE_TEXT = "2026-10-08 01:00 - 2026-10-08 02:00";
const HOSTS = [
  ["autoApply", { autoApply: true }],
  ["applyPresets", { applyPresets: true }],
  ["plain", {}],
] as const;

// The clock creeps between two mounts, so a resolved range is compared by its length.
const comparable = (payload: Record<string, unknown>) => {
  const { startTime, endTime, relativeTimePeriod, valueType, userChangedValue } = payload;
  const span = Number(endTime) - Number(startTime);
  return { span: Math.round(span / 1e6), relativeTimePeriod, valueType, userChangedValue };
};

describe("DateTime typed range bar", () => {
  let wrapper: Picker | null = null;

  const create = (props: Record<string, unknown> = {}) => {
    wrapper = mountPicker(props);
    return wrapper;
  };

  const historyWrites = () =>
    vi.mocked(Storage.prototype.setItem).mock.calls.filter(([key]) => key === HISTORY_KEY).length;

  beforeAll(warmRangeInput);

  beforeEach(() => {
    // A frozen clock makes Vue drop every listener after the first for one event, so it creeps instead.
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    store.state.timezone = "UTC";
    store.state.savedViewFlag = false;
    localStorage.clear();
    toastMock.mockReset();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("puts the cursor in the bar when the picker opens", async () => {
    create({ autoApply: true });
    await openMenu(wrapper!);

    expect(document.activeElement).toBe(barInput());
    const autoFocus = new Event("focus", { cancelable: true });
    wrapper!.vm.onPopoverOpenAutoFocus(autoFocus);
    expect(autoFocus.defaultPrevented).toBe(true);
  });

  it.each(HOSTS)(
    "applies a typed rolling range once with the chip's payload on a %s host",
    async (_, props) => {
      const chip = create(props);
      await flushPromises();
      chip.vm.pickRelativeChip("h", 2);
      if (!("autoApply" in props) && !("applyPresets" in props)) chip.vm.applyAndClose();
      await flushPromises();
      const expected = comparable(lastChange(chip));
      chip.unmount();

      create(props);
      await flushPromises();
      await openMenu(wrapper!);
      const before = changes(wrapper!).length;
      await typeInBar("2h");
      await press(barInput(), "Enter");

      expect(changes(wrapper!).length).toBe(before + 1);
      expect(comparable(lastChange(wrapper!))).toEqual(expected);
      expect(wrapper!.vm.menuOpen).toBe(false);
    },
  );

  it("applies a typed calendar period with the rail's payload", async () => {
    const rail = create({ autoApply: true });
    await flushPromises();
    rail.vm.applyCalendarItem("today");
    await flushPromises();
    const expected = comparable(lastChange(rail));
    rail.unmount();

    create({ autoApply: true });
    await openMenu(wrapper!);
    await typeInBar("today");
    await press(barInput(), "Enter");

    expect(comparable(lastChange(wrapper!))).toEqual(expected);
    expect(lastChange(wrapper!).relativeTimePeriod).toBe("calendar:day:0");
  });

  it.each(HOSTS)(
    "applies a typed absolute range with one emit and one Recent write on a %s host",
    async (_, props) => {
      vi.spyOn(Storage.prototype, "setItem");
      create(props);
      await flushPromises();
      await openMenu(wrapper!);
      const before = changes(wrapper!).length;
      await typeInBar(ABSOLUTE_TEXT);
      await press(barInput(), "Enter");

      expect(changes(wrapper!).length).toBe(before + 1);
      expect(lastChange(wrapper!)).toMatchObject({
        startTime: micros("2026-10-08T01:00:00Z"),
        endTime: micros("2026-10-08T02:00:00Z"),
        relativeTimePeriod: null,
        valueType: "absolute",
        userChangedValue: true,
      });
      expect(historyWrites()).toBe(1);
      expect(JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]")).toHaveLength(1);
    },
  );

  it("writes Recent once when Apply applies a typed range", async () => {
    vi.spyOn(Storage.prototype, "setItem");
    create({ autoApply: false });
    await flushPromises();
    await openMenu(wrapper!);
    await typeInBar(ABSOLUTE_TEXT);
    el("date-time-apply-btn")!.click();
    await flushPromises();

    expect(lastChange(wrapper!)).toMatchObject({ startTime: micros("2026-10-08T01:00:00Z") });
    expect(historyWrites()).toBe(1);
  });

  it("emits hide once when a typed range is applied", async () => {
    create({ autoApply: true });
    await openMenu(wrapper!);
    await typeInBar("2h");
    await press(barInput(), "Enter");

    expect(wrapper!.emitted("hide")).toHaveLength(1);
  });

  it("applies nothing when the picker closes with typed text", async () => {
    create({ autoApply: true });
    await openMenu(wrapper!);
    const before = changes(wrapper!).length;
    await typeInBar("2h");
    wrapper!.vm.menuOpen = false;
    wrapper!.vm.onMenuOpenChange(false);
    await flushPromises();

    expect(changes(wrapper!).length).toBe(before);
    expect(wrapper!.vm.relativeValue).toBe(15);
  });

  it("disables Apply while the bar holds text that is not a valid reading", async () => {
    create({ autoApply: false });
    await openMenu(wrapper!);
    await typeInBar("garbage text");

    expect(el<HTMLButtonElement>("date-time-apply-btn")!.disabled).toBe(true);
  });

  it("clears the typed text when a chip is picked", async () => {
    create({ autoApply: false });
    await openMenu(wrapper!);
    await typeInBar("2h");
    el("date-time-relative-6-h-btn")!.click();
    await flushPromises();

    expect(barInput()!.value).toBe("");
    expect(barState()).toBe("empty");
  });

  it("keeps the preset grid still when an arrow is pressed in the bar", async () => {
    create({ autoApply: true });
    await openMenu(wrapper!);
    el("date-time-relative-5-m-btn")!.focus();
    barInput()!.focus();
    await press(barInput(), "ArrowRight");

    expect(document.activeElement).toBe(barInput());
  });

  it.each([
    ["hideClipboard", { hideClipboard: true }],
    ["hideRangeInput", { hideRangeInput: true }],
    ["a date-only picker", { disableRelative: true, hideRelativeTime: true }],
  ])("renders no bar for %s", async (_, props) => {
    create(props);
    await openMenu(wrapper!);

    expect(el("date-time-range-bar")).toBeNull();
  });

  it("moves copy and paste onto the bar's status line", async () => {
    create({ autoApply: true });
    await openMenu(wrapper!);
    const actions = el("date-time-range-actions")!;

    expect(actions.querySelector("[data-test='date-time-copy-btn']")).not.toBeNull();
    expect(actions.querySelector("[data-test='date-time-paste-btn']")).not.toBeNull();
    expect(el("date-time-range-status")!.querySelector("[data-test$='-btn']")).toBeNull();
    expect(document.querySelectorAll("[data-test='date-time-copy-btn']")).toHaveLength(1);
    expect(document.querySelectorAll("[data-test='date-time-paste-btn']")).toHaveLength(1);
  });

  describe("t shortcut", () => {
    const others: Picker[] = [];

    // jsdom lays nothing out, so every mounted picker reports a box to count as shown.
    beforeEach(() => {
      vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
        {},
      ] as unknown as DOMRectList);
    });

    afterEach(() => {
      others.splice(0).forEach((w) => w.unmount());
    });

    it("opens the first picker on the page with the cursor in the bar", async () => {
      create({ autoApply: true });
      others.push(mountPicker({ autoApply: true }));
      await flushPromises();

      openPrimaryTimeRangePicker();
      await flushPromises();

      expect(wrapper!.vm.menuOpen).toBe(true);
      expect(others[0].vm.menuOpen).toBe(false);
      expect(document.activeElement).toBe(barInput());
    });

    it("skips a disabled picker and keeps working after another unmounts", async () => {
      create({ autoApply: true, disable: true });
      const second = mountPicker({ autoApply: true });
      const third = mountPicker({ autoApply: true });
      others.push(third);
      await flushPromises();
      second.unmount();

      openPrimaryTimeRangePicker();
      await flushPromises();

      expect(wrapper!.vm.menuOpen).toBe(false);
      expect(third.vm.menuOpen).toBe(true);
    });
  });

  describe("paste", () => {
    it("applies a pasted full range at once and closes on an auto host", async () => {
      create({ autoApply: true });
      await openMenu(wrapper!);
      const before = changes(wrapper!).length;
      await wrapper!.vm.onPickerPaste(pasteEvent(ABSOLUTE_TEXT));

      expect(changes(wrapper!).length).toBe(before + 1);
      expect(lastChange(wrapper!)).toMatchObject({ startTime: micros("2026-10-08T01:00:00Z") });
      expect(wrapper!.vm.menuOpen).toBe(false);
    });

    it("stages a pasted full range without an emit on an Apply host", async () => {
      create({ autoApply: false });
      await openMenu(wrapper!);
      const before = changes(wrapper!).length;
      await wrapper!.vm.onPickerPaste(pasteEvent(ABSOLUTE_TEXT));

      expect(changes(wrapper!).length).toBe(before);
      expect(wrapper!.vm.selectedType).toBe("absolute");
      expect(wrapper!.vm.menuOpen).toBe(true);
    });

    it.each([
      ["a single timestamp", "2026-10-08T01:00:00Z", "valid"],
      ["an ambiguous text", "15M", "ambiguous"],
      ["an unreadable text", "garbage text", "invalid"],
      ["a range over the limit", "200h", "blocked"],
    ])("puts %s in the bar with no toast and no emit", async (_, text, state) => {
      create({ autoApply: true, queryRangeRestrictionInHour: 72 });
      await openMenu(wrapper!);
      el("date-time-relative-tab")!.focus();
      const before = changes(wrapper!).length;
      await wrapper!.vm.onPickerPaste(pasteEvent(text));
      await flushPromises();

      expect(barInput()!.value).toBe(text);
      expect(document.activeElement).toBe(barInput());
      expect(barState()).toBe(state);
      expect(changes(wrapper!).length).toBe(before);
      expect(toastMock).not.toHaveBeenCalled();
    });

    it("keeps both buttons in the top row and toasts an unreadable paste on a host without the bar", async () => {
      create({ autoApply: true, disableRelative: true, hideRelativeTime: true });
      await openMenu(wrapper!);

      expect(el("date-time-copy-btn")).not.toBeNull();
      expect(el("date-time-paste-btn")).not.toBeNull();
      await wrapper!.vm.onPickerPaste(pasteEvent("garbage text"));

      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "error", message: "Could not parse date range" }),
      );
    });
  });
});

function pasteEvent(text: string): ClipboardEvent {
  const event = new Event("paste", { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", { value: { getData: () => text } });
  Object.defineProperty(event, "target", { value: document.body });
  return event;
}

describe("DateTime typed range bar review fixes", () => {
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

  const applyBtn = () => el<HTMLButtonElement>("date-time-apply-btn")!;

  beforeAll(warmRangeInput);

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

  it("re-checks the gate when a typed range keeps the same whole-second fields", async () => {
    create({ autoApply: false });
    await openMenu(wrapper!);
    await setAbsolute("2026/10/08 01:00:00", "2026/10/08 01:00:00");
    expect(wrapper!.vm.gateReason).toBe("order");
    const start = micros("2026-10-08T01:00:00Z");
    wrapper!.vm.commitTypedReading({
      kind: "absolute",
      startUs: start,
      endUs: start + 500_000,
      notes: [],
    } as unknown as TimeRangeReading);
    await flushPromises();

    expect(lastChange(wrapper!)).toMatchObject({ startTime: start, endTime: start + 500_000 });
  });

  it("enables Apply for a valid reading in the bar while the panel draft is refused", async () => {
    create({ autoApply: false });
    await openMenu(wrapper!);
    await setAbsolute("2026/10/08 02:00:00", "2026/10/08 01:00:00");
    await typeInBar("1h");

    expect(applyBtn().disabled).toBe(false);
    applyBtn().click();
    await flushPromises();
    expect(lastChange(wrapper!).relativeTimePeriod).toBe("1h");
  });

  it("writes an epoch-zero start as 1970, not today", async () => {
    create({ autoApply: true });
    await flushPromises();
    wrapper!.vm.setAbsoluteTime(0, micros("1970-01-01T01:00:00Z"));
    await flushPromises();

    expect(wrapper!.vm.selectedDate.from).toBe("1970/01/01");
    expect(wrapper!.vm.selectedTime.startTime).toBe("00:00:00");
  });

  it("applies a typed rolling range over the ten-year limit only as the capped row", async () => {
    create({ autoApply: true });
    await openMenu(wrapper!);
    await typeInBar("last 11 years");
    const before = (wrapper!.emitted("on:date-change") ?? []).length;
    await press(barInput(), "Enter");
    expect((wrapper!.emitted("on:date-change") ?? []).length).toBe(before);

    await press(barInput(), "ArrowDown");
    await press(barInput(), "Enter");
    expect(lastChange(wrapper!).relativeTimePeriod).toBe("120M");
  });

  it("offers both capped readings when the capped start falls in a repeated hour", async () => {
    vi.setSystemTime(new Date("2026-11-04T06:30:00Z"));
    store.state.timezone = "America/New_York";
    create({ autoApply: true });
    await openMenu(wrapper!);
    await typeInBar("last 3651 days");

    expect(barState()).toBe("blocked");
    expect(el("date-time-range-reading-0")!.textContent).toContain("First time, UTC-04:00");
    expect(el("date-time-range-reading-1")!.textContent).toContain("Second time, UTC-05:00");
    await press(barInput(), "ArrowDown");
    await press(barInput(), "ArrowDown");
    await press(barInput(), "Enter");
    const change = lastChange(wrapper!);
    expect(change.relativeTimePeriod).toBe("3650d");
    expect(Number(change.endTime) - Number(change.startTime)).toBe(3650 * 24 * 3_600_000_000);
  });

  it("applies the capped row for an over-cap range read in a repeated hour", async () => {
    vi.setSystemTime(new Date("2026-11-01T05:30:00Z"));
    store.state.timezone = "America/New_York";
    create({ autoApply: true });
    await openMenu(wrapper!);
    await typeInBar("last 11 years");

    expect(barState()).toBe("blocked");
    expect(el("date-time-range-reading-0")!.getAttribute("aria-disabled")).toBeNull();
    await press(barInput(), "ArrowDown");
    await press(barInput(), "Enter");
    expect(lastChange(wrapper!).relativeTimePeriod).toBe("120M");
  });

  it("keeps the weeks cap within the days cap", async () => {
    create({ autoApply: true });
    await openMenu(wrapper!);
    await typeInBar("last 521 weeks");
    expect(barState()).toBe("valid");
    await typeInBar("last 522 weeks");
    expect(barState()).toBe("blocked");
  });

  it("moves focus to the next control when a resize hides the trigger", async () => {
    create({ autoApply: true });
    const next = document.createElement("button");
    document.body.appendChild(next);
    // jsdom lays nothing out, so only the control after the picker counts as rendered.
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (
      this: HTMLElement,
    ) {
      return (this === next ? [{}] : []) as unknown as DOMRectList;
    });
    await openMenu(wrapper!);
    expect(document.activeElement).toBe(barInput());

    window.dispatchEvent(new Event("resize"));
    await flushPromises();

    expect(wrapper!.vm.menuOpen).toBe(false);
    expect(document.activeElement).toBe(next);
  });

  it("shows the range a host set through setSavedDate as applied", async () => {
    create({ autoApply: true, defaultRelativeTime: "15m" });
    await flushPromises();
    wrapper!.vm.setSavedDate({ type: "relative", relativeTimePeriod: "2h" });
    await flushPromises();

    const applied = wrapper!.vm.appliedRange!;
    expect(applied.endUs - applied.startUs).toBe(2 * 3_600_000_000);
  });
});
