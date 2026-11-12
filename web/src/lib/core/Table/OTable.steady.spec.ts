// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { flushPromises, mount, VueWrapper, config } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { defineComponent, h, nextTick, ref } from "vue";
import OTable from "./OTable.vue";
import OContextMenu from "@/lib/overlay/ContextMenu/OContextMenu.vue";
import ODropdown from "@/lib/overlay/Dropdown/ODropdown.vue";
import ODropdownItem from "@/lib/overlay/Dropdown/ODropdownItem.vue";
import type { OTableColumnDef } from "./OTable.types";
import { LOADER_DELAY_MS, MIN_SKELETON_MS, STALE_DIM_DELAY_MS } from "@/lib/styles/motion";

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: { search: { noData: "No data available" }, common: { loading: "Loading..." } } },
});

beforeAll(() => {
  config.global.plugins.unshift([i18n as any]);
});

interface Row {
  id: number;
  name: string;
}

const columns: OTableColumnDef<Row>[] = [
  { id: "id", header: "ID", accessorKey: "id", size: 60 },
  { id: "name", header: "Name", accessorKey: "name", size: 200 },
];

function makeRows(count: number, label = "User"): Row[] {
  return Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `${label} ${i + 1}` }));
}

const SKELETON = '[data-test="o2-table-skeleton-body"]';
const BODY = '[data-test="o2-table-body"]';
const TABLE = '[data-test="o2-table"]';
const BAR = '[data-test="o2-table-streaming-bar"]';
const EMPTY = '[data-test="o2-table-empty"]';
const PAGER_INFO = '[data-test="o2-table-pagination-info"]';
const NEXT = '[data-test="o2-table-next-page-btn"]';
const HOVER_TOOLBAR = '[data-test^="o2-table-cell-hover-actions-"]';

let wrapper: VueWrapper<any>;

function mountTable(props: Record<string, unknown> = {}, slots: Record<string, string> = {}) {
  wrapper = mount(OTable as any, {
    props: { data: makeRows(5), columns, loading: false, ...props },
    slots,
    attachTo: document.body,
  });
  return wrapper;
}

async function advance(ms: number): Promise<void> {
  vi.advanceTimersByTime(ms);
  await nextTick();
}

async function startRefetch(): Promise<void> {
  await wrapper.setProps({ loading: true });
  await advance(STALE_DIM_DELAY_MS);
}

