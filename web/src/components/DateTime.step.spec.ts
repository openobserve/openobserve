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

import { flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import store from "@/test/unit/helpers/store";
import {
  changes,
  el,
  lastChange,
  mountPicker,
  openMenu,
  type Picker,
} from "@/test/unit/helpers/dateTimePicker";
import type { TimeRangeReading } from "@/utils/timeRangeInput/types";

const NOW = new Date("2026-10-08T03:00:00Z");
const MIN_US = 60_000_000;
const micros = (iso: string) => Date.parse(iso) * 1000;

describe("DateTime range step", () => {
  let wrapper: Picker | null = null;

  const create = async (props: Record<string, unknown> = {}) => {
    wrapper = mountPicker({ autoApply: true, ...props });
    await flushPromises();
    return wrapper;
  };

  const click = async (dataTest: string) => {
    el<HTMLButtonElement>(dataTest)!.click();
    await flushPromises();
  };

  const span = (payload: Record<string, unknown>) =>
    Number(payload.endTime) - Number(payload.startTime);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    store.state.timezone = "UTC";
    store.state.savedViewFlag = false;
    localStorage.clear();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("returns to the rolling range when › undoes a ‹", async () => {
    await create({ defaultRelativeTime: "15m" });
    await click("date-time-prev-btn");
    expect(lastChange(wrapper!)).toMatchObject({ relativeTimePeriod: null });
    expect(span(lastChange(wrapper!))).toBe(15 * MIN_US);

    expect(el<HTMLButtonElement>("date-time-next-btn")!.disabled).toBe(false);
    await click("date-time-next-btn");
    expect(lastChange(wrapper!)).toMatchObject({
      valueType: "relative",
      relativeTimePeriod: "15m",
    });
  });

  it.each([
    ["auto", { autoApply: true }],
    ["Apply", { autoApply: false }],
  ])("emits once per step click on an %s host", async (_, props) => {
    await create({ defaultRelativeTime: "15m", ...props });
    for (const button of ["date-time-prev-btn", "date-time-next-btn", "date-time-prev-btn"]) {
      const before = changes(wrapper!).length;
      await click(button);
      expect(changes(wrapper!).length, button).toBe(before + 1);
      expect(lastChange(wrapper!).userChangedValue, button).toBe(true);
    }
  });

  it("repeats the trigger label in a live region", async () => {
    await create({ defaultRelativeTime: "15m" });
    await click("date-time-prev-btn");

    const live = el("date-time-range-live")!;
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toBe(wrapper!.vm.triggerLabel);
  });
});

describe("DateTime range step review fixes", () => {
  let wrapper: Picker | null = null;

  const create = async (props: Record<string, unknown> = {}) => {
    wrapper = mountPicker({ autoApply: true, ...props });
    await flushPromises();
    return wrapper;
  };

  const click = async (dataTest: string) => {
    el<HTMLButtonElement>(dataTest)!.click();
    await flushPromises();
  };

  const absoluteReading = (startUs: number, endUs: number) =>
    ({ kind: "absolute", startUs, endUs, notes: [] }) as unknown as TimeRangeReading;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    store.state.timezone = "UTC";
    store.state.savedViewFlag = false;
    localStorage.clear();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("steps from the applied range after a dismissed draft on an Apply host", async () => {
    await create({ autoApply: false });
    await openMenu(wrapper!);
    wrapper!.vm.selectTab("absolute");
    wrapper!.vm.selectedDate = { from: "2026/10/08", to: "2026/10/08" };
    wrapper!.vm.selectedTime = { startTime: "01:00:00", endTime: "02:00:00" };
    await flushPromises();
    wrapper!.vm.applyAndClose();
    await flushPromises();

    await openMenu(wrapper!);
    wrapper!.vm.selectedDate = { from: "2026/10/01", to: "2026/10/01" };
    await flushPromises();
    wrapper!.vm.menuOpen = false;
    wrapper!.vm.onMenuOpenChange(false);
    await flushPromises();
    await click("date-time-prev-btn");

    expect(lastChange(wrapper!)).toMatchObject({
      startTime: micros("2026-10-08T00:00:00Z"),
      endTime: micros("2026-10-08T01:00:00Z"),
    });
  });

  it("clamps a Previous step at minDate instead of moving to a refused range", async () => {
    await create({
      disableRelative: true,
      minDate: "2026/10/01",
      defaultAbsoluteTime: {
        startTime: micros("2026-10-01T06:00:00Z"),
        endTime: micros("2026-10-01T18:00:00Z"),
      },
    });
    const before = changes(wrapper!).length;
    await click("date-time-prev-btn");

    expect(changes(wrapper!).length).toBe(before + 1);
    expect(lastChange(wrapper!)).toMatchObject({
      startTime: micros("2026-10-01T00:00:00Z"),
      endTime: micros("2026-10-01T06:00:00Z"),
    });
  });

  it("leaves the fields alone when Previous cannot move past minDate", async () => {
    await create({
      disableRelative: true,
      minDate: "2026/10/01",
      defaultAbsoluteTime: {
        startTime: micros("2026-10-01T00:00:00Z"),
        endTime: micros("2026-10-01T12:00:00Z"),
      },
    });
    const before = changes(wrapper!).length;
    await click("date-time-prev-btn");

    expect(changes(wrapper!).length).toBe(before);
    expect(wrapper!.vm.selectedDate.from).toBe("2026/10/01");
    expect(wrapper!.vm.selectedTime.startTime).toBe("00:00:00");
  });

  it("keeps subsecond bounds when stepping", async () => {
    await create();
    const start = micros("2026-10-08T01:00:00Z") + 100_000;
    wrapper!.vm.commitTypedReading(absoluteReading(start, start + 100_000));
    await flushPromises();
    const before = changes(wrapper!).length;
    await click("date-time-prev-btn");

    expect(changes(wrapper!).length).toBe(before + 1);
    expect(lastChange(wrapper!)).toMatchObject({ startTime: start - 100_000, endTime: start });
  });
});
