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
import { currentSearchAroundUser, readSearchAroundChoice } from "@/utils/searchAroundWindow";

vi.mock("@/utils/timeInputFailure", () => ({ reportParseFailure: vi.fn() }));

const NOW = new Date("2026-11-12T15:54:10Z");
const IST = "Asia/Calcutta";
const micros = (iso: string) => Date.parse(iso) * 1000;

describe("DateTime typed text", () => {
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
  const names = () => rows().map((row) => row.getAttribute("aria-label"));

  const lastEmit = () => {
    const events = wrapper!.emitted("on:date-change") as unknown[][];
    return events[events.length - 1][0] as Record<string, unknown>;
  };
  const emitCount = () => (wrapper!.emitted("on:date-change") ?? []).length;

  const typeInBar = async (text: string) => {
    const field = el("date-time-input-field") as HTMLInputElement;
    field.value = text;
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

  it("keeps the name of a typed period that has started (V6)", async () => {
    createWrapper();
    await openMenu();
    await typeInBar("Q4");
    expect(el("date-time-resolved-name")?.textContent).toBe("Q4 2026");

    await pressInBar("Enter");
    expect(wrapper!.vm.triggerLabel).toBe("Q4 2026 · Oct 1 – Nov 12, 21:24");
  });

  it("greys a typed range over the limit and offers the longest allowed before it (V9)", async () => {
    createWrapper({ queryRangeRestrictionInHour: 24 });
    await openMenu();
    await typeInBar("Nov 1 - 6");

    expect(names().slice(0, 2)).toEqual(["Nov 1 – 6, Max 1d", "Nov 6, Longest allowed"]);
    expect(rows()[0].getAttribute("aria-disabled")).toBe("true");
    expect(rows()[1].getAttribute("aria-selected")).toBe("true");
    expect(el("date-time-preview-note")?.textContent).toBe("Nov 1 - 6 is over the 1-day limit");

    await pressInBar("Enter");
    expect(lastEmit()).toMatchObject({
      startTime: micros("2026-11-05T18:30:00Z"),
      endTime: micros("2026-11-06T18:30:00Z"),
    });
  });

  it("applies the first filtered row on Enter when the text reads as nothing (V13)", async () => {
    createWrapper();
    await openMenu();
    await typeInBar("prev");
    const before = emitCount();

    await pressInBar("Enter");
    expect(el("date-time-input-error")).toBeNull();
    expect(emitCount()).toBe(before + 1);
    expect(lastEmit()).toMatchObject({ valueType: "relative" });
  });

  it("remembers the anchor window picked for a pasted instant (V14)", async () => {
    createWrapper();
    await openMenu();
    await typeInBar("1794498229948025");
    await pressInBar("ArrowDown");
    await pressInBar("Enter");

    expect(readSearchAroundChoice(currentSearchAroundUser(store.state))).toBe("t1");
    await openMenu();
    await typeInBar("1794498229948025");
    expect(el("date-time-list-anchor-1m")?.getAttribute("aria-selected")).toBe("true");
  });

  it("keeps the morning reading of a range that starts in a DST gap (V18)", async () => {
    store.state.timezone = "America/New_York";
    createWrapper();
    await openMenu();
    await typeInBar("Mar 8 2:30 - 3:30");
    expect(names()[0]).toBe("Mar 8, 03:30 – 04:30, 1h");

    await typeInBar("Mar 8 02:30 - 03:30");

    expect(el("date-time-preview-note")?.textContent).toBe(
      "02:30 does not exist on Mar 8 · using 03:30",
    );
    await pressInBar("Enter");
    expect(lastEmit()).toMatchObject({
      startTime: micros("2026-03-08T07:30:00Z"),
      endTime: micros("2026-03-08T08:30:00Z"),
    });
  });

  it("names which instant each DST repeated-hour row is (V19)", async () => {
    store.state.timezone = "America/New_York";
    createWrapper();
    await openMenu();
    await typeInBar("Nov 1 1:30 - 1:45");

    const labels = names().slice(0, 2).join(" | ");
    expect(labels).toContain("01:30 – 01:45 EDT (UTC-04:00)");
    expect(labels).toContain("01:30 – 01:45 EST (UTC-05:00)");
    expect(labels).not.toContain("T05:30");
  });

  it("greys a typed day wholly outside retention (V21)", async () => {
    createWrapper({ retentionDays: 3 });
    await openMenu();
    await typeInBar("Nov 5");

    const row = rows()[0];
    expect(row.getAttribute("aria-label")).toBe("Nov 5, Outside 3-day retention");
    expect(row.getAttribute("aria-disabled")).toBe("true");
  });

  it("reads day and month in the browser's order, not the UI language's (V24)", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-GB", "en"]);
    createWrapper();
    await openMenu();
    await typeInBar("4/11");

    expect(names()[0]).toMatch(/^Nov 4\b/);
  });

  it("groups the digits of a long count (P1)", async () => {
    createWrapper();
    await openMenu();
    await typeInBar("2025");

    expect(names()).toContain("Last 2,025 minutes");
  });

  it("does not repeat the dates as the name of an unnamed calendar period (P2)", async () => {
    createWrapper();
    await openMenu();
    await typeInBar("2w ago");

    const text = (dataTest: string) =>
      (el(dataTest)?.textContent ?? "").replace(/\s+/g, " ").trim();
    expect(text("date-time-resolved-name")).toBe("Oct 25 – 31");
    expect(text("date-time-resolved-range")).toBe("");
  });

  it("leaves out milliseconds an epoch in seconds never had (P2)", async () => {
    createWrapper();
    await openMenu();
    await typeInBar("1794498229");

    expect(el("date-time-resolved-name")?.textContent).toBe("± 5 min around Nov 12, 21:13:49");
    expect(names()[0]).not.toContain(".000");
  });

  it("says read as UTC for a stamp written in UTC (P2)", async () => {
    createWrapper();
    await openMenu();
    await typeInBar("2026-11-12T10:00:00Z");

    expect(el("date-time-preview-note")?.textContent).toBe("read as UTC");
  });

  it("offers the as UTC toggle for machine stamps only (P2)", async () => {
    createWrapper();
    await openMenu();
    await typeInBar("Nov 6, 2026 14:02:11");
    expect(el("date-time-as-utc-toggle")).toBeNull();

    await typeInBar("2026-11-06 14:02:11");
    expect(el("date-time-as-utc-toggle")).not.toBeNull();
  });

  it("treats a lone clock time as an instant with anchor rows (P3)", async () => {
    createWrapper();
    await openMenu();
    await typeInBar("11:38");

    expect(rows()[0].getAttribute("data-test")).toBe("date-time-list-anchor-5m");
    expect(el("date-time-resolved-name")?.textContent).toBe("± 5 min around Nov 12, 11:38:00");
  });
});
