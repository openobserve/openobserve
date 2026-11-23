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
import ODateTimeRange from "@/lib/forms/DateTimeRange/ODateTimeRange.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

const NOW = new Date("2026-10-08T03:00:00Z");

describe("ODateTimeRange trigger", () => {
  let wrapper: VueWrapper<InstanceType<typeof ODateTimeRange>> | null = null;

  const createWrapper = (props: Record<string, unknown> = {}) => {
    wrapper = mount(ODateTimeRange, {
      props,
      attachTo: document.body,
      global: { plugins: [i18n, store] },
    });
    return wrapper;
  };

  const button = (dataTest: string) =>
    wrapper!
      .findAllComponents({ name: "OButton" })
      .find((b) => b.attributes("data-test") === dataTest)!;

  const setAbsolute = async (from: string, startTime: string, to: string, endTime: string) => {
    wrapper!.vm.selectedType = "absolute";
    wrapper!.vm.selectedDate.from = from;
    wrapper!.vm.selectedDate.to = to;
    wrapper!.vm.selectedTime.startTime = startTime;
    wrapper!.vm.selectedTime.endTime = endTime;
    wrapper!.vm.saveDate("absolute");
    await flushPromises();
  };

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

  it("sizes the group and its trigger from the size prop, md by default", async () => {
    createWrapper();
    await flushPromises();
    expect(button("date-time-btn").props("size")).toBe("md");
    expect(wrapper!.get(".date-time-container").classes()).toContain("h-control-md");
    wrapper!.unmount();
    createWrapper({ size: "sm" });
    await flushPromises();
    expect(button("date-time-btn").props("size")).toBe("sm");
    expect(wrapper!.get(".date-time-container").classes()).toContain("h-control-sm");
  });

  it("draws one outline around the group, so a disabled shift button keeps the edge", async () => {
    createWrapper();
    await flushPromises();
    const group = wrapper!.get(".date-time-container").classes();
    expect(group).toContain("border");
    expect(group).toContain("border-button-outline-border");
    const next = button("date-time-next-btn");
    expect(next.props("variant")).toBe("ghost");
    expect(next.classes()).toContain("border-s-button-outline-border!");
    expect(button("date-time-prev-btn").classes()).toContain("border-e-button-outline-border!");
    expect(button("date-time-btn").classes()).toContain("border-0!");
  });

  it("keeps one trigger width whether the range is relative or absolute", async () => {
    createWrapper();
    await flushPromises();
    const relativeClasses = button("date-time-btn").classes();
    expect(relativeClasses).toContain("w-54");
    await setAbsolute("2026/10/01", "09:00:00", "2026/10/01", "10:00:00");
    expect(button("date-time-btn").classes()).toContain("w-54");
    expect(
      button("date-time-btn")
        .classes()
        .some((c) => c.includes("min-w-71.5")),
    ).toBe(false);
  });

  it("fills its field when it has the field look", async () => {
    createWrapper({ fieldAppearance: true, hideRangeShift: true });
    await flushPromises();
    expect(button("date-time-btn").classes()).toContain("w-full");
    expect(button("date-time-btn").classes()).not.toContain("w-54");
  });

  it("disables the trigger and both shift buttons with disabled", async () => {
    createWrapper({ disabled: true });
    await flushPromises();
    for (const id of ["date-time-btn", "date-time-prev-btn", "date-time-next-btn"]) {
      expect(button(id).props("disabled")).toBe(true);
    }
  });

  it("shortens a same-day absolute range and keeps the full range in the tooltip", async () => {
    createWrapper({ autoApply: true });
    await flushPromises();
    await setAbsolute("2026/10/01", "19:00:26", "2026/10/01", "20:00:26");
    expect(wrapper!.vm.triggerLabel).toBe("Oct 1 19:00 – 20:00");
    expect(wrapper!.vm.triggerTooltip).toBe("2026/10/01 19:00:26 - 2026/10/01 20:00:26");
  });

  it("names both days when the range spans days, and the year outside this year", async () => {
    createWrapper({ autoApply: true });
    await flushPromises();
    await setAbsolute("2026/10/01", "19:00:00", "2026/10/02", "08:00:00");
    expect(wrapper!.vm.triggerLabel).toBe("Oct 1 19:00 – Oct 2 08:00");
    await setAbsolute("2025/12/31", "23:00:00", "2026/01/01", "01:00:00");
    expect(wrapper!.vm.triggerLabel).toBe("Dec 31, 2025 23:00 – Jan 1, 2026 01:00");
  });

  it("shortens a date-only range the same way", async () => {
    createWrapper({ autoApply: true, disableRelative: true });
    await flushPromises();
    await setAbsolute("2026/10/01", "00:00:00", "2026/10/31", "23:59:59");
    expect(wrapper!.vm.triggerLabel).toBe("Oct 1 – Oct 31");
    expect(wrapper!.vm.triggerTooltip).toBe("2026/10/01 - 2026/10/31");
  });

  it("keeps the seconds when both ends fall in the same minute", async () => {
    createWrapper({ autoApply: true });
    await flushPromises();
    await setAbsolute("2026/10/01", "19:00:10", "2026/10/01", "19:00:50");
    expect(wrapper!.vm.triggerLabel).toBe("Oct 1 19:00:10 – 19:00:50");
  });

  it("leaves relative labels and the caller's trigger text as they are", async () => {
    createWrapper({ autoApply: true });
    await flushPromises();
    expect(wrapper!.vm.triggerLabel).toBe("Past 15 Minutes");
    expect(wrapper!.vm.triggerTooltip).toBeUndefined();
    wrapper!.unmount();
    createWrapper({ autoApply: true, triggerText: "Next 24 hours" });
    await flushPromises();
    await setAbsolute("2026/10/01", "19:00:00", "2026/10/01", "20:00:00");
    expect(wrapper!.vm.triggerLabel).toBe("Next 24 hours");
    expect(wrapper!.vm.triggerTooltip).toBeUndefined();
  });
});
