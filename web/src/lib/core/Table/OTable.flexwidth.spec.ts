// Copyright 2026 OpenObserve Inc.
import { describe, it, expect, beforeAll } from "vitest";
import { mount, config, flushPromises } from "@vue/test-utils";
import { createI18n } from "vue-i18n";

const i18n = createI18n({ legacy: false, locale: "en", messages: { en: {} } });
beforeAll(() => {
  config.global.plugins.unshift([i18n as any]);
  (globalThis as any).requestAnimationFrame = (cb: any) => cb();
});

import OTable from "./OTable.vue";
import type { OTableColumnDef } from "./OTable.types";

const columns: OTableColumnDef[] = [
  { id: "name", header: "Name", accessorKey: "name", size: 200, minSize: 160, meta: { align: "left", flex: true } },
  { id: "type", header: "Type", accessorKey: "type", size: 100 },
  { id: "actions", header: "Actions", isAction: true, size: 80 },
];
const data = [{ name: "a", type: "logs" }, { name: "b", type: "logs" }];

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
        data, columns,
        selection: "multiple",
        showIndex: true,
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
    // the arithmetic fallback = container − nonFlex (1000 − 284) = 716 is pinned
    // into columnSizing. nonFlex = #(56) + type(100) + actions(84) + checkbox(44).
    // Then widen Type to 400 (TanStack preserves name).
    st.freezeFlexColumns();
    st.columnSizing = { ...st.columnSizing, type: 400 };
    await flushPromises();

    // Now explicit width: Name HOLDS at 716, table grows to 1300 (scroll)
    // (56 + 716 + 400 + 84 + 44 = 1300), # stays 56, and w-full is dropped.
    expect(isWFull(wrapper)).toBe(false);
    expect(colVar(wrapper, "name")).toBe(716);
    expect(tableWidth(wrapper)).toBe(1300);
    expect(colVar(wrapper, "#")).toBe(56);

    // DECREASE Type to 50 (below its original 100). Name must NOT grow to
    // absorb the freed space — it stays frozen at 716. Real columns sum to 950
    // (56 + 716 + 50 + 84 + 44 = 950 < container) so the invisible spacer absorbs
    // the 50px (its var) and the table stays at the container width (1000) →
    // actions flush-right.
    st.columnSizing = { ...st.columnSizing, type: 50 };
    await flushPromises();
    expect(colVar(wrapper, "name")).toBe(716);
    expect(colVar(wrapper, "#")).toBe(56);
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
        data, columns,
        selection: "multiple",
        showIndex: true,
        enableColumnResize: true,
        defaultColumns: false,
        tableId: "flexdiag2",
      } as any,
    });
    await flushPromises();
    (wrapper.vm.$ as any).setupState.containerWidth = 1000;
    await flushPromises();

    // The flex (name) column fills explicitly (container 1000 − nonFlex 284).
    expect(thHasExplicitWidth(wrapper, "name")).toBe(true);
    expect(headerVar(wrapper, "name")).toBe(716);
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
        data, columns,
        selection: "multiple",
        showIndex: true,
        enableColumnResize: true,
        defaultColumns: false,
        tableId: "flexdiag3",
      } as any,
    });
    await flushPromises();
    const st: any = (wrapper.vm.$ as any).setupState;

    // Wide container: fixed (272) + flex min (160) = 432 < 1000 → fills, no scroll.
    st.containerWidth = 1000;
    await flushPromises();
    expect(st.frozen).toBe(false);
    expect(st.allowHorizontalScroll).toBe(false);

    // Narrow container: 432 > 400 → even at min widths the columns overflow, so
    // the scroll container must expose a horizontal scrollbar.
    st.containerWidth = 400;
    await flushPromises();
    expect(st.frozen).toBe(false);
    expect(st.allowHorizontalScroll).toBe(true);
  });
});
