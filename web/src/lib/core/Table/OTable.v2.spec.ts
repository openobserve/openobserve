// Copyright 2026 OpenObserve Inc.

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import OTable from "./OTable.vue";
import { ROW_ACTIONS_COLUMN_ID, type OTableColumnDef } from "./OTable.types";
import { raw } from "@/types/i18n";

interface Row {
  id: number;
  name: string;
  count: number | null;
  traceId: string;
  note?: string | null;
}

const rows = (n = 3): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: `row ${i + 1}`,
    count: i === 1 ? null : (i + 1) * 10,
    traceId: `7f3c2a91b0e44d5c9e1f${i}abc123456`,
    note: i === 0 ? null : "kept",
  }));

const columns: OTableColumnDef<Row>[] = [
  { id: "name", header: raw("Name"), accessorKey: "name" },
  { id: "count", header: raw("Count"), accessorKey: "count" },
  { id: "traceId", header: raw("Trace"), accessorKey: "traceId", meta: { identifier: true } },
  { id: "note", header: raw("Note"), accessorKey: "note" },
];

let wrapper: VueWrapper<any>;
afterEach(() => wrapper?.unmount());

const mountTable = (props: Record<string, unknown> = {}) => {
  wrapper = mount(OTable, {
    props: { data: rows(), columns, pagination: "none", ...props },
    attachTo: document.body,
  });
  return wrapper;
};

describe("OTable v2 cells (C4, D3, D4)", () => {
  it('renders an unknown value as a tertiary "—"', () => {
    mountTable();
    const unknown = wrapper.find('[data-test="o2-table-row-0"] [data-test="o2-table-cell-note"]');
    expect(unknown.text()).toBe("—");
    expect(unknown.find('[data-test="o2-table-cell-unknown"]').classes()).toContain(
      "text-text-muted",
    );
  });

  it("right-aligns a column of plain numbers, header included", () => {
    mountTable();
    const cell = wrapper.find('[data-test="o2-table-row-0"] [data-test="o2-table-cell-count"]');
    expect(cell.classes()).toEqual(expect.arrayContaining(["text-right", "tabular-nums"]));
    const header = wrapper.find('[data-test="o2-table-th-count"]');
    expect(header.html()).toContain("justify-end");
    const text = wrapper.find('[data-test="o2-table-row-0"] [data-test="o2-table-cell-name"]');
    expect(text.classes()).toContain("text-left");
  });

  it("keeps a named alignment over the numeric default", () => {
    mountTable({
      columns: columns.map((c) => (c.id === "count" ? { ...c, meta: { align: "center" } } : c)),
    });
    const cell = wrapper.find('[data-test="o2-table-row-0"] [data-test="o2-table-cell-count"]');
    expect(cell.classes()).toContain("text-center");
  });

  it("cuts a long id in the middle, in mono, keeping its tail", () => {
    mountTable();
    const id = wrapper.find('[data-test="o2-table-row-0"] [data-test="o2-table-cell-identifier"]');
    expect(id.classes()).toContain("font-mono");
    const [head, tail] = id.findAll("span");
    expect(head.classes()).toContain("truncate");
    expect(tail.text()).toBe("123456");
    expect(head.text() + tail.text()).toBe(rows()[0].traceId);
  });
});

describe("OTable row actions (B7, D7)", () => {
  const edit = vi.fn();
  const remove = vi.fn();
  const duplicate = vi.fn();
  const rowActions = [
    { id: "edit", icon: "edit", label: raw("Edit"), onClick: edit },
    {
      id: "pause",
      icon: "pause",
      label: raw("Pause"),
      onClick: vi.fn(),
      hidden: (r: Row) => r.id === 2,
    },
  ];
  const rowMenu = [
    { id: "delete", label: raw("Delete"), destructive: true, onSelect: remove },
    { id: "duplicate", label: raw("Duplicate"), onSelect: duplicate },
  ];

  it("appends an actions column with up to two inline icon buttons and the ⋯ menu", () => {
    mountTable({ rowActions, rowMenu });
    const cell = wrapper.find(
      `[data-test="o2-table-row-0"] [data-test="o2-table-cell-${ROW_ACTIONS_COLUMN_ID}"]`,
    );
    expect(cell.find('[data-test="o2-table-row-action-edit"]').exists()).toBe(true);
    expect(cell.find('[data-test="o2-table-row-action-pause"]').exists()).toBe(true);
    expect(cell.find('[data-test="o2-table-row-menu"]').exists()).toBe(true);
    const second = wrapper.find(`[data-test="o2-table-row-1"]`);
    expect(second.find('[data-test="o2-table-row-action-pause"]').exists()).toBe(false);
  });

  it("shows the actions on hover and focus, and always on touch", () => {
    mountTable({ rowActions });
    const bar = wrapper.find('[data-test="o2-table-row-actions"]');
    expect(bar.classes()).toEqual(
      expect.arrayContaining([
        "opacity-0",
        "group-hover/row:opacity-100",
        "group-focus-within/row:opacity-100",
        "pointer-coarse:opacity-100",
      ]),
    );
  });

  it("calls the action with the row and never clicks the row", async () => {
    const onRowClick = vi.fn();
    mountTable({ rowActions, "onRow-click": onRowClick });
    await wrapper
      .find('[data-test="o2-table-row-0"] [data-test="o2-table-row-action-edit"]')
      .trigger("click");
    expect(edit).toHaveBeenCalledWith(rows()[0]);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("lists destructive menu items last, in red", async () => {
    mountTable({ rowMenu });
    await wrapper
      .find('[data-test="o2-table-row-0"] [data-test="o2-table-row-menu"]')
      .trigger("keydown", { key: "Enter" });
    await flushPromises();
    const items = Array.from(document.querySelectorAll('[data-test^="o2-table-row-menu-"]'));
    expect(items.map((el) => el.getAttribute("data-test"))).toEqual([
      "o2-table-row-menu-duplicate",
      "o2-table-row-menu-delete",
    ]);
  });

  it("names the actions header for screen readers only, so it covers no label (D7)", () => {
    mountTable({ rowActions });
    const th = wrapper.find(`[data-test="o2-table-th-${ROW_ACTIONS_COLUMN_ID}"]`);
    expect(th.html()).toContain("sr-only");
    expect(th.classes()).not.toContain("bg-table-header-bg");
  });
});

describe("OTable footer (D5)", () => {
  it("draws no pager under an empty table", async () => {
    mountTable({ data: [], pagination: "client" });
    await nextTick();
    expect(wrapper.find('[data-test="o2-table-pagination-bottom"]').exists()).toBe(false);
  });

  it("draws the pager once there are rows", () => {
    mountTable({ pagination: "client" });
    expect(wrapper.find('[data-test="o2-table-pagination-info"]').text()).toBe("1–3 of 3");
  });
});

describe("OTable virtual rows", () => {
  it("estimates rows at the density's height", () => {
    mountTable({ virtualScroll: true, density: "compact", data: rows(50) });
    expect((wrapper.vm.$ as any).setupState.rowHeightEstimate).toBe(28);
  });

  it("reads the estimate off a rendered row that a page styles another height", async () => {
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      height: 20,
      width: 100,
      top: 0,
      left: 0,
      right: 100,
      bottom: 20,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    mountTable({ virtualScroll: true, data: rows(50) });
    await flushPromises();
    await nextTick();
    expect((wrapper.vm.$ as any).setupState.rowHeightEstimate).toBe(20);
    rect.mockRestore();
  });
});
