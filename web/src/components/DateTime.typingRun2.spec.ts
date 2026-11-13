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

// Thu 2026-11-12 21:24:10 in IST.
const NOW = new Date("2026-11-12T15:54:10Z");
const IST = "Asia/Calcutta";
const micros = (iso: string) => Date.parse(iso) * 1000;
// Keys added in this run, read through i18n so the test holds before and after the locale merge.
const tr = (key: string) => String((i18n.global.t as unknown as (key: string) => string)(key));

describe("DateTime typed text, run 2", () => {
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
  const text = (dataTest: string) => (el(dataTest)?.textContent ?? "").replace(/\s+/g, " ").trim();

  const rows = () =>
    Array.from(
      document.querySelectorAll<HTMLElement>("[data-test='date-time-list'] [role='option']"),
    );
  const names = () => rows().map((row) => row.getAttribute("aria-label"));

  const lastEmit = () => {
    const events = wrapper!.emitted("on:date-change") as unknown[][];
    return events[events.length - 1][0] as Record<string, unknown>;
  };

  const typeInBar = async (value: string) => {
    const field = el("date-time-input-field") as HTMLInputElement;
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 150));
    await flushPromises();
  };

  const pressInBar = async (key: string) => {
    vi.setSystemTime(Date.now() + 1000);
    el("date-time-input-field")!.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true }),
    );
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

  describe("business periods [P4, C9, D-NAME]", () => {
    it("applies a running quarter fixed under its typed name", async () => {
      createWrapper();
      await openMenu();
      await typeInBar("Q4");
      expect(text("date-time-resolved-name")).toBe("Q4 2026");
      expect(el("date-time-preview-fixed")).not.toBeNull();

      await pressInBar("Enter");
      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-09-30T18:30:00Z"),
      });
    });

    it("applies a running fiscal year fixed as FY26 with its fiscal note", async () => {
      createWrapper();
      await openMenu();
      await typeInBar("FY26");
      expect(text("date-time-resolved-name")).toBe("FY26");
      expect(text("date-time-preview-note")).toContain("fiscal year starts Jan");

      await pressInBar("Enter");
      expect(lastEmit()).toMatchObject({ valueType: "absolute" });
    });

    it("applies this year typed as a number fixed as 2026", async () => {
      createWrapper();
      await openMenu();
      await typeInBar("2026");
      expect(text("date-time-resolved-name")).toBe("2026");

      await pressInBar("Enter");
      expect(lastEmit()).toMatchObject({ valueType: "absolute" });
    });

    it("shows a finished quarter by its name and dates, fixed", async () => {
      createWrapper();
      await openMenu();
      await typeInBar("Q3");
      expect(text("date-time-resolved-name")).toBe("Q3 2026");
      expect(text("date-time-resolved-range")).toBe("Jul 1 – Sep 30");
      expect(el("date-time-preview-fixed")).not.toBeNull();

      await pressInBar("Enter");
      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-06-30T18:30:00Z"),
        endTime: micros("2026-09-30T18:30:00Z"),
      });
    });
  });

  describe("calendar words on a recurring picker [C5, D-ROLLING]", () => {
    it.each([
      ["last week", "Last 7 days", "7d"],
      ["yesterday", "Last 1 day", "1d"],
      ["this month", "Last 30 days", "30d"],
      ["previous quarter", "Last 90 days", "90d"],
    ])("offers %s as its rolling equivalent and applies it", async (typed, name, period) => {
      createWrapper({ calendarPresets: false, rollingCalendarWords: true });
      await openMenu();
      await typeInBar(typed);
      expect(text("date-time-resolved-name")).toBe(name);
      expect(text("date-time-preview-note")).toBe(tr("dateTime.rollingHere"));

      await pressInBar("Enter");
      expect(lastEmit()).toMatchObject({ relativeTimePeriod: period });
      expect(lastEmit().valueType).not.toBe("absolute");
    });

    it("keeps calendar words as their dates on a dates-only picker", async () => {
      createWrapper({ calendarPresets: false, disableRelative: true, rollingCalendarWords: true });
      await openMenu();
      await typeInBar("last week");
      await pressInBar("Enter");
      expect(lastEmit()).toMatchObject({ valueType: "absolute" });
    });
  });

  describe("previews what Enter would say [P11]", () => {
    it("says a future day is in the future before Enter", async () => {
      createWrapper();
      await openMenu();
      await typeInBar("tomorrow");
      expect(text("date-time-preview-note")).toBe("That is in the future. Latest is now.");
      expect(el("date-time-list-example-0")).toBeNull();
    });

    it("notes an end cut to now", async () => {
      createWrapper();
      await openMenu();
      await typeInBar("today 20:00 - 23:00");
      expect(text("date-time-resolved-name")).toBe("Nov 12, 20:00:00 – 21:24:10");
      expect(text("date-time-preview-note")).toBe(tr("dateTime.cutToNow"));
    });

    it("names a count past ten years by its cap, with the note", async () => {
      createWrapper();
      await openMenu();
      await typeInBar("2030");
      expect(names()).toEqual([
        "Last 2,030 minutes",
        "Last 2,030 hours",
        "Last 2,030 days",
        "Last 520 weeks, cut to 10 years",
        "Last 10 years, cut to 10 years",
      ]);
      for (let i = 0; i < 4; i++) await pressInBar("ArrowDown");
      expect(text("date-time-resolved-name")).toBe("Last 10 years");
      expect(text("date-time-preview-note")).toBe("cut to 10 years");
    });
  });

  describe("slash dates [P10]", () => {
    it("notes the other day/month order when only it can apply", async () => {
      createWrapper();
      await openMenu();
      await typeInBar("12/10/2026");
      expect(text("date-time-resolved-name")).toBe("Oct 12");
      expect(text("date-time-preview-note")).toBe(tr("dateTime.readAsDayMonth"));
    });

    it("needs no note in the browser's own order", async () => {
      createWrapper();
      await openMenu();
      await typeInBar("10/12/2026");
      expect(text("date-time-resolved-name")).toBe("Oct 12");
      expect(text("date-time-preview-note")).toBe("");
    });

    it("gives a slash instant the anchor rows an ISO one gets", async () => {
      createWrapper();
      await openMenu();
      await typeInBar("11/12/2026 10:00:00");
      expect(rows()[0].getAttribute("data-test")).toMatch(/^date-time-list-anchor-/);
      expect(text("date-time-resolved-name")).toBe("± 5 min around Nov 12, 10:00:00");
    });

    it("anchors a flipped slash instant on the order that can apply, with the note", async () => {
      createWrapper();
      await openMenu();
      await typeInBar("12/11/2026 10:00:00");
      expect(rows()[0].getAttribute("data-test")).toMatch(/^date-time-list-anchor-/);
      expect(text("date-time-resolved-name")).toBe("± 5 min around Nov 12, 10:00:00");
      expect(text("date-time-preview-note")).toBe(tr("dateTime.readAsDayMonth"));
    });
  });

  describe("yearless dates where the future is allowed [C3]", () => {
    it("reads a yearless date as the coming one on a picker with no ceiling", async () => {
      createWrapper({ disableRelative: true, minDate: "2026/01/01", futureAllowed: true });
      await openMenu();
      await typeInBar("Dec 20 - Dec 22");
      await pressInBar("Enter");
      expect(lastEmit()).toMatchObject({
        startTime: micros("2026-12-19T18:30:00Z"),
        endTime: micros("2026-12-22T18:30:00Z"),
      });
    });

    it("rolls a yearless date already over into next year", async () => {
      createWrapper({ disableRelative: true, minDate: "2026/01/01", futureAllowed: true });
      await openMenu();
      await typeInBar("Jan 5");
      await pressInBar("Enter");
      expect(lastEmit()).toMatchObject({ startTime: micros("2027-01-04T18:30:00Z") });
    });

    it("keeps the past reading where the ceiling is now", async () => {
      createWrapper();
      await openMenu();
      await typeInBar("Dec 20");
      await pressInBar("Enter");
      expect(lastEmit()).toMatchObject({ startTime: micros("2025-12-19T18:30:00Z") });
    });
  });
});
