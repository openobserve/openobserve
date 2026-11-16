// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import OSelect from "./OSelect.vue";
import type { SelectOption } from "./OSelect.types";
import { raw } from "@/types/i18n";

// JSDOM has no layout, so the real virtualizer renders no rows; render them all.
vi.mock("@tanstack/vue-virtual", async () => {
  const { computed, unref } = await import("vue");
  return {
    useVirtualizer: (options: any) =>
      computed(() => {
        const count = unref(options).count;
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
  { label: raw("UTC"), value: "UTC" },
  { label: raw("Browser time · Asia/Kolkata"), value: "Browser", searchText: "browser local" },
  { label: raw(""), divider: true },
  { label: raw("Asia/Kolkata"), value: "Asia/Kolkata" },
  { label: raw("Europe/Berlin"), value: "Europe/Berlin" },
];

describe("OSelect divider option", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  const open = async (options: SelectOption[] = OPTIONS, props: Record<string, unknown> = {}) => {
    wrapper = mount(OSelect, {
      attachTo: document.body,
      attrs: { "data-test": "unit" },
      props: { options, searchable: true, ...props },
    });
    await wrapper.find("button").trigger("click");
    await flushPromises();
  };
  const searchInput = () =>
    document.body.querySelector<HTMLInputElement>('[data-test="unit-search"]')!;
  const search = async (term: string) => {
    searchInput().value = term;
    searchInput().dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
  };
  const press = async (key: string) => {
    searchInput().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    await flushPromises();
  };
  const dividers = () => document.body.querySelectorAll<HTMLElement>('[role="separator"]');
  const highlighted = () =>
    document.body
      .querySelector<HTMLElement>(".bg-select-item-hover-bg[data-test-value]")
      ?.getAttribute("data-test-value");
  const rows = () =>
    [...document.body.querySelectorAll<HTMLElement>("[data-vrow]")].map((row) =>
      row.querySelector('[role="separator"]')
        ? "—"
        : row.querySelector("[data-test-value]")?.getAttribute("data-test-value"),
    );

  it("renders a separator row between the options it splits", async () => {
    await open();
    expect(dividers()).toHaveLength(1);
    expect(dividers()[0].getAttribute("data-test")).toBe("unit-divider");
    expect(rows()).toEqual(["UTC", "Browser", "—", "Asia/Kolkata", "Europe/Berlin"]);
  });

  it("takes the divider's own data-test when it names one", async () => {
    await open(OPTIONS.map((o) => (o.divider ? { ...o, dataTest: "zone-divider" } : o)));
    expect(dividers()[0].getAttribute("data-test")).toBe("zone-divider");
  });

  it("is skipped by the arrow keys", async () => {
    await open();
    await press("ArrowDown");
    await press("ArrowDown");
    expect(highlighted()).toBe("Browser");
    await press("ArrowDown");
    expect(highlighted()).toBe("Asia/Kolkata");
    await press("ArrowUp");
    expect(highlighted()).toBe("Browser");
  });

  it("is never selected and never counted by select-all", async () => {
    await open(OPTIONS, { multiple: true, selectAll: true });
    dividers()[0].click();
    await flushPromises();
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
    const selectAll = document.body.querySelector<HTMLElement>('[role="checkbox"]');
    selectAll!.click();
    await flushPromises();
    expect(wrapper.emitted("update:modelValue")?.[0]?.[0]).toEqual([
      "UTC",
      "Browser",
      "Asia/Kolkata",
      "Europe/Berlin",
    ]);
  });

  it.each([
    ["local", ["Browser"]],
    ["kolkata", ["Browser", "—", "Asia/Kolkata"]],
    ["berlin", ["Europe/Berlin"]],
  ])("searching %s keeps the divider only between matches", async (term, expected) => {
    await open();
    await search(term);
    expect(rows()).toEqual(expected);
  });
});
