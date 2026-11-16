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
import { timeRangePinsKey } from "@/composables/useTimeRangePins";

vi.mock("@/utils/timeInputFailure", () => ({ reportParseFailure: vi.fn() }));

// The spec's clock: Thu 2026-11-12 21:24:10 in IST.
const NOW = new Date("2026-11-12T15:54:10Z");
const IST = "Asia/Calcutta";
const micros = (iso: string) => Date.parse(iso) * 1000;
const Q4_2026 = {
  kind: "fixed",
  startUs: micros("2026-09-30T18:30:00Z"),
  endUs: micros("2026-12-31T18:30:00Z"),
};
const Q3_2026 = {
  kind: "fixed",
  startUs: micros("2026-06-30T18:30:00Z"),
  endUs: micros("2026-09-30T18:30:00Z"),
};
const INCIDENT = {
  kind: "fixed",
  startUs: micros("2026-11-12T15:38:49Z"),
  endUs: micros("2026-11-12T15:48:49Z"),
};
const HISTORY_KEY = timeRangeHistoryKey("default", "example@gmail.com");
const PINS_KEY = timeRangePinsKey("default", "example@gmail.com");
const tr = (key: string, params: Record<string, unknown> = {}) =>
  String((i18n.global.t as unknown as (k: string, p: object) => string)(key, params));
const tp = (key: string, count: number) =>
  String(
    (i18n.global.t as unknown as (k: string, p: object, n: number) => string)(
      key,
      { count },
      count,
    ),
  );

