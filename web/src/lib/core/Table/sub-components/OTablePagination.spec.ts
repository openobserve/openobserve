// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { flushPromises, mount, VueWrapper, config } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";
import OTablePagination from "./OTablePagination.vue";
import { publishFloatingObstacle } from "@/lib/core/Table/composables/useFloatingClearance";
import { LOADER_DELAY_MS } from "@/lib/styles/motion";
import OSelect from "@/lib/forms/Select/OSelect.vue";

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
const PREV = '[data-test="o2-table-prev-page-btn"]';
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
    for (const selector of [PREV, NEXT]) {
      const button = wrapper.find(selector);
      expect(button.attributes("disabled")).toBeUndefined();
      expect(button.attributes("aria-disabled")).toBe("true");
      await button.trigger("click");
    }
    expect(wrapper.emitted("prev-page")).toBeUndefined();
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

  it("gives the pager its own line on narrow screens", () => {
    mountPager();
    expect(wrapper.find(INFO).element.parentElement!.className).toContain("max-md:basis-full");
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
    for (const selector of [PREV, NEXT]) {
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
    expect(wrapper.emitted("prev-page")).toBeUndefined();
    expect(wrapper.emitted("next-page")).toBeUndefined();
    expect(wrapper.emitted("update:pageSize")).toBeUndefined();
    await wrapper.setProps({ pending: false });
    await wrapper.find(NEXT).trigger("click");
    expect(wrapper.emitted("next-page")).toHaveLength(1);
  });

  it("keeps today's controls when stale is absent", () => {
    mountPager();
    expect(wrapper.find(PREV).attributes("disabled")).toBeUndefined();
    expect(wrapper.find(PREV).attributes("aria-disabled")).toBe("true");
    expect(wrapper.find(NEXT).attributes("disabled")).toBeUndefined();
    expect(wrapper.find(NEXT).attributes("aria-disabled")).toBeUndefined();
    expect(wrapper.find(PAGE_SIZE).attributes("aria-disabled")).toBeUndefined();
    expect(wrapper.find(INFO).classes()).not.toContain("opacity-60");
  });
});

const PAGER = [PREV, NEXT];

function heightOf(classes: string[]): string | undefined {
  return classes.find((name) => /^(h|size)-/.test(name))?.replace(/^size-/, "h-");
}

describe("OTablePagination footer", () => {
  afterEach(() => wrapper?.unmount());

  it("sets the page-size select to the height of the framed pager group", () => {
    mountPager({ isFirstPage: false, currentPage: 2 });
    const select = wrapper.find('[data-test="o2-table-page-size-select-trigger"]');
    expect(heightOf(select.classes())).toBe("h-7");
    expect(wrapper.find("nav").classes()).toEqual(expect.arrayContaining(["border", "p-px"]));
    for (const selector of PAGER) {
      expect(heightOf(wrapper.find(selector).classes()), selector).toBe("h-6");
    }
  });

  it("sets the range count in fixed-width secondary digits", () => {
    mountPager();
    const info = wrapper.find(INFO);
    expect(info.classes()).toEqual(expect.arrayContaining(["tabular-nums", "text-text-secondary"]));
    expect(wrapper.html()).not.toMatch(/\btext-primary\b/);
  });
});

