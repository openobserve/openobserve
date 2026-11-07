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
import OSegmentedField from "@/lib/forms/SegmentedField/OSegmentedField.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

// Friday 2026-11-06 14:02 in Asia/Calcutta; the test browser runs in UTC, so IST labels carry a suffix.
const NOW = new Date("2026-11-06T08:32:00Z");
const IST = "Asia/Calcutta";
const micros = (iso: string) => Date.parse(iso) * 1000;
const START = micros("2026-11-04T13:47:03+05:30");
const END = micros("2026-11-06T14:02:03+05:30");

describe("DateTime absolute ranges", () => {
  let wrapper: VueWrapper<InstanceType<typeof DateTime>> | null = null;

  const createWrapper = (props: Record<string, unknown> = {}) => {
    wrapper = mount(DateTime, {
      props: {
        defaultType: "absolute",
        defaultAbsoluteTime: { startTime: START, endTime: END },
        ...props,
      },
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

  const closeMenu = async () => {
    wrapper!.vm.onMenuOpenChange(false);
    wrapper!.vm.menuOpen = false;
    await flushPromises();
  };

  const el = (dataTest: string) => document.querySelector<HTMLElement>(`[data-test="${dataTest}"]`);

  const emits = () => (wrapper!.emitted("on:date-change") ?? []) as unknown[][];
  const lastEmit = () => emits()[emits().length - 1][0] as Record<string, unknown>;

  const editEdge = (edge: "start" | "end", date: string, time: string) =>
    wrapper!.vm.onDraftEdge(edge, { date, time, offset: "" });

  const trigger = () => wrapper!.find('[data-test="date-time-btn"]');
  const triggerRange = () =>
    wrapper!.find('[data-test="date-time-btn"] .date-time-label > span').text();

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

  describe("trigger", () => {
    it("labels an absolute range with the compact formatter and carries its instants", async () => {
      createWrapper();
      await flushPromises();

      expect(triggerRange()).toBe("Nov 4, 13:47:03 – Nov 6, 14:02:03");
      expect(trigger().attributes("data-start-us")).toBe(String(START));
      expect(trigger().attributes("data-end-us")).toBe(String(END));
    });

    it("describes the range with the two tooltip lines", async () => {
      createWrapper();
      await flushPromises();

      expect(wrapper!.vm.triggerTooltip).toBe(
        "2026-11-04 13:47:03 – 2026-11-06 14:02:03\n2d 15m · Asia/Calcutta (UTC+05:30)",
      );
      const describedBy = trigger().attributes("aria-describedby")!;
      expect(document.getElementById(describedBy)?.textContent).toContain("2d 15m");
    });

    it("drops the tooltip while the panel is open, since the summary says it", async () => {
      createWrapper();
      await openMenu();

      expect(trigger().attributes("aria-describedby")).toBeUndefined();
    });

    it("shows a muted zone suffix only when the picker zone is not the browser's", async () => {
      createWrapper();
      await flushPromises();
      expect(el("date-time-btn-tz")?.textContent).toBe("UTC+05:30");
      expect(wrapper!.vm.triggerLabel).toBe("Nov 4, 13:47:03 – Nov 6, 14:02:03 UTC+05:30");
      wrapper!.unmount();

      store.state.timezone = "UTC";
      createWrapper();
      await flushPromises();
      expect(el("date-time-btn-tz")).toBeNull();
    });

    it.each([
      [1, 0, "Nov 4, 13:47:03 – Nov 6, 14:02:03", false],
      [2, 1, "Nov 4, 13:47 – Nov 6, 14:02", true],
      [3, 2, "2d 15m", true],
    ])(
      "steps down the ladder to step %i by the width it has, keeping the visible text in the name",
      async (step, failures, visible, hasTail) => {
        createWrapper();
        await flushPromises();
        const label = wrapper!.vm.triggerLabelEl as HTMLElement;
        let measured = 0;
        Object.defineProperty(label, "clientWidth", { configurable: true, get: () => 100 });
        Object.defineProperty(label, "scrollWidth", {
          configurable: true,
          get: () => (measured++ < failures ? 200 : 50),
        });

        await wrapper!.vm.measureLadder();
        await flushPromises();

        expect(wrapper!.vm.ladderStep).toBe(step);
        const name = label.textContent ?? "";
        expect(name.startsWith(visible)).toBe(true);
        expect(name.includes(", Nov 4, 13:47:03 – Nov 6, 14:02:03 UTC+05:30")).toBe(hasTail);
        if (step === 3) expect(el("date-time-btn-duration")?.textContent).toBe("2d 15m");
      },
    );

    it("keeps a relative label and its compact form", async () => {
      createWrapper({ defaultType: "relative" });
      await flushPromises();

      expect(wrapper!.vm.triggerLabel).toBe("Past 15 Minutes");
      expect(trigger().attributes("data-start-us")).toBeUndefined();
    });
  });

  describe("panel", () => {
    it("mounts no clock dial and offers typed segment fields", async () => {
      createWrapper();
      await openMenu();

      expect(document.querySelector('[data-test="otime-popup"]')).toBeNull();
      expect(document.querySelector('[data-test="datetime-start-time"] input')).not.toBeNull();
      expect(
        (document.querySelector('[data-test="datetime-start-time"] input') as HTMLInputElement)
          .value,
      ).toBe("13:47:03");
      expect(document.querySelector('input[type="time"]')).toBeNull();
    });

    it("summarises the applied range with no badge and Apply off", async () => {
      createWrapper({ autoApply: true });
      await openMenu();

      expect(el("date-time-range-summary-range")?.textContent).toBe(
        "Nov 4, 13:47:03 – Nov 6, 14:02:03",
      );
      expect(el("date-time-range-duration")?.textContent).toBe("2d 15m");
      expect(el("date-time-range-tz")?.textContent).toContain("UTC+05:30");
      expect(el("date-time-range-draft")).toBeNull();
      expect((el("date-time-apply-btn") as HTMLButtonElement).disabled).toBe(true);
    });

    it("marks an edit as not applied and turns Apply on, without emitting", async () => {
      createWrapper({ autoApply: true });
      await openMenu();
      const before = emits().length;

      editEdge("start", "2026-11-04", "10:00:00");
      await flushPromises();

      expect(emits()).toHaveLength(before);
      expect(el("date-time-range-draft")?.textContent).toContain("Not applied");
      expect((el("date-time-apply-btn") as HTMLButtonElement).disabled).toBe(false);
      expect(triggerRange()).toBe("Nov 4, 13:47:03 – Nov 6, 14:02:03");
    });

    it("shows end-before-start under End and rings both days", async () => {
      createWrapper();
      await openMenu();

      editEdge("end", "2026-11-03", "09:00:00");
      await flushPromises();

      expect(el("date-time-range-end-error")?.textContent?.trim()).toBe("End is before start.");
      const endInputs = document.querySelectorAll<HTMLInputElement>(
        '[data-test="date-time-range-end"] input',
      );
      expect(endInputs.length).toBe(2);
      for (const input of endInputs) {
        expect(input.getAttribute("aria-invalid")).toBe("true");
        expect(input.getAttribute("aria-errormessage")).toBe(el("date-time-range-end-error")!.id);
      }
      expect(
        document.querySelector('[data-test="date-time-range-end"] [data-test="o-input-error"]'),
      ).toBeNull();
      expect(el("date-time-range-note")?.textContent).toContain(
        "End is before start (Nov 4, 13:47:03).",
      );
      expect(el("date-time-range-duration")?.textContent).toBe("—");
      expect(el("date-time-range-summary")?.textContent).not.toContain("Read as");
      expect(el("date-time-range-swap")).not.toBeNull();
      expect(document.querySelector('[data-test="date-time-range-input"]')?.innerHTML).toMatch(
        /error|invalid/,
      );
      expect(wrapper!.vm.calendarInvalidDates).toEqual(["2026/11/04", "2026/11/03"]);
      expect((el("date-time-apply-btn") as HTMLButtonElement).disabled).toBe(true);
    });

    it("reports a time that a DST change skips", async () => {
      store.state.timezone = "America/New_York";
      createWrapper();
      await openMenu();

      editEdge("start", "2026-03-08", "02:30:00");
      editEdge("end", "2026-03-08", "05:00:00");
      await flushPromises();

      expect(el("date-time-range-start-error")?.textContent).toContain(
        "02:30 does not exist on Mar 8 in America/New_York; clocks jumped from 02:00 to 03:00.",
      );
    });

    it("offers the two offsets of a repeated hour and explains the repeat", async () => {
      store.state.timezone = "America/New_York";
      createWrapper();
      await openMenu();

      editEdge("start", "2026-11-01", "01:30:00");
      editEdge("end", "2026-11-01", "03:00:00");
      await flushPromises();

      expect(wrapper!.vm.draftOffsets.start).toEqual(["UTC-04:00", "UTC-05:00"]);
      expect(el("date-time-range-note")?.textContent).toContain(
        "Clocks went back at 02:00 on Nov 1, so 01:00–02:00 happens twice.",
      );
    });

    it("keeps typing that runs past the Start time's last segment inside Start", async () => {
      createWrapper();
      await openMenu();
      const startTime = wrapper!
        .findAllComponents(OSegmentedField)
        .find((field) => field.props("ariaLabel") === "Start time")!
        .find("input");
      const endDate = wrapper!
        .findAllComponents(OSegmentedField)
        .find((field) => field.props("ariaLabel") === "End date")!
        .find("input");
      (startTime.element as HTMLInputElement).focus();
      await startTime.trigger("focus");

      await startTime.trigger("keydown", { key: "ArrowRight" });
      for (const key of "21:30:00") await startTime.trigger("keydown", { key });
      await flushPromises();

      expect(document.activeElement).toBe(startTime.element);
      expect(document.activeElement).not.toBe(endDate.element);
      expect(wrapper!.vm.draft.start.time).toBe("13:21:00");
      expect(wrapper!.vm.draft.end).toMatchObject({ date: "2026-11-06", time: "14:02:03" });
    });

    it("sets a day's first and last second with the chips", async () => {
      createWrapper();
      await openMenu();

      el("date-time-range-start-sod")!.click();
      el("date-time-range-end-eod")!.click();
      await flushPromises();

      expect(wrapper!.vm.draft.start.time).toBe("00:00:00");
      expect(wrapper!.vm.draft.end.time).toBe("23:59:59");
    });

    it("switches the fields to 12h and keeps the choice for the next picker", async () => {
      createWrapper();
      await openMenu();

      wrapper!.vm.setHourFormat("12h");
      await flushPromises();

      expect(
        (document.querySelector('[data-test="datetime-start-time"] input') as HTMLInputElement)
          .value,
      ).toBe("01:47:03 PM");
      expect(localStorage.getItem("o2.hourFormat")).toBe("12h");
      expect(triggerRange()).toBe("Nov 4, 1:47:03 PM – Nov 6, 2:02:03 PM");
    });

    it("warns with the host's own message when the range is over the query limit", async () => {
      createWrapper({
        queryRangeRestrictionInHour: 24,
        queryRangeRestrictionMsg: "Limited to 1 day.",
      });
      await openMenu();

      editEdge("start", "2026-11-01", "00:00:00");
      await flushPromises();

      expect(el("date-time-range-note")?.getAttribute("data-kind")).toBe("warn");
      expect(el("date-time-range-note")?.textContent).toContain("Limited to 1 day.");
      expect((el("date-time-apply-btn") as HTMLButtonElement).disabled).toBe(false);
    });
  });

  describe("applying", () => {
    it("sends an End of 23:59:59 as the next midnight and keeps the payload shape", async () => {
      createWrapper();
      await openMenu();

      editEdge("start", "2026-11-05", "00:00:00");
      editEdge("end", "2026-11-05", "23:59:59");
      await flushPromises();
      wrapper!.vm.submitDraft();
      await flushPromises();

      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-11-05T00:00:00+05:30"),
        endTime: 1793903400000000,
        selectedDate: { from: "2026/11/05", to: "2026/11/05" },
        selectedTime: { startTime: "00:00:00", endTime: "23:59:59" },
        userChangedValue: true,
      });
      expect(triggerRange()).toBe("Nov 5");
    });

    it("reads an applied end at midnight back as the day before's 23:59:59", async () => {
      createWrapper({
        defaultAbsoluteTime: {
          startTime: micros("2026-11-05T00:00:00+05:30"),
          endTime: micros("2026-11-06T00:00:00+05:30"),
        },
      });
      await openMenu();

      expect(wrapper!.vm.draft.end).toMatchObject({ date: "2026-11-05", time: "23:59:59" });
      expect(el("date-time-range-summary-range")?.textContent).toBe("Nov 5, 00:00:00 – 23:59:59");
    });

    it("applies a valid draft when an auto-apply panel closes on an outside click", async () => {
      createWrapper({ autoApply: true });
      await openMenu();

      editEdge("start", "2026-11-04", "10:00:00");
      await closeMenu();

      expect(lastEmit()).toMatchObject({
        startTime: micros("2026-11-04T10:00:00+05:30"),
        endTime: END,
        userChangedValue: true,
      });
    });

    it("drops an invalid draft on an auto-apply close and keeps the applied range", async () => {
      createWrapper({ autoApply: true });
      await openMenu();
      const before = emits().length;

      editEdge("end", "2026-11-01", "09:00:00");
      await closeMenu();

      expect(emits()).toHaveLength(before);
      expect(trigger().attributes("data-end-us")).toBe(String(END));
      await openMenu();
      expect(wrapper!.vm.draft.end).toMatchObject({ date: "2026-11-06", time: "14:02:03" });
    });

    it("discards the draft on Esc, even on an auto-apply host", async () => {
      createWrapper({ autoApply: true });
      await openMenu();
      const before = emits().length;

      editEdge("start", "2026-11-04", "10:00:00");
      document
        .getElementById("date-time-menu")!
        .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await flushPromises();

      expect(wrapper!.vm.menuOpen).toBe(false);
      expect(emits()).toHaveLength(before);
      expect(trigger().attributes("data-start-us")).toBe(String(START));
    });

    it("discards the draft on close where the host has no auto-apply", async () => {
      createWrapper({ autoApply: false });
      await openMenu();
      const before = emits().length;

      editEdge("start", "2026-11-04", "10:00:00");
      await closeMenu();

      expect(emits()).toHaveLength(before);
    });

    it("does not apply the draft when the shift arrows close the panel", async () => {
      createWrapper({ autoApply: true });
      await openMenu();
      editEdge("start", "2026-11-04", "10:00:00");
      const prev = document.querySelector('[data-test="date-time-prev-btn"]')!;

      wrapper!.vm.onPointerDownOutside({ target: prev } as unknown as Event);
      await closeMenu();

      expect(trigger().attributes("data-start-us")).toBe(String(START));
    });

    it("keeps the applied absolute range when the panel opens and closes untouched", async () => {
      createWrapper({ autoApply: true });
      await openMenu();

      expect(wrapper!.vm.draft.start).toMatchObject({ date: "2026-11-04", time: "13:47:03" });
      await closeMenu();
      wrapper!.vm.refresh();
      await flushPromises();

      expect(lastEmit()).toMatchObject({ valueType: "absolute", startTime: START, endTime: END });
    });

    it("sends an exact 23:59:59 end from a setter as it came, without the extra second", async () => {
      createWrapper();
      await flushPromises();
      const end = micros("2026-11-05T23:59:59+05:30");

      wrapper!.vm.setAbsoluteTime(START, end);
      wrapper!.vm.refresh();
      await flushPromises();

      expect(lastEmit()).toMatchObject({ startTime: START, endTime: end });
    });

    it("keeps the pending day's date when End's time is typed after one calendar click", async () => {
      createWrapper();
      await openMenu();

      wrapper!.vm.onCalendarPending("2026/11/03");
      await flushPromises();
      editEdge("end", "", "18:00:00");
      await flushPromises();

      expect(wrapper!.vm.pendingEnd).toBe(false);
      expect(wrapper!.vm.draft.end).toMatchObject({ date: "2026-11-03", time: "18:00:00" });
    });

    it("keeps the draft's End time when only End's date is typed after one calendar click", async () => {
      createWrapper();
      await openMenu();

      wrapper!.vm.onCalendarPending("2026/11/03");
      await flushPromises();
      editEdge("end", "2026-11-04", "");
      await flushPromises();

      expect(wrapper!.vm.draft.end).toMatchObject({ date: "2026-11-04", time: "14:02:03" });
    });

    it("focuses the first incomplete part on Enter instead of applying", async () => {
      createWrapper();
      await openMenu();
      const before = emits().length;

      wrapper!.vm.onDraftEdge("start", { date: "2026-11-04", time: "", offset: "" });
      wrapper!.vm.onFieldStatus("startTime", "incomplete");
      await flushPromises();
      wrapper!.vm.submitDraft();
      await flushPromises();

      expect(emits()).toHaveLength(before);
      expect(el("date-time-range-start-error")?.textContent).toContain("Enter a full time");
      expect(document.activeElement).toBe(
        document.querySelector('[data-test="datetime-start-time"] input'),
      );
    });
  });
});
