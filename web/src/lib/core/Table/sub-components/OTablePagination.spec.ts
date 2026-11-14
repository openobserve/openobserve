// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { flushPromises, mount, VueWrapper } from "@vue/test-utils";
import { h, nextTick, Teleport } from "vue";
import OTablePagination from "./OTablePagination.vue";
import { LOADER_DELAY_MS } from "@/lib/styles/motion";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";

const SKEL = '[data-test="o2-table-pagination-info-skel"]';
const INFO = '[data-test="o2-table-pagination-info"]';
const FIRST = '[data-test="o2-table-first-page-btn"]';
const PREV = '[data-test="o2-table-prev-page-btn"]';
const NEXT = '[data-test="o2-table-next-page-btn"]';
const LAST = '[data-test="o2-table-last-page-btn"]';
const PAGE_SIZE = '[data-test="o2-table-page-size-select-group"]';
const SELECTION = '[data-test="o2-table-pagination-selection"]';

let wrapper: VueWrapper<any>;

// 30 pages, so the first and last buttons are on the bar.
function mountPager(props: Record<string, unknown> = {}, slots: Record<string, any> = {}) {
  wrapper = mount(OTablePagination, {
    props: {
      currentPage: 1,
      totalPages: 30,
      totalCount: 300,
      pageSize: 10,
      pageSizeOptions: [10, 20],
      ...props,
    },
    slots,
    attachTo: document.body,
  });
  return wrapper;
}