describe("OTablePagination options for a caller-owned pager", () => {
  afterEach(() => wrapper?.unmount());

  it("draws a numbered page window under the caller's data-test and emits the page picked", async () => {
    mountPager({ pageWindow: 5, totalPages: 8, currentPage: 3, dataTestPrefix: "pg" });
    const pages = wrapper.findAll('[data-test^="pg-page-"]').map((b) => b.text());
    expect(pages).toEqual(["1", "2", "3", "4", "5"]);
    expect(wrapper.find('[data-test="pg-page-3"]').attributes("aria-current")).toBe("page");
    expect(wrapper.find('[data-test="pg-prev"]').exists()).toBe(true);
    await wrapper.find('[data-test="pg-page-4"]').trigger("click");
    expect(wrapper.emitted("go-to-page")).toEqual([[4]]);
  });

  it("keeps the compact pager by default", () => {
    mountPager();
    expect(wrapper.find('[data-test="o2-table-page-window"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="o2-table-current-page"]').exists()).toBe(true);
  });

  it("locks every control and states why", async () => {
    mountPager({ pageWindow: 3, totalPages: 3, dataTestPrefix: "pg", lockedReason: "Run first" });
    const root = wrapper.find('[data-test="o2-table-pagination-bottom"]');
    expect(root.attributes("data-locked")).toBe("true");
    expect(wrapper.find('[data-test="pg"]').attributes("data-locked")).toBe("true");
    expect(root.text()).toContain("Run first");
    expect(wrapper.find('[data-test="pg-page-2"]').attributes("disabled")).toBeDefined();
    expect(wrapper.findComponent(OSelect).props("disabled")).toBe(true);
    wrapper.findComponent(OSelect).vm.$emit("update:modelValue", 20);
    await nextTick();
    expect(wrapper.emitted("update:pageSize")).toBeUndefined();
  });

  it("holds only the page buttons while the page count settles", async () => {
    mountPager({ pageWindow: 3, totalPages: 3, dataTestPrefix: "pg", navPending: true });
    expect(wrapper.find('[data-test="pg-page-2"]').attributes("disabled")).toBeDefined();
    expect(wrapper.find(PAGE_SIZE).attributes("aria-disabled")).toBeUndefined();
    wrapper.findComponent(OSelect).vm.$emit("update:modelValue", 20);
    await nextTick();
    expect(wrapper.emitted("update:pageSize")).toEqual([[20]]);
  });

  it("names the page-size select and hides the range on request", () => {
    mountPager({ pageSizeDataTest: "rpp", hideRange: true });
    expect(wrapper.find('[data-test="rpp-trigger"]').exists()).toBe(true);
    expect(wrapper.find(INFO).exists()).toBe(false);
    expect(wrapper.find('[data-test="o2-table-pagination-divider"]').exists()).toBe(false);
  });
});

describe("OTablePagination beside a floating launcher", () => {
  const CONTROLS = '[data-test="o2-table-pagination-controls"]';
  const box = (left: number, top: number, width: number, height: number) =>
    ({ left, top, right: left + width, bottom: top + height, width, height }) as DOMRect;
  let main: HTMLElement;

  function mountInMain(pagerBox: DOMRect) {
    main = document.createElement("main");
    document.body.append(main);
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
      },
      attachTo: main,
    });
    wrapper.element.getBoundingClientRect = () => pagerBox;
  }

  afterEach(() => {
    publishFloatingObstacle(null);
    wrapper?.unmount();
    main?.remove();
  });

  it("keeps its full width while no launcher is published", async () => {
    mountInMain(box(240, 810, 1192, 34));
    await nextTick();
    expect(wrapper.get(CONTROLS).attributes("style")).toBeUndefined();
  });

  it("ends its controls before a launcher it overlaps", async () => {
    mountInMain(box(240, 810, 1192, 34));
    publishFloatingObstacle({ rect: box(1368, 800, 48, 48), scope: main });
    await nextTick();
    const controls = wrapper.get(CONTROLS);
    expect(controls.attributes("style")).toContain("--o-pager-clearance: 4");
    expect(controls.classes()).toContain("me-[calc(var(--o-pager-clearance)*1rem)]");
    publishFloatingObstacle(null);
    await nextTick();
    expect(wrapper.get(CONTROLS).attributes("style")).toBeUndefined();
  });

  it("keeps its full width when the launcher is nowhere near it", async () => {
    mountInMain(box(240, 300, 1192, 34));
    publishFloatingObstacle({ rect: box(1368, 800, 48, 48), scope: main });
    await nextTick();
    expect(wrapper.get(CONTROLS).attributes("style")).toBeUndefined();
  });

  it("keeps its full width outside the launcher's page", async () => {
    mountInMain(box(240, 810, 1192, 34));
    publishFloatingObstacle({
      rect: box(1368, 800, 48, 48),
      scope: document.createElement("main"),
    });
    await nextTick();
    expect(wrapper.get(CONTROLS).attributes("style")).toBeUndefined();
  });

  it("clears a launcher at the left edge in right-to-left layouts", async () => {
    mountInMain(box(0, 810, 1192, 34));
    wrapper.element.style.direction = "rtl";
    publishFloatingObstacle({ rect: box(24, 800, 48, 48), scope: main });
    await nextTick();
    expect(wrapper.get(CONTROLS).attributes("style")).toContain("--o-pager-clearance: 4.5");
  });
});
