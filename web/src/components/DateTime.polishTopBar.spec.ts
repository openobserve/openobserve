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

const NOW = new Date("2026-11-12T15:54:10Z");
const IST = "Asia/Calcutta";
const tr = (key: string) => String((i18n.global.t as unknown as (k: string) => string)(key));

describe("DateTime top bar (V4, R11)", () => {
  let wrapper: VueWrapper<InstanceType<typeof DateTime>> | null = null;

  const createWrapper = (props: Record<string, unknown> = {}) => {
    wrapper = mount(DateTime, {
      props,
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
  const el = (dataTest: string) => document.querySelector<HTMLElement>(`[data-test="${dataTest}"]`);
  const field = () => el("date-time-input-field") as HTMLInputElement;

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

  it("puts a Pick dates icon button in the top bar that toggles the calendar", async () => {
    createWrapper();
    await openMenu();
    const button = el("date-time-pick-dates-btn")!;
    expect(el("date-time-top-bar")!.contains(button)).toBe(true);
    expect(button.getAttribute("aria-label")).toBe(tr("dateTime.pickDates"));
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.textContent?.trim()).toBe("");

    button.click();
    await flushPromises();
    expect(wrapper!.vm.calendarMode).toBe(true);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(el("date-time-footer")!.contains(el("date-time-pick-dates-btn"))).toBe(false);

    button.click();
    await flushPromises();
    expect(wrapper!.vm.calendarMode).toBe(false);
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("drops the calendar back arrow and joins Start and End with a dash", async () => {
    createWrapper();
    await openMenu();
    el("date-time-pick-dates-btn")!.click();
    await flushPromises();
    expect(el("date-time-calendar-back-btn")).toBeNull();
    expect(el("date-time-start-end-dash")?.textContent?.trim()).toBe("–");
  });

  it("is 512px wide, clamped by the viewport", async () => {
    createWrapper();
    await openMenu();
    const panel = document.getElementById("date-time-menu")!;
    expect(panel.className).toContain("w-128");
    expect(panel.className).toContain("max-w-[min(32rem,calc(100vw-1.5rem))]");
    expect(panel.className).toContain("time-picker-scope");
  });

  it("shows the business-hours example on explorers and the dashboard examples on dashboards", async () => {
    createWrapper({ preset: "explorer-auto" });
    await openMenu();
    expect(field().placeholder).toBe(tr("dateTime.placeholderOps"));
    wrapper!.unmount();
    document.body.innerHTML = "";

    createWrapper({ preset: "dashboard" });
    await openMenu();
    expect(field().placeholder).toBe(tr("common.timeRangeInputPlaceholder"));
  });

  it("falls back to the short placeholder when the long one overflows the bar", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.dataset?.test === "date-time-input-field" ? 80 : 400;
    });
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.dataset?.test === "date-time-input-field" ? 200 : 0;
    });
    createWrapper();
    await openMenu();
    expect(field().placeholder).toBe(tr("dateTime.placeholderShort"));
    expect(el("date-time-input")!.getAttribute("data-placeholder")).toBe("short");
  });

  it("offers the dashboard examples for text that reads as nothing", async () => {
    createWrapper({ preset: "dashboard" });
    await openMenu();
    field().value = "zzz";
    field().dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 150));
    const examples = Array.from(
      document.querySelectorAll<HTMLElement>("[data-test^='date-time-list-example-']"),
    ).map((row) => (row.textContent ?? "").replace(/\s+/g, " ").trim());
    const labels = ["last quarter", "Q3 2025", "2025", "Nov 4 – 6", "90d"];
    expect(examples.map((text, index) => text.startsWith(labels[index]))).toEqual(
      labels.map(() => true),
    );
  });

  it("parses every placeholder example", async () => {
    const { parseTimeInput } = await import("@/utils/dateTimeRangeParse");
    const options = { now: NOW, timeZone: IST };
    for (const text of ["2h", "Nov 10 2pm-4pm", "yesterday", "Q3", "Nov 4 – 6"]) {
      expect(parseTimeInput(text, options), text).not.toBeNull();
    }
  });
});
