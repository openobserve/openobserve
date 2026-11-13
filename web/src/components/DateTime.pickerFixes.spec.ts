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

// Thursday 2026-10-08 08:30 in Asia/Calcutta.
const NOW = new Date("2026-10-08T03:00:00Z");
const IST = "Asia/Calcutta";
const micros = (iso: string) => Date.parse(iso) * 1000;

describe("DateTime picker fixes (run 1)", () => {
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

  const openCalendar = async () => {
    await openMenu();
    wrapper!.vm.openCalendar();
    await flushPromises();
  };

  const el = (dataTest: string) =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-test]")).find(
      (node) => node.getAttribute("data-test") === dataTest,
    ) ?? null;

  const emits = () => (wrapper!.emitted("on:date-change") ?? []).length;

  const lastEmit = () => {
    const events = wrapper!.emitted("on:date-change") as unknown[][];
    return events[events.length - 1][0] as Record<string, number>;
  };

  const calendar = () => wrapper!.findComponent({ name: "ODateRangeCalendar" });

  // Vue drops an event stamped no later than its listener was attached, and Date is frozen here.
  const key = async (target: HTMLElement, name: string) => {
    vi.setSystemTime(Date.now() + 1000);
    target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
    await flushPromises();
  };

  const absoluteProps = {
    defaultType: "absolute",
    defaultAbsoluteTime: {
      startTime: micros("2026-10-06T07:00:00Z"),
      endTime: micros("2026-10-06T09:00:00Z"),
    },
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
  });

  describe("V1 nothing applies while the panel is open", () => {
    it("keeps an auto-apply picker's field edits pending and restores them on Escape", async () => {
      createWrapper(absoluteProps);
      await flushPromises();
      const applied = wrapper!.vm.triggerLabel;
      await openCalendar();
      const before = emits();

      wrapper!.vm.onStartTimeEdit("10:00:00");
      await flushPromises();
      expect(emits()).toBe(before);
      expect(wrapper!.vm.triggerLabel).toBe(applied);

      wrapper!.vm.closeCalendar();
      await flushPromises();
      await key(el("date-time-input-field")!, "Escape");
      expect(wrapper!.vm.menuOpen).toBe(false);
      expect(emits()).toBe(before);
      expect(wrapper!.vm.selectedTime).toMatchObject({ startTime: "12:30:00" });
      expect(wrapper!.vm.triggerLabel).toBe(applied);
    });

    it("still applies a chip and a calendar row at once on an auto-apply picker", async () => {
      createWrapper();
      await flushPromises();
      await openMenu();
      wrapper!.vm.pickChip("1h");
      await flushPromises();
      expect(lastEmit()).toMatchObject({ relativeTimePeriod: "1h" });
      expect(wrapper!.vm.menuOpen).toBe(false);

      await openMenu();
      el("date-time-list-calendar-yesterday")!.click();
      await flushPromises();
      expect(lastEmit()).toMatchObject({ relativeTimePeriod: "calendar:day:-1" });
      expect(wrapper!.vm.menuOpen).toBe(false);
    });
  });

  it("V2 starts a single pick from a timed range at 00:00 and ends it at the day's end", async () => {
    createWrapper({
      defaultType: "absolute",
      defaultAbsoluteTime: {
        startTime: micros("2026-10-07T04:45:00Z"),
        endTime: micros("2026-10-07T13:15:00Z"),
      },
    });
    await flushPromises();
    await openCalendar();

    calendar().vm.$emit("update:pendingDate", "2026/10/05");
    await flushPromises();
    wrapper!.vm.applyAndClose();
    await flushPromises();

    expect(lastEmit()).toMatchObject({
      startTime: micros("2026-10-04T18:30:00Z"),
      endTime: micros("2026-10-05T18:30:00Z"),
    });
  });

  it("V3 closes on Apply through the path that emits hide", async () => {
    createWrapper(absoluteProps);
    await flushPromises();
    await openCalendar();
    calendar().vm.$emit("update:pendingDate", "2026/10/03");
    await flushPromises();

    el("date-time-apply-btn")!.click();
    await flushPromises();

    expect(wrapper!.vm.menuOpen).toBe(false);
    expect(wrapper!.emitted("hide")).toHaveLength(1);
  });

  describe("V7 calendar picks over the page's limit", () => {
    it("disables Apply on a picked range over the limit and says the limit", async () => {
      createWrapper({ ...absoluteProps, queryRangeRestrictionInHour: 24 });
      await flushPromises();
      await openCalendar();
      const before = emits();

      calendar().vm.$emit("update:pendingDate", "2026/10/03");
      calendar().vm.$emit("update:startDate", "2026/10/03");
      calendar().vm.$emit("update:endDate", "2026/10/05");
      calendar().vm.$emit("update:pendingDate", null);
      await flushPromises();

      expect((el("date-time-apply-btn") as HTMLButtonElement).disabled).toBe(true);
      expect(el("date-time-input-error")?.textContent).toContain("Max 1d");
      wrapper!.vm.onTimeFieldEnter(new KeyboardEvent("keydown", { key: "Enter" }));
      await flushPromises();
      expect(emits()).toBe(before);
    });

    it("says the limit while the pointer previews an end past it", async () => {
      createWrapper({ ...absoluteProps, queryRangeRestrictionInHour: 24 });
      await flushPromises();
      await openCalendar();

      calendar().vm.$emit("update:pendingDate", "2026/10/03");
      calendar().vm.$emit("update:previewDate", "2026/10/06");
      await flushPromises();
      expect(el("date-time-input-error")?.textContent).toContain("Max 1d");
      expect((el("date-time-apply-btn") as HTMLButtonElement).disabled).toBe(false);

      calendar().vm.$emit("update:previewDate", "2026/10/03");
      await flushPromises();
      expect(el("date-time-input-error")).toBeNull();
    });
  });

  it("V8 returns focus to the trigger when Escape closes the panel", async () => {
    createWrapper();
    await flushPromises();
    await openMenu();
    const bar = el("date-time-input-field")!;
    bar.focus();

    await key(bar, "Escape");
    await flushPromises();

    expect(wrapper!.vm.menuOpen).toBe(false);
    expect(document.activeElement?.getAttribute("data-test")).toBe("date-time-btn");
  });

  it("V10 keeps the milliseconds of a fixed range through [ and -", async () => {
    createWrapper({
      defaultType: "absolute",
      defaultAbsoluteTime: {
        startTime: micros("2026-10-08T01:00:49.948Z"),
        endTime: micros("2026-10-08T02:00:49.948Z"),
      },
    });
    await flushPromises();

    wrapper!.vm.shiftTimeRange("prev");
    await flushPromises();
    expect(lastEmit()).toMatchObject({
      startTime: micros("2026-10-08T00:00:49.948Z"),
      endTime: micros("2026-10-08T01:00:49.948Z"),
    });

    wrapper!.vm.zoomOut();
    await flushPromises();
    expect(lastEmit()).toMatchObject({
      startTime: micros("2026-10-07T23:30:49.948Z"),
      endTime: micros("2026-10-08T01:30:49.948Z"),
    });
  });

  it("V11 goes back to live on ] after [, however long the user waited", async () => {
    createWrapper({ defaultRelativeTime: "1h" });
    await flushPromises();

    wrapper!.vm.shiftTimeRange("prev");
    await flushPromises();
    expect(wrapper!.vm.selectedType).toBe("absolute");
    vi.setSystemTime(Date.now() + 5_000);
    wrapper!.vm.shiftTimeRange("next");
    await flushPromises();

    expect(wrapper!.vm.selectedType).toBe("relative");
    expect(lastEmit()).toMatchObject({ relativeTimePeriod: "1h" });
  });

  it("V12 flags a time no typing can complete as it is typed, and only that", async () => {
    createWrapper({ ...absoluteProps, autoApply: false });
    await flushPromises();
    await openCalendar();
    const field = document.querySelector<HTMLInputElement>(
      '[data-test="datetime-start-time"] input',
    )!;
    const typeInto = async (text: string) => {
      vi.setSystemTime(Date.now() + 1000);
      field.value = text;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      await flushPromises();
    };

    for (const bad of ["25:99", "ab", "12:60"]) {
      await typeInto(bad);
      expect((el("date-time-apply-btn") as HTMLButtonElement).disabled).toBe(true);
      expect(el("date-time-input-error")?.textContent).toContain("Enter a time as HH:MM");
    }
    for (const partial of ["1", "12:", "12:3", "12:30:0"]) {
      await typeInto(partial);
      expect((el("date-time-apply-btn") as HTMLButtonElement).disabled).toBe(false);
    }
  });

  it("V20 turns zoom out off at the page's limit and says the limit", async () => {
    createWrapper({ defaultRelativeTime: "1d", queryRangeRestrictionInHour: 24 });
    await flushPromises();
    const zoom = el("date-time-zoom-out-btn") as HTMLButtonElement;
    expect(zoom.disabled).toBe(true);
    expect(zoom.getAttribute("aria-label")).toBe("Max 1d");
    expect(zoom.className).toContain("forced-colors:disabled:text-[color:GrayText]!");
    const before = emits();
    wrapper!.vm.zoomOut();
    await flushPromises();
    expect(emits()).toBe(before);
  });

  it("V22 gives the lit chip system highlight colours in forced-colours mode", async () => {
    createWrapper();
    await flushPromises();
    await openMenu();
    expect(el("date-time-chip-15m")?.className).toContain(
      "forced-colors:data-[state=on]:bg-[color:Highlight]!",
    );
  });

  describe("P6 accessibility", () => {
    it("marks the panel modal and speaks the cursor row's kind, length, group and place", async () => {
      createWrapper();
      await flushPromises();
      await openMenu();
      await flushPromises();
      expect(document.querySelector("[role='dialog']")?.getAttribute("aria-modal")).toBe("true");

      const bar = el("date-time-input-field")!;
      await key(bar, "ArrowDown");
      const speech = el("date-time-live-region")!.textContent!.trim();
      expect(speech).toMatch(/, live, .+\. Calendar, 1 of \d+\.$/);
    });

    it("moves the list cursor to the first and last row with Home and End", async () => {
      createWrapper();
      await flushPromises();
      await openMenu();
      const bar = el("date-time-input-field")!;
      await key(bar, "ArrowDown");
      await key(bar, "ArrowDown");
      expect(wrapper!.vm.listCursor).toBe(1);

      await key(bar, "End");
      const last = wrapper!.vm.shownRows.length - 1;
      expect(wrapper!.vm.listCursor).toBe(last);
      await key(bar, "Home");
      expect(wrapper!.vm.listCursor).toBe(0);
    });
  });

  it("P7 lets the calendar scroll when the panel is capped short", async () => {
    createWrapper();
    await flushPromises();
    await openCalendar();
    expect(calendar().element.parentElement?.className).toContain("overflow-y-auto");
  });
});
