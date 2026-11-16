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
vi.mock("@/lib/feedback/Toast/useToast", () => ({ toast: vi.fn() }));

const NOW = new Date("2026-11-16T10:00:00Z");
const IST = "Asia/Calcutta";

describe("DateTime test-assist pass 2 (N1, N5, N6)", () => {
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
  const input = (dataTest: string) =>
    document.querySelector<HTMLInputElement>(`[data-test="${dataTest}"] input`)!;
  const commit = async (dataTest: string, value: string) => {
    const field = input(dataTest);
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    await flushPromises();
  };
  const typeInBar = async (text: string) => {
    const field = el("date-time-input-field") as HTMLInputElement;
    field.value = text;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 150));
    await flushPromises();
  };
  const names = () =>
    Array.from(
      document.querySelectorAll<HTMLElement>("[data-test='date-time-list'] [role='option']"),
    ).map((row) => row.getAttribute("aria-label"));

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

  it("N1: Enter in the End field applies without letting the key reach the trigger", async () => {
    createWrapper();
    await openMenu();
    wrapper!.vm.openCalendar();
    await flushPromises();
    await commit("datetime-start-time", "Nov 15 2pm");
    await commit("datetime-end-time", "Nov 15 3pm");

    // Vue drops a bubbled event stamped no later than its listener was attached, and Date is frozen.
    vi.setSystemTime(NOW.getTime() + 1000);
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    input("datetime-end-time").dispatchEvent(enter);
    await flushPromises();

    expect(enter.defaultPrevented).toBe(true);
    expect(wrapper!.vm.menuOpen).toBe(false);
    expect(wrapper!.emitted("on:date-change")?.at(-1)?.[0]).toMatchObject({
      valueType: "absolute",
    });
  });

  it("N5: a chip over the range limit has no raised fill or outline", async () => {
    createWrapper({ queryRangeRestrictionInHour: 24 });
    await openMenu();

    for (const chip of ["7d", "30d"]) {
      const node = el(`date-time-chip-${chip}`)!;
      expect(node.hasAttribute("data-disabled")).toBe(true);
      expect(node.className).not.toMatch(/data-disabled:bg-surface-base|data-disabled:border\b/);
      expect(node.className).toContain("data-disabled:text-toggle-item-disabled");
    }
    expect(el("date-time-chip-24h")?.hasAttribute("data-disabled")).toBe(false);
  });

  it("N6: a repeated-hour reading names each end's own zone", async () => {
    store.state.timezone = "America/New_York";
    createWrapper();
    await openMenu();
    await typeInBar("Nov 1 1:30am - 2:30am");

    const labels = names().slice(0, 2);
    expect(labels).toContainEqual(expect.stringContaining("01:30 EDT – 02:30 EST"));
    expect(labels).toContainEqual(expect.stringContaining("01:30 – 02:30 EST (UTC-05:00)"));
    expect(labels.join(" | ")).not.toContain("02:30 EDT");
  });
});