describe("OTablePagination loading and stale states", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
  });

  it("holds the range slot without a shimmer until a cold load outlasts the loader delay", async () => {
    mountPager({ loading: true });
    await nextTick();
    expect(wrapper.find(SKEL).classes()).toContain("invisible");
    vi.advanceTimersByTime(LOADER_DELAY_MS);
    await nextTick();
    expect(wrapper.find(SKEL).classes()).not.toContain("invisible");
  });

  it("never shows the shimmer for a cold load shorter than the loader delay", async () => {
    mountPager({ loading: true });
    await nextTick();
    vi.advanceTimersByTime(LOADER_DELAY_MS - 100);
    await wrapper.setProps({ loading: false });
    vi.advanceTimersByTime(LOADER_DELAY_MS);
    await nextTick();
    expect(wrapper.find(SKEL).exists()).toBe(false);
    expect(wrapper.find(INFO).exists()).toBe(true);
  });

  it("keeps the last range dimmed and the controls focusable but inactive while stale", async () => {
    mountPager({ currentPage: 2 });
    const before = wrapper.find(INFO).text();
    await wrapper.setProps({ stale: true });
    expect(wrapper.find(SKEL).exists()).toBe(false);
    expect(wrapper.find(INFO).text()).toBe(before);
    expect(wrapper.find(INFO).classes()).toContain("opacity-60");
    for (const selector of [FIRST, NEXT]) {
      const button = wrapper.find(selector);
      expect(button.attributes("disabled")).toBeUndefined();
      expect(button.attributes("aria-disabled")).toBe("true");
      await button.trigger("click");
    }
    expect(wrapper.emitted("go-to-page")).toBeUndefined();
  });

  it("swallows activation of the page-size select while stale but lets focus move", async () => {
    mountPager({ stale: true });
    const group = wrapper.find(PAGE_SIZE);
    expect(group.attributes("aria-disabled")).toBe("true");
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    const trigger = group.find("button, [role='combobox']").element;
    trigger.dispatchEvent(enter);
    trigger.dispatchEvent(tab);
    expect(enter.defaultPrevented).toBe(true);
    expect(tab.defaultPrevented).toBe(false);
  });

  it("keeps the selection bar and its count while stale, with its actions inactive", async () => {
    mountPager(
      { selectedCount: 2, stale: true },
      { "selection-actions": '<button data-test="bulk">Delete</button>' },
    );
    expect(wrapper.find('[data-test="o2-table-selected-count"]').exists()).toBe(true);
    const actions = wrapper.find('[data-test="o2-table-selection-actions"]');
    expect(actions.attributes("aria-disabled")).toBe("true");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    wrapper.find('[data-test="bulk"]').element.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });

  it("gives the selection and the pager their own lines on narrow screens", () => {
    mountPager({ selectedCount: 1 }, { "selection-actions": "<button>Pause</button>" });
    expect(wrapper.find(SELECTION).classes()).toContain("max-md:basis-full");
    expect(wrapper.find('[data-test="o2-table-pager"]').classes()).toContain("max-md:basis-full");
  });

  it("keeps focus on next when it lands on the last page, inactive but never disabled", async () => {
    mountPager({ currentPage: 29 });
    (wrapper.find(NEXT).element as HTMLElement).focus();
    await wrapper.setProps({ currentPage: 30 });
    const next = wrapper.find(NEXT);
    expect(document.activeElement).toBe(next.element);
    expect(next.attributes("disabled")).toBeUndefined();
    expect(next.attributes("aria-disabled")).toBe("true");
    await next.trigger("click");
    expect(wrapper.emitted("go-to-page")).toBeUndefined();
  });

  it("withholds the range text while no rows are on screen, keeping its width", async () => {
    mountPager({ rangeHidden: true });
    const info = wrapper.find(INFO);
    expect(info.classes()).toContain("invisible");
    expect(info.attributes("aria-hidden")).toBe("true");
    await wrapper.setProps({ rangeHidden: false });
    expect(wrapper.find(INFO).classes()).not.toContain("invisible");
    expect(wrapper.find(INFO).attributes("aria-hidden")).toBeUndefined();
  });

  it("ignores a page size chosen while stale and passes one on once fresh", async () => {
    mountPager({ stale: true });
    wrapper.findComponent(OSelect).vm.$emit("update:modelValue", 20);
    await nextTick();
    expect(wrapper.emitted("update:pageSize")).toBeUndefined();
    await wrapper.setProps({ stale: false });
    wrapper.findComponent(OSelect).vm.$emit("update:modelValue", 20);
    await nextTick();
    expect(wrapper.emitted("update:pageSize")).toEqual([[20]]);
  });

  it("closes a page-size menu opened before the rows went stale and blocks its options", async () => {
    mountPager();
    const trigger = wrapper.find(`${PAGE_SIZE} [aria-controls]`);
    await trigger.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(trigger.attributes("aria-expanded")).toBe("true");
    const menuId = trigger.attributes("aria-controls")!;
    const option = document.getElementById(menuId)!.querySelector('[role="option"]:last-child')!;
    await wrapper.setProps({ stale: true });
    await flushPromises();
    expect(trigger.attributes("aria-expanded")).toBe("false");
    for (const type of ["pointerdown", "pointerup", "click"]) {
      option.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
    }
    option.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flushPromises();
    expect(wrapper.emitted("update:pageSize")).toBeUndefined();
  });

  it("closes a bulk-action menu opened before the rows went stale and blocks its items", async () => {
    const onSelect = vi.fn();
    mountPager(
      { selectedCount: 2 },
      {
        "selection-actions": () =>
          h(ODropdown, null, {
            trigger: () => h("button", { "data-test": "bulk-menu" }, "Snooze"),
            default: () => h(ODropdownItem, { onSelect, "data-test": "bulk-item" }, () => "1 hour"),
          }),
      },
    );
    const trigger = wrapper.find('[data-test="bulk-menu"]');
    await trigger.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(trigger.attributes("aria-expanded")).toBe("true");
    const item = document.querySelector('[data-test="bulk-item"]')!;
    await wrapper.setProps({ stale: true });
    await flushPromises();
    expect(trigger.attributes("aria-expanded")).toBe("false");
    item.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    item.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await flushPromises();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("blocks the items of a portaled bulk menu that stays open while stale, and frees them after", async () => {
    const onItem = vi.fn();
    const onEscape = vi.fn();
    mountPager(
      { selectedCount: 2 },
      {
        "selection-actions": () => [
          h("button", { id: "bulk-trigger", "aria-expanded": "true" }, "More"),
          h(Teleport, { to: "body" }, [
            h("div", { "aria-labelledby": "bulk-trigger", onKeydown: onEscape }, [
              h("button", { "data-test": "kept-item", onClick: onItem }, "Archive"),
            ]),
          ]),
        ],
      },
    );
    const item = document.querySelector<HTMLElement>('[data-test="kept-item"]')!;
    await wrapper.setProps({ stale: true });
    expect(onEscape.mock.calls.map(([event]) => event.key)).toEqual(["Escape"]);
    item.click();
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    item.dispatchEvent(enter);
    expect(onItem).not.toHaveBeenCalled();
    expect(enter.defaultPrevented).toBe(true);
    await wrapper.setProps({ stale: false });
    item.click();
    expect(onItem).toHaveBeenCalledTimes(1);
  });

  it("ignores paging and page size at once while a page is pending, before any dim", async () => {
    mountPager({ currentPage: 2 });
    const trigger = wrapper.find(`${PAGE_SIZE} [aria-controls]`);
    await trigger.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(trigger.attributes("aria-expanded")).toBe("true");
    const before = wrapper.find(INFO).text();
    await wrapper.setProps({ pending: true });
    await flushPromises();
    expect(trigger.attributes("aria-expanded")).toBe("false");
    expect(wrapper.find(INFO).text()).toBe(before);
    expect(wrapper.find(INFO).classes()).not.toContain("opacity-60");
    for (const selector of [FIRST, NEXT]) {
      const button = wrapper.find(selector);
      expect(button.attributes("aria-disabled")).toBe("true");
      expect(button.attributes("disabled")).toBeUndefined();
      await button.trigger("click");
    }
    expect(wrapper.find(PAGE_SIZE).attributes("aria-disabled")).toBe("true");
    wrapper.findComponent(OSelect).vm.$emit("update:modelValue", 20);
    await nextTick();
    expect(wrapper.emitted("go-to-page")).toBeUndefined();
    expect(wrapper.emitted("update:pageSize")).toBeUndefined();
    await wrapper.setProps({ pending: false });
    await wrapper.find(NEXT).trigger("click");
    expect(wrapper.emitted("go-to-page")).toEqual([[3]]);
  });

  it("keeps today's controls when stale is absent", () => {
    mountPager();
    expect(wrapper.find(FIRST).attributes("disabled")).toBeUndefined();
    expect(wrapper.find(FIRST).attributes("aria-disabled")).toBe("true");
    expect(wrapper.find(NEXT).attributes("aria-disabled")).toBeUndefined();
    expect(wrapper.find(PAGE_SIZE).attributes("aria-disabled")).toBeUndefined();
    expect(wrapper.find(INFO).classes()).not.toContain("opacity-60");
  });
});

