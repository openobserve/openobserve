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

// The spec's clock: Thu 2026-11-12 21:24:10 in IST.
const NOW = new Date("2026-11-12T15:54:10Z");
const IST = "Asia/Calcutta";
const micros = (iso: string) => Date.parse(iso) * 1000;
const tr = (key: string, params: Record<string, unknown> = {}) =>
  String((i18n.global.t as unknown as (k: string, p: object) => string)(key, params));

describe("DateTime typed text, grammar v3", () => {
  let wrapper: VueWrapper<InstanceType<typeof DateTime>> | null = null;
  const settings = store.state.organizationData.organizationSettings as Record<string, unknown>;

  const createWrapper = (props: Record<string, unknown> = {}) => {
    wrapper = mount(DateTime, {
      props: { ...props },
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
  const activeRows = () => rows().filter((row) => row.getAttribute("aria-selected") === "true");

  const emits = () => (wrapper!.emitted("on:date-change") ?? []) as unknown[][];
  const lastEmit = () => emits()[emits().length - 1][0] as Record<string, unknown>;

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
    delete settings.fiscal_year_start_month;
    localStorage.clear();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
    delete settings.fiscal_year_start_month;
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("a typed period in progress keeps its real end (O1)", () => {
    it("lists Q4 2026 with the live twin and Q4 2025, cursor on the first", async () => {
      createWrapper({ preset: "dashboard" });
      await openMenu();
      await typeInBar("Q4");
      const labels = rows().map(rowText);
      expect(labels[0]).toContain("Q4 2026");
      expect(labels[1]).toContain(tr("common.thisQuarter"));
      expect(labels[2]).toContain("Q4 2025");
      expect(activeRows().map(rowText)[0]).toContain("Q4 2026");
      expect(text("date-time-list-heading")).toBe(
        tr("dateTime.periodInProgress", { period: "Q4 2026", date: "Dec 31" }),
      );
    });

    it("applies Q4 fixed with its end on Dec 31, not cut to now", async () => {
      createWrapper();
      await openMenu();
      await typeInBar("Q4");
      await pressInBar("Enter");
      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-09-30T18:30:00Z"),
        endTime: micros("2026-12-31T18:30:00Z"),
      });
    });

    it("applies since 9am up to the end of today", async () => {
      createWrapper();
      await openMenu();
      await typeInBar("since 9am");
      await pressInBar("Enter");
      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2026-11-12T03:30:00Z"),
        endTime: micros("2026-11-12T18:30:00Z"),
      });
    });
  });

  describe("text with two readings waits for a pick", () => {
    it("lists 15M as months then minutes with no cursor, and Enter does nothing", async () => {
      createWrapper();
      await openMenu();
      await typeInBar("15M");
      expect(text("date-time-list-heading")).toBe(tr("dateTime.twoReadings", { text: "15M" }));
      expect(rows().slice(0, 2).map(rowText)).toEqual([
        expect.stringContaining("15 months"),
        expect.stringContaining("15 minutes"),
      ]);
      expect(activeRows().map(rowText)).toEqual([]);
      const before = emits().length;
      await pressInBar("Enter");
      expect(emits()).toHaveLength(before);
    });

    it("applies the reading picked with the arrow key", async () => {
      createWrapper();
      await openMenu();
      await typeInBar("15M");
      await pressInBar("ArrowDown");
      await pressInBar("Enter");
      expect(lastEmit()).toMatchObject({ valueType: "relative", relativeTimePeriod: "15M" });
    });

    it("lists a bare number as minutes, hours and days", async () => {
      createWrapper();
      await openMenu();
      await typeInBar("9");
      expect(rows().slice(0, 3).map(rowText)).toEqual([
        expect.stringContaining("9 minutes"),
        expect.stringContaining("9 hours"),
        expect.stringContaining("9 days"),
      ]);
      const before = emits().length;
      await pressInBar("Enter");
      expect(emits()).toHaveLength(before);
    });
  });

  describe("answers that are not ranges", () => {
    it("answers a comparison with both periods as rows and applies neither on Enter", async () => {
      createWrapper({ preset: "dashboard" });
      await openMenu();
      await typeInBar("this quarter vs last quarter");
      expect(text("date-time-list-heading")).toBe(tr("dateTime.compareNotAvailable"));
      expect(rows().slice(0, 2).map(rowText)).toEqual([
        expect.stringContaining(tr("common.thisQuarter")),
        expect.stringContaining(tr("dateTime.previousQuarter")),
      ]);
      const before = emits().length;
      await pressInBar("Enter");
      expect(emits()).toHaveLength(before);
    });

    it("says FY needs the org's fiscal start, and applies nothing", async () => {
      createWrapper();
      await openMenu();
      await typeInBar("FY26");
      expect(text("date-time-preview-note")).toBe(tr("dateTime.fiscalYearUnset"));
      const before = emits().length;
      await pressInBar("Enter");
      expect(emits()).toHaveLength(before);
    });

    it("reads FY26 from the org's fiscal start month", async () => {
      settings.fiscal_year_start_month = 4;
      createWrapper();
      await openMenu();
      await typeInBar("FY26");
      await pressInBar("Enter");
      expect(lastEmit()).toMatchObject({
        valueType: "absolute",
        startTime: micros("2025-03-31T18:30:00Z"),
        endTime: micros("2026-03-31T18:30:00Z"),
      });
    });

    it("says next week is in the future", async () => {
      createWrapper();
      await openMenu();
      await typeInBar("next week");
      expect(text("date-time-preview-note")).toBe(tr("common.timeRangeStartInFuture"));
    });

    it("shows three examples after an Enter that read nothing", async () => {
      createWrapper();
      await openMenu();
      await typeInBar("banana");
      await pressInBar("Enter");
      expect(text("date-time-list-heading")).toBe(tr("common.timeRangeInputError"));
      const shown = rows().map(rowText);
      expect(shown).toHaveLength(3);
      expect(shown[0].startsWith("2h")).toBe(true);
      expect(shown[1].startsWith("yesterday 9-17")).toBe(true);
      expect(shown[2].startsWith("Nov 4 – 6")).toBe(true);
    });

    it("teaches with the dashboard examples on a dashboard", async () => {
      createWrapper({ preset: "dashboard" });
      await openMenu();
      await typeInBar("banana");
      expect(text("date-time-list-heading")).toBe(tr("dateTime.noMatchYet"));
      expect(rowText(rows()[0])).toContain("last quarter");
      expect(rows()).toHaveLength(5);
    });
  });

  describe("a host that stores rolling ranges only", () => {
    it("greys a calendar word and puts the cursor on the closest rolling range", async () => {
      createWrapper({ preset: "form", capabilities: { kinds: ["rolling"] }, hostName: "Reports" });
      await openMenu();
      await typeInBar("yesterday");
      const [word, closest] = rows();
      expect(rowText(word)).toContain(tr("common.yesterday"));
      expect(rowText(word)).toContain(tr("dateTime.notAvailableIn", { host: "Reports" }));
      expect(word.getAttribute("aria-disabled")).toBe("true");
      expect(rowText(closest)).toContain(tr("dateTime.closestMatch"));
      expect(closest.getAttribute("aria-selected")).toBe("true");
      await pressInBar("Enter");
      expect(lastEmit()).toMatchObject({ valueType: "relative", relativeTimePeriod: "24h" });
    });
  });
});
