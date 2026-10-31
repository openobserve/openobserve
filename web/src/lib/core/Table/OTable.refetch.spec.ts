// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { mount, VueWrapper, config } from "@vue/test-utils";
import { createI18n } from "vue-i18n";
import { nextTick, reactive } from "vue";
import OTable from "./OTable.vue";
import type { OTableColumnDef } from "./OTable.types";
import { ENTER_FADE } from "@/lib/styles/motion";

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
const LOADING_SLOT = '[data-test="o2-table-loading-slot"]';

let wrapper: VueWrapper<any>;

function mountTable(props: Record<string, unknown> = {}, slots: Record<string, string> = {}) {
  wrapper = mount(OTable as any, {
    props: { data: makeRows(5), columns, loading: false, ...props },
    slots,
  });
  return wrapper;
}

function bodyText(): string {
  return wrapper.find(BODY).text();
}

describe("OTable refetch keeps settled rows", () => {
  afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
  });

  it("keeps the settled rows instead of the skeleton while a refetch runs", async () => {
    mountTable();
    await wrapper.setProps({ loading: true });
    expect(wrapper.find(SKELETON).exists()).toBe(false);
    expect(wrapper.findAll(`${BODY} tr[data-test^="o2-table-row-"]`)).toHaveLength(5);

    await wrapper.setProps({ data: [] });
    expect(wrapper.findAll(`${BODY} tr[data-test^="o2-table-row-"]`)).toHaveLength(5);

    await wrapper.setProps({ data: makeRows(2, "Fresh"), loading: false });
    expect(wrapper.findAll(`${BODY} tr[data-test^="o2-table-row-"]`)).toHaveLength(2);
    expect(bodyText()).toContain("Fresh 1");
    expect(wrapper.find(BODY).attributes("data-test-stale")).toBeUndefined();
  });

  it("leaves the kept rows clickable until the refetch is visibly slow", async () => {
    vi.useFakeTimers();
    mountTable();
    await wrapper.setProps({ loading: true });
    expect(wrapper.find(BODY).attributes("data-test-stale")).toBe("true");
    expect(wrapper.find(BODY).attributes("inert")).toBeUndefined();
    expect(wrapper.find(BAR).exists()).toBe(false);
    await wrapper.find('[data-test="o2-table-row-0"]').trigger("click");
    expect(wrapper.emitted("row-click")).toHaveLength(1);
  });

  it("never shows the stale cue for a refetch that settles quickly", async () => {
    vi.useFakeTimers();
    mountTable();
    await wrapper.setProps({ loading: true });
    await wrapper.setProps({ loading: false });
    vi.runAllTimers();
    await nextTick();
    expect(wrapper.find(BODY).attributes("inert")).toBeUndefined();
    expect(wrapper.find(TABLE).attributes("aria-busy")).toBeUndefined();
    expect(wrapper.find(BAR).exists()).toBe(false);
  });

  it("blocks clicks, marks the table busy and shows the bar once the refetch is slow", async () => {
    vi.useFakeTimers();
    mountTable({ selection: "multiple" });
    await wrapper.setProps({ loading: true });
    vi.runAllTimers();
    await nextTick();
    expect(wrapper.find(BODY).attributes("inert")).toBeDefined();
    expect(wrapper.find(TABLE).attributes("aria-busy")).toBe("true");
    expect(wrapper.find(BAR).exists()).toBe(true);

    await wrapper.find('[data-test="o2-table-row-0"]').trigger("click");
    await wrapper.find('[data-test="o2-table-row-0"]').trigger("dblclick");
    await wrapper.find('[data-test="o2-table-cell-id"]').trigger("click");
    await wrapper.find('[data-test="o2-table-select-0"] [role="checkbox"]').trigger("click");
    await wrapper.find('[data-test="o2-table-select-all"] [role="checkbox"]').trigger("click");
    expect(wrapper.emitted("row-click")).toBeUndefined();
    expect(wrapper.emitted("row-dblclick")).toBeUndefined();
    expect(wrapper.emitted("cell-click")).toBeUndefined();
    expect(wrapper.emitted("update:selectedIds")).toBeUndefined();

    await wrapper.setProps({ loading: false });
    expect(wrapper.find(BODY).attributes("inert")).toBeUndefined();
    expect(wrapper.find(TABLE).attributes("aria-busy")).toBeUndefined();
    expect(wrapper.find(BAR).exists()).toBe(false);
    await wrapper.find('[data-test="o2-table-row-0"]').trigger("click");
    expect(wrapper.emitted("row-click")).toHaveLength(1);
  });

  it("dims kept rows on the body whose enter fade already ran and holds no opacity", async () => {
    vi.useFakeTimers();
    mountTable();
    const mounted = wrapper.find(BODY).element;
    await wrapper.setProps({ loading: true });
    vi.runAllTimers();
    await nextTick();
    const stale = wrapper.find(BODY);
    // Same element, so the fade does not replay; no fill mode, so the dim class owns opacity after it.
    expect(stale.element).toBe(mounted);
    expect(stale.classes()).toEqual(
      expect.arrayContaining([...ENTER_FADE.split(" "), "opacity-60", "dark:opacity-40"]),
    );
    expect(stale.classes().some((c) => /fill-mode-(forwards|both)/.test(c))).toBe(false);
  });

  it("draws the custom loading overlay on a first load but not over kept rows", async () => {
    vi.useFakeTimers();
    mountTable({ loading: true }, { loading: "<div>Custom loader</div>" });
    expect(wrapper.find(LOADING_SLOT).exists()).toBe(true);
    await wrapper.setProps({ loading: false });
    vi.runAllTimers();
    await nextTick();
    await wrapper.setProps({ loading: true });
    expect(wrapper.find(BODY).attributes("data-test-stale")).toBe("true");
    expect(wrapper.find(LOADING_SLOT).exists()).toBe(false);
  });

  it("shows the skeleton on a first load, even with rows already passed in", () => {
    mountTable({ loading: true });
    expect(wrapper.find(SKELETON).exists()).toBe(true);
  });

  it("shows the skeleton when the last settled answer was empty", async () => {
    mountTable({ data: [] });
    await wrapper.setProps({ loading: true });
    expect(wrapper.find(SKELETON).exists()).toBe(true);
  });

  it("shows the skeleton for the load after an error", async () => {
    mountTable();
    await wrapper.setProps({ error: "boom" });
    await wrapper.setProps({ error: null, loading: true });
    expect(wrapper.find(SKELETON).exists()).toBe(true);
  });

  it("shows the skeleton after loadingResetKey changes", async () => {
    mountTable({ loadingResetKey: "folder-a" });
    await wrapper.setProps({ loadingResetKey: "folder-b" });
    await wrapper.setProps({ loading: true });
    expect(wrapper.find(SKELETON).exists()).toBe(true);
  });

  it("swaps kept rows for the skeleton when loadingResetKey changes mid-load", async () => {
    mountTable({ loadingResetKey: "folder-a" });
    await wrapper.setProps({ loading: true });
    expect(wrapper.find(SKELETON).exists()).toBe(false);
    await wrapper.setProps({ loadingResetKey: "folder-b" });
    expect(wrapper.find(SKELETON).exists()).toBe(true);
  });

  it("keeps rows that arrived with the new loadingResetKey on the next refetch", async () => {
    mountTable({ loadingResetKey: "folder-a" });
    await wrapper.setProps({ loadingResetKey: "folder-b", data: makeRows(3, "B") });
    await wrapper.setProps({ loading: true });
    expect(wrapper.find(SKELETON).exists()).toBe(false);
    expect(bodyText()).toContain("B 1");
  });

  it("shows the skeleton on every load with skeletonOnRefetch", async () => {
    mountTable({ skeletonOnRefetch: true });
    await wrapper.setProps({ loading: true });
    expect(wrapper.find(SKELETON).exists()).toBe(true);
  });

  it("does not repaint kept rows when the consumer mutates its row objects mid-load", async () => {
    const rows = reactive(makeRows(3));
    mountTable({ data: rows });
    await wrapper.setProps({ loading: true });
    rows[0].name = "Mutated";
    rows.push({ id: 99, name: "Pushed" });
    await nextTick();
    expect(bodyText()).toContain("User 1");
    expect(bodyText()).not.toContain("Mutated");
    expect(bodyText()).not.toContain("Pushed");

    await wrapper.setProps({ loading: false });
    expect(bodyText()).toContain("Mutated");
    expect(bodyText()).toContain("Pushed");
  });

  it("exposes data-test-loading and data-test-stale so tests can tell stale rows from fresh ones", async () => {
    mountTable();
    expect(wrapper.find(TABLE).attributes("data-test-loading")).toBe("false");
    await wrapper.setProps({ loading: true });
    expect(wrapper.find(TABLE).attributes("data-test-loading")).toBe("true");
    expect(wrapper.find(BODY).attributes("data-test-stale")).toBe("true");
    await wrapper.setProps({ data: makeRows(1, "Fresh"), loading: false });
    expect(wrapper.find(TABLE).attributes("data-test-loading")).toBe("false");
    expect(bodyText()).toContain("Fresh 1");
  });
});
