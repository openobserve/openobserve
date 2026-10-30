// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import { raw } from "@/types/i18n";
import OCommandSearch from "./OCommandSearch.vue";
import type { CommandSearchItem } from "./OCommandSearch.types";

const ITEMS: CommandSearchItem[] = [
  {
    id: "dedup",
    label: raw("Skip duplicates"),
    context: [raw("Who should hear about it?"), raw("More")],
  },
  { id: "cooldown", label: raw("At most once every"), context: [raw("How often?")] },
];

const mountSearch = (items: CommandSearchItem[] = ITEMS) => {
  const selected: string[] = [];
  const Host = defineComponent({
    setup() {
      const query = ref("");
      return () =>
        h(
          OCommandSearch,
          {
            modelValue: query.value,
            "onUpdate:modelValue": (v: string) => (query.value = v),
            items,
            label: raw("Find a setting"),
            countText: raw("2 settings match"),
            emptyText: raw("Nothing"),
            shortcutId: "sectionedFormFind",
            onSelect: (id: string) => selected.push(id),
          },
          { footer: () => "Esc closes" },
        );
    },
  });
  const wrapper = mount(Host, { attachTo: document.body });
  return { wrapper, selected };
};

const input = (wrapper: VueWrapper) => wrapper.find('[data-test="o-command-search-input"]');
const results = () => document.querySelector('[data-test="o-command-search-results"]');
const item = (id: string) =>
  document.querySelector<HTMLElement>(`[data-test="o-command-search-item-${id}"]`);

const type = async (wrapper: VueWrapper, text: string) => {
  await input(wrapper).trigger("focus");
  await input(wrapper).setValue(text);
  await flushPromises();
};

describe("OCommandSearch", () => {
  let wrapper: VueWrapper | null = null;
  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.innerHTML = "";
  });

  it("stays closed until something is typed, then lists label and location", async () => {
    const m = mountSearch();
    wrapper = m.wrapper;
    await input(wrapper).trigger("focus");
    await flushPromises();
    expect(results()).toBeNull();
    await type(wrapper, "dup");
    expect(results()).not.toBeNull();
    expect(item("dedup")?.textContent).toContain(
      "Skip duplicates · Who should hear about it? · More",
    );
    expect(document.querySelector('[data-test="o-command-search-count"]')?.textContent).toContain(
      "2 settings match",
    );
    expect(document.querySelector('[data-test="o-command-search-footer"]')?.textContent).toContain(
      "Esc closes",
    );
  });

  it("moves with the arrows and selects with Enter, then clears", async () => {
    const m = mountSearch();
    wrapper = m.wrapper;
    await type(wrapper, "o");
    await input(wrapper).trigger("keydown", { key: "ArrowDown" });
    await flushPromises();
    await input(wrapper).trigger("keydown", { key: "ArrowDown" });
    await flushPromises();
    expect(item("cooldown")?.hasAttribute("data-highlighted")).toBe(true);
    await input(wrapper).trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(m.selected).toEqual(["cooldown"]);
    expect((input(wrapper).element as HTMLInputElement).value).toBe("");
    expect(results()).toBeNull();
  });

  it("selects a clicked result", async () => {
    const m = mountSearch();
    wrapper = m.wrapper;
    await type(wrapper, "dup");
    item("dedup")?.click();
    await flushPromises();
    expect(m.selected).toEqual(["dedup"]);
  });

  it("closes on Escape without selecting", async () => {
    const m = mountSearch();
    wrapper = m.wrapper;
    await type(wrapper, "dup");
    await input(wrapper).trigger("keydown", { key: "Escape" });
    await flushPromises();
    expect(results()).toBeNull();
    expect(m.selected).toEqual([]);
  });

  it("says so when nothing matches", async () => {
    const m = mountSearch([]);
    wrapper = m.wrapper;
    await type(wrapper, "zzz");
    expect(document.querySelector('[data-test="o-command-search-empty"]')?.textContent).toContain(
      "Nothing",
    );
  });

  it("shows the registry shortcut that focuses it", () => {
    const m = mountSearch();
    wrapper = m.wrapper;
    expect(wrapper.find('[data-test="o-command-search-shortcut"]').text()).toContain("/");
  });
});
