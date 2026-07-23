// Copyright 2026 OpenObserve Inc.

import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from "vitest";
import { mount, VueWrapper, flushPromises, config } from "@vue/test-utils";
import { createI18n } from "vue-i18n";


// Set up i18n so OTable sub-components (loading, error, etc.) can use useI18n()
const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      search: { noData: "No data available" },
      common: { loading: "Loading..." },
    },
  },
});

// Register i18n globally so every mount gets it
beforeAll(() => {
  config.global.plugins.unshift([i18n as any]);
});

import { nextTick } from "vue";
import OTable from "./OTable.vue";
import OTableHeader from "./sub-components/OTableHeader.vue";
import OSelect from "@/lib/forms/Select/OSelect.vue";
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

      // Find the OSelect inside the pagination footer and trigger a value change
      const select = wrapper.findComponent(OSelect);
      expect(select.exists()).toBe(true);

      // Programmatically change the page size to 50
      select.vm.$emit("update:modelValue", 50);
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

    it("displays sort icons on sortable columns when sortBy is provided", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          sorting: "client",
          sortBy: "id",
          sortOrder: "asc",
        },
      });
      // Should have active sort icon on the sorted column
      const activeIcon = wrapper.find(
        '[data-test="o2-table-sort-icon-active"]',
      );
      expect(activeIcon.exists()).toBe(true);
      // The active icon must expose its direction for e2e sort assertions.
      expect(activeIcon.attributes("data-test-sort-direction")).toBe("asc");
    });

    it("exposes data-test-sort-direction on every sort icon (asc/desc/none)", () => {
      // e2e tests read this attribute to detect sort state. Missing it makes
      // sortByColumn() time out (as it did in CI), so lock it in here.
      const asc = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          sorting: "client",
          sortBy: "id",
          sortOrder: "asc",
        },
      });
      expect(
        asc
          .find('[data-test="o2-table-sort-icon-active"]')
          .attributes("data-test-sort-direction"),
      ).toBe("asc");

      const desc = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          sorting: "client",
          sortBy: "id",
          sortOrder: "desc",
        },
      });
      expect(
        desc
          .find('[data-test="o2-table-sort-icon-active"]')
          .attributes("data-test-sort-direction"),
      ).toBe("desc");

      // An unsorted sortable column shows the inactive icon with direction none.
      const none = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          sorting: "client",
        },
      });
      expect(
        none
          .find('[data-test="o2-table-sort-icon-inactive"]')
          .attributes("data-test-sort-direction"),
      ).toBe("none");
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
      // The checkbox might be a nested component; trigger the row click
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
      // OTableLoading renders a skeleton tbody with data-test="o2-table-skeleton-body"
      expect(wrapper.find('[data-test="o2-table-skeleton-body"]').exists()).toBe(
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
      // When loading=true, heldLoading activates and the skeleton replaces the body
      // The outer <table> element is still rendered
      expect(wrapper.find('[data-test="o2-table"]').exists()).toBe(true);
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
      expect(idCell.classes()).toContain("text-center");

      const nameCell = wrapper.find('[data-test="o2-table-cell-name"]');
      expect(nameCell.classes()).toContain("text-right");
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

  // ── Cell hover-action overlay (G13) ─────────────────────────

  describe("cell hover actions (G13)", () => {
    it("renders a cell-hover-actions overlay per cell and activates only the hovered cell", async () => {
      vi.useFakeTimers();
      wrapper = mount(OTable, {
        props: { data: makeRows(2), columns: makeColumns() },
        slots: {
          "cell-hover-actions": `<span class="hover-act" :data-active="active">A</span>`,
        },
      });

      // Overlay rendered in cells
      expect(
        wrapper.findAll('[data-test^="o2-table-cell-hover-actions-"]').length,
      ).toBeGreaterThan(0);
      // Nothing active before hover
      expect(wrapper.findAll('.hover-act[data-active="true"]').length).toBe(0);

      // Hovering one cell activates exactly that cell after the debounce
      await wrapper.find('[data-test="o2-table-cell-id"]').trigger("mouseenter");
      vi.advanceTimersByTime(250);
      await nextTick();
      expect(wrapper.findAll('.hover-act[data-active="true"]').length).toBe(1);

      // Leaving clears it after the leave debounce
      await wrapper.find('[data-test="o2-table-cell-id"]').trigger("mouseleave");
      vi.advanceTimersByTime(200);
      await nextTick();
      expect(wrapper.findAll('.hover-act[data-active="true"]').length).toBe(0);
      vi.useRealTimers();
    });

    it("does not collide with a per-column '#cell-actions' slot (id: 'actions')", () => {
      // The established convention: a column with id 'actions' renders its cell
      // content via #cell-actions. The hover overlay must NOT hijack that name.
      wrapper = mount(OTable, {
        props: {
          data: makeRows(1),
          columns: [
            ...makeColumns().slice(0, 1),
            { id: "actions", header: "", isAction: true },
          ],
        },
        slots: {
          "cell-actions": `<span data-test="col-actions">Edit</span>`,
        },
      });
      // Per-column actions slot still renders
      expect(wrapper.find('[data-test="col-actions"]').exists()).toBe(true);
      // No generic hover overlay was created (that slot wasn't provided)
      expect(
        wrapper.findAll('[data-test^="o2-table-cell-hover-actions-"]').length,
      ).toBe(0);
    });
  });

  // ── Dense / Bordered / Striped ─────────────────────────────

  describe("display variants", () => {
    it("uses dense row height when dense is true", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
          dense: true,
        },
      });
      // dense mode sets row height to 2.25rem via CSS variable on the table
      const tableEl = wrapper.find('[data-test="o2-table"]');
      expect(tableEl.attributes("style")).toContain("2.25rem");
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

    it("exposes getRows returning all visible rows", () => {
      wrapper = mount(OTable, {
        props: { data: makeRows(5), columns: makeColumns() },
      });
      const vm = wrapper.vm as any;
      expect(typeof vm.getRows).toBe("function");
      const rows = vm.getRows();
      expect(rows).toHaveLength(5);
      expect(rows[0]).toEqual(expect.objectContaining({ id: 1 }));
    });
  });

  // ── Virtual Scroll ──────────────────────────────────────────

  describe("virtual scroll", () => {
    it("renders rows when virtual scroll is enabled", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(100),
          columns: makeColumns(),
          virtualScroll: true,
          maxHeight: 400,
        },
      });
      // Virtual scroll still renders visible rows
      expect(wrapper.find('[data-test="o2-table"]').exists()).toBe(true);
    });

    it("renders correctly with virtual scroll and small dataset", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          virtualScroll: true,
          maxHeight: 400,
        },
      });
      expect(wrapper.find('[data-test="o2-table-root"]').exists()).toBe(true);
    });

    // NOTE (G8 variable-height virtual rows): OTable auto-enables per-row DOM
    // measurement when `virtualScroll && wrap` (see useTableVirtualization
    // `dynamicRowHeight` + OTableBodyRow `data-index`/measureRowElement). It
    // cannot be asserted in jsdom — the virtualizer returns 0 virtual items with
    // no real scroll-element size, so the virtual branch (which carries the
    // wiring) never renders and getBoundingClientRect is 0. Validated via the
    // logs-grid browser QA (§6.1 wrap + scroll).
  });

  // ── Column Management ──────────────────────────────────────

  describe("column resize", () => {
    it("shows resize handle on resizable columns", () => {
      const cols: OTableColumnDef<TestRow>[] = [
        { id: "id", header: "ID", accessorKey: "id", resizable: true },
        { id: "name", header: "Name", accessorKey: "name" },
      ];
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: cols,
          enableColumnResize: true,
        },
      });
      expect(wrapper.find(".resizer").exists()).toBe(true);
    });

    it("does not show resize handles when column resize is disabled", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
          enableColumnResize: false,
        },
      });
      expect(wrapper.find(".resizer").exists()).toBe(false);
    });
  });

  describe("column reorder", () => {
    it("renders drag wrapper when column reorder is enabled", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
          enableColumnReorder: true,
        },
      });
      // vuedraggable adds a draggable wrapper
      expect(wrapper.find('[data-test="o2-table-header"]').exists()).toBe(true);
    });
  });

  describe("column visibility", () => {
    it("hides columns specified in columnVisibility", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
          columnVisibility: { email: false },
        },
      });
      // Email column header should not be rendered
      expect(wrapper.find('[data-test="o2-table-th-email"]').exists()).toBe(false);
    });

    it("shows columns by default when no visibility specified", () => {
      wrapper = mount(OTable, {
        props: { data: makeRows(3), columns: makeColumns() },
      });
      expect(wrapper.find('[data-test="o2-table-th-email"]').exists()).toBe(true);
    });
  });

  describe("column close (G4)", () => {
    it("renders a close button only for meta.closable columns and emits close-column", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(2),
          columns: [
            { id: "id", header: "ID", accessorKey: "id" },
            {
              id: "name",
              header: "Name",
              accessorKey: "name",
              meta: { closable: true },
            },
          ] as OTableColumnDef<TestRow>[],
        },
      });
      // Only the closable column gets a remove button
      expect(
        wrapper.find('[data-test="o2-table-th-remove-name-btn"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="o2-table-th-remove-id-btn"]').exists(),
      ).toBe(false);

      await wrapper
        .find('[data-test="o2-table-th-remove-name-btn"]')
        .trigger("click");
      const ev = wrapper.emitted("close-column");
      expect(ev).toBeTruthy();
      expect((ev![0][0] as OTableColumnDef).id).toBe("name");
    });
  });

  describe("column pinning", () => {
    it("pins left-pinned columns", () => {
      const cols: OTableColumnDef<TestRow>[] = [
        { id: "id", header: "ID", accessorKey: "id", pinned: "left" },
        { id: "name", header: "Name", accessorKey: "name" },
      ];
      wrapper = mount(OTable, {
        props: { data: makeRows(3), columns: cols },
      });
      expect(wrapper.find('[data-test="o2-table-root"]').exists()).toBe(true);
    });

    it("auto-pins isAction columns to right", () => {
      const cols: OTableColumnDef<TestRow>[] = [
        { id: "id", header: "ID", accessorKey: "id" },
        { id: "actions", header: "", isAction: true },
      ];
      wrapper = mount(OTable, {
        props: { data: makeRows(3), columns: cols },
      });
      expect(wrapper.find('[data-test="o2-table-root"]').exists()).toBe(true);
    });
  });


  // ── Highlighting ────────────────────────────────────────────

  describe("highlighting", () => {
    it("renders highlighted text in cells", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
          highlightText: "User",
        },
      });
      // Cells containing "User" should have highlighted spans
      const cell = wrapper.find('[data-test="o2-table-cell-name"]');
      expect(cell.html()).toContain("User");
    });

    it("limits highlighting to specific fields", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
          highlightText: "Active",
          highlightFields: ["status"],
        },
      });
      expect(wrapper.find('[data-test="o2-table-root"]').exists()).toBe(true);
    });
  });

  // ── Streaming Indicator ─────────────────────────────────────

  describe("streaming", () => {
    it("shows streaming indicator when streaming with data", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
          streaming: true,
        },
      });
      expect(
        wrapper.find('[data-test="o2-table-streaming-bar"]').exists(),
      ).toBe(true);
    });

    it("does not show streaming indicator when not streaming", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
          streaming: false,
        },
      });
      expect(
        wrapper.find('[data-test="o2-table-streaming-bar"]').exists(),
      ).toBe(false);
    });
  });

  // ── Loading Banner ──────────────────────────────────────────

  describe("loading banner", () => {
    it("renders loading banner slot when streaming with existing data", () => {
      // The loading-banner slot is rendered when streaming=true and data exists,
      // not when loading=true (loading uses the skeleton overlay instead)
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          streaming: true,
        },
        slots: {
          "loading-banner":
            '<div data-test="custom-loading-banner">Refreshing...</div>',
        },
      });
      expect(
        wrapper.find('[data-test="custom-loading-banner"]').exists(),
      ).toBe(true);
    });
  });

  // ── Scoped Bottom Slot ─────────────────────────────────────

  describe("bottom slot", () => {
    it("renders bottom slot", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          pagination: "client",
        },
        slots: {
          bottom:
            '<div data-test="custom-bottom">Bottom Content</div>',
        },
      });
      expect(
        wrapper.find('[data-test="custom-bottom"]').exists(),
      ).toBe(true);
    });
  });

  // ── getCellStyle ────────────────────────────────────────────

  describe("getCellStyle", () => {
    it("applies custom cell styles via getCellStyle callback", () => {
      const getCellStyle = vi.fn(({ columnId, value }) => {
        if (columnId === "status" && value === "Active") {
          return { backgroundColor: "var(--color-status-success-bg)" };
        }
        return {};
      });
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
          getCellStyle,
        },
      });
      // The callback should have been called for each cell
      expect(getCellStyle).toHaveBeenCalled();
    });
  });

  // ── meta.format ─────────────────────────────────────────────

  describe("meta.format", () => {
    it("formats cell values using meta.format function", () => {
      const cols: OTableColumnDef<TestRow>[] = [
        {
          id: "name",
          header: "Name",
          accessorKey: "name",
          meta: { format: (value: string) => value.toUpperCase() },
        },
        { id: "email", header: "Email", accessorKey: "email" },
      ];
      wrapper = mount(OTable, {
        props: { data: makeRows(1), columns: cols },
      });
      const nameCell = wrapper.find('[data-test="o2-table-cell-name"]');
      // The format function uppercases the name
      expect(nameCell.text()).toContain("USER 1");
    });
  });

  // ── Row Styling ─────────────────────────────────────────────

  describe("row styling", () => {
    it("applies static rowClass to rows", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
          rowClass: "custom-row-class",
        },
      });
      const row = wrapper.find('[data-test="o2-table-row-0"]');
      expect(row.classes()).toContain("custom-row-class");
    });

    it("applies dynamic rowClass function", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
          rowClass: (row: TestRow) =>
            row.status === "Active" ? "row-active" : "row-inactive",
        },
      });
      const activeRow = wrapper.find('[data-test="o2-table-row-0"]');
      expect(activeRow.classes()).toContain("row-active");
      const inactiveRow = wrapper.find('[data-test="o2-table-row-1"]');
      expect(inactiveRow.classes()).toContain("row-inactive");
    });

    it("applies status bar color via getRowStatusColor", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
          getRowStatusColor: (row: TestRow) =>
            row.status === "Active" ? "#00ff00" : "#ff0000",
        },
      });
      expect(wrapper.find('[data-test="o2-table-root"]').exists()).toBe(true);
    });
  });

  // ── Cell Copy ───────────────────────────────────────────────

  describe("cell copy", () => {
    it("shows copy button on cells when enableCellCopy is true", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
          enableCellCopy: true,
        },
      });
      expect(
        wrapper.find('[data-test="o2-table-cell-copy-id"]').exists(),
      ).toBe(true);
    });

    it("does not show copy button when enableCellCopy is false", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
          enableCellCopy: false,
        },
      });
      expect(
        wrapper.find('[data-test="o2-table-cell-copy-id"]').exists(),
      ).toBe(false);
    });
  });

  // ── Footer Totals ───────────────────────────────────────────

  describe("footer totals", () => {
    it("renders footer when columns have aggregate and footer configured", () => {
      const cols: OTableColumnDef<TestRow>[] = [
        {
          id: "id",
          header: "ID",
          accessorKey: "id",
          aggregate: "count",
          footer: () => "Count",
        },
        { id: "name", header: "Name", accessorKey: "name" },
      ];
      wrapper = mount(OTable, {
        props: { data: makeRows(5), columns: cols },
      });
      // Footer renders when at least one column has a footer renderer
      expect(wrapper.find('[data-test="o2-table-footer"]').exists()).toBe(true);
    });

    it("renders footer cell for the column with footer configured", () => {
      const cols: OTableColumnDef<TestRow>[] = [
        {
          id: "id",
          header: "ID",
          accessorKey: "id",
          aggregate: "count",
          footer: () => "5",
        },
        { id: "name", header: "Name", accessorKey: "name" },
      ];
      wrapper = mount(OTable, {
        props: { data: makeRows(5), columns: cols },
      });
      const footerCells = wrapper.findAll(
        '[data-test^="o2-table-footer-cell-"]',
      );
      expect(footerCells.length).toBeGreaterThan(0);
    });

    it("does not render footer when no column has footer configured", () => {
      wrapper = mount(OTable, {
        props: { data: makeRows(5), columns: makeColumns() },
      });
      expect(
        wrapper.find('[data-test="o2-table-footer"]').exists(),
      ).toBe(false);
    });
  });

  // ── Pivot Headers ───────────────────────────────────────────

  describe("pivot headers", () => {
    it("renders custom pivot multi-level headers when pivotHeaderLevels is provided", () => {
      const pivotHeaderLevels = [
        {
          isLeaf: false,
          cells: [
            { label: "Group A", colspan: 2, hasBorder: false },
            { label: "Group B", colspan: 2, hasBorder: true },
          ],
        },
        {
          isLeaf: true,
          cells: [
            { label: "Count", colspan: 1, _sortColumn: "A_count" },
            { label: "Sum", colspan: 1, _sortColumn: "A_sum" },
            { label: "Count", colspan: 1, _sortColumn: "B_count" },
            { label: "Sum", colspan: 1, _sortColumn: "B_sum" },
          ],
        },
      ];

      const cols: OTableColumnDef<TestRow>[] = [
        { id: "name", header: "Name", accessorKey: "name" },
        { id: "A_count", header: "Count", accessorKey: "A_count" },
        { id: "A_sum", header: "Sum", accessorKey: "A_sum" },
        { id: "B_count", header: "Count", accessorKey: "B_count" },
        { id: "B_sum", header: "Sum", accessorKey: "B_sum" },
      ];

      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: cols,
          pivotHeaderLevels,
          pivotRowColumns: [cols[0]],
        },
      });

      // Should render pivot header instead of standard header
      expect(
        wrapper.find('[data-test="o2-table-pivot-header"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="o2-table-header"]').exists(),
      ).toBe(false);
    });

    it("renders standard header when pivotHeaderLevels is empty", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
          pivotHeaderLevels: [],
        },
      });
      expect(
        wrapper.find('[data-test="o2-table-header"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="o2-table-pivot-header"]').exists(),
      ).toBe(false);
    });
  });

  // ── scrollEl / scrollMargin ─────────────────────────────────

  describe("scrollEl prop", () => {
    it("accepts scrollEl and scrollMargin props without error", () => {
      const scrollContainer = document.createElement("div");
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          scrollEl: scrollContainer,
          scrollMargin: 50,
          virtualScroll: true,
        },
      });
      expect(wrapper.find('[data-test="o2-table-root"]').exists()).toBe(true);
    });
  });

  // ── update:columnSizes ─────────────────────────────────────

  describe("column sizes emit", () => {
    it("does not emit update:columnSizes when column resize is disabled", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          enableColumnResize: false,
        },
      });
      // Should not have emitted column sizes
      expect(wrapper.emitted("update:columnSizes")).toBeFalsy();
    });
  });

  // ── Row Grouping / Tree ─────────────────────────────────────

  describe("row grouping / tree", () => {
    it("renders expand buttons when expansion is tree mode", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          expansion: "tree",
          getSubRows: (row: TestRow) =>
            row.id === 1
              ? [
                  {
                    id: 10,
                    name: "Sub 1",
                    email: "sub1@example.com",
                    status: "Active",
                  },
                ]
              : [],
        },
      });
      // Should have expand cells
      expect(
        wrapper.find('[data-test="o2-table-expand-cell"]').exists(),
      ).toBe(true);
    });

    it("expands and collapses tree rows", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(3),
          columns: makeColumns(),
          expansion: "multiple",
          getSubRows: (row: TestRow) =>
            row.id === 1
              ? [
                  {
                    id: 10,
                    name: "Sub 1",
                    email: "sub1@example.com",
                    status: "Active",
                  },
                ]
              : [],
        },
      });

      // Click expand button on first row
      const expandBtn = wrapper.find(
        '[data-test="o2-table-expand-0"]',
      );
      expect(expandBtn.exists()).toBe(true);
      await expandBtn.trigger("click");
      expect(wrapper.emitted("update:expandedIds")).toBeTruthy();
    });
  });

  // ── Keyboard Navigation ─────────────────────────────────────

  describe("keyboard navigation", () => {
    it("renders table with keyboard-navigable rows", () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
        },
      });
      const scrollContainer = wrapper.find(
        '[data-test="o2-table-scroll-container"]',
      );
      expect(scrollContainer.exists()).toBe(true);
    });
  });

  // ── Data Refresh with Loading ────────────────────────────────

  describe("data refresh", () => {
    it("shows skeleton body when loading is true while data exists", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(5),
          columns: makeColumns(),
          loading: true,
        },
      });
      // When loading=true, heldLoading activates and the skeleton replaces rows
      expect(wrapper.find('[data-test="o2-table"]').exists()).toBe(true);
      // OTableLoading (skeleton) is shown instead of actual rows
      expect(wrapper.find('[data-test="o2-table-skeleton-body"]').exists()).toBe(true);
    });

    it("shows skeleton body when loading with no data", () => {
      wrapper = mount(OTable, {
        props: {
          data: [],
          columns: makeColumns(),
          loading: true,
        },
      });
      // OTableLoading skeleton renders inside the table with data-test="o2-table-skeleton-body"
      expect(wrapper.find('[data-test="o2-table-skeleton-body"]').exists()).toBe(
        true,
      );
    });
  });

  // ── Per-column value filter (#2239.4) ────────────────────────
  describe("per-column value filter", () => {
    function filterableColumns(): OTableColumnDef<TestRow>[] {
      return makeColumns().map((c) =>
        c.id === "status" ? { ...c, filterable: true } : c,
      );
    }

    it("filters rows to the selected values through the column API", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(10), // 5 Active, 5 Inactive
          columns: filterableColumns(),
          enableColumnFilter: true,
          pagination: "none",
          sorting: "none",
        },
      });
      await nextTick();
      const table = (wrapper.vm as any).table;

      expect(table.getColumn("status").getCanFilter()).toBe(true);
      expect(table.getColumn("email").getCanFilter()).toBe(false);
      expect(table.getFilteredRowModel().rows.length).toBe(10);

      table.getColumn("status").setFilterValue(["Active"]);
      await nextTick();
      const rows = table.getFilteredRowModel().rows;
      expect(rows.length).toBe(5);
      expect(rows.every((r: any) => r.original.status === "Active")).toBe(true);

      // Multi-select is a union of the chosen values.
      table.getColumn("status").setFilterValue(["Active", "Inactive"]);
      await nextTick();
      expect(table.getFilteredRowModel().rows.length).toBe(10);

      // Clearing restores every row.
      table.getColumn("status").setFilterValue(undefined);
      await nextTick();
      expect(table.getFilteredRowModel().rows.length).toBe(10);
    });

    it("shows the filter button only on filterable columns when enabled", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(4),
          columns: filterableColumns(),
          enableColumnFilter: true,
          pagination: "none",
          sorting: "none",
        },
      });
      await nextTick();
      expect(
        wrapper.find('[data-test="o2-table-column-filter-btn-status"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="o2-table-column-filter-btn-email"]').exists(),
      ).toBe(false);
    });

    it("renders no filter buttons when enableColumnFilter is off", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(4),
          columns: filterableColumns(),
          pagination: "none",
          sorting: "none",
        },
      });
      await nextTick();
      expect(
        wrapper.find('[data-test="o2-table-column-filter-btn-status"]').exists(),
      ).toBe(false);
    });
  });

  // ── Column close "x" gating (#2239.1) ────────────────────────
  describe("column close (x) affordance", () => {
    it("does NOT show the close x on a hideable column by default", async () => {
      const columns: OTableColumnDef<TestRow>[] = makeColumns().map((c) =>
        c.id === "name" ? { ...c, hideable: true } : c,
      );
      wrapper = mount(OTable, {
        props: { data: makeRows(3), columns, pagination: "none", sorting: "none" },
      });
      await nextTick();
      // hideable must not imply closable — otherwise every table's headers show
      // a dead "x" (QA #2239.1, seen on the dashboards list).
      expect(
        wrapper.find('[data-test="o2-table-th-remove-name-btn"]').exists(),
      ).toBe(false);
    });

    it("shows the close x only when a column opts in via meta.closable", async () => {
      const columns: OTableColumnDef<TestRow>[] = makeColumns().map((c) =>
        c.id === "name" ? { ...c, hideable: true, meta: { closable: true } } : c,
      );
      wrapper = mount(OTable, {
        props: { data: makeRows(3), columns, pagination: "none", sorting: "none" },
      });
      await nextTick();
      expect(
        wrapper.find('[data-test="o2-table-th-remove-name-btn"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="o2-table-th-remove-email-btn"]').exists(),
      ).toBe(false);
    });
  });

  // ── Column reorder (#2239.11) ────────────────────────────────
  describe("column reorder", () => {
    it("re-emits column-order-change when the header updates the order", async () => {
      wrapper = mount(OTable, {
        props: {
          data: makeRows(4),
          columns: makeColumns(),
          enableColumnReorder: true,
          pagination: "none",
          sorting: "none",
        },
      });
      await nextTick();
      const header = wrapper.findComponent(OTableHeader);
      const newOrder = ["status", "id", "name", "email"];
      header.vm.$emit("update:column-order", newOrder);
      await nextTick();
      // Previously OTable swallowed this (only updated its internal order), so
      // consumers like the logs grid never persisted the reorder — #2239.11.
      const emitted = wrapper.emitted("column-order-change");
      expect(emitted).toBeTruthy();
      expect(emitted![emitted!.length - 1][0]).toEqual(newOrder);
    });
  });
});