describe("OTable cold load timing", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
  });

  it("goes straight from header to rows on a load shorter than the loader delay", async () => {
    mountTable({ data: [], loading: true });
    await nextTick();
    await advance(LOADER_DELAY_MS - 100);
    expect(wrapper.find(SKELETON).exists()).toBe(false);
    expect(wrapper.find(EMPTY).exists()).toBe(false);
    expect(wrapper.find(BODY).exists()).toBe(false);
    expect(wrapper.find(TABLE).attributes("aria-busy")).toBe("true");

    await wrapper.setProps({ data: makeRows(2, "Fresh"), loading: false });
    expect(wrapper.find(SKELETON).exists()).toBe(false);
    expect(wrapper.find(BODY).text()).toContain("Fresh 1");
    await advance(LOADER_DELAY_MS);
    expect(wrapper.find(SKELETON).exists()).toBe(false);
  });

  it("shows the skeleton at the loader delay and holds it for the minimum once visible", async () => {
    mountTable({ data: [], loading: true });
    await nextTick();
    await advance(LOADER_DELAY_MS - 1);
    expect(wrapper.find(SKELETON).exists()).toBe(false);
    await advance(1);
    expect(wrapper.find(SKELETON).exists()).toBe(true);

    await advance(50);
    await wrapper.setProps({ data: makeRows(2, "Fresh"), loading: false });
    expect(wrapper.find(SKELETON).exists()).toBe(true);
    await advance(MIN_SKELETON_MS - 50 - 1);
    expect(wrapper.find(SKELETON).exists()).toBe(true);
    await advance(1);
    expect(wrapper.find(SKELETON).exists()).toBe(false);
    expect(wrapper.find(BODY).text()).toContain("Fresh 1");
  });

  it("releases at once when the skeleton was visible longer than the minimum", async () => {
    mountTable({ data: [], loading: true });
    await nextTick();
    await advance(LOADER_DELAY_MS + MIN_SKELETON_MS);
    await wrapper.setProps({ data: makeRows(1, "Fresh"), loading: false });
    expect(wrapper.find(SKELETON).exists()).toBe(false);
    expect(wrapper.find(BODY).text()).toContain("Fresh 1");
  });

  it("never shows the empty state while a load runs, inside or after the delay", async () => {
    mountTable({ data: [], loading: true });
    await nextTick();
    expect(wrapper.find(EMPTY).exists()).toBe(false);
    await advance(LOADER_DELAY_MS);
    expect(wrapper.find(EMPTY).exists()).toBe(false);
    await wrapper.setProps({ loading: false });
    await advance(MIN_SKELETON_MS);
    expect(wrapper.find(EMPTY).exists()).toBe(true);
  });

  it("times the skeleton from the loadingResetKey change that dropped the kept rows", async () => {
    mountTable({ loadingResetKey: "a" });
    await wrapper.setProps({ loading: true });
    await advance(LOADER_DELAY_MS);
    await wrapper.setProps({ loadingResetKey: "b" });
    expect(wrapper.find(BODY).exists()).toBe(false);
    expect(wrapper.find(SKELETON).exists()).toBe(false);
    await advance(LOADER_DELAY_MS);
    expect(wrapper.find(SKELETON).exists()).toBe(true);
  });

  it("shows the progress line only once streaming outlasts the loader delay", async () => {
    mountTable({ streaming: true });
    await nextTick();
    expect(wrapper.find(BAR).exists()).toBe(false);
    await advance(LOADER_DELAY_MS);
    const bar = wrapper.find(BAR);
    expect(bar.exists()).toBe(true);
    expect(bar.classes()).toContain("motion-safe:animate-pulse");
    expect(bar.classes()).not.toContain("animate-pulse");
    expect(bar.classes()).toContain(
      "motion-reduce:animate-[pulse_8s_cubic-bezier(0.4,0,0.6,1)_infinite]",
    );
  });
});

