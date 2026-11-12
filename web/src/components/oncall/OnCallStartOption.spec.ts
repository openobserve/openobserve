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
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";

import OnCallStartOption from "@/components/oncall/OnCallStartOption.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import type { SelectOption } from "@/lib/forms/Select/OSelect.types";
import i18n from "@/locales";
import { raw } from "@/types/i18n";

// jsdom has no layout, so the real virtualizer renders no rows; render them all.
vi.mock("@tanstack/vue-virtual", async () => {
  const { computed, unref } = await import("vue");
  return {
    useVirtualizer: (options: unknown) =>
      computed(() => {
        const count = (unref(options) as { count: number }).count;
        return {
          getVirtualItems: () =>
            Array.from({ length: count }, (_, index) => ({
              index,
              key: index,
              start: index * 28,
              size: 28,
              end: (index + 1) * 28,
              lane: 0,
            })),
          getTotalSize: () => count * 28,
          scrollToIndex: () => {},
          measureElement: () => {},
        };
      }),
  };
});

const OPTIONS: SelectOption[] = [
  {
    label: raw("Environment production and Region eu-west-1 and Service inventory-service"),
    value: "s1",
    icon: "notifications-active",
    dimensions: { environment: "production", region: "eu-west-1", service: "inventory-service" },
    meta: "1 trigger, last 30 days",
  },
  { label: raw("checkout"), value: "service:checkout", icon: "group-work" },
];

/// The real OSelect with the real option component in its `#option` slot, as both pickers use it.
const Picker = defineComponent({
  setup: () => () =>
    h(
      OSelect,
      { options: OPTIONS, searchable: true, iconKey: "icon", "data-test": "unit" },
      {
        option: ({ option }: { option: SelectOption }) =>
          h(OnCallStartOption, { option, dataTest: `unit-start-${String(option.value)}` }),
      },
    ),
});

describe("OnCallStartOption in OSelect", () => {
  let wrapper: VueWrapper;

  afterEach(() => wrapper?.unmount());

  async function open() {
    wrapper = mount(Picker, { attachTo: document.body, global: { plugins: [i18n] } });
    await wrapper.find("button").trigger("click");
    await flushPromises();
  }

  const row = (value: string) =>
    document.body.querySelector<HTMLElement>(`[data-test="unit-start-${value}"]`);

  it("renders each condition as a chip and keeps the trigger count beside them", async () => {
    await open();
    const signal = row("s1");
    expect(signal).not.toBeNull();
    expect(signal?.querySelectorAll("[data-fit-chip]")).toHaveLength(3);
    expect(signal?.textContent).toContain("1 trigger, last 30 days");
  });

  it("falls back to the plain label for an option with no conditions", async () => {
    await open();
    const service = row("service:checkout");
    expect(service?.querySelectorAll("[data-fit-chip]")).toHaveLength(0);
    expect(service?.textContent?.trim()).toBe("checkout");
  });

  it("leaves OSelect's own label rendering untouched without the slot", async () => {
    wrapper = mount(OSelect, {
      attachTo: document.body,
      attrs: { "data-test": "plain" },
      props: { options: OPTIONS, searchable: true },
      global: { plugins: [i18n] },
    });
    await wrapper.find("button").trigger("click");
    await flushPromises();
    const option = document.body.querySelector('[data-test="plain-option"][data-test-value="s1"]');
    expect(option?.textContent).toContain("Environment production and Region");
    expect(option?.querySelector("[data-fit-chip]")).toBeNull();
  });
});
