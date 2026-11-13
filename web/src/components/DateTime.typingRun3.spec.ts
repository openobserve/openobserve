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
const tr = (key: string) => String((i18n.global.t as unknown as (key: string) => string)(key));

describe("DateTime typed text, run 3", () => {
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
  const rowText = (row: HTMLElement) => (row.textContent ?? "").replace(/\s+/g, " ").trim();

  const emits = () => (wrapper!.emitted("on:date-change") ?? []) as unknown[][];
  const lastEmit = () => emits()[emits().length - 1][0] as Record<string, unknown>;

  const setBar = (value: string) => {
    const field = el("date-time-input-field") as HTMLInputElement;
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const typeInBar = async (value: string) => {
    setBar(value);
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

  describe("typed period names apply fixed and keep their name [D-NAME]", () => {
    it.each([
      ["Q4", "Q4 2026", "Oct 1 – Nov 12, 21:24", "2026-09-30T18:30:00Z"],
      ["H2", "H2 2026", "Jul 1 – Nov 12, 21:24", "2026-06-30T18:30:00Z"],
      ["2026", "2026", "Jan 1 – Nov 12, 21:24", "2025-12-31T18:30:00Z"],
      ["FY26", "FY26", "Jan 1 – Nov 12, 21:24", "2025-12-31T18:30:00Z"],
    ])("previews running %s as %s, fixed, cut to now", async (typed, name, range, start) => {
      createWrapper();
      await openMenu();
      await typeInBar(typed);
      expect(text("date-time-resolved-name")).toBe(name);
      expect(text("date-time-resolved-range")).toBe(range);
      expect(el("date-time-preview-fixed")).not.toBeNull();
      expect(el("date-time-preview-live")).toBeNull();

      await pressInBar("Enter");
      expect(lastEmit()).toMatchObject({ valueType: "absolute", startTime: micros(start) });
      expect(lastEmit().relativeTimePeriod ?? null).toBeNull();
    });

    it("names a finished quarter by its name and dates", async () => {
      createWrapper();
      await openMenu();
      await typeInBar("Q3");
      expect(text("date-time-resolved-name")).toBe("Q3 2026");
      expect(text("date-time-resolved-range")).toBe("Jul 1 – Sep 30");

      await pressInBar("Enter");
      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-06-30T18:30:00Z"),
        endTime: micros("2026-09-30T18:30:00Z"),
      });
    });

    it("lists named readings by name with a calendar icon and their dates", async () => {
      createWrapper();
      await openMenu();
      await typeInBar("Q3");
      const [first, second] = rows();
      expect(rowText(first)).toContain("Q3 2026");
      expect(rowText(first)).toContain("Jul 1 – Sep 30");
      expect(rowText(second)).toContain("Q3 2025");
      expect(first.querySelector("[data-icon], svg, i")?.outerHTML ?? "").not.toContain("schedule");
    });

    it("keeps the name where calendar presets are off", async () => {
      createWrapper({ calendarPresets: false });
      await openMenu();
      await typeInBar("Q4");
      expect(text("date-time-resolved-name")).toBe("Q4 2026");
      expect(text("date-time-resolved-range")).toBe("Oct 1 – Nov 12, 21:24");
    });
  });

  describe("calendar words without calendar presets [D-ROLLING]", () => {
    it.each([
      ["yesterday", "2026-11-10T18:30:00Z", "2026-11-11T18:30:00Z"],
      ["last week", "2026-10-31T18:30:00Z", "2026-11-07T18:30:00Z"],
    ])("applies %s as its exact period by default", async (typed, start, end) => {
      createWrapper({ calendarPresets: false });
      await openMenu();
      await typeInBar(typed);
      expect(text("date-time-preview-note")).not.toBe(tr("dateTime.rollingHere"));

      await pressInBar("Enter");
      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros(start),
        endTime: micros(end),
      });
    });

    it("offers the rolling length only where the picker opts in", async () => {
      createWrapper({ calendarPresets: false, rollingCalendarWords: true });
      await openMenu();
      await typeInBar("yesterday");
      expect(text("date-time-resolved-name")).toBe("Last 1 day");
      expect(text("date-time-preview-note")).toBe(tr("dateTime.rollingHere"));

      await pressInBar("Enter");
      expect(lastEmit()).toMatchObject({ relativeTimePeriod: "1d" });
    });
  });

  describe("fast Enter [fresh#7]", () => {
    it.each([
      ["Q3", "2026-06-30T18:30:00Z"],
      ["H1", "2025-12-31T18:30:00Z"],
      ["2025", "2024-12-31T18:30:00Z"],
    ])("applies %s on an Enter pressed before the text was read", async (typed, start) => {
      createWrapper();
      await openMenu();
      setBar(typed);
      await pressInBar("Enter");
      expect(emits().length).toBeGreaterThan(0);
      expect(lastEmit()).toMatchObject({ valueType: "absolute", startTime: micros(start) });
      expect(wrapper!.vm.menuOpen).toBe(false);
    });

    it("applies a pasted instant's preferred window on an immediate Enter", async () => {
      createWrapper();
      await openMenu();
      setBar("1794454200000000");
      await pressInBar("Enter");
      expect(emits().length).toBeGreaterThan(0);
      expect(lastEmit()).toMatchObject({ valueType: "absolute" });
      const { startTime, endTime } = lastEmit() as { startTime: number; endTime: number };
      expect((startTime + endTime) / 2).toBe(1794454200000000);
    });
  });

  describe("cut and duration notes", () => {
    it("notes a week count cut to ten years [visual #7]", async () => {
      createWrapper();
      await openMenu();
      await typeInBar("2025w");
      expect(text("date-time-resolved-name")).toBe("Last 520 weeks");
      expect(text("date-time-preview-note")).toBe(tr("dateTime.cutToTenYears"));
    });

    it("marks the capped week count of a bare year as cut in its row [visual #7]", async () => {
      createWrapper();
      await openMenu();
      await typeInBar("2025");
      const weeks = rows().find((row) => rowText(row).startsWith("Last 520 weeks"));
      expect(rowText(weeks!)).toContain(tr("dateTime.cutToTenYears"));
    });

    it("gives a zone-typed reading row its duration, not the zone [a8]", async () => {
      createWrapper();
      await openMenu();
      await typeInBar("Nov 11 9:00 - 17:00 UTC");
      const row = rows()[0];
      expect(rowText(row)).toContain("8h");
      expect(rowText(row)).not.toMatch(/UTC$/);
    });
  });

  describe("yearless dates against the ceiling [D-CEILING]", () => {
    it("reads yesterday's date as this year on a dates-only picker floored by minDate", async () => {
      createWrapper({
        disableRelative: true,
        hideRelativeTime: true,
        minDate: "2026/11/09",
      });
      await openMenu();
      await typeInBar("Nov 11");
      await pressInBar("Enter");
      const { startTime } = lastEmit() as { startTime: number };
      expect(startTime).toBe(micros("2026-11-10T18:30:00Z"));
    });

    it("refuses a future date there instead of saving it", async () => {
      createWrapper({
        disableRelative: true,
        hideRelativeTime: true,
        minDate: "2026/11/09",
      });
      await openMenu();
      const before = emits().length;
      await typeInBar("Nov 20 - Nov 22");
      await pressInBar("Enter");
      expect(emits().length).toBe(before);
    });
  });
});
