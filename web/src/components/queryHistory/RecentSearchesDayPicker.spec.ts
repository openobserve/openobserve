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
  it("is a text field with the dd/mm/yyyy placeholder that shows the chosen day in that format", () => {
    const empty = mountPicker().find<HTMLInputElement>('[data-test="ran-on-field"]');
    expect(empty.element.tagName).toBe("INPUT");
    expect(empty.attributes("placeholder")).toBe("dd/mm/yyyy");
    expect(empty.element.value).toBe("");
    const picked = mountPicker("2026-10-29").find<HTMLInputElement>('[data-test="ran-on-field"]');
    expect(picked.element.value).toBe("29/10/2026");
  });

  it("applies a typed day on Enter and on leaving the field", async () => {
    const wrapper = mountPicker();
    const field = wrapper.find('[data-test="ran-on-field"]');
    await field.setValue("05/10/2026");
    await field.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["2026-10-05"]);
    await field.setValue("6/10/2026");
    await field.trigger("blur");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["2026-10-06"]);
  });

  it("refuses a typed day that is not a date or is after today, and marks the field", async () => {
    const wrapper = mountPicker();
    const field = wrapper.find('[data-test="ran-on-field"]');
    await field.setValue("31/02/2026");
    await field.trigger("keydown", { key: "Enter" });
    await field.setValue(DateTime.local().plus({ days: 1 }).toFormat("dd/MM/yyyy"));
    await field.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    expect(field.attributes("aria-invalid")).toBe("true");
  });

  it("clears the day when the typed text is emptied", async () => {
    const wrapper = mountPicker("2026-10-27");
    const field = wrapper.find('[data-test="ran-on-field"]');
    await field.setValue("");
    await field.trigger("blur");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([undefined]);
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

  it("clears the day with the field's clear button", async () => {
    const wrapper = mountPicker("2026-10-27");
    await wrapper.find('[data-test="ran-on-clear"]').trigger("click");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual([undefined]);
  });
});
