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

describe("DateTime typed text, run 2", () => {
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
    it("keeps calendar words as their dates on a dates-only picker", async () => {
      createWrapper({ capabilities: { kinds: ["fixed"] } });
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
  });

  describe("yearless dates where the future is allowed [C3]", () => {
    it("reads a yearless date as the coming one on a picker with no ceiling", async () => {
      createWrapper({ capabilities: { kinds: ["fixed"], future: true }, minDate: "2026/01/01" });
      await openMenu();
      await typeInBar("Dec 20 - Dec 22");
      await pressInBar("Enter");
      expect(lastEmit()).toMatchObject({
        startTime: micros("2026-12-19T18:30:00Z"),
        endTime: micros("2026-12-22T18:30:00Z"),
      });
    });

    it("rolls a yearless date already over into next year", async () => {
      createWrapper({ capabilities: { kinds: ["fixed"], future: true }, minDate: "2026/01/01" });
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
