// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { flushPromises, mount, VueWrapper, config } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { h, nextTick, Teleport } from "vue";
import OTablePagination from "./OTablePagination.vue";
import { LOADER_DELAY_MS } from "@/lib/styles/motion";
import OSelect from "@/lib/forms/Select/OSelect.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: { common: { loading: "Loading..." } } },
});

beforeAll(() => {
  config.global.plugins.unshift([i18n as any]);
});

const SKEL = '[data-test="o2-table-pagination-info-skel"]';
const INFO = '[data-test="o2-table-pagination-info"]';
const FIRST = '[data-test="o2-table-first-page-btn"]';
const NEXT = '[data-test="o2-table-next-page-btn"]';
const PAGE_SIZE = '[data-test="o2-table-page-size"]';

let wrapper: VueWrapper<any>;

function mountPager(props: Record<string, unknown> = {}, slots: Record<string, string> = {}) {
  wrapper = mount(OTablePagination, {
    props: {
      currentPage: 1,
      totalPages: 3,
      totalCount: 30,
      pageSize: 10,
      pageSizeOptions: [10, 20],
      showingFrom: 1,
      showingTo: 10,
      isFirstPage: true,
      isLastPage: false,
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
    mountPager({ isFirstPage: false, currentPage: 2, showingFrom: 11, showingTo: 20 });
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
    expect(wrapper.emitted("first-page")).toBeUndefined();
    expect(wrapper.emitted("next-page")).toBeUndefined();
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

  it("gives the pager its own line on narrow screens and hides the page-size label there", () => {
    mountPager({ selectedCount: 1 }, { "selection-actions": "<button>Pause</button>" });
    expect(wrapper.find(INFO).element.parentElement!.className).toContain("max-md:basis-full");
    expect(wrapper.find(PAGE_SIZE).find("span").classes()).toContain("max-md:hidden");
  });

  it("keeps focus on next when it lands on the last page, inactive but never disabled", async () => {
    mountPager({ isFirstPage: false, currentPage: 2 });
    (wrapper.find(NEXT).element as HTMLElement).focus();
    await wrapper.setProps({ currentPage: 3, isLastPage: true });
    const next = wrapper.find(NEXT);
    expect(document.activeElement).toBe(next.element);
    expect(next.attributes("disabled")).toBeUndefined();
    expect(next.attributes("aria-disabled")).toBe("true");
    await next.trigger("click");
    await next.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("next-page")).toBeUndefined();
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

  it("hides the divider with the range so it never shows alone, keeping its width", async () => {
    mountPager({ rangeHidden: true });
    const divider = wrapper.find('[data-test="o2-table-pagination-divider"]');
    expect(divider.exists()).toBe(true);
    expect(divider.classes()).toContain("invisible");
    expect(divider.classes()).not.toContain("hidden");
    await wrapper.setProps({ rangeHidden: false });
    expect(wrapper.find('[data-test="o2-table-pagination-divider"]').classes()).not.toContain(
      "invisible",
    );
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
    mountPager({ selectedCount: 2 });
    wrapper.unmount();
    wrapper = mount(OTablePagination, {
      props: { ...wrapper.props(), selectedCount: 2 },
      slots: {
        "selection-actions": () =>
          h(ODropdown, null, {
            trigger: () => h("button", { "data-test": "bulk-menu" }, "Snooze"),
            default: () => h(ODropdownItem, { onSelect, "data-test": "bulk-item" }, () => "1 hour"),
          }),
      },
      attachTo: document.body,
    });
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
    mountPager({ selectedCount: 2 });
    wrapper.unmount();
    wrapper = mount(OTablePagination, {
      props: { ...wrapper.props(), selectedCount: 2 },
      slots: {
        "selection-actions": () => [
          h("button", { id: "bulk-trigger", "aria-expanded": "true" }, "More"),
          h(Teleport, { to: "body" }, [
            h("div", { "aria-labelledby": "bulk-trigger", onKeydown: onEscape }, [
              h("button", { "data-test": "kept-item", onClick: onItem }, "Archive"),
            ]),
          ]),
        ],
      },
      attachTo: document.body,
    });
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
    mountPager({ isFirstPage: false, currentPage: 2, showingFrom: 11, showingTo: 20 });
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
      expect(button.classes()).not.toContain("cursor-not-allowed!");
      await button.trigger("click");
    }
    const group = wrapper.find(PAGE_SIZE);
    expect(group.attributes("aria-disabled")).toBe("true");
    expect(group.classes()).not.toContain("opacity-60");
    wrapper.findComponent(OSelect).vm.$emit("update:modelValue", 20);
    await nextTick();
    expect(wrapper.emitted("first-page")).toBeUndefined();
    expect(wrapper.emitted("next-page")).toBeUndefined();
    expect(wrapper.emitted("update:pageSize")).toBeUndefined();
    await wrapper.setProps({ pending: false });
    await wrapper.find(NEXT).trigger("click");
    expect(wrapper.emitted("next-page")).toHaveLength(1);
  });

  it("keeps today's controls when stale is absent", () => {
    mountPager();
    expect(wrapper.find(FIRST).attributes("disabled")).toBeUndefined();
    expect(wrapper.find(FIRST).attributes("aria-disabled")).toBe("true");
    expect(wrapper.find(NEXT).attributes("disabled")).toBeUndefined();
    expect(wrapper.find(NEXT).attributes("aria-disabled")).toBeUndefined();
    expect(wrapper.find(PAGE_SIZE).attributes("aria-disabled")).toBeUndefined();
    expect(wrapper.find(INFO).classes()).not.toContain("opacity-60");
  });
});
