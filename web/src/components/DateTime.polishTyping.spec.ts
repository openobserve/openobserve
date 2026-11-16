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

describe("DateTime typed input rows (R8)", () => {
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
  const typeInBar = async (value: string) => {
    const field = document.querySelector<HTMLInputElement>("[data-test='date-time-input-field']")!;
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 150));
    await flushPromises();
  };
  const rows = () =>
    Array.from(
      document.querySelectorAll<HTMLElement>("[data-test='date-time-list'] [role='option']"),
    );

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

  it("hides the name-match rows once the text reads as a fixed range", async () => {
    createWrapper();
    await openMenu();
    await typeInBar("Nov 15 20:00-20:05");
    const kinds = rows().map((row) => row.getAttribute("data-test") ?? "");
    expect(kinds.length).toBeGreaterThan(0);
    expect(
      kinds.every((id) => id === "date-time-list-reading" || id.startsWith("date-time-suggest")),
    ).toBe(true);
  });

  it("previews From here to now with its end written as now", async () => {
    createWrapper();
    await openMenu();
    await typeInBar("13:32:10");
    const toNow = document.querySelector<HTMLElement>(
      "[data-test='date-time-list-anchor-to-now']",
    )!;
    expect(toNow).not.toBeNull();
    expect((toNow.textContent ?? "").replace(/\s+/g, " ").trim()).toMatch(/– now$/);
  });
});
