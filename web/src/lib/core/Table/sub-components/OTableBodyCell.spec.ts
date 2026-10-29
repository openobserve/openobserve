// Copyright 2026 OpenObserve Inc.

import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { h } from "vue";

import OTable from "../OTable.vue";
import type { OTableColumnDef } from "../OTable.types";

interface Row {
  id: number;
  name: string;
  code: number;
}

const columns: OTableColumnDef<Row>[] = [
  { id: "name", header: "Name", accessorKey: "name", size: 120 },
  {
    id: "code",
    header: "Code",
    accessorKey: "code",
    size: 80,
    sortable: true,
    meta: { align: "right" },
  },
];

const rows: Row[] = [
  { id: 1, name: "checkout", code: 502 },
  { id: 2, name: "cart", code: 200 },
];

let wrapper: VueWrapper | null = null;

function render(props: Record<string, unknown> = {}) {
  wrapper = mount(OTable, {
    props: { columns, data: rows, rowKey: "id", pagination: "none", sorting: "none", ...props },
    slots: {
      "cell-hover-actions": ({ row, menu }: { row: Row; menu?: boolean }) =>
        h(
          "button",
          { type: "button", "data-test": menu ? `menu-${row.id}` : `act-${row.id}` },
          menu ? "menu" : "act",
        ),
    },
    attachTo: document.body,
  });
  return wrapper;
}

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
});

describe("OTableBodyCell default render", () => {
  it("is byte-identical without focusToolbar (snapshot taken before the prop existed)", async () => {
    const table = render();
    await flushPromises();
    expect(table.find("tbody").html()).toMatchSnapshot();
  });
});

