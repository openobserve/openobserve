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
const tr = (key: string, params: Record<string, unknown> = {}) =>
  String((i18n.global.t as unknown as (k: string, p: object) => string)(key, params));

describe("DateTime trigger tooltip (R3, R4, R5)", () => {
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
  // The tooltip opens after a 400 ms hover.
  const hover = async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], now: NOW });
    el("date-time-btn")!.dispatchEvent(new MouseEvent("mouseenter"));
    vi.advanceTimersByTime(450);
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
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

  it("adds the window the query keeps, with its length", async () => {
    createWrapper({
      narrowedByQuery: {
        startUs: micros("2026-11-16T09:02:10Z"),
        endUs: micros("2026-11-16T09:02:11Z"),
      },
    });
    await flushPromises();
    await hover();
    expect(text("date-time-trigger-tooltip-narrowed")).toBe(
      tr("dateTime.queryKeeps", { range: "14:32:10 – 14:32:11", duration: "1s" }),
    );
  });

  it("states the window in the open panel too", async () => {
    createWrapper({
      narrowedByQuery: {
        startUs: micros("2026-11-16T09:02:10Z"),
        endUs: micros("2026-11-16T09:02:11Z"),
      },
    });
    await flushPromises();
    wrapper!.vm.onMenuOpenChange(true);
    wrapper!.vm.menuOpen = true;
    await flushPromises();
    expect(text("date-time-panel-narrowed")).toBe(
      tr("dateTime.queryKeeps", { range: "14:32:10 – 14:32:11", duration: "1s" }),
    );
    expect(el("date-time-chips-note-narrowed")).toBeNull();
  });

  it("adds a UTC line whenever the zone is not UTC", async () => {
    createWrapper({
      defaultType: "absolute",
      defaultAbsoluteTime: {
        startTime: micros("2026-11-15T20:30:00.123Z"),
        endTime: micros("2026-11-15T20:35:00.500Z"),
      },
    });
    await flushPromises();
    await hover();
    const utc = text("date-time-trigger-tooltip-utc");
    expect(utc.startsWith("UTC ")).toBe(true);
    expect(utc).toContain("20:30:00.123");
    expect(utc).toContain("20:35:00.500");
  });

  it("has no UTC line in UTC", async () => {
    store.state.timezone = "UTC";
    createWrapper();
    await flushPromises();
    await hover();
    expect(el("date-time-trigger-tooltip")).not.toBeNull();
    expect(el("date-time-trigger-tooltip-utc")).toBeNull();
  });
});
