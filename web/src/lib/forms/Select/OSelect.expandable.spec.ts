// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { unref } from "vue";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import OSelect from "./OSelect.vue";
import { resolveTokens } from "@/lib/styles/tokens/colorMath";

const TOKEN_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../styles/tokens");

// JSDOM has no layout, so the real virtualizer renders no rows; render them all.
vi.mock("@tanstack/vue-virtual", async () => {
  const { computed, unref } = await import("vue");
  return {
    useVirtualizer: (options: any) => {
      (globalThis as any).__oselectVirtualOptions = options;
      return computed(() => {
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
      });
    },
  };
});

const OPTIONS = [
  { label: "Numbers", value: "numbers" },
  { label: "Locale Format (Auto)", value: "locale" },
  { label: "Other Locale", value: "other-locale", expandable: true },
  { label: "Czech (Czechia)", value: "locale:cs-CZ", parentValue: "other-locale" },
  { label: "German (Germany)", value: "locale:de-DE", parentValue: "other-locale" },
  { label: "Bytes", value: "bytes" },
];

describe("OSelect expandable rows", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  const mountSelect = (props: Record<string, unknown>) => {
    wrapper = mount(OSelect, {
      attachTo: document.body,
      attrs: { "data-test": "unit" },
      props: { options: OPTIONS, ...props },
    });
  };
  const openDropdown = async () => {
    await wrapper.find("button").trigger("click");
    await flushPromises();
  };
  const open = async (props: Record<string, unknown>) => {
    mountSelect(props);
    await openDropdown();
  };
  const option = (value: string) =>
    document.body.querySelector<HTMLElement>(
      `[data-test="unit-option"][data-test-value="${value}"]`,
    );
  const expandRow = () => document.body.querySelector<HTMLElement>('[data-test="unit-expand"]');
  const clickExpandRow = async () => {
    expandRow()!.click();
    await flushPromises();
  };
  const search = () => document.body.querySelector<HTMLInputElement>('[data-test="unit-search"]')!;
  const pressKey = async (key: string) => {
    search().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    await flushPromises();
  };

  it("renders the row as a collapsed toggle, not a selectable option", async () => {
    await open({ modelValue: "bytes" });
    expect(expandRow()?.textContent?.trim()).toBe("Other Locale");
    expect(expandRow()!.getAttribute("aria-expanded")).toBe("false");
    expect(option("other-locale")).toBeNull();
    expect(option("locale:cs-CZ")).toBeNull();
    expect(option("locale")).not.toBeNull();
    expect(option("bytes")).not.toBeNull();
  });

  it("styles the row like an option with the arrow on the right", async () => {
    await open({ modelValue: "bytes" });
    const row = expandRow()!;
    expect(row.classList.contains("text-sm")).toBe(true);
    expect(row.classList.contains("font-bold")).toBe(false);
    expect(row.classList.contains("bg-surface-subtle")).toBe(false);
    expect(row.firstElementChild?.textContent?.trim()).toBe("Other Locale");
    expect(row.lastElementChild).not.toBe(row.firstElementChild);
  });

  it("expands and collapses on click without selecting anything", async () => {
    await open({ modelValue: "bytes" });
    await clickExpandRow();
    expect(option("locale:cs-CZ")).not.toBeNull();
    expect(option("locale:de-DE")).not.toBeNull();
    expect(expandRow()!.getAttribute("aria-expanded")).toBe("true");
    await clickExpandRow();
    expect(option("locale:cs-CZ")).toBeNull();
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("selects a nested option and indents its row", async () => {
    await open({ modelValue: "bytes" });
    await clickExpandRow();
    expect(option("locale:cs-CZ")!.classList.contains("ps-7")).toBe(true);
    expect(option("bytes")!.classList.contains("ps-3")).toBe(true);
    option("locale:cs-CZ")!.click();
    await flushPromises();
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["locale:cs-CZ"]);
  });

  it("opens expanded when a nested option is selected", async () => {
    await open({ modelValue: "locale:de-DE" });
    expect(option("locale:cs-CZ")).not.toBeNull();
    expect(expandRow()!.getAttribute("aria-expanded")).toBe("true");
  });

  it("forgets an expansion once the dropdown closes", async () => {
    mountSelect({ modelValue: "bytes" });
    await openDropdown();
    await clickExpandRow();
    await pressKey("Escape");
    await openDropdown();
    expect(option("locale:cs-CZ")).toBeNull();
  });

  it("searches nested options flat, without the row", async () => {
    await open({ modelValue: "bytes" });
    const input = search();
    input.value = "czech";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
    expect(option("locale:cs-CZ")!.classList.contains("ps-3")).toBe(true);
    expect(option("bytes")).toBeNull();
    expect(expandRow()).toBeNull();
  });

  it("toggles from the keyboard: Enter, ArrowRight, ArrowLeft", async () => {
    await open({ modelValue: "locale" });
    await pressKey("ArrowDown");
    await pressKey("Enter");
    expect(option("locale:cs-CZ")).not.toBeNull();
    await pressKey("ArrowLeft");
    expect(option("locale:cs-CZ")).toBeNull();
    await pressKey("ArrowRight");
    expect(option("locale:cs-CZ")).not.toBeNull();
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("collapses the row with ArrowLeft from a nested option", async () => {
    await open({ modelValue: "locale:cs-CZ" });
    await pressKey("ArrowLeft");
    expect(option("locale:cs-CZ")).toBeNull();
    expect(expandRow()!.getAttribute("aria-expanded")).toBe("false");
  });

  it("never shows the row's key as the selected label", () => {
    mountSelect({ modelValue: "other-locale" });
    expect(wrapper.find('[data-test="unit-trigger"]').attributes("data-test-selected-label")).toBe(
      "other-locale",
    );
  });

  it("renders no row for options without nesting", async () => {
    await open({ options: [{ label: "Bytes", value: "bytes" }], modelValue: "bytes" });
    expect(expandRow()).toBeNull();
    expect(option("bytes")!.classList.contains("ps-3")).toBe(true);
  });
});

const GROUPED = [
  { label: "Number group", header: true },
  { label: "Numbers", value: "numbers" },
  { label: "Locale Format (Auto)", value: "locale" },
  { label: "Other Locale", value: "other-locale", expandable: true },
  { label: "Czech (Czechia)", value: "locale:cs-CZ", parentValue: "other-locale" },
  { label: "German (Germany)", value: "locale:de-DE", parentValue: "other-locale" },
  { label: "Data group", header: true },
  { label: "Bytes", value: "bytes" },
  { label: "Time group", header: true },
  { label: "Seconds", value: "seconds" },
];

describe("OSelect group headers while searching", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  const open = async (options: unknown[]) => {
    wrapper = mount(OSelect, {
      attachTo: document.body,
      attrs: { "data-test": "unit" },
      props: { options, modelValue: "bytes" } as Record<string, unknown>,
    });
    await wrapper.find("button").trigger("click");
    await flushPromises();
  };
  const search = async (term: string) => {
    const input = document.body.querySelector<HTMLInputElement>('[data-test="unit-search"]')!;
    input.value = term;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
  };
  const listText = () =>
    document.body.querySelector('[data-test="unit-popover"]')?.textContent ?? "";
  const optionValues = () =>
    [...document.body.querySelectorAll<HTMLElement>('[data-test="unit-option"]')].map(
      (el) => el.dataset.testValue,
    );

  it("hides a header whose group has no match", async () => {
    await open(GROUPED);
    await search("seconds");
    expect(listText()).toContain("Time group");
    expect(listText()).not.toContain("Number group");
    expect(listText()).not.toContain("Data group");
    expect(optionValues()).toEqual(["seconds"]);
  });

  it("keeps the header above a matching nested option", async () => {
    await open(GROUPED);
    await search("czech");
    expect(listText()).toContain("Number group");
    expect(listText()).not.toContain("Data group");
    expect(optionValues()).toEqual(["locale:cs-CZ"]);
  });

  it("drops the header when only its expandable row matched, and shows the empty state", async () => {
    await open(GROUPED);
    await search("other");
    expect(listText()).not.toContain("Number group");
    expect(optionValues()).toEqual([]);
    expect(listText()).toContain("No options found");
  });

  const headerRow = (label: string) =>
    [...document.body.querySelectorAll<HTMLElement>("[data-vrow] > div")].find(
      (el) => el.textContent?.trim() === label,
    )!;

  it("styles every header like the option text, bold, with no border", async () => {
    await open(GROUPED);
    for (const label of ["Number group", "Data group"]) {
      const el = headerRow(label);
      expect(el.classList.contains("text-select-item-text")).toBe(true);
      expect(el.classList.contains("text-xs")).toBe(true);
      expect(el.classList.contains("font-bold")).toBe(true);
      expect([...el.classList].some((c) => c.includes("border"))).toBe(false);
    }
  });

  it("puts the group gap above every header but the first", async () => {
    await open(GROUPED);
    expect(headerRow("Number group").parentElement!.classList.contains("pt-select-group-gap")).toBe(
      false,
    );
    expect(headerRow("Data group").parentElement!.classList.contains("pt-select-group-gap")).toBe(
      true,
    );
    expect(headerRow("Time group").parentElement!.classList.contains("pt-select-group-gap")).toBe(
      true,
    );
  });

  it("sizes spaced header rows from the gap token so the virtual rows never overlap", async () => {
    const virtualOptions = () => unref((globalThis as any).__oselectVirtualOptions);
    const dataHeader = GROUPED.findIndex((o) => o.label === "Data group");

    document.documentElement.style.setProperty("--spacing-select-group-gap", "0.75rem");
    try {
      await open(GROUPED);
      expect(virtualOptions().estimateSize(0)).toBe(28);
      expect(virtualOptions().estimateSize(dataHeader)).toBe(28 + 12);
      expect(virtualOptions().estimateSize(1)).toBe(28);
    } finally {
      document.documentElement.style.removeProperty("--spacing-select-group-gap");
    }
    wrapper.unmount();

    await open(GROUPED);
    expect(virtualOptions().estimateSize(dataHeader)).toBe(28);
  });

  it("opens the gap in dark only", () => {
    const sheets = ["base.css", "semantic.css", "component.css", "dark.css"].map((file) =>
      readFileSync(join(TOKEN_DIR, file), "utf8"),
    );
    const { light, dark } = resolveTokens(sheets);
    expect(light.get("--spacing-select-group-gap")).toBe("0rem");
    expect(dark.get("--spacing-select-group-gap")).toBe("0.75rem");
  });

  it("shows every header without a search", async () => {
    await open(GROUPED);
    for (const header of ["Number group", "Data group", "Time group"]) {
      expect(listText()).toContain(header);
    }
  });

  it("keeps headers of a list without nesting as before", async () => {
    await open(GROUPED.filter((o) => !("expandable" in o) && !("parentValue" in o)));
    await search("by");
    expect(listText()).toContain("Data group");
    expect(listText()).not.toContain("Time group");
    expect(optionValues()).toEqual(["bytes"]);
  });
});
