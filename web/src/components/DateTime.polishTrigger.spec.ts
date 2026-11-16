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

const NOW = new Date("2026-11-16T10:00:00Z");
const IST = "Asia/Calcutta";
const micros = (iso: string) => Date.parse(iso) * 1000;
const tr = (key: string) => String((i18n.global.t as unknown as (k: string) => string)(key));
const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const otherZone = browserZone === IST ? "America/New_York" : IST;

describe("DateTime trigger (V1, R2, R9)", () => {
  let wrapper: VueWrapper<InstanceType<typeof DateTime>> | null = null;

  const createWrapper = (props: Record<string, unknown> = {}) => {
    wrapper = mount(DateTime, {
      props,
      attachTo: document.body,
      global: { plugins: [i18n, store] },
    });
    return wrapper;
  };
  const el = (dataTest: string) => document.querySelector<HTMLElement>(`[data-test="${dataTest}"]`);
  const text = (dataTest: string) => (el(dataTest)?.textContent ?? "").replace(/\s+/g, " ").trim();
  // The label slot is `slot` px wide, each character takes 8 px and the clock icon 16 px.
  const fakeWidths = (slot: number) => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.dataset?.test === "date-time-trigger-label" ? slot : 0;
    });
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.dataset?.test !== "date-time-trigger-label") return 0;
      const icon = document.querySelector("[data-test='date-time-trigger-icon']") ? 16 : 0;
      return (this.textContent ?? "").length * 8 + icon;
    });
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

  it("drops the clock icon before the dashboard label shortens, and keeps the zone label", async () => {
    createWrapper({ preset: "dashboard", defaultRelativeTime: "6h" });
    await flushPromises();
    const full = text("date-time-trigger-label");
    fakeWidths(full.length * 8 + 8);
    await wrapper!.vm.fitTriggerLabel();
    expect(el("date-time-trigger-icon")).toBeNull();
    expect(text("date-time-trigger-label")).toBe(full);
    expect(wrapper!.vm.triggerFormIndex).toBe(0);
    expect(el("date-time-zone-badge")).not.toBeNull();
    expect(el("date-time-zone-dot")).toBeNull();
  });

  it("keeps the clock icon when the full label fits", async () => {
    fakeWidths(800);
    createWrapper({ defaultRelativeTime: "15m" });
    await flushPromises();
    await wrapper!.vm.fitTriggerLabel();
    expect(el("date-time-trigger-icon")).not.toBeNull();
  });

  it("gives the explorer zone dot a role, a name and a tooltip", async () => {
    fakeWidths(10);
    store.state.timezone = otherZone;
    createWrapper({
      defaultType: "absolute",
      defaultAbsoluteTime: {
        startTime: micros("2026-11-15T20:30:00Z"),
        endTime: micros("2026-11-16T03:30:00Z"),
      },
    });
    await flushPromises();
    await wrapper!.vm.fitTriggerLabel();
    const dot = el("date-time-zone-dot")!;
    expect(dot).not.toBeNull();
    expect(dot.getAttribute("role")).toBe("img");
    expect(dot.getAttribute("aria-label")).toBe(wrapper!.vm.zoneBadgeText);
    expect(dot.hasAttribute("aria-hidden")).toBe(false);
  });

  it("puts the funnel in the clock's place when the query narrows the window", async () => {
    createWrapper({
      narrowedByQuery: {
        startUs: micros("2026-11-16T09:55:00Z"),
        endUs: micros("2026-11-16T09:55:01Z"),
      },
    });
    await flushPromises();
    const icon = el("date-time-trigger-narrowed")!;
    expect(icon).not.toBeNull();
    expect(el("date-time-trigger-icon")).toBeNull();
    const label = el("date-time-trigger-label")!;
    expect(icon.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("marks a refused over-limit range with a lock", async () => {
    createWrapper({
      defaultRelativeTime: "7d",
      queryRangeRestrictionInHour: 24,
      limitRefused: true,
    });
    await flushPromises();
    expect(el("date-time-trigger-lock")).not.toBeNull();
    expect(wrapper!.vm.getConsumableDateTime().relativeTimePeriod).toBe("7d");
  });

  it("clamps a too-long range when the page does not refuse it", async () => {
    createWrapper({ defaultRelativeTime: "7d", queryRangeRestrictionInHour: 24 });
    await flushPromises();
    expect(el("date-time-trigger-lock")).toBeNull();
    expect(wrapper!.vm.getConsumableDateTime().relativeTimePeriod).not.toBe("7d");
  });

  it("carries a timer mark, named for panel-specific time, when a panel keeps its own time", async () => {
    createWrapper({ preset: "dashboard", panelTimeMark: true });
    await flushPromises();
    const mark = el("date-time-panel-time-mark")!;
    expect(mark.getAttribute("aria-label")).toBe(tr("dashboard.panelTimeEnabled"));
    expect(mark.getAttribute("role")).toBe("img");
  });

  it("exposes the trigger width at its shortest form for the toolbar budget", async () => {
    createWrapper({ defaultRelativeTime: "15m" });
    await flushPromises();
    expect(typeof wrapper!.vm.shortestFormWidth()).toBe("number");
  });
});
