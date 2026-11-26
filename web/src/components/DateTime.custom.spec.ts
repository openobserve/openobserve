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
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import OSelect from "@/lib/forms/Select/OSelect.vue";
import store from "@/test/unit/helpers/store";
import {
  changes,
  el,
  lastChange,
  mountPicker,
  openMenu,
  press,
  warmRangeInput,
  type Picker,
} from "@/test/unit/helpers/dateTimePicker";

const NOW = new Date("2026-10-08T03:00:00Z");

describe("DateTime custom relative value", () => {
  let wrapper: Picker | null = null;

  const create = (props: Record<string, unknown> = {}) => {
    wrapper = mountPicker(props);
    return wrapper;
  };

  const field = () => el<HTMLInputElement>("date-time-custom-value-field")!;

  const typeCustom = async (value: string) => {
    field().value = value;
    field().dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
  };

  const focusOut = async (from: Element, to: Element | null) => {
    from.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: to }));
    await flushPromises();
  };

  const pickUnit = async (unit: string) => {
    const select = wrapper!
      .findAllComponents(OSelect)
      .find((c) => c.attributes("data-test") === "date-time-custom-unit");
    select!.vm.$emit("update:modelValue", unit);
    await flushPromises();
  };

  beforeAll(warmRangeInput);

  beforeEach(() => {
    // A frozen clock makes Vue drop every listener after the first for one event, so it creeps instead.
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
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

  it("emits nothing while typing and once on Enter, then closes on an auto host", async () => {
    create({ autoApply: true });
    await openMenu(wrapper!);
    const before = changes(wrapper!).length;
    await typeCustom("9");
    await typeCustom("90");
    expect(changes(wrapper!).length).toBe(before);

    await press(field(), "Enter");
    expect(changes(wrapper!).length).toBe(before + 1);
    expect(lastChange(wrapper!)).toMatchObject({
      valueType: "relative-custom",
      relativeTimePeriod: "90m",
    });
    expect(wrapper!.vm.menuOpen).toBe(false);
  });

  it("applies and closes on Enter on an Apply host", async () => {
    create({ autoApply: false });
    await openMenu(wrapper!);
    const before = changes(wrapper!).length;
    await typeCustom("40");
    await press(field(), "Enter");

    expect(changes(wrapper!).length).toBe(before + 1);
    expect(lastChange(wrapper!).relativeTimePeriod).toBe("40m");
    expect(wrapper!.vm.menuOpen).toBe(false);
    expect(wrapper!.emitted("hide")).toHaveLength(1);
  });

  it("commits the value and the unit together once", async () => {
    create({ autoApply: true });
    await openMenu(wrapper!);
    const before = changes(wrapper!).length;
    await typeCustom("90");
    const unitTrigger = el("date-time-custom-unit-trigger") ?? el("date-time-custom-unit");
    await focusOut(field(), unitTrigger);
    expect(changes(wrapper!).length).toBe(before);

    await pickUnit("h");
    expect(changes(wrapper!).length).toBe(before + 1);
    expect(lastChange(wrapper!).relativeTimePeriod).toBe("90h");

    await focusOut(field(), document.body);
    expect(changes(wrapper!).length).toBe(before + 1);
  });

  it("commits once when focus leaves the row", async () => {
    create({ autoApply: true });
    await openMenu(wrapper!);
    const before = changes(wrapper!).length;
    await typeCustom("25");
    await focusOut(field(), el("date-time-relative-tab"));

    expect(changes(wrapper!).length).toBe(before + 1);
    expect(lastChange(wrapper!).relativeTimePeriod).toBe("25m");
    expect(wrapper!.vm.menuOpen).toBe(true);
  });

  it.each([true, false])(
    "keeps an applied calendar period when focus passes through the row unedited (autoApply %s)",
    async (autoApply) => {
      create({ autoApply, defaultRelativeTime: "calendar:day:0" });
      await openMenu(wrapper!);
      const before = changes(wrapper!).length;
      field().focus();
      await focusOut(field(), el("date-time-relative-tab"));

      expect(changes(wrapper!).length).toBe(before);
      expect(wrapper!.vm.calendarToken).toBe("calendar:day:0");
      expect(wrapper!.vm.selectedType).toBe("relative");
    },
  );

  it("restores the last valid value when an emptied field loses focus", async () => {
    create({ autoApply: true });
    await openMenu(wrapper!);
    const before = changes(wrapper!).length;
    await typeCustom("");
    field().dispatchEvent(new FocusEvent("blur"));
    await focusOut(field(), document.body);

    expect(field().value).toBe("15");
    expect(changes(wrapper!).length).toBe(before);
  });
});

describe("DateTime custom relative value review fixes", () => {
  let wrapper: Picker | null = null;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));
    store.state.timezone = "UTC";
    store.state.savedViewFlag = false;
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("keeps a one-month range that fits a 28-day limit in February", async () => {
    wrapper = mountPicker({
      autoApply: true,
      queryRangeRestrictionInHour: 672,
      defaultRelativeTime: "1M",
    });
    await flushPromises();

    expect(wrapper.vm.relativePeriodsMaxValue.M).toBe(1);
    expect(wrapper.vm.relativePeriod).toBe("M");
    expect(wrapper.vm.relativeValue).toBe(1);
  });
});