describe("OTable kept rows while refetching", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("marks the table busy at once and dims to 60% in both themes at the dim delay", async () => {
    mountTable();
    await wrapper.setProps({ loading: true });
    expect(wrapper.find(TABLE).attributes("aria-busy")).toBe("true");
    await advance(STALE_DIM_DELAY_MS - 1);
    expect(wrapper.find(BODY).classes()).not.toContain("opacity-60");
    await advance(1);
    const body = wrapper.find(BODY);
    expect(body.classes()).toContain("opacity-60");
    expect(body.classes().some((c) => c.startsWith("dark:opacity"))).toBe(false);
    expect(body.attributes("inert")).toBeUndefined();
  });

  it("shows the progress line at the loader delay, not at the dim", async () => {
    mountTable();
    await startRefetch();
    expect(wrapper.find(BAR).exists()).toBe(false);
    await advance(LOADER_DELAY_MS - STALE_DIM_DELAY_MS);
    expect(wrapper.find(BAR).exists()).toBe(true);
  });

  it("keeps rows readable, openable and expandable while dimmed", async () => {
    mountTable({ expansion: "single" }, { expansion: '<div data-test="exp">Detail</div>' });
    await startRefetch();
    expect(wrapper.find(BODY).text()).toContain("User 1");
    await wrapper.find('[data-test="o2-table-row-0"]').trigger("click");
    expect(wrapper.emitted("row-click")).toHaveLength(1);
    await wrapper.find('[data-test="o2-table-expand-0"]').trigger("click");
    expect(wrapper.find('[data-test="exp"]').exists()).toBe(true);
  });

  it("keeps row checkboxes focusable but inactive, and select-all dimmed", async () => {
    mountTable({ selection: "multiple" });
    await startRefetch();
    const row = wrapper.find('[data-test="o2-table-select-0"] [role="checkbox"]');
    expect(row.attributes("disabled")).toBeUndefined();
    expect(row.element.closest('[aria-disabled="true"]')).not.toBeNull();
    await row.trigger("click");
    const all = wrapper.find('[data-test="o2-table-select-all"]');
    expect(all.classes()).toContain("opacity-60");
    await all.find('[role="checkbox"]').trigger("click");
    expect(wrapper.emitted("update:selectedIds")).toBeUndefined();
  });

  it("disables the selection-bar actions while dimmed and re-enables them after", async () => {
    const onDelete = vi.fn();
    const Host = defineComponent({
      components: { OTable },
      setup: () => ({ rows: makeRows(5), columns, loading: ref(false), onDelete }),
      template: `<OTable :data="rows" :columns="columns" :loading="loading" selection="multiple" :selected-ids="['1']">
        <template #selection-actions><button data-test="bulk-delete" @click="onDelete">Delete</button></template>
      </OTable>`,
    });
    wrapper = mount(Host, { attachTo: document.body });
    (wrapper.vm as any).loading = true;
    await nextTick();
    await advance(STALE_DIM_DELAY_MS);
    const group = wrapper.find('[data-test="o2-table-selection-actions"]');
    expect(group.attributes("aria-disabled")).toBe("true");
    await wrapper.find('[data-test="bulk-delete"]').trigger("click");
    expect(onDelete).not.toHaveBeenCalled();

    (wrapper.vm as any).loading = false;
    await nextTick();
    await wrapper.find('[data-test="bulk-delete"]').trigger("click");
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["before the refetch", 0],
    ["inside the dim delay", STALE_DIM_DELAY_MS - 1],
  ])(
    "closes a bulk menu opened %s once the rows dim, and its items do nothing",
    async (_when, openAt) => {
      const onSnooze = vi.fn();
      const Host = defineComponent({
        components: { OTable, ODropdown, ODropdownItem },
        setup: () => ({ rows: makeRows(5), columns, loading: ref(false), onSnooze }),
        template: `<OTable :data="rows" :columns="columns" :loading="loading" selection="multiple" :selected-ids="['1']">
        <template #selection-actions>
          <ODropdown>
            <template #trigger><button data-test="bulk-snooze">Snooze</button></template>
            <ODropdownItem data-test="bulk-snooze-hour" @select="onSnooze">1 hour</ODropdownItem>
          </ODropdown>
        </template>
      </OTable>`,
      });
      wrapper = mount(Host, { attachTo: document.body });
      const openMenu = async () => {
        await wrapper.find('[data-test="bulk-snooze"]').trigger("keydown", { key: "Enter" });
        await flushPromises();
      };
      if (openAt === 0) await openMenu();
      (wrapper.vm as any).loading = true;
      await nextTick();
      if (openAt > 0) {
        await advance(openAt);
        await openMenu();
      }
      const trigger = wrapper.find('[data-test="bulk-snooze"]');
      expect(trigger.attributes("aria-expanded")).toBe("true");
      const item = document.querySelector<HTMLElement>('[data-test="bulk-snooze-hour"]')!;
      await advance(STALE_DIM_DELAY_MS - openAt);
      await flushPromises();
      expect(trigger.attributes("aria-expanded")).toBe("false");
      item.click();
      item.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await flushPromises();
      expect(onSnooze).not.toHaveBeenCalled();
    },
  );

  it("hides cell hover actions while dimmed and brings them back for the hovered cell", async () => {
    mountTable({}, { "cell-hover-actions": '<span class="hover-act">A</span>' });
    await wrapper.find('[data-test="o2-table-cell-id"]').trigger("mouseenter");
    await advance(0);
    expect(document.querySelectorAll(HOVER_TOOLBAR).length).toBe(1);
    await startRefetch();
    expect(document.querySelectorAll(HOVER_TOOLBAR).length).toBe(0);
    await wrapper.setProps({ loading: false });
    expect(document.querySelectorAll(HOVER_TOOLBAR).length).toBe(1);
  });

  it("disables the pager while dimmed: count kept and dimmed, controls focusable but inactive", async () => {
    mountTable({ data: makeRows(30), pageSize: 10 });
    const before = wrapper.find(PAGER_INFO).text();
    await startRefetch();
    const info = wrapper.find(PAGER_INFO);
    expect(info.text()).toBe(before);
    expect(info.classes()).toContain("opacity-60");
    expect(wrapper.find('[data-test="o2-table-pagination-info-skel"]').exists()).toBe(false);
    const next = wrapper.find(NEXT);
    expect(next.attributes("disabled")).toBeUndefined();
    expect(next.attributes("aria-disabled")).toBe("true");
    await next.trigger("click");
    expect(wrapper.vm.table.getState().pagination.pageIndex).toBe(0);
    expect(wrapper.find('[data-test="o2-table-page-size"]').attributes("aria-disabled")).toBe(
      "true",
    );
  });

  it.each([
    ["the page", { currentPage: 2 }],
    ["the page size", { pageSize: 50 }],
    ["the total", { totalCount: 90 }],
  ])(
    "keeps the settled server range when %s changes before the rows arrive",
    async (_change, next) => {
      const serverProps = { pagination: "server", currentPage: 1, pageSize: 25, totalCount: 60 };
      mountTable({ ...serverProps, data: makeRows(25) });
      const settled = wrapper.find(PAGER_INFO).text();
      expect(settled).toMatch(/1 - 25 .*60/);
      await wrapper.setProps({ ...next, loading: true });
      expect(wrapper.find(PAGER_INFO).text()).toBe(settled);
      await advance(STALE_DIM_DELAY_MS);
      expect(wrapper.find(PAGER_INFO).text()).toBe(settled);
      await wrapper.setProps({ data: makeRows(25, "Next"), loading: false });
      const live = { ...serverProps, ...next };
      const from = (live.currentPage - 1) * live.pageSize + 1;
      const to = Math.min(live.currentPage * live.pageSize, live.totalCount);
      expect(wrapper.find(PAGER_INFO).text()).toMatch(
        new RegExp(`${from} - ${to} .*${live.totalCount}`),
      );
    },
  );

  it.each([true, false])(
    "moves exactly one page on a quick double next (dimOnRefetch %s)",
    async (dimOnRefetch) => {
      mountTable({
        pagination: "server",
        currentPage: 1,
        pageSize: 25,
        totalCount: 100,
        data: makeRows(25),
        dimOnRefetch,
      });
      const next = () => wrapper.find(NEXT).trigger("click");
      await next();
      expect(wrapper.emitted("update:currentPage")).toEqual([[2]]);
      await wrapper.setProps({ currentPage: 2, loading: true });
      await next();
      expect(wrapper.find(NEXT).attributes("aria-disabled")).toBe("true");
      expect(wrapper.find(PAGER_INFO).classes()).not.toContain("opacity-60");
      await advance(STALE_DIM_DELAY_MS - 1);
      await next();
      expect(wrapper.emitted("update:currentPage")).toEqual([[2]]);
      await wrapper.setProps({ data: makeRows(25, "Next"), loading: false });
      await next();
      expect(wrapper.emitted("update:currentPage")).toEqual([[2], [3]]);
    },
  );

  it("closes the row context menu when the rows dim, and does not open one on a dimmed row", async () => {
    const open = ref(false);
    const hostLoading = ref(false);
    const Host = defineComponent({
      setup: () => () =>
        h(
          OContextMenu,
          { "onUpdate:open": (value: boolean) => (open.value = value) },
          {
            trigger: () =>
              h("div", [
                h(OTable as any, {
                  data: makeRows(3),
                  columns,
                  loading: hostLoading.value,
                  onCellContextmenu: () => undefined,
                }),
              ]),
            default: () => h("div", { "data-test": "menu-item" }, "Copy"),
          },
        ),
    });
    wrapper = mount(Host, { attachTo: document.body });
    await wrapper.find('[data-test="o2-table-cell-id"]').trigger("contextmenu");
    await nextTick();
    await nextTick();
    expect(open.value).toBe(true);

    hostLoading.value = true;
    await nextTick();
    await advance(STALE_DIM_DELAY_MS);
    await nextTick();
    expect(open.value).toBe(false);

    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    wrapper.find('[data-test="o2-table-cell-id"]').element.dispatchEvent(event);
    await nextTick();
    await nextTick();
    expect(event.defaultPrevented).toBe(true);
    expect(open.value).toBe(false);
  });

  it("skips the dim, the busy state and the progress line with dimOnRefetch off", async () => {
    mountTable({ dimOnRefetch: false, selection: "multiple" });
    await wrapper.setProps({ loading: true });
    await advance(LOADER_DELAY_MS);
    expect(wrapper.find(BODY).attributes("data-test-stale")).toBe("true");
    expect(wrapper.find(BODY).classes()).not.toContain("opacity-60");
    expect(wrapper.find(TABLE).attributes("aria-busy")).toBeUndefined();
    expect(wrapper.find(BAR).exists()).toBe(false);
    await wrapper.find('[data-test="o2-table-select-0"] [role="checkbox"]').trigger("click");
    expect(wrapper.emitted("update:selectedIds")).toHaveLength(1);
  });

  it("dims by default when dimOnRefetch is absent", async () => {
    mountTable();
    expect(wrapper.props("dimOnRefetch")).toBe(true);
    await startRefetch();
    expect(wrapper.find(BODY).classes()).toContain("opacity-60");
  });
});