describe("DateTime round 2", () => {
  let wrapper: VueWrapper<InstanceType<typeof DateTime>> | null = null;

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
  const storedPins = () =>
    JSON.parse(localStorage.getItem(PINS_KEY) ?? "[]") as { range: Record<string, unknown> }[];

  const typeInBar = async (value: string) => {
    const field = el("date-time-input-field") as HTMLInputElement;
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 150));
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

  describe("pin star in the summary row", () => {
    it("pins the applied range and then offers to unpin it", async () => {
      createWrapper({ range: INCIDENT });
      await flushPromises();
      await openMenu();
      const star = el("date-time-pin-btn")!;
      expect(star.getAttribute("aria-label")).toBe(tr("dateTime.pinThisRange"));
      star.click();
      await flushPromises();
      expect(storedPins().map((pin) => pin.range)).toEqual([
        { startUs: INCIDENT.startUs, endUs: INCIDENT.endUs },
      ]);
      expect(el("date-time-pin-btn")!.getAttribute("aria-pressed")).toBe("true");
      el("date-time-pin-btn")!.click();
      await flushPromises();
      expect(storedPins()).toEqual([]);
    });

    it("pins a live range as its token", async () => {
      createWrapper({ defaultRelativeTime: "6h" });
      await flushPromises();
      await openMenu();
      el("date-time-pin-btn")!.click();
      await flushPromises();
      expect(storedPins().map((pin) => pin.range)).toEqual([{ relative: "6h" }]);
    });

    it("pins the applied range on Alt+P when no row has the cursor", async () => {
      createWrapper({ range: INCIDENT });
      await flushPromises();
      await openMenu();
      el("date-time-input-field")!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "p", code: "KeyP", altKey: true, bubbles: true }),
      );
      await flushPromises();
      expect(storedPins()).toHaveLength(1);
    });

    it("hides while the panel holds a draft", async () => {
      createWrapper({ range: INCIDENT });
      await flushPromises();
      await openMenu();
      await typeInBar("2h");
      expect(el("date-time-pin-btn")).toBeNull();
    });
  });

  describe("Recent rows name the page they came from", () => {
    it("tags a range applied on another page with that page", async () => {
      localStorage.setItem(
        HISTORY_KEY,
        JSON.stringify([
          { startUs: INCIDENT.startUs, endUs: INCIDENT.endUs, source: "Logs" },
          { relative: "6h", source: "Traces" },
        ]),
      );
      createWrapper({ hostName: "Traces" });
      await flushPromises();
      await openMenu();
      const recent = rows().map(rowText);
      const fromLogs = recent.find((row) => row.includes("21:08:49"));
      expect(fromLogs).toContain(`${tr("dateTime.fromPage", { page: "Logs" })} · 10m`);
      const own = recent.find((row) => row.includes(tp("common.pastHour", 6)));
      expect(own ?? "").not.toContain(tr("dateTime.fromPage", { page: "Traces" }));
    });

    it("records the range it replaces with this page as its source", async () => {
      createWrapper({ range: INCIDENT, hostName: "Logs" });
      await flushPromises();
      await openMenu();
      wrapper!.vm.pickChip("4h");
      await flushPromises();
      const stored = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
      expect(stored[0]).toEqual({
        startUs: INCIDENT.startUs,
        endUs: INCIDENT.endUs,
        source: "Logs",
      });
    });
  });

  describe("stepper names", () => {
    it("names a calendar period's steps by its unit", async () => {
      createWrapper({
        preset: "dashboard",
        range: { kind: "calendar", unit: "quarter", offset: -1 },
      });
      await flushPromises();
      expect(el("date-time-prev-btn")!.getAttribute("aria-label")).toBe(
        tr("dateTime.backOne", { unit: tr("dateTime.unitQuarter") }),
      );
      expect(el("date-time-next-btn")!.getAttribute("aria-label")).toBe(
        tr("dateTime.forwardOne", { unit: tr("dateTime.unitQuarter") }),
      );
    });

    it("names a step that returns to the live range it started from", async () => {
      createWrapper({ defaultRelativeTime: "15m" });
      await flushPromises();
      wrapper!.vm.shiftTimeRange("prev");
      await flushPromises();
      expect(el("date-time-next-btn")!.getAttribute("aria-label")).toBe(
        tr("dateTime.backTo", { range: tp("common.pastMinute", 15) }),
      );
    });
  });

  describe("a fixed range that is exactly a calendar period steps by that period", () => {
    it("names its steps by the period's unit", async () => {
      createWrapper({ preset: "dashboard", range: Q3_2026 });
      await flushPromises();
      expect(el("date-time-prev-btn")!.getAttribute("aria-label")).toBe(
        tr("dateTime.backOne", { unit: tr("dateTime.unitQuarter") }),
      );
      expect(wrapper!.vm.stepTooltip.prev.window).toContain("Q2 2026");
    });

    it("steps back to the previous quarter, not back 92 days", async () => {
      createWrapper({ preset: "dashboard", range: Q3_2026 });
      await flushPromises();
      wrapper!.vm.shiftTimeRange("prev");
      await flushPromises();
      expect(wrapper!.vm.getRange()).toEqual({
        kind: "fixed",
        startUs: micros("2026-03-31T18:30:00Z"),
        endUs: micros("2026-06-30T18:30:00Z"),
      });
    });

    it("steps forward into the quarter in progress with its real end", async () => {
      createWrapper({ preset: "dashboard", range: Q3_2026 });
      await flushPromises();
      wrapper!.vm.shiftTimeRange("next");
      await flushPromises();
      expect(wrapper!.vm.getRange()).toEqual(Q4_2026);
      expect(el("date-time-next-btn")!.hasAttribute("disabled")).toBe(true);
    });
  });

  describe("calendar rows carry their period name", () => {
    it("names a quarter in the row meta beside its dates", async () => {
      createWrapper({ preset: "dashboard" });
      await flushPromises();
      await openMenu();
      const text = (id: string) => rowText(el(id)!);
      expect(text("date-time-list-calendar-last-quarter")).toContain("Q3 2026 · Jul 1 – Sep 30");
      expect(text("date-time-list-calendar-this-quarter")).toContain("Q4 2026 · Oct 1 – now");
    });
  });

  describe("a fixed range still in progress on the trigger", () => {
    it("tags it with when it ends and shows today as its end on a dashboard", async () => {
      createWrapper({ preset: "dashboard", range: Q4_2026 });
      await flushPromises();
      expect(text("date-time-trigger-ends")).toBe(tr("dateTime.endsWhen", { when: "Dec 31" }));
      expect(text("date-time-trigger-dates")).toContain("Oct 1 – Nov 12, 2026");
    });

    it("adds the in-progress line to the trigger tooltip", async () => {
      createWrapper({ preset: "dashboard", range: Q4_2026 });
      await flushPromises();
      expect(wrapper!.vm.triggerTooltip?.progress).toBe(
        tr("dateTime.inProgressRefresh", { end: "Dec 31" }),
      );
    });

    it("has no ends tag on a range that has ended", async () => {
      createWrapper({ range: INCIDENT });
      await flushPromises();
      expect(el("date-time-trigger-ends")).toBeNull();
      expect(wrapper!.vm.triggerTooltip?.progress).toBeFalsy();
    });
  });

  describe("label forms step down to fit the slot", () => {
    const fakeWidths = (slot: number) => {
      vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
        this: HTMLElement,
      ) {
        return this.dataset?.test === "date-time-trigger-label" ? slot : 0;
      });
      vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (
        this: HTMLElement,
      ) {
        return (this.textContent ?? "").length * 8;
      });
    };

    it("drops a live explorer name to its short form when the full one does not fit", async () => {
      fakeWidths(60);
      createWrapper({ defaultRelativeTime: "15m" });
      await flushPromises();
      await wrapper!.vm.fitTriggerLabel();
      expect(text("date-time-trigger-name")).toBe("15m");
    });

    it("keeps the full form when it fits", async () => {
      fakeWidths(400);
      createWrapper({ defaultRelativeTime: "15m" });
      await flushPromises();
      await wrapper!.vm.fitTriggerLabel();
      expect(text("date-time-trigger-name")).toBe(tp("common.pastMinute", 15));
    });

    it("keeps a dashboard range's dates in its last form", async () => {
      fakeWidths(10);
      createWrapper({
        preset: "dashboard",
        range: { kind: "calendar", unit: "quarter", offset: -1 },
      });
      await flushPromises();
      await wrapper!.vm.fitTriggerLabel();
      expect(el("date-time-trigger-name")).toBeNull();
      expect(text("date-time-trigger-dates")).toBe("Jul 1 – Sep 30, 2026");
    });
  });

  describe("kind tag of an ended calendar period in the summary", () => {
    it("says when the period changes instead of live", async () => {
      createWrapper({
        preset: "dashboard",
        range: { kind: "calendar", unit: "quarter", offset: -1 },
      });
      await flushPromises();
      await openMenu();
      expect(text("date-time-preview-changes")).toBe(tr("dateTime.changesWhen", { when: "Jan 1" }));
      expect(el("date-time-preview-live")).toBeNull();
    });

    it("offers no Freeze on an ended period, which already names fixed dates", async () => {
      createWrapper({
        preset: "dashboard",
        range: { kind: "calendar", unit: "quarter", offset: -1 },
      });
      await flushPromises();
      await openMenu();
      expect(el("date-time-freeze-btn")).toBeNull();
    });

    it("keeps live on a running period", async () => {
      createWrapper({
        preset: "dashboard",
        range: { kind: "calendar", unit: "quarter", offset: 0 },
      });
      await flushPromises();
      await openMenu();
      expect(el("date-time-preview-changes")).toBeNull();
      expect(el("date-time-preview-live")).not.toBeNull();
    });
  });

  describe("undo ref method", () => {
    it("undoes the last applied change, emitting apply as the undo button does", async () => {
      createWrapper({ defaultRelativeTime: "15m" });
      await flushPromises();
      wrapper!.vm.pickChip("4h");
      await flushPromises();
      expect(wrapper!.vm.undo()).toBe(true);
      await flushPromises();
      expect(wrapper!.emitted("apply")?.at(-1)?.[0]).toEqual({ kind: "rolling", span: "15m" });
      expect((wrapper!.emitted("apply")?.at(-1)?.[1] as { source: string }).source).toBe("undo");
      expect(wrapper!.vm.undo()).toBe(false);
    });
  });
});
