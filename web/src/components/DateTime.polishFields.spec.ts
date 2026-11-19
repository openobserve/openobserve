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

// Mon 2026-11-16 10:00 UTC; the picker zone is IST.
const NOW = new Date("2026-11-16T10:00:00Z");
const IST = "Asia/Calcutta";
const micros = (iso: string) => Date.parse(iso) * 1000;
const tr = (key: string) => String((i18n.global.t as unknown as (k: string) => string)(key));

describe("DateTime Start and End text fields (R1)", () => {
  let wrapper: VueWrapper<InstanceType<typeof DateTime>> | null = null;

  const createWrapper = (props: Record<string, unknown> = {}) => {
    wrapper = mount(DateTime, {
      props,
      attachTo: document.body,
      global: { plugins: [i18n, store] },
    });
    return wrapper;
  };
  const openCalendar = async () => {
    wrapper!.vm.onMenuOpenChange(true);
    wrapper!.vm.menuOpen = true;
    wrapper!.vm.openCalendar();
    await flushPromises();
  };
  const el = (dataTest: string) => document.querySelector<HTMLElement>(`[data-test="${dataTest}"]`);
  const input = (dataTest: string) =>
    document.querySelector<HTMLInputElement>(`[data-test="${dataTest}"] input`)!;
  const text = (dataTest: string) => (el(dataTest)?.textContent ?? "").replace(/\s+/g, " ").trim();
  const typeInto = async (dataTest: string, value: string) => {
    vi.setSystemTime(Date.now() + 1000);
    const field = input(dataTest);
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
  };
  const commit = async (dataTest: string, value: string) => {
    await typeInto(dataTest, value);
    vi.setSystemTime(Date.now() + 1000);
    input(dataTest).dispatchEvent(new Event("change", { bubbles: true }));
    await flushPromises();
  };
  const lastEmit = () => {
    const events = (wrapper!.emitted("on:date-change") ?? []) as unknown[][];
    return events[events.length - 1][0] as Record<string, unknown>;
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

  it("are plain text inputs prefilled with the exact instants", async () => {
    createWrapper({
      defaultType: "absolute",
      defaultAbsoluteTime: {
        startTime: micros("2026-11-15T20:30:00.123Z"),
        endTime: micros("2026-11-15T20:35:00.500Z"),
      },
    });
    await flushPromises();
    await openCalendar();
    expect(input("datetime-start-time").value).toBe("Nov 16, 02:00:00.123");
    expect(input("datetime-end-time").value).toBe("Nov 16, 02:05:00.500");
    expect(el("datetime-start-time")!.querySelector("[role='group']")).toBeNull();
  });

  it("applies typed full stamps exactly and shows a second-precision draft", async () => {
    createWrapper();
    await flushPromises();
    await openCalendar();
    await commit("datetime-start-time", "Nov 16, 02:00:00.123");
    await commit("datetime-end-time", "Nov 16, 02:05");

    expect(el("date-time-draft-tag")).not.toBeNull();
    expect(text("date-time-resolved-name")).toBe("Nov 16, 02:00:00 – 02:05:00");
    expect(el("date-time-apply-btn")!.hasAttribute("disabled")).toBe(false);

    wrapper!.vm.onApplyClick();
    await flushPromises();
    expect(lastEmit()).toMatchObject({
      valueType: "absolute",
      startTime: micros("2026-11-15T20:30:00.123Z"),
      endTime: micros("2026-11-15T20:35:00Z"),
    });
  });

  it("keeps the day of the field for a time typed alone", async () => {
    createWrapper({
      defaultType: "absolute",
      defaultAbsoluteTime: {
        startTime: micros("2026-11-14T03:30:00Z"),
        endTime: micros("2026-11-14T06:30:00Z"),
      },
    });
    await flushPromises();
    await openCalendar();
    await commit("datetime-start-time", "10:15");
    expect(input("datetime-start-time").value).toBe("Nov 14, 10:15");
  });

  it("marks unreadable text invalid, blocks Apply and keeps the applied range", async () => {
    createWrapper({
      defaultType: "absolute",
      defaultAbsoluteTime: {
        startTime: micros("2026-11-14T03:30:00Z"),
        endTime: micros("2026-11-14T06:30:00Z"),
      },
    });
    await flushPromises();
    await openCalendar();
    await commit("datetime-start-time", "noon-ish");

    expect(el("date-time-apply-btn")!.hasAttribute("disabled")).toBe(true);
    expect(input("datetime-start-time").getAttribute("aria-invalid")).toBe("true");
    expect(text("date-time-input-error")).toContain(tr("common.timeRangeInputError"));
    expect(document.body.textContent).not.toContain("HH:MM");
    expect(wrapper!.vm.getConsumableDateTime()).toMatchObject({
      startTime: micros("2026-11-14T03:30:00Z"),
      endTime: micros("2026-11-14T06:30:00Z"),
    });
  });

  it("previews the range while a field is being typed in", async () => {
    createWrapper({
      defaultType: "absolute",
      defaultAbsoluteTime: {
        startTime: micros("2026-11-14T03:30:00Z"),
        endTime: micros("2026-11-14T06:30:00Z"),
      },
    });
    await flushPromises();
    await openCalendar();
    await typeInto("datetime-start-time", "Nov 14, 10:15:30.250");
    expect(text("date-time-resolved-name")).toBe("Nov 14, 10:15:30 – 12:00:00");
    expect(el("date-time-preview-note")).toBeNull();
  });

  it("drops the pick-the-end-date note while a day waits for its end", async () => {
    createWrapper();
    await flushPromises();
    await openCalendar();
    wrapper!.vm.onCalendarPendingDay("2026/11/10");
    await flushPromises();
    expect(document.body.textContent).not.toContain(tr("dateTime.pickEndDate"));
  });

  it("reads every prefilled text back to the instant it was written from", async () => {
    const samples = [
      "2026-11-15T20:30:00.123Z",
      "2026-11-15T20:30:00Z",
      "2026-11-15T20:30:15Z",
      "2026-01-03T00:00:00.999Z",
      "2025-12-31T18:29:59.001Z",
      "2026-06-30T18:30:00Z",
      "2026-03-08T07:59:59.500Z",
      "2026-11-16T09:59:00.010Z",
      "2024-02-29T12:00:00Z",
      "2026-10-31T23:15:45.678Z",
    ];
    for (const iso of samples) {
      createWrapper({
        defaultType: "absolute",
        defaultAbsoluteTime: { startTime: micros(iso), endTime: micros("2026-11-16T09:59:59Z") },
      });
      await flushPromises();
      const read = wrapper!.vm.readFieldText("start", wrapper!.vm.startFieldText);
      expect(read, `${iso} via ${wrapper!.vm.startFieldText}`).toBe(micros(iso));
      wrapper!.unmount();
      wrapper = null;
      document.body.innerHTML = "";
    }
  });
});
