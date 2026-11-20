// Copyright 2026 OpenObserve Inc.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { mount, config, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

const i18n = createI18n({ legacy: false, locale: "en", messages: { en: {} } });
beforeAll(() => {
  config.global.plugins.unshift([i18n as any]);
  (globalThis as any).requestAnimationFrame = (cb: any) => cb();
});

import OTable from "./OTable.vue";
import { ROW_ACTIONS_COLUMN_ID, type OTableColumnDef } from "./OTable.types";

const columns: OTableColumnDef[] = [
  {
    id: "name",
    header: "Name",
    accessorKey: "name",
    size: 200,
    minSize: 160,
    meta: { align: "left", flex: true },
  },
  { id: "type", header: "Type", accessorKey: "type", size: 100 },
  { id: "actions", header: "Actions", isAction: true, size: 80 },
];
const data = [
  { name: "a", type: "logs" },
  { name: "b", type: "logs" },
];

function tableWidth(wrapper: any): number {
  const style = wrapper.find('[data-test="o2-table"]').attributes("style") || "";
  const m = style.match(/(?:^|[^-])width:\s*(\d+(?:\.\d+)?)px/);
  return m ? parseFloat(m[1]) : -1;
}
function colVar(wrapper: any, id: string): number {
  const style = wrapper.find('[data-test="o2-table"]').attributes("style") || "";
  const m = style.match(new RegExp(`--col-${id}-size:\\s*(\\d+(?:\\.\\d+)?)px`));
  return m ? parseFloat(m[1]) : -1;
}
function isWFull(wrapper: any): boolean {
  return (wrapper.find('[data-test="o2-table"]').attributes("class") || "").includes("w-full");
}
function headerVar(wrapper: any, safeId: string): number {
  const style = wrapper.find('[data-test="o2-table"]').attributes("style") || "";
  const m = style.match(new RegExp(`--header-${safeId}-size:\\s*(\\d+(?:\\.\\d+)?)px`));
  return m ? parseFloat(m[1]) : -1;
}
function thHasExplicitWidth(wrapper: any, id: string): boolean {
  const style = wrapper.find(`[data-test="o2-table-th-${id}"]`).attributes("style") || "";
  return /(?:^|[^-])width:/.test(style);
}

