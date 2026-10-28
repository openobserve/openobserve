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

const ACTION_HEADER: SelectOption = {
  label: raw("Internal streams"),
  value: "group:hide",
  header: true,
  headerCount: raw("2"),
  headerAction: raw("Hide"),
  headerActionAriaLabel: raw("Hide internal streams"),
};

const OPTIONS: SelectOption[] = [
  { label: raw("Recent"), header: true },
  { label: raw("default"), value: "default" },
  ACTION_HEADER,
  { label: raw("_rumdata"), value: "_rumdata" },
  { label: raw("_rumlog"), value: "_rumlog" },
];

describe("OSelect header actions", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  const open = async (props: Record<string, unknown> = {}, attrs: Record<string, unknown> = {}) => {
    wrapper = mount(OSelect, {
      attachTo: document.body,
      attrs: { "data-test": "unit", ...attrs },
      props: { multiple: true, options: OPTIONS, ...props },
    });
    await wrapper.find("button").trigger("click");
    await flushPromises();
  };
  const actionButton = () =>
    document.body.querySelector<HTMLButtonElement>('[data-test="unit-header-action"]');
  const search = async (term: string) => {
    const input = document.body.querySelector<HTMLInputElement>('[data-test="unit-search"]')!;
    input.value = term;
    input.dispatchEvent(new Event("input"));
    await flushPromises();
  };
  // Every text node of a row, space-joined: the compiled template drops whitespace between elements.
  const words = (el: Element) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const parts: string[] = [];
    while (walker.nextNode()) parts.push(walker.currentNode.textContent!.trim());
    return parts.filter(Boolean).join(" ");
  };
  const rows = () => Array.from(document.body.querySelectorAll("[data-vrow]")).map(words);

  it("renders the label, the count and a real action button on the header row", async () => {
    await open();
    const header = document.body.querySelector<HTMLElement>('[data-test="unit-header"]')!;
    expect(words(header)).toBe("Internal streams · 2 Hide");
    const button = actionButton()!;
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.getAttribute("aria-label")).toBe("Hide internal streams");
  });

  it("emits header-action with the header option as passed in, without selecting anything", async () => {
    await open();
    actionButton()!.click();
    await flushPromises();
    expect(wrapper.emitted("header-action")).toEqual([[ACTION_HEADER]]);
    expect(wrapper.emitted("update:modelValue")).toBeUndefined();
  });

  it("does not take focus from the search input on mousedown", async () => {
    await open();
    const input = document.body.querySelector<HTMLInputElement>('[data-test="unit-search"]')!;
    input.focus();
    const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    actionButton()!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it("keeps keyboard focus on the action after the consumer swaps the header", async () => {
    const collapsed = { ...ACTION_HEADER, headerCount: raw("2 hidden"), headerAction: raw("Show") };
    await open(
      {},
      { onHeaderAction: () => wrapper.setProps({ options: [OPTIONS[0], OPTIONS[1], collapsed] }) },
    );
    actionButton()!.focus();
    actionButton()!.click();
    await flushPromises();
    expect(actionButton()!.textContent!.trim()).toBe("Show");
    expect(document.activeElement).toBe(actionButton());
  });

  it("is skipped by arrow-key highlight", async () => {
    await open();
    const input = document.body.querySelector<HTMLInputElement>('[data-test="unit-search"]')!;
    const press = async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      await flushPromises();
    };
    const highlighted = () =>
      document.body
        .querySelector<HTMLElement>(".bg-select-item-hover-bg[data-test-value]")
        ?.getAttribute("data-test-value");
    await press();
    expect(highlighted()).toBe("default");
    await press();
    expect(highlighted()).toBe("_rumdata");
  });

  it("drops an action header with no match while searching unless keepOnSearch is set", async () => {
    await open();
    await search("default");
    expect(rows()).toEqual(["Recent", "default"]);

    await wrapper.setProps({
      options: [...OPTIONS.slice(0, 2), { ...ACTION_HEADER, keepOnSearch: true }],
    });
    await flushPromises();
    expect(rows()).toEqual(["Recent", "default", "Internal streams · 2 Hide"]);
  });

  it("shows a header with nothing under it when no search is active", async () => {
    await open({ options: [{ ...ACTION_HEADER, headerAction: raw("Show") }] });
    expect(rows()).toEqual(["Internal streams · 2 Show"]);
    expect(document.body.textContent).not.toContain("No options found");
  });

  it("renders a header without the new fields exactly as before", async () => {
    await open();
    const plain = document.body.querySelector<HTMLElement>('[data-vrow="0"] > div')!;
    expect(plain.textContent!.trim()).toBe("Recent");
    expect(plain.className).toContain("pointer-events-none");
    expect(plain.className).not.toContain("bg-select-header-bg");
    expect(plain.querySelector("button")).toBeNull();
  });
});
