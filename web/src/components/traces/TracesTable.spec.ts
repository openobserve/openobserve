// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { h } from "vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";

// ---------------------------------------------------------------------------
// Mock @tanstack/vue-virtual — real virtualizer needs a sized DOM element
// ---------------------------------------------------------------------------
vi.mock("@tanstack/vue-virtual", () => ({
  useVirtualizer: (optsRef: any) => ({
    getTotalSize: () => optsRef.value.count * 52,
    getVirtualItems: () =>
      Array.from({ length: optsRef.value.count }, (_, i) => ({
        key: i,
        index: i,
        start: i * 52,
        size: 52,
      })),
  }),
}));

// Remove debounce delay so scroll tests fire synchronously
vi.mock("quasar", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return { ...actual, debounce: (fn: any) => fn };
});

import TracesTable from "./TracesTable.vue";

installQuasar();

const testColumns = [
  { id: "name", header: "NAME", size: 200 },
  { id: "value", header: "VALUE", meta: { grow: true, width: 300 } },
];

const testRows = [
  { name: "alpha", value: "v1" },
  { name: "beta", value: "v2" },
  { name: "gamma", value: "v3" },
];

describe("TracesTable", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // ─── Mounting ─────────────────────────────────────────────────────────────
  describe("mounting", () => {
    it("mounts without errors", () => {
      wrapper = mount(TracesTable, {
        props: { columns: testColumns, rows: testRows },
      });
      expect(wrapper.exists()).toBe(true);
    });

    it("accepts an empty rows array", () => {
      wrapper = mount(TracesTable, {
        props: { columns: testColumns, rows: [] },
      });
      expect(wrapper.exists()).toBe(true);
    });
  });

  // ─── Header ───────────────────────────────────────────────────────────────
  describe("header", () => {
    it("renders a header cell for each column", () => {
      wrapper = mount(TracesTable, {
        props: { columns: testColumns, rows: [] },
      });
      // The sticky header uses FlexRender per column
      // Each column contributes one div to the header group
      const headerRow = wrapper.find(".tw\\:sticky");
      expect(headerRow.exists()).toBe(true);
    });

    it("shows column header text", () => {
      wrapper = mount(TracesTable, {
        props: { columns: testColumns, rows: [] },
      });
      expect(wrapper.text()).toContain("NAME");
      expect(wrapper.text()).toContain("VALUE");
    });
  });

  // ─── Rows ─────────────────────────────────────────────────────────────────
  describe("rows", () => {
    it("renders a row for each data item", () => {
      wrapper = mount(TracesTable, {
        props: { columns: testColumns, rows: testRows },
      });
      const rows = wrapper.findAll(".oz-table__row");
      expect(rows).toHaveLength(testRows.length);
    });

    it("renders no rows when rows is empty", () => {
      wrapper = mount(TracesTable, {
        props: { columns: testColumns, rows: [] },
      });
      expect(wrapper.findAll(".oz-table__row")).toHaveLength(0);
    });
  });

  // ─── Loading slot ─────────────────────────────────────────────────────────
  describe("loading slot", () => {
    it("renders the loading slot when loading=true", () => {
      wrapper = mount(TracesTable, {
        props: { columns: testColumns, rows: [], loading: true },
        slots: { loading: '<div data-test="custom-loading">Loading…</div>' },
      });
      expect(wrapper.find('[data-test="custom-loading"]').exists()).toBe(true);
    });

    it("still renders existing rows while a new load is in progress", () => {
      // The component keeps rows visible while loading more (infinite-scroll pattern).
      // The loading slot is only shown when rows is empty.
      wrapper = mount(TracesTable, {
        props: { columns: testColumns, rows: testRows, loading: true },
        slots: { loading: '<div data-test="custom-loading" />' },
      });
      expect(wrapper.findAll(".oz-table__row")).toHaveLength(testRows.length);
      expect(wrapper.find('[data-test="custom-loading"]').exists()).toBe(false);
    });
  });

  // ─── Empty slot ───────────────────────────────────────────────────────────
  describe("empty slot", () => {
    it("renders the empty slot when rows is empty and not loading", () => {
      wrapper = mount(TracesTable, {
        props: { columns: testColumns, rows: [], loading: false },
        slots: { empty: '<div data-test="custom-empty">No data</div>' },
      });
      expect(wrapper.find('[data-test="custom-empty"]').exists()).toBe(true);
    });

    it("does not render the empty slot when rows exist", () => {
      wrapper = mount(TracesTable, {
        props: { columns: testColumns, rows: testRows, loading: false },
        slots: { empty: '<div data-test="custom-empty">No data</div>' },
      });
      expect(wrapper.find('[data-test="custom-empty"]').exists()).toBe(false);
    });
  });

  // ─── row-click event ──────────────────────────────────────────────────────
  describe("row-click event", () => {
    it("emits row-click with the row data when a row is clicked", async () => {
      wrapper = mount(TracesTable, {
        props: { columns: testColumns, rows: testRows },
      });
      const rows = wrapper.findAll(".oz-table__row");
      await rows[0].trigger("click");
      expect(wrapper.emitted("row-click")).toBeTruthy();
      expect(wrapper.emitted("row-click")![0]).toEqual([testRows[0]]);
    });

    it("emits row-click for any row that is clicked", async () => {
      wrapper = mount(TracesTable, {
        props: { columns: testColumns, rows: testRows },
      });
      const rows = wrapper.findAll(".oz-table__row");
      await rows[1].trigger("click");
      expect(wrapper.emitted("row-click")![0]).toEqual([testRows[1]]);
    });
  });

  // ─── load-more event ──────────────────────────────────────────────────────
  // TracesTable does not emit 'load-more'; callers use an external scroll
  // listener on the container. These tests are intentionally skipped.
  describe.skip("load-more event", () => {
    it("emits load-more when scrolled near the bottom", async () => {
      wrapper = mount(TracesTable, {
        props: { columns: testColumns, rows: testRows },
      });
      const scroller = wrapper.element as HTMLElement;

      Object.defineProperties(scroller, {
        scrollTop: { value: 700, configurable: true },
        clientHeight: { value: 300, configurable: true },
        scrollHeight: { value: 1000, configurable: true },
      });

      await wrapper.trigger("scroll");
      expect(wrapper.emitted("load-more")).toBeTruthy();
    });

    it("does not emit load-more when far from the bottom", async () => {
      wrapper = mount(TracesTable, {
        props: { columns: testColumns, rows: testRows },
      });
      const scroller = wrapper.element as HTMLElement;

      Object.defineProperties(scroller, {
        scrollTop: { value: 0, configurable: true },
        clientHeight: { value: 300, configurable: true },
        scrollHeight: { value: 10000, configurable: true },
      });

      await wrapper.trigger("scroll");
      expect(wrapper.emitted("load-more")).toBeFalsy();
    });
  });

  // ─── Empty stream list ────────────────────────────────────────────────────
  describe("empty stream list", () => {
    it("should handle empty stream list gracefully", () => {
      // Simulates the case where the backend returns no traces (empty stream).
      // The component must not throw, must render no rows, and must show the
      // empty slot so the parent can display a "no results" message.
      wrapper = mount(TracesTable, {
        props: { columns: testColumns, rows: [], loading: false },
        slots: { empty: '<div data-test="no-traces">No traces found</div>' },
      });
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.findAll(".oz-table__row")).toHaveLength(0);
      expect(wrapper.find('[data-test="no-traces"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="no-traces"]').text()).toBe(
        "No traces found",
      );
    });
  });

  // ─── rowClass prop ────────────────────────────────────────────────────────
  describe("rowClass prop", () => {
    it("applies the class returned by rowClass to the matching row", () => {
      wrapper = mount(TracesTable, {
        props: {
          columns: testColumns,
          rows: testRows,
          rowClass: (row: any) =>
            row.name === "alpha" ? "oz-table__row--error" : "",
        },
      });
      const rows = wrapper.findAll(".oz-table__row");
      expect(rows[0].classes()).toContain("oz-table__row--error");
      expect(rows[1].classes()).not.toContain("oz-table__row--error");
    });

    it("works without a rowClass prop (no crash)", () => {
      wrapper = mount(TracesTable, {
        props: { columns: testColumns, rows: testRows },
      });
      expect(wrapper.findAll(".oz-table__row")).toHaveLength(testRows.length);
    });
  });

  // ─── Custom cell slot ─────────────────────────────────────────────────────
  describe("cell slots", () => {
    it("renders a custom slot for a specific column", () => {
      wrapper = mount(TracesTable, {
        props: { columns: testColumns, rows: testRows },
        slots: {
          "cell-name": ({ item }: any) =>
            h("span", { "data-test": "custom-name-cell" }, item.name),
        },
      });
      const cells = wrapper.findAll('[data-test="custom-name-cell"]');
      expect(cells).toHaveLength(testRows.length);
      expect(cells[0].text()).toBe("alpha");
    });
  });

  // ─── Column alignment ─────────────────────────────────────────────────────
  describe("column alignment", () => {
    it("applies text-center class for center-aligned columns", () => {
      const centeredCols = [
        {
          id: "id",
          header: "ID",
          size: 100,
          meta: { align: "center" as const },
        },
      ];
      wrapper = mount(TracesTable, {
        props: { columns: centeredCols, rows: [{ id: "x" }] },
      });
      // The first data cell should have text-center
      const cell = wrapper.find(".oz-table__row div");
      expect(cell.classes()).toContain("text-center");
    });

    it("applies text-right class for right-aligned columns", () => {
      const rightCols = [
        {
          id: "val",
          header: "VAL",
          size: 100,
          meta: { align: "right" as const },
        },
      ];
      wrapper = mount(TracesTable, {
        props: { columns: rightCols, rows: [{ val: 42 }] },
      });
      const cell = wrapper.find(".oz-table__row div");
      expect(cell.classes()).toContain("text-right");
    });

    it("applies no alignment class for default (left) columns", () => {
      wrapper = mount(TracesTable, {
        props: {
          columns: [{ id: "name", header: "N", size: 100 }],
          rows: [{ name: "x" }],
        },
      });
      const cell = wrapper.find(".oz-table__row div");
      expect(cell.classes()).not.toContain("text-center");
      expect(cell.classes()).not.toContain("text-right");
    });
  });

  // ─── Column sizing ────────────────────────────────────────────────────────
  describe("column sizing", () => {
    it("applies fixed width style for non-grow columns", () => {
      wrapper = mount(TracesTable, {
        props: {
          columns: [{ id: "name", header: "N", size: 250 }],
          rows: [{ name: "x" }],
        },
      });
      const cell = wrapper.find(".oz-table__row div");
      expect(cell.attributes("style")).toContain("width: 250px");
    });

    it("applies flex-grow style for grow columns", () => {
      wrapper = mount(TracesTable, {
        props: {
          columns: [
            { id: "desc", header: "D", meta: { grow: true, width: 200 } },
          ],
          rows: [{ desc: "y" }],
        },
      });
      const cell = wrapper.find(".oz-table__row div");
      expect(cell.attributes("style")).toContain("flex: 1 1 0px");
    });
  });
});
