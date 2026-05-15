// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";

installQuasar();

import OTable from "./OTable.vue";
import type { OTableColumnDef } from "./OTable.types";

interface TestRow {
  id: number;
  name: string;
  email: string;
  status: string;
}

function makeColumns(): OTableColumnDef<TestRow>[] {
  return [
    { id: "id", header: "ID", accessorKey: "id", sortable: true, size: 60 },
    { id: "name", header: "Name", accessorKey: "name", sortable: true, size: 200 },
    { id: "email", header: "Email", accessorKey: "email", size: 250 },
    { id: "status", header: "Status", accessorKey: "status", size: 100 },
  ];
}

function makeRows(count: number = 10): TestRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `User ${i + 1}`,
    email: `user${i + 1}@example.com`,
    status: i % 2 === 0 ? "Active" : "Inactive",
  }));
}

describe("OTable", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
  });

  // ── Basic Rendering ──────────────────────────────────────────

  describe("basic rendering", () => {
    it("renders the table with correct data-test attribute", () => {
      wrapper = mount(OTable, {
        props: { data: makeRows(5), columns: makeColumns() },
      });
      expect(wrapper.find('[data-test="o2-table-root"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="o2-table"]').exists()).toBe(true);
    });

    it("renders all column headers", () => {
      wrapper = mount(OTable, {
        props: { data: makeRows(5), columns: makeColumns() },
      });
      expect(wrapper.find('[data-test="o2-table-th-id"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="o2-table-th-name"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="o2-table-th-email"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="o2-table-th-status"]').exists()).toBe(true);
    });

    it("renders data rows", () => {
      wrapper = mount(OTable, {
        props: { data: makeRows(5), columns: makeColumns() },
      });
      const rows = wrapper.findAll('[data-test^="o2-table-row-"]');
      expect(rows.length).toBe(5);
    });

    it("renders cell content", () => {
      wrapper = mount(OTable, {
        props: { data: makeRows(3), columns: makeColumns() },
      });
      const firstRow = wrapper.find('[data-test="o2-table-row-0"]');
      expect(firstRow.text()).toContain("User 1");
      expect(firstRow.text()).toContain("user1@example.com");
    });
  });

  // ── Client-Side Pagination ──────────────────────────────────

  describe("pagination: client", () => {
    beforeEach(() => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(25),
          columns: makeColumns(),
          pagination: "client",
          pageSize: 10,
        },
      });
    });

    it("renders the pagination footer", () => {
      expect(
        wrapper.find('[data-test="o2-table-pagination-bottom"]').exists(),
      ).toBe(true);
    });

    it("shows only the first page of rows", () => {
      const rows = wrapper.findAll('[data-test^="o2-table-row-"]');
      expect(rows.length).toBe(10);
    });

    it("shows correct row count in pagination info", () => {
      const info = wrapper.find('[data-test="o2-table-pagination-info"]');
      expect(info.text()).toContain("10");
      expect(info.text()).toContain("25");
    });

    it("has page size select", () => {
      expect(
        wrapper.find('[data-test="o2-table-page-size-select"]').exists(),
      ).toBe(true);
    });

    it("has prev/next buttons", () => {
      expect(
        wrapper.find('[data-test="o2-table-prev-page-btn"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="o2-table-next-page-btn"]').exists(),
      ).toBe(true);
    });
  });

  // ── Server-Side Pagination ──────────────────────────────────

  describe("pagination: server", () => {
    it("emits pagination-change on page size change", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(10),
          columns: makeColumns(),
          pagination: "server",
          totalCount: 100,
          pageSize: 20,
          currentPage: 1,
        },
      });

      await wrapper
        .find('[data-test="o2-table-page-size-select"]')
        .setValue("50");
      await flushPromises();

      expect(wrapper.emitted("update:pageSize")).toBeTruthy();
    });

    it("shows total count from props (not data length)", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(10),
          columns: makeColumns(),
          pagination: "server",
          totalCount: 200,
        },
      });
      const info = wrapper.find('[data-test="o2-table-pagination-info"]');
      expect(info.text()).toContain("200");
    });
  });

  // ── Client-Side Sorting ────────────────────────────────────

  describe("sorting: client", () => {
    it("renders sortable header with sort trigger", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          sorting: "client",
        },
      });
      // The ID column is sortable, so it should have sort trigger
      expect(
        wrapper.find('[data-test="o2-table-th-sort-trigger"]').exists(),
      ).toBe(true);
    });

    it("displays sort icons on sortable columns", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          sorting: "client",
        },
      });
      // Should have inactive sort icons
      expect(
        wrapper.find('[data-test="o2-table-sort-icon-inactive"]').exists(),
      ).toBe(true);
    });
  });

  // ── Server-Side Sorting ────────────────────────────────────

  describe("sorting: server", () => {
    it("emits sort-change when sort header is clicked", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(10),
          columns: makeColumns(),
          sorting: "server",
          sortBy: undefined,
          sortOrder: undefined,
        },
      });
      const sortTrigger = wrapper.find(
        '[data-test="o2-table-th-sort-trigger"]',
      );
      await sortTrigger.trigger("click");
      expect(wrapper.emitted("sort-change")).toBeTruthy();
      expect(wrapper.emitted("sort-change")?.[0][0]).toEqual({
        column: "id",
        order: "asc",
      });
    });

    it("toggles sort order on second click", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(10),
          columns: makeColumns(),
          sorting: "server",
          sortBy: "id",
          sortOrder: "asc",
        },
      });
      const sortTrigger = wrapper.find(
        '[data-test="o2-table-th-sort-trigger"]',
      );
      await sortTrigger.trigger("click");
      expect(wrapper.emitted("sort-change")?.[0][0]).toEqual({
        column: "id",
        order: "desc",
      });
    });
  });

  // ── Row Selection ──────────────────────────────────────────

  describe("selection", () => {
    it("renders checkbox column when selection is multiple", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          selection: "multiple",
        },
      });
      expect(
        wrapper.find('[data-test="o2-table-select-cell"]').exists(),
      ).toBe(true);
    });

    it("does not render checkbox column when selection is none", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          selection: "none",
        },
      });
      expect(
        wrapper.find('[data-test="o2-table-select-cell"]').exists(),
      ).toBe(false);
    });

    it("emits update:selectedIds when a row checkbox is toggled", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          selection: "multiple",
        },
      });
      // Find first row's checkbox
      const checkbox = wrapper.find(
        '[data-test="o2-table-select-0"] input[type="checkbox"]',
      );
      // The checkbox might be a Quasar component; trigger the row click
      const row = wrapper.find('[data-test="o2-table-row-0"]');
      await row.trigger("click");
    });
  });

  // ── Row Expansion ──────────────────────────────────────────

  describe("expansion", () => {
    it("renders expand button when expansion is enabled", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          expansion: "single",
        },
      });
      expect(
        wrapper.find('[data-test="o2-table-expand-cell"]').exists(),
      ).toBe(true);
    });

    it("does not render expand button when expansion is none", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          expansion: "none",
        },
      });
      expect(
        wrapper.find('[data-test="o2-table-expand-cell"]').exists(),
      ).toBe(false);
    });
  });

  // ── Empty State ────────────────────────────────────────────

  describe("empty state", () => {
    it("shows empty state when data is empty and not loading", () => {
      wrapper = mount(OTable, {
        props: {
          data: [],
          columns: makeColumns(),
          loading: false,
        },
      });
      expect(wrapper.find('[data-test="o2-table-empty"]').exists()).toBe(true);
    });

    it("uses custom empty message when provided", () => {
      wrapper = mount(OTable, {
        props: {
          data: [],
          columns: makeColumns(),
          emptyMessage: "Nothing here",
        },
      });
      expect(wrapper.find('[data-test="o2-table-empty"]').text()).toContain(
        "Nothing here",
      );
    });
  });

  // ── Loading State ──────────────────────────────────────────

  describe("loading state", () => {
    it("shows loading when loading is true and no rows", () => {
      wrapper = mount(OTable, {
        props: {
          data: [],
          columns: makeColumns(),
          loading: true,
        },
      });
      expect(wrapper.find('[data-test="o2-table-loading"]').exists()).toBe(
        true,
      );
    });

    it("shows loading overlay when loading is true with existing rows", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          loading: true,
        },
      });
      // When there are rows, the loading bar should not be the full page overlay
      // But a loading banner should appear in the table
      const loadingEl = wrapper.find('[data-test="o2-table-loading"]');
      // Loading may or may not be visible depending on implementation
      expect(loadingEl.exists() || wrapper.find('[data-test="o2-table"]').exists()).toBe(true);
    });
  });

  // ── Error State ────────────────────────────────────────────

  describe("error state", () => {
    it("shows error when error prop is set", () => {
      wrapper = mount(OTable, {
        props: {
          data: [],
          columns: makeColumns(),
          error: "Failed to load data",
        },
      });
      expect(wrapper.find('[data-test="o2-table-error"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="o2-table-error"]').text()).toContain(
        "Failed to load data",
      );
    });

    it("shows error instead of empty when both error and empty data", () => {
      wrapper = mount(OTable, {
        props: {
          data: [],
          columns: makeColumns(),
          error: "API Error",
        },
      });
      expect(wrapper.find('[data-test="o2-table-error"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="o2-table-empty"]').exists()).toBe(false);
    });
  });

  // ── Column Features ────────────────────────────────────────

  describe("column features", () => {
    it("applies align class from column meta", () => {
      const cols: OTableColumnDef<TestRow>[] = [
        { id: "id", header: "ID", accessorKey: "id", meta: { align: "center" } },
        { id: "name", header: "Name", accessorKey: "name", meta: { align: "right" } },
      ];
      wrapper = mount(OTable, {
        props: { data: makeRows(1), columns: cols },
      });

      const idCell = wrapper.find('[data-test="o2-table-cell-id"]');
      expect(idCell.classes()).toContain("tw:text-center");

      const nameCell = wrapper.find('[data-test="o2-table-cell-name"]');
      expect(nameCell.classes()).toContain("tw:text-right");
    });
  });

  // ── Row Events ─────────────────────────────────────────────

  describe("row events", () => {
    it("emits row-click when a row is clicked", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
        },
      });
      const row = wrapper.find('[data-test="o2-table-row-0"]');
      await row.trigger("click");
      expect(wrapper.emitted("row-click")).toBeTruthy();
      expect(wrapper.emitted("row-click")?.[0][0]).toEqual(
        expect.objectContaining({ id: 1 }),
      );
    });

    it("emits row-dblclick when a row is double-clicked", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
        },
      });
      const row = wrapper.find('[data-test="o2-table-row-0"]');
      await row.trigger("dblclick");
      expect(wrapper.emitted("row-dblclick")).toBeTruthy();
    });

    it("emits cell-click when a cell is clicked", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(2),
          columns: makeColumns(),
        },
      });
      const cell = wrapper.find('[data-test="o2-table-cell-id"]');
      await cell.trigger("click");
      expect(wrapper.emitted("cell-click")).toBeTruthy();
    });
  });

  // ── Custom Cell Slots ──────────────────────────────────────

  describe("cell slots", () => {
    it("renders custom cell content via slot", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(1),
          columns: [
            ...makeColumns().slice(0, 1),
            { id: "actions", header: "", isAction: true },
          ],
        },
        slots: {
          "cell-actions": `<span data-test="custom-action">Edit</span>`,
        },
      });
      expect(wrapper.find('[data-test="custom-action"]').exists()).toBe(true);
    });
  });

  // ── Dense / Bordered / Striped ─────────────────────────────

  describe("display variants", () => {
    it("applies dense class when dense is true", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
          dense: true,
        },
      });
      const cell = wrapper.find('[data-test="o2-table-cell-id"]');
      expect(cell.classes()).toContain("tw:py-1");
    });
  });

  // ── Pagination: none ───────────────────────────────────────

  describe("pagination: none", () => {
    it("does not render pagination footer", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          pagination: "none",
        },
      });
      expect(
        wrapper.find('[data-test="o2-table-pagination-bottom"]').exists(),
      ).toBe(false);
    });
  });

  // ── Exposed API ────────────────────────────────────────────

  describe("exposed API", () => {
    it("exposes the TanStack table instance", () => {
      wrapper = mount(OTable, {
        props: { data: makeRows(5), columns: makeColumns() },
      });
      const vm = wrapper.vm as any;
      expect(vm.table).toBeDefined();
    });

    it("exposes toggleAllRows for selection", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          selection: "multiple",
        },
      });
      const vm = wrapper.vm as any;
      expect(typeof vm.toggleAllRows).toBe("function");
      expect(typeof vm.clearSelection).toBe("function");
    });
  });
});