// Regression: a `meta.flex` column fills the leftover width on load, and the
// first resize freezes it so the table grows + scrolls (only the dragged column
// changes) instead of squeezing the flex/rigid columns.
describe("OTable flex column width", () => {
  it("fills initially, then grows + holds the flex column on resize", async () => {
    const wrapper = mount(OTable, {
      props: {
        data,
        columns,
        selection: "multiple",
        enableColumnResize: true,
        defaultColumns: false,
        tableId: "flexdiag",
      } as any,
    });
    await flushPromises();

    const st: any = (wrapper.vm.$ as any).setupState;
    st.containerWidth = 1000;
    await flushPromises();

    // Fill state: width:100% (w-full), no explicit px width → can't overflow →
    // no stray scrollbar. Name absorbs the leftover via the browser.
    expect(isWFull(wrapper)).toBe(true);
    expect(tableWidth(wrapper)).toBe(-1);

    // Resize freezes the flex column at its current fill width. With no layout,
    // the arithmetic fallback = container − nonFlex (1000 − 228) = 772 is pinned
    // into columnSizing. nonFlex = type(100) + actions(84) + checkbox(44).
    // Then widen Type to 400 (TanStack preserves name).
    st.freezeFlexColumns();
    st.columnSizing = { ...st.columnSizing, type: 400 };
    await flushPromises();

    // Now explicit width: Name HOLDS at 772, table grows to 1300 (scroll)
    // (772 + 400 + 84 + 44 = 1300), and w-full is dropped.
    expect(isWFull(wrapper)).toBe(false);
    expect(colVar(wrapper, "name")).toBe(772);
    expect(tableWidth(wrapper)).toBe(1300);

    // DECREASE Type to 50 (below its original 100). Name must NOT grow to
    // absorb the freed space — it stays frozen at 772. Real columns sum to 950
    // (772 + 50 + 84 + 44 = 950 < container) so the invisible spacer absorbs
    // the 50px (its var) and the table stays at the container width (1000) →
    // actions flush-right.
    st.columnSizing = { ...st.columnSizing, type: 50 };
    await flushPromises();
    expect(colVar(wrapper, "name")).toBe(772);
    expect(colVar(wrapper, "__spacer__")).toBe(50);
    expect(tableWidth(wrapper)).toBe(1000);

    // Reset → frozen cleared → back to pure-fill (w-full, Name re-fills).
    st.frozen = false;
    st.columnSizing = {};
    await flushPromises();
    expect(isWFull(wrapper)).toBe(true);
  });

  it("fill state: flex column has explicit fill width and spacer is 0", async () => {
    const wrapper = mount(OTable, {
      props: {
        data,
        columns,
        selection: "multiple",
        enableColumnResize: true,
        defaultColumns: false,
        tableId: "flexdiag2",
      } as any,
    });
    await flushPromises();
    (wrapper.vm.$ as any).setupState.containerWidth = 1000;
    await flushPromises();

    // The flex (name) column fills explicitly (container 1000 − nonFlex 228).
    expect(thHasExplicitWidth(wrapper, "name")).toBe(true);
    expect(headerVar(wrapper, "name")).toBe(772);
    // The invisible spacer must be 0 in the fill state — no trailing gap.
    expect(headerVar(wrapper, "--spacer--")).toBe(0);
  });

  // Regression: in the FILL state (before any resize), when the columns can't
  // fit even at their min widths the table must scroll horizontally instead of
  // clipping the trailing columns (table-fixed otherwise grows past 100% and
  // the overflow is hidden).
  it("fill state: enables horizontal scroll when columns overflow the container", async () => {
    const wrapper = mount(OTable, {
      props: {
        data,
        columns,
        selection: "multiple",
        enableColumnResize: true,
        defaultColumns: false,
        tableId: "flexdiag3",
      } as any,
    });
    await flushPromises();
    const st: any = (wrapper.vm.$ as any).setupState;

    // Wide container: fixed (216) + flex min (160) = 376 < 1000 → fills, no scroll.
    st.containerWidth = 1000;
    await flushPromises();
    expect(st.frozen).toBe(false);
    expect(st.allowHorizontalScroll).toBe(false);

    // Narrow container: 376 > 350 → even at min widths the columns overflow, so
    // the scroll container must expose a horizontal scrollbar.
    st.containerWidth = 350;
    await flushPromises();
    expect(st.frozen).toBe(false);
    expect(st.allowHorizontalScroll).toBe(true);
  });

  it("keeps the actions column pinned and scrolls sideways while the columns overflow", async () => {
    const rowActions = [{ id: "edit", label: "Edit", icon: "edit", onClick: () => {} }];
    const mountAt = async (width: number, props: Record<string, unknown> = {}) => {
      const wrapper = mount(OTable, {
        props: {
          data,
          columns: columns.filter((c) => !c.isAction),
          rowActions,
          enableColumnResize: true,
          defaultColumns: false,
          ...props,
        } as any,
      });
      await flushPromises();
      const st: any = (wrapper.vm.$ as any).setupState;
      st.containerWidth = width;
      await flushPromises();
      const state = () => ({
        pinned: ["th", "cell"].every((part) =>
          /position:\s*sticky/.test(
            wrapper
              .find(`[data-test="o2-table-${part}-${ROW_ACTIONS_COLUMN_ID}"]`)
              .attributes("style") || "",
          ),
        ),
        scrolls: st.allowHorizontalScroll,
      });
      return { st, state };
    };

    expect((await mountAt(1000)).state()).toEqual({ pinned: true, scrolls: false });
    expect((await mountAt(250)).state()).toEqual({ pinned: true, scrolls: true });

    // A resize holds the filler at its filled width, so widening a sibling overflows a container the minimums fit.
    const resized = await mountAt(1000);
    resized.st.freezeFlexColumns();
    resized.st.columnSizing = { ...resized.st.columnSizing, type: 400 };
    await flushPromises();
    expect(resized.state()).toEqual({ pinned: true, scrolls: true });

    const elastic = [
      { id: "name", header: "Name", accessorKey: "name", minSize: 160, meta: { autoWidth: true } },
      { id: "type", header: "Type", accessorKey: "type", size: 700 },
    ];
    const autoWidth = { columns: elastic, enableColumnResize: false };
    expect((await mountAt(1000, autoWidth)).state()).toEqual({ pinned: true, scrolls: false });
    const overflows = await mountAt(900, autoWidth);
    expect(overflows.state()).toEqual({ pinned: true, scrolls: true });
    expect(overflows.st.minTableWidth).toBeDefined();
  });

  // Regression: the measured fill raised each equal share to its column minimum, so unequal
  // minimums summed past the pane and the trailing columns were clipped with no scrollbar.
  it.each([
    {
      name: "unequal minimums that fit share the pane exactly",
      mins: [110, 80, 96, 70, 90, 90, 104],
      rendered: { type: 56 },
      pane: 702,
      scrolls: false,
    },
    {
      name: "fixed columns rendered wider than declared leave the minimums no room",
      mins: [160],
      rendered: { type: 300 },
      pane: 400,
      scrolls: true,
    },
  ])("measured fill: $name", async ({ mins, rendered, pane, scrolls }) => {
    const flexIds = mins.map((_, i) => `f${i}`);
    const cols: OTableColumnDef[] = [
      ...mins.map((minSize, i) => ({
        id: flexIds[i],
        header: flexIds[i],
        accessorKey: "name",
        size: 200,
        minSize,
        meta: { flex: true },
      })),
      { id: "type", header: "Type", accessorKey: "type", size: 56 },
    ];
    const widths: Record<string, number> = { "o2-table-th-type": rendered.type };
    const clientWidth = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(pane);
    const rect = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        return { width: widths[this.getAttribute("data-test") || ""] ?? 0 } as DOMRect;
      });
    try {
      const wrapper = mount(OTable, {
        props: { data, columns: cols, enableColumnResize: true, defaultColumns: false } as any,
      });
      await flushPromises();
      const st: any = (wrapper.vm.$ as any).setupState;
      st.containerWidth = pane;
      await flushPromises();

      const filled = flexIds.map((id) => colVar(wrapper, id));
      filled.forEach((w, i) => expect(w).toBeGreaterThanOrEqual(mins[i]));
      const total = filled.reduce((a, b) => a + b, 0) + rendered.type;
      if (scrolls) expect(total).toBeGreaterThan(pane);
      else expect(total).toBe(pane);
      expect(st.allowHorizontalScroll).toBe(scrolls);
    } finally {
      clientWidth.mockRestore();
      rect.mockRestore();
    }
  });

  // Regression: a non-resizable table whose fixed columns alone overflow gave its
  // autoWidth column 0px on a laptop (Alert History hid every alert name).
  it("non-resizable: floors the table width so an autoWidth column keeps its size", async () => {
    const wrapper = mount(OTable, {
      props: {
        data,
        columns: [
          { id: "name", header: "Name", accessorKey: "name", size: 200, meta: { autoWidth: true } },
          { id: "type", header: "Type", accessorKey: "type", size: 700 },
          { id: "actions", header: "Actions", isAction: true, size: 80 },
        ],
        defaultColumns: false,
        tableId: "autowidth-floor",
      } as any,
    });
    await flushPromises();
    const st: any = (wrapper.vm.$ as any).setupState;
    const minWidth = () =>
      (wrapper.find('[data-test="o2-table"]').attributes("style") || "").match(
        /min-width:\s*(\d+)px/,
      )?.[1];

    st.containerWidth = 1200;
    await flushPromises();
    expect(st.allowHorizontalScroll).toBe(false);
    expect(minWidth()).toBeUndefined();

    st.containerWidth = 600;
    await flushPromises();
    expect(st.allowHorizontalScroll).toBe(true);
    expect(Number(minWidth())).toBeGreaterThanOrEqual(980);
  });

  // Regression: the floor read the built def's 48 resize minimum, so a leftover of
  // 56 passed it and Alert History showed every alert name as "cp…".
  describe("autoWidth floor when the fixed columns fit but leave less than its size", () => {
    const mountAuto = async (name: Record<string, unknown>) => {
      const wrapper = mount(OTable, {
        props: {
          data,
          columns: [
            { id: "name", header: "Name", accessorKey: "name", meta: { autoWidth: true }, ...name },
            { id: "type", header: "Type", accessorKey: "type", size: 700 },
            { id: "actions", header: "Actions", isAction: true, size: 80 },
          ],
          defaultColumns: false,
          tableId: "autowidth-leftover",
        } as any,
      });
      await flushPromises();
      const st: any = (wrapper.vm.$ as any).setupState;
      const minWidth = () =>
        (wrapper.find('[data-test="o2-table"]').attributes("style") || "").match(
          /min-width:\s*(\d+)px/,
        )?.[1];
      const fixed = (wrapper.find('[data-test="o2-table"]').attributes("style") || "").match(
        /--col-actions-size:\s*(\d+)px/,
      )?.[1];
      return { st, minWidth, fixedSum: 700 + Number(fixed) };
    };

    it("keeps the column at its size and scrolls instead of handing it the leftover", async () => {
      const { st, minWidth, fixedSum } = await mountAuto({ size: 200 });
      st.containerWidth = fixedSum + 56;
      await flushPromises();
      expect(st.allowHorizontalScroll).toBe(true);
      expect(Number(minWidth())).toBe(fixedSum + 200);
    });

    it("floors at the page's minSize when it is set below the size", async () => {
      const { st, minWidth, fixedSum } = await mountAuto({ size: 200, minSize: 120 });
      st.containerWidth = fixedSum + 150;
      await flushPromises();
      expect(minWidth()).toBeUndefined();
      st.containerWidth = fixedSum + 56;
      await flushPromises();
      expect(Number(minWidth())).toBe(fixedSum + 120);
    });
  });
});