function heightOf(classes: string[]): string | undefined {
  return classes.find((name) => /^(h|size)-/.test(name))?.replace(/^size-/, "h-");
}

describe("OTablePagination footer", () => {
  afterEach(() => wrapper?.unmount());

  it("gives the pager buttons and the page-size select one height (S8)", () => {
    mountPager({ currentPage: 2 });
    const select = wrapper.find('[data-test="o2-table-page-size-select-trigger"]');
    const selectHeight = heightOf(select.classes());
    expect(selectHeight).toBe("h-control-sm");
    for (const selector of [FIRST, PREV, NEXT, LAST]) {
      expect(heightOf(wrapper.find(selector).classes()), selector).toBe(selectHeight);
    }
  });

  it('states the range as "1–10 of 300" in fixed-width secondary digits (D5)', () => {
    mountPager();
    const info = wrapper.find(INFO);
    expect(info.text()).toBe("1–10 of 300");
    expect(info.classes()).toEqual(expect.arrayContaining(["tabular-nums", "text-text-secondary"]));
  });

  it("emits the page a button asks for", async () => {
    mountPager({ currentPage: 5 });
    await wrapper.find(PREV).trigger("click");
    await wrapper.find(LAST).trigger("click");
    expect(wrapper.emitted("go-to-page")).toEqual([[4], [30]]);
  });

  it('turns the start side into the selection bar: "3 selected · actions · Clear" (D6)', async () => {
    mountPager(
      { selectedCount: 3 },
      { "selection-actions": '<button data-test="bulk">Pause</button>' },
    );
    const bar = wrapper.find(SELECTION);
    expect(wrapper.find('[data-test="o2-table-selected-count"]').text()).toBe("3 selected");
    expect(bar.find('[data-test="bulk"]').exists()).toBe(true);
    expect(wrapper.classes()).toContain("bg-table-row-selected-bg");
    await wrapper.find('[data-test="o2-table-clear-selection"]').trigger("click");
    expect(wrapper.emitted("clear-selection")).toHaveLength(1);
  });

  it("shows the selection bar without a pager when the table does not page", () => {
    mountPager({ selectedCount: 2, paged: false });
    expect(wrapper.find(SELECTION).exists()).toBe(true);
    expect(wrapper.find('[data-test="o2-table-pager"]').exists()).toBe(false);
  });
});