describe("OTable progress line placement", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("hangs the 2px line under the header, before the table, so it stays visible on a tall table", async () => {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.tagName === "THEAD" ? 36 : 0;
    });
    mountTable();
    await startRefetch();
    await advance(LOADER_DELAY_MS - STALE_DIM_DELAY_MS);
    const bar = wrapper.find(BAR);
    const holder = bar.element.parentElement as HTMLElement;
    expect(holder.classList.contains("sticky")).toBe(true);
    expect(holder.classList.contains("top-0")).toBe(true);
    expect(holder.classList.contains("h-0")).toBe(true);
    expect(holder.nextElementSibling?.tagName).toBe("TABLE");
    expect(bar.classes()).toContain("h-0.5");
    expect(bar.classes()).toContain("absolute");
    expect((bar.element as HTMLElement).style.top).toBe("36px");
    expect(bar.classes().some((c) => c.startsWith("bottom-"))).toBe(false);
  });

  it("keeps the 300 ms delay and the 4x slower pulse under reduced motion at its new place", async () => {
    mountTable();
    await startRefetch();
    expect(wrapper.find(BAR).exists()).toBe(false);
    await advance(LOADER_DELAY_MS - STALE_DIM_DELAY_MS);
    const bar = wrapper.find(BAR);
    expect(bar.classes()).toContain("motion-safe:animate-pulse");
    expect(bar.classes()).toContain(
      "motion-reduce:animate-[pulse_8s_cubic-bezier(0.4,0,0.6,1)_infinite]",
    );
    // The global reduced-motion rule stops every animation not marked to keep moving.
    expect(bar.classes()).toContain("o2-motion-keep");
  });

  it("sits at the top edge with no header, and scrolls with a non-sticky header", async () => {
    mountTable({ showHeader: false, stickyHeader: false });
    await startRefetch();
    await advance(LOADER_DELAY_MS - STALE_DIM_DELAY_MS);
    const bar = wrapper.find(BAR);
    expect((bar.element as HTMLElement).style.top).toBe("0px");
    expect(bar.element.parentElement?.classList.contains("sticky")).toBe(false);
  });
});