describe("OTableBodyCell focusToolbar", () => {
  const cells = () => [...document.querySelectorAll<HTMLElement>("td[data-o2-focus-cell]")];
  const toolbar = () => document.body.querySelector<HTMLElement>(".o2-table-cell-hover-actions");
  const key = async (el: Element, k: string, shiftKey = false) => {
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: k, shiftKey, bubbles: true, cancelable: true }),
    );
    await flushPromises();
  };
  const focus = async (el: HTMLElement) => {
    el.focus();
    await flushPromises();
  };

  it("keeps one roving tab stop, first cell first", async () => {
    render({ focusToolbar: true });
    await flushPromises();
    expect(cells().map((c) => c.tabIndex)).toEqual([0, -1, -1, -1]);
    await focus(cells()[3]);
    expect(cells().map((c) => c.tabIndex)).toEqual([-1, -1, -1, 0]);
  });

  it("opens the toolbar on focus, not only on hover", async () => {
    render({ focusToolbar: true });
    await flushPromises();
    expect(toolbar()).toBeNull();
    await focus(cells()[0]);
    expect(toolbar()?.querySelector('[data-test="act-1"]')).not.toBeNull();
  });

  it("moves the active cell with the arrow keys", async () => {
    render({ focusToolbar: true });
    await flushPromises();
    await focus(cells()[0]);
    await key(cells()[0], "ArrowRight");
    expect(document.activeElement).toBe(cells()[1]);
    await key(cells()[1], "ArrowDown");
    expect(document.activeElement).toBe(cells()[3]);
    await key(cells()[3], "ArrowLeft");
    expect(document.activeElement).toBe(cells()[2]);
    await key(cells()[2], "ArrowUp");
    expect(document.activeElement).toBe(cells()[0]);
  });

  it("moves exactly one cell per arrow press away from the table edges", async () => {
    render({
      focusToolbar: true,
      columns: [...columns, { id: "id", header: "Id", accessorKey: "id", size: 60 }],
      data: [...rows, { id: 3, name: "search", code: 404 }],
    });
    await flushPromises();
    await focus(cells()[0]);
    await key(cells()[0], "ArrowDown");
    expect(document.activeElement).toBe(cells()[3]);
    await key(cells()[3], "ArrowRight");
    expect(document.activeElement).toBe(cells()[4]);
  });

  it("Tab enters the toolbar, Escape hides it and returns focus to the cell", async () => {
    render({ focusToolbar: true });
    await flushPromises();
    await focus(cells()[0]);
    await key(cells()[0], "Tab");
    const action = toolbar()?.querySelector<HTMLElement>('[data-test="act-1"]');
    expect(document.activeElement).toBe(action);
    await key(action!, "Escape");
    expect(document.activeElement).toBe(cells()[0]);
    await new Promise((r) => setTimeout(r, 150));
    await flushPromises();
    expect(toolbar()).toBeNull();
  });

  it("puts a touch kebab in the row's first cell and hides the hover toolbar on coarse pointers (round 2 X-26)", async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) =>
      ({
        matches: query === "(pointer: coarse)",
        media: query,
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
    render({ focusToolbar: true });
    await flushPromises();
    const menus = [...document.querySelectorAll<HTMLElement>("[data-o2-row-menu]")];
    expect(menus).toHaveLength(2);
    expect(menus[0].className).toContain("hidden");
    expect(menus[0].className).toContain("pointer-coarse:flex");
    expect(menus[0].className).toContain("max-md:flex");
    expect(menus[0].querySelector('[data-test="menu-1"]')).not.toBeNull();
    await focus(cells()[0]);
    expect(toolbar()?.className).toContain("pointer-coarse:hidden");
    expect(toolbar()?.className).toContain("max-md:hidden");
    window.matchMedia = original;
  });

  it("hands the tab stop to the first rendered row when row 0 is not first (sorted) (F6)", async () => {
    const table = render({ focusToolbar: true, sorting: "client" });
    await flushPromises();
    const sort = () =>
      table
        .find('[data-test="o2-table-th-code"] [data-test="o2-table-th-sort-trigger"]')
        .trigger("click");
    await sort();
    await flushPromises();
    if (!cells()[0].textContent?.includes("cart")) await sort();
    await flushPromises();
    const tabbable = cells().filter((c) => c.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toBe(cells()[0]);
    expect(tabbable[0].textContent).toContain("cart");
  });

  it("keeps a tab stop when the focused row goes away (virtual scroll recycles it) (F6)", async () => {
    const table = render({ focusToolbar: true });
    await flushPromises();
    await focus(cells()[2]);
    await table.setProps({ data: [rows[0]] });
    await flushPromises();
    expect(cells().filter((c) => c.tabIndex === 0)).toHaveLength(1);
  });

  it("keeps the toolbar while focus is inside a popover one of its doors opened (F4)", async () => {
    render({ focusToolbar: true });
    await flushPromises();
    await focus(cells()[0]);
    const popover = document.createElement("div");
    popover.setAttribute("data-o-popover-content", "");
    const button = document.createElement("button");
    popover.appendChild(button);
    document.body.appendChild(popover);
    toolbar()?.querySelector<HTMLElement>('[data-test="act-1"]')?.focus();
    button.focus();
    await new Promise((r) => setTimeout(r, 200));
    await flushPromises();
    expect(toolbar()).not.toBeNull();
  });

  it("Tab past the last toolbar control leaves the table (V7)", async () => {
    render({ focusToolbar: true });
    await flushPromises();
    const after = document.createElement("button");
    after.getClientRects = () => [{}] as unknown as DOMRectList;
    document.body.appendChild(after);
    await focus(cells()[0]);
    await key(cells()[0], "Tab");
    const action = toolbar()?.querySelector<HTMLElement>('[data-test="act-1"]');
    expect(document.activeElement).toBe(action);
    await key(action!, "Tab");
    expect(document.activeElement).toBe(after);
  });

  it("takes row checkboxes out of the tab order, names them by their first cell, and selects on Space (V7, V8)", async () => {
    const table = render({ focusToolbar: true, selection: "multiple", sorting: "client" });
    await flushPromises();
    const boxes = () => [
      ...document.querySelectorAll<HTMLButtonElement>(
        'tbody [data-test^="o2-table-select-"] button[role="checkbox"]',
      ),
    ];
    expect(boxes().map((b) => b.tabIndex)).toEqual([-1, -1]);
    const sort = () =>
      table
        .find('[data-test="o2-table-th-code"] [data-test="o2-table-th-sort-trigger"]')
        .trigger("click");
    await sort();
    await flushPromises();
    if (!cells()[0].textContent?.includes("cart")) await sort();
    await flushPromises();
    expect(boxes().map((b) => b.getAttribute("aria-label"))).toEqual([
      "Select row cart",
      "Select row checkout",
    ]);
    await focus(cells()[0]);
    await key(cells()[0], " ");
    expect(table.emitted("selection-change")?.at(-1)?.[0]).toEqual([rows[1]]);
  });

  it("names each page's row checkbox by its own row across pages", async () => {
    const table = render({
      focusToolbar: true,
      selection: "multiple",
      pagination: "client",
      pageSize: 1,
    });
    await flushPromises();
    const name = () =>
      document
        .querySelector('tbody [data-test^="o2-table-select-"] button[role="checkbox"]')
        ?.getAttribute("aria-label");
    expect(name()).toBe("Select row checkout");
    await table.find('[data-test="o2-table-next-page-btn"]').trigger("click");
    await flushPromises();
    expect(name()).toBe("Select row cart");
  });

  it("adds nothing without a hover-actions slot", async () => {
    wrapper = mount(OTable, {
      props: {
        columns,
        data: rows,
        rowKey: "id",
        pagination: "none",
        sorting: "none",
        focusToolbar: true,
      },
      attachTo: document.body,
    });
    await flushPromises();
    expect(cells()).toHaveLength(0);
  });
});
