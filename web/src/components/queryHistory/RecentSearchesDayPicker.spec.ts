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

import { afterEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { DateTime } from "luxon";
import i18n from "@/locales";
import RecentSearchesDayPicker from "./RecentSearchesDayPicker.vue";

enableAutoUnmount(afterEach);

const mountPicker = (modelValue?: string, zone?: string) =>
  mount(RecentSearchesDayPicker, {
    props: {
      modelValue,
      zone,
      placeholder: "dd/mm/yyyy",
      fieldLabel: "Filter by date run",
      dataTest: "ran-on",
    },
    attachTo: document.body,
    global: { plugins: [i18n] },
  });

const cell = (iso: string) =>
  document.querySelector<HTMLElement>(`[data-test="daterangecalendar-cell-${iso}"]`);

const openCalendar = async (wrapper: ReturnType<typeof mountPicker>) => {
  await wrapper.find('[data-test="ran-on-trigger"]').trigger("click");
  await flushPromises();
};

describe("RecentSearchesDayPicker", () => {
  it("reads as a date field: the dd/mm/yyyy placeholder, then the chosen day in that format", () => {
    const empty = mountPicker();
    const emptyValue = empty.find('[data-test="ran-on-value"]');
    expect(emptyValue.text()).toBe("dd/mm/yyyy");
    expect(emptyValue.classes()).toContain("text-input-placeholder");
    expect(empty.find('[data-test="ran-on-trigger"]').attributes("aria-label")).toBe(
      "Filter by date run",
    );
    const picked = mountPicker("2026-10-29").find('[data-test="ran-on-value"]');
    expect(picked.text()).toBe("29/10/2026");
    expect(picked.classes()).toContain("text-input-text");
  });

  it("opens the shared range calendar and picks one day with a single click", async () => {
    const wrapper = mountPicker();
    await openCalendar(wrapper);
    expect(document.querySelector('[data-test="daterangecalendar-root"]')).not.toBeNull();
    const today = DateTime.local().toISODate()!;
    cell(today)!.click();
    await flushPromises();
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([today]);
    expect(document.querySelector('[data-test="ran-on-calendar"]')).toBeNull();
  });

  it("marks the chosen day selected and keeps days after today unavailable", async () => {
    const today = DateTime.local();
    const wrapper = mountPicker(today.toISODate()!);
    await openCalendar(wrapper);
    expect(cell(today.toISODate()!)?.hasAttribute("data-selected")).toBe(true);
    const later = [
      ...document.querySelectorAll<HTMLElement>('[data-test^="daterangecalendar-cell-"]'),
    ].filter((el) => el.dataset.test!.replace("daterangecalendar-cell-", "") > today.toISODate()!);
    later.forEach((el) => expect(el.hasAttribute("data-disabled")).toBe(true));
  });

  it("offers the new day after midnight without a remount", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(2026, 9, 28, 23, 59));
      const wrapper = mountPicker();
      await openCalendar(wrapper);
      expect(cell("2026-10-29")?.hasAttribute("data-disabled")).toBe(true);
      await wrapper.find('[data-test="ran-on-trigger"]').trigger("click");
      await flushPromises();
      vi.setSystemTime(new Date(2026, 9, 29, 0, 1));
      await openCalendar(wrapper);
      expect(cell("2026-10-29")?.hasAttribute("data-disabled")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ends the pickable days at today in the given timezone", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(Date.UTC(2026, 9, 28, 20, 0)));
      await openCalendar(mountPicker(undefined, "Asia/Kolkata"));
      expect(cell("2026-10-29")?.hasAttribute("data-disabled")).toBe(false);
      expect(cell("2026-10-30")?.hasAttribute("data-disabled")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("joins the field and its clear button in a button group, without overriding the buttons' box", () => {
    const wrapper = mountPicker("2026-10-27");
    const group = wrapper.find('[data-test="ran-on"]');
    expect(group.attributes("role")).toBe("group");
    const buttons = group.findAll(":scope > button");
    expect(buttons.map((b) => b.attributes("data-test"))).toEqual([
      "ran-on-trigger",
      "ran-on-clear",
    ]);
    const forced = /^(h|rounded|border)(-\S*)?!$/;
    buttons.forEach((b) => expect(b.classes().filter((c) => forced.test(c))).toEqual([]));
  });

  it("clears the day with its own button, shown only while a day is set", async () => {
    expect(mountPicker().find('[data-test="ran-on-clear"]').exists()).toBe(false);
    const wrapper = mountPicker("2026-10-27");
    await wrapper.find('[data-test="ran-on-clear"]').trigger("click");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([undefined]);
  });
});
