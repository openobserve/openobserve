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

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { h } from "vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";

// Hoist copyToClipboard mock so it can be referenced inside vi.mock factory below.
const { mockCopyToClipboard } = vi.hoisted(() => ({
  mockCopyToClipboard: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Module mocks — must appear before any import of the tested component.
// ---------------------------------------------------------------------------

vi.mock("@tanstack/vue-virtual", () => ({
  useVirtualizer: (optsRef: any) => ({
    __v_isRef: true,
    value: {
      getTotalSize: () => optsRef.value.count * 24,
      getVirtualItems: () =>
        Array.from({ length: optsRef.value.count }, (_, i) => ({
          key: i,
          index: i,
          start: i * 24,
          size: 24,
        })),
      measureElement: vi.fn(),
    },
  }),
}));

vi.mock("quasar", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return { ...actual, debounce: (fn: any) => fn, copyToClipboard: mockCopyToClipboard };
});

vi.mock("vuex", () => ({
  useStore: () => ({
    state: {
      theme: "light",
      zoConfig: { timestamp_column: "_timestamp" },
    },
  }),
}));

vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (k: string) => k }),
}));

vi.mock("vue-draggable-next", () => ({
  VueDraggableNext: {
    name: "VueDraggable",
    template: "<tr><slot /></tr>",
    props: ["modelValue", "animation", "sort", "disabled", "handle", "tag"],
  },
}));

vi.mock("@/plugins/logs/JsonPreview.vue", () => ({
  default: { template: "<div />" },
}));

vi.mock("@/plugins/logs/data-table/CellActions.vue", () => ({
  default: { template: "<div />" },
}));

vi.mock("@/components/common/O2AIContextAddBtn.vue", () => ({
  default: { template: "<div />" },
}));

vi.mock("@/utils/logs/statusParser", () => ({
  extractStatusFromLog: () => ({ color: "" }),
}));

vi.mock("@/composables/useTextHighlighter", () => ({
  useTextHighlighter: () => ({ isFTSColumn: vi.fn() }),
}));

vi.mock("@/composables/useLogsHighlighter", () => ({
  useLogsHighlighter: () => ({
    processedResults: {},
    processHitsInChunks: vi.fn(),
  }),
}));

// CSS.supports is not available in jsdom
vi.stubGlobal("CSS", { supports: () => false });

import TenstackTable from "@/components/TenstackTable.vue";

installQuasar();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseColumns = [
  { id: "name", accessorKey: "name", header: "NAME", size: 200 },
  { id: "status", accessorKey: "status", header: "STATUS", size: 150 },
];

const baseRows = [
  { _timestamp: 1000, name: "alpha", status: "ok" },
  { _timestamp: 2000, name: "beta", status: "error" },
  { _timestamp: 3000, name: "gamma", status: "warn" },
];

function mountTable(
  props: Record<string, any> = {},
  slots: Record<string, any> = {},
): VueWrapper {
  return mount(TenstackTable, {
    props: {
      columns: baseColumns,
      rows: baseRows,
      enableColumnReorder: false,
      enableRowExpand: false,
      enableTextHighlight: false,
      enableCellActions: false,
      enableStatusBar: false,
      enableAiContextButton: false,
      ...props,
    },
    slots,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TenstackTable", () => {
  let wrapper: VueWrapper;

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // ── Mounting ──────────────────────────────────────────────────────────────
  describe("mounting", () => {
    it("should mount without errors", () => {
      wrapper = mountTable();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render the o2-table element", () => {
      wrapper = mountTable();
      expect(wrapper.find('[data-test="o2-table"]').exists()).toBe(true);
    });

    it("should render the table body", () => {
      wrapper = mountTable();
      expect(wrapper.find('[data-test="o2-table-body"]').exists()).toBe(true);
    });

    it("should accept an empty rows array without crashing", () => {
      wrapper = mountTable({ rows: [] });
      expect(wrapper.find('[data-test="o2-table"]').exists()).toBe(true);
    });
  });

  // ── Column headers ────────────────────────────────────────────────────────
  describe("column headers", () => {
    it("should render a th element for each provided column", () => {
      wrapper = mountTable();
      const thName = wrapper.find('[data-test="o2-table-th-name"]');
      const thStatus = wrapper.find('[data-test="o2-table-th-status"]');
      expect(thName.exists()).toBe(true);
      expect(thStatus.exists()).toBe(true);
    });

    it("should display the header text for each column", () => {
      wrapper = mountTable();
      expect(wrapper.find('[data-test="o2-table-th-name"]').text()).toContain(
        "NAME",
      );
      expect(
        wrapper.find('[data-test="o2-table-th-status"]').text(),
      ).toContain("STATUS");
    });
  });

  // ── Row rendering ─────────────────────────────────────────────────────────
  describe("row rendering", () => {
    it("should render one tr for each row provided", () => {
      wrapper = mountTable();
      // Rows are keyed by _timestamp in data-test
      expect(
        wrapper.find('[data-test="o2-table-detail-1000"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="o2-table-detail-2000"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="o2-table-detail-3000"]').exists(),
      ).toBe(true);
    });

    it("should render cell content for each column", () => {
      wrapper = mountTable();
      // First row, name column
      const nameCell = wrapper.find(
        '[data-test="o2-table-column-0-name"]',
      );
      expect(nameCell.exists()).toBe(true);
      expect(nameCell.text()).toContain("alpha");
    });

    it("should render cells for all columns in the first row", () => {
      wrapper = mountTable();
      expect(
        wrapper.find('[data-test="o2-table-column-0-name"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="o2-table-column-0-status"]').exists(),
      ).toBe(true);
    });

    it("should render no data rows when rows is empty", () => {
      wrapper = mountTable({ rows: [] });
      expect(
        wrapper.find('[data-test="o2-table-detail-1000"]').exists(),
      ).toBe(false);
    });
  });

  // ── Sort icons ────────────────────────────────────────────────────────────
  describe("sort icons", () => {
    const sortableColumns = [
      {
        id: "duration",
        header: "DURATION",
        size: 120,
        meta: { sortable: true },
      },
      {
        id: "timestamp",
        header: "TIMESTAMP",
        size: 160,
        meta: { sortable: true },
      },
    ];

    it("should show the active sort icon for the currently sorted column", () => {
      wrapper = mountTable({
        columns: sortableColumns,
        rows: [],
        sortBy: "duration",
        sortOrder: "desc",
        sortFieldMap: {},
      });
      expect(
        wrapper.find('[data-test="tenstack-table-sort-icon-active"]').exists(),
      ).toBe(true);
    });

    it("should show the inactive sort icon for non-active sortable columns", () => {
      wrapper = mountTable({
        columns: sortableColumns,
        rows: [],
        sortBy: "duration",
        sortOrder: "asc",
        sortFieldMap: {},
      });
      // timestamp column is not active
      const inactiveIcons = wrapper.findAll(
        '[data-test="tenstack-table-sort-icon-inactive"]',
      );
      expect(inactiveIcons.length).toBeGreaterThan(0);
    });

    it("should not render any sort icon when sortBy is not provided", () => {
      wrapper = mountTable({
        columns: sortableColumns,
        rows: [],
      });
      expect(
        wrapper
          .find('[data-test="tenstack-table-sort-icon-active"]')
          .exists(),
      ).toBe(false);
      expect(
        wrapper
          .find('[data-test="tenstack-table-sort-icon-inactive"]')
          .exists(),
      ).toBe(false);
    });

    it("should resolve the active column via sortFieldMap", () => {
      wrapper = mountTable({
        columns: [
          {
            id: "timestamp",
            header: "TIMESTAMP",
            size: 160,
            meta: { sortable: true },
          },
        ],
        rows: [],
        sortBy: "start_time",
        sortOrder: "desc",
        sortFieldMap: { timestamp: "start_time" },
      });
      // timestamp maps to start_time which equals sortBy → active icon
      expect(
        wrapper.find('[data-test="tenstack-table-sort-icon-active"]').exists(),
      ).toBe(true);
    });
  });

  // ── Loading state ─────────────────────────────────────────────────────────
  describe("loading state", () => {
    it("should show the default loading indicator when loading=true and no rows", () => {
      wrapper = mountTable({ rows: [], loading: true });
      // Quasar renders q-spinner-hourglass as an SVG with class q-spinner
      const tableHtml = wrapper.html();
      expect(tableHtml).toContain("q-spinner");
      // i18n key is rendered as-is by the mock
      expect(tableHtml).toContain("confirmDialog.loading");
    });

    it("should render a custom loading slot when loading=true and rows is empty", () => {
      wrapper = mountTable(
        { rows: [], loading: true },
        { loading: '<div data-test="custom-loading-slot">Loading…</div>' },
      );
      expect(
        wrapper.find('[data-test="custom-loading-slot"]').exists(),
      ).toBe(true);
    });

    it("should not show the loading indicator when rows exist", () => {
      wrapper = mountTable(
        { loading: true },
        { loading: '<div data-test="custom-loading-slot">Loading…</div>' },
      );
      expect(
        wrapper.find('[data-test="custom-loading-slot"]').exists(),
      ).toBe(false);
    });

    it("should show the loading-banner slot when loading=true and rows exist", () => {
      wrapper = mountTable(
        { loading: true },
        { "loading-banner": '<div data-test="loading-banner">Refreshing…</div>' },
      );
      expect(wrapper.find('[data-test="loading-banner"]').exists()).toBe(true);
    });

    it("should not show the loading-banner slot when rows is empty", () => {
      wrapper = mountTable(
        { rows: [], loading: true },
        { "loading-banner": '<div data-test="loading-banner">Refreshing…</div>' },
      );
      expect(wrapper.find('[data-test="loading-banner"]').exists()).toBe(false);
    });
  });

  // ── Empty slot ────────────────────────────────────────────────────────────
  describe("empty slot", () => {
    it("should render the empty slot when rows is empty and not loading", () => {
      wrapper = mountTable(
        { rows: [], loading: false },
        { empty: '<div data-test="empty-state">No results</div>' },
      );
      expect(wrapper.find('[data-test="empty-state"]').exists()).toBe(true);
    });

    it("should not render the empty slot when rows are present", () => {
      wrapper = mountTable(
        {},
        { empty: '<div data-test="empty-state">No results</div>' },
      );
      expect(wrapper.find('[data-test="empty-state"]').exists()).toBe(false);
    });

    it("should not render the empty slot when rows is empty but loading is true", () => {
      wrapper = mountTable(
        { rows: [], loading: true },
        { empty: '<div data-test="empty-state">No results</div>' },
      );
      expect(wrapper.find('[data-test="empty-state"]').exists()).toBe(false);
    });
  });

  // ── errMsg ────────────────────────────────────────────────────────────────
  describe("errMsg prop", () => {
    it("should display the error message when errMsg is non-empty", () => {
      wrapper = mountTable({
        rows: [],
        loading: false,
        errMsg: "Query syntax error",
      });
      expect(wrapper.text()).toContain("Query syntax error");
    });

    it("should not render any error row when errMsg is empty string", () => {
      wrapper = mountTable({ errMsg: "" });
      // No bg-warning class means no error row rendered
      expect(wrapper.find(".bg-warning").exists()).toBe(false);
    });

    it("should not show the error row while loading even if errMsg was set previously", () => {
      // The template guards errMsg row with `!loading`
      wrapper = mountTable({
        rows: [],
        loading: true,
        errMsg: "Some error",
      });
      expect(wrapper.find(".bg-warning").exists()).toBe(false);
    });
  });

  // ── functionErrorMsg ──────────────────────────────────────────────────────
  describe("functionErrorMsg prop", () => {
    it("should render the function error row when functionErrorMsg is non-empty", () => {
      wrapper = mountTable({ functionErrorMsg: "VRL script failed" });
      expect(
        wrapper.find('[data-test="o2-table-function-error"]').exists(),
      ).toBe(true);
    });

    it("should not render the function error row when functionErrorMsg is empty", () => {
      wrapper = mountTable({ functionErrorMsg: "" });
      expect(
        wrapper.find('[data-test="o2-table-function-error"]').exists(),
      ).toBe(false);
    });

    it("should show the expand toggle button when functionErrorMsg is non-empty", () => {
      wrapper = mountTable({ functionErrorMsg: "some vrl error" });
      expect(
        wrapper.find('[data-test="table-row-expand-menu"]').exists(),
      ).toBe(true);
    });

    it("should expand the error detail when the expand button is clicked", async () => {
      const errorText = "line 1: unknown function\nline 2: bad type";
      wrapper = mountTable({ functionErrorMsg: errorText });

      // Detail row should not be visible before click
      const preElements = wrapper.findAll("pre");
      expect(preElements.length).toBe(0);

      await wrapper.find('[data-test="table-row-expand-menu"]').trigger("click");
      await flushPromises();

      const pre = wrapper.find("pre");
      expect(pre.exists()).toBe(true);
      expect(pre.text()).toContain("line 1: unknown function");
    });

    it("should collapse the error detail on a second click of the expand button", async () => {
      wrapper = mountTable({ functionErrorMsg: "vrl error details" });

      await wrapper.find('[data-test="table-row-expand-menu"]').trigger("click");
      await flushPromises();
      expect(wrapper.find("pre").exists()).toBe(true);

      await wrapper.find('[data-test="table-row-expand-menu"]').trigger("click");
      await flushPromises();
      expect(wrapper.find("pre").exists()).toBe(false);
    });
  });

  // ── closable column ───────────────────────────────────────────────────────
  describe("closable column", () => {
    const closableColumns = [
      {
        id: "severity",
        accessorKey: "severity",
        header: "SEVERITY",
        size: 120,
        meta: { closable: true },
      },
      { id: "name", accessorKey: "name", header: "NAME", size: 200 },
    ];

    it("should render the close button for a closable column header", () => {
      wrapper = mountTable({ columns: closableColumns });
      expect(
        wrapper
          .find('[data-test="o2-table-th-remove-SEVERITY-btn"]')
          .exists(),
      ).toBe(true);
    });

    it("should not render a close button for a non-closable column", () => {
      wrapper = mountTable({ columns: closableColumns });
      expect(
        wrapper.find('[data-test="o2-table-th-remove-NAME-btn"]').exists(),
      ).toBe(false);
    });

    it("should emit closeColumn with the column definition when the close button is clicked", async () => {
      wrapper = mountTable({ columns: closableColumns });
      await wrapper
        .find('[data-test="o2-table-th-remove-SEVERITY-btn"]')
        .trigger("click");
      expect(wrapper.emitted("closeColumn")).toBeTruthy();
      const payload = wrapper.emitted("closeColumn")![0][0] as any;
      expect(payload.id).toBe("severity");
    });
  });

  // ── sort-change emit ──────────────────────────────────────────────────────
  describe("sort-change emit", () => {
    it("should emit sort-change with desc on first click of an inactive sortable column", async () => {
      wrapper = mountTable({
        columns: [
          {
            id: "duration",
            header: "DURATION",
            size: 120,
            meta: { sortable: true },
          },
        ],
        rows: [],
        sortBy: "other_field",
        sortOrder: "asc",
        sortFieldMap: {},
      });
      await wrapper
        .find('[data-test="o2-table-th-sort-duration"]')
        .trigger("click");
      expect(wrapper.emitted("sort-change")).toBeTruthy();
      expect(wrapper.emitted("sort-change")![0]).toEqual(["duration", "desc"]);
    });

    it("should toggle from desc to asc when clicking the active sort column", async () => {
      wrapper = mountTable({
        columns: [
          {
            id: "duration",
            header: "DURATION",
            size: 120,
            meta: { sortable: true },
          },
        ],
        rows: [],
        sortBy: "duration",
        sortOrder: "desc",
        sortFieldMap: {},
      });
      await wrapper
        .find('[data-test="o2-table-th-sort-duration"]')
        .trigger("click");
      expect(wrapper.emitted("sort-change")![0]).toEqual(["duration", "asc"]);
    });

    it("should toggle from asc to desc when clicking the active sort column", async () => {
      wrapper = mountTable({
        columns: [
          {
            id: "duration",
            header: "DURATION",
            size: 120,
            meta: { sortable: true },
          },
        ],
        rows: [],
        sortBy: "duration",
        sortOrder: "asc",
        sortFieldMap: {},
      });
      await wrapper
        .find('[data-test="o2-table-th-sort-duration"]')
        .trigger("click");
      expect(wrapper.emitted("sort-change")![0]).toEqual(["duration", "desc"]);
    });

    it("should use sortFieldMap to resolve the emitted field name", async () => {
      wrapper = mountTable({
        columns: [
          {
            id: "timestamp",
            header: "TIMESTAMP",
            size: 160,
            meta: { sortable: true },
          },
        ],
        rows: [],
        sortBy: "other",
        sortOrder: "asc",
        sortFieldMap: { timestamp: "start_time" },
      });
      await wrapper
        .find('[data-test="o2-table-th-sort-timestamp"]')
        .trigger("click");
      expect(wrapper.emitted("sort-change")![0]).toEqual(["start_time", "desc"]);
    });

    it("should not emit sort-change when sortBy prop is not provided", async () => {
      wrapper = mountTable({
        columns: [
          {
            id: "duration",
            header: "DURATION",
            size: 120,
            meta: { sortable: true },
          },
        ],
        rows: [],
      });
      await wrapper
        .find('[data-test="o2-table-th-sort-duration"]')
        .trigger("click");
      expect(wrapper.emitted("sort-change")).toBeFalsy();
    });
  });

  // ── rowHeight prop ────────────────────────────────────────────────────────
  describe("rowHeight prop", () => {
    it("should apply the rowHeight style to th elements when provided", () => {
      wrapper = mountTable({ rowHeight: 48 });
      const th = wrapper.find('[data-test="o2-table-th-name"]');
      expect(th.attributes("style")).toContain("height: 48px");
    });

    it("should apply the default rowHeight of 22px to th elements when rowHeight prop is not passed", () => {
      wrapper = mountTable();
      const th = wrapper.find('[data-test="o2-table-th-name"]');
      expect(th.attributes("style")).toContain("height: 22px");
    });
  });

  // ── totalSize computed ─────────────────────────────────────────────────────
  describe("totalSize computed", () => {
    it("should set the table minHeight to getTotalSize() + rowHeight when using default rowHeight", () => {
      // Mock returns count * 24 for getTotalSize(). With 3 rows: 3*24 = 72.
      // Default rowHeight = 22. Expected totalSize = 72 + 22 = 94.
      wrapper = mountTable();
      const table = wrapper.find('[data-test="o2-table"]');
      expect(table.attributes("style")).toContain("min-height: 94px");
    });

    it("should set the table minHeight to getTotalSize() + rowHeight when rowHeight is explicitly provided", () => {
      // Mock returns count * 24 for getTotalSize(). With 3 rows: 3*24 = 72.
      // rowHeight = 48. Expected totalSize = 72 + 48 = 120.
      wrapper = mountTable({ rowHeight: 48 });
      const table = wrapper.find('[data-test="o2-table"]');
      expect(table.attributes("style")).toContain("min-height: 120px");
    });

    it("should set the table minHeight to getTotalSize() + rowHeight when rows is empty", () => {
      // Mock returns 0 * 24 = 0 for getTotalSize(). Default rowHeight = 22.
      // Expected totalSize = 0 + 22 = 22.
      wrapper = mountTable({ rows: [] });
      const table = wrapper.find('[data-test="o2-table"]');
      expect(table.attributes("style")).toContain("min-height: 22px");
    });
  });

  // ── wrap prop ─────────────────────────────────────────────────────────────
  describe("wrap prop", () => {
    it("should mount without error when wrap=true", () => {
      wrapper = mountTable({ wrap: true });
      expect(wrapper.find('[data-test="o2-table"]').exists()).toBe(true);
    });
  });

  // ── cell slots ────────────────────────────────────────────────────────────
  describe("cell slots", () => {
    it("should render a named cell slot for a column with meta.slot=true", () => {
      wrapper = mountTable(
        {
          columns: [
            {
              id: "name",
              accessorKey: "name",
              header: "NAME",
              size: 200,
              meta: { slot: true },
            },
          ],
        },
        {
          "cell-name": ({ item }: any) =>
            h("span", { "data-test": "custom-cell" }, item.name),
        },
      );
      const cells = wrapper.findAll('[data-test="custom-cell"]');
      expect(cells).toHaveLength(baseRows.length);
      expect(cells[0].text()).toBe("alpha");
    });

    it("should fall back to renderValue when no cell slot is provided", () => {
      wrapper = mountTable();
      expect(wrapper.text()).toContain("alpha");
      expect(wrapper.text()).toContain("ok");
    });
  });

  // ── enableColumnReorder prop ──────────────────────────────────────────────
  describe("enableColumnReorder prop", () => {
    it("should mount without error when enableColumnReorder=true", () => {
      wrapper = mountTable({ enableColumnReorder: true });
      expect(wrapper.find('[data-test="o2-table"]').exists()).toBe(true);
    });

    it("should mount without error when enableColumnReorder=false", () => {
      wrapper = mountTable({ enableColumnReorder: false });
      expect(wrapper.find('[data-test="o2-table"]').exists()).toBe(true);
    });
  });

  // ── showPagination prop ───────────────────────────────────────────────────
  describe("showPagination prop", () => {
    it("should render dashboard-data-row class rows when showPagination=true", () => {
      wrapper = mountTable({ showPagination: true });
      const rows = wrapper.findAll(".dashboard-data-row");
      expect(rows.length).toBe(baseRows.length);
    });

    it("should not set min-height on the table when showPagination=true", () => {
      wrapper = mountTable({ showPagination: true });
      const table = wrapper.find('[data-test="o2-table"]');
      const style = table.attributes("style") ?? "";
      expect(style).not.toContain("min-height");
    });

    it("should limit rows to rowsPerPage when showPagination=true", () => {
      // 3 rows total, rowsPerPage=2 → only 2 rows on first page
      wrapper = mountTable({ showPagination: true, rowsPerPage: 2 });
      const rows = wrapper.findAll(".dashboard-data-row");
      expect(rows.length).toBe(2);
    });

    it("should render all rows when showPagination=false", () => {
      wrapper = mountTable({ showPagination: false });
      // virtual scroll renders rows via virtualizer mock (3 rows)
      // o2-table-detail-* elements are rendered via virtual scroll path
      expect(
        wrapper.find('[data-test="o2-table-detail-1000"]').exists(),
      ).toBe(true);
    });

    it("should pass pagination info through the bottom slot when provided", () => {
      let slotProps: any = null;
      wrapper = mountTable(
        { showPagination: true, rowsPerPage: 10 },
        {
          bottom: (props: any) => {
            slotProps = props;
            return [];
          },
        },
      );
      expect(slotProps).not.toBeNull();
      expect(slotProps.pagination).toBeDefined();
      expect(slotProps.pagination.rowsPerPage).toBe(10);
      expect(slotProps.pagesNumber).toBeGreaterThanOrEqual(1);
      expect(typeof slotProps.setRowsPerPage).toBe("function");
      expect(typeof slotProps.firstPage).toBe("function");
      expect(typeof slotProps.lastPage).toBe("function");
    });
  });

  // ── useVirtualScroll=false prop ───────────────────────────────────────────
  describe("useVirtualScroll=false (dashboard mode)", () => {
    const dashboardColumns = [
      { name: "product", label: "PRODUCT", field: "product", align: "left" },
      { name: "revenue", label: "REVENUE", field: "revenue", align: "right" },
    ];
    const dashboardRows = [
      { product: "Alpha", revenue: 100 },
      { product: "Beta", revenue: 200 },
    ];

    it("should render dashboard-data-row class rows when useVirtualScroll=false", () => {
      wrapper = mountTable({
        columns: dashboardColumns,
        rows: dashboardRows,
        useVirtualScroll: false,
      });
      const rows = wrapper.findAll(".dashboard-data-row");
      expect(rows.length).toBe(dashboardRows.length);
    });

    it("should set min-height based on totalSize when useVirtualScroll=false and showPagination=false", () => {
      // The virtualizer mock returns count*24 for getTotalSize(). With 2 dashboard rows: 2*24=48.
      // Default rowHeight=22 → totalSize = 48 + 22 = 70px.
      wrapper = mountTable({
        columns: dashboardColumns,
        rows: dashboardRows,
        useVirtualScroll: false,
      });
      const table = wrapper.find('[data-test="o2-table"]');
      const style = table.attributes("style") ?? "";
      expect(style).toContain("min-height: 70px");
    });

    it("should render column labels from Quasar column format", () => {
      wrapper = mountTable({
        columns: dashboardColumns,
        rows: dashboardRows,
        useVirtualScroll: false,
      });
      expect(wrapper.text()).toContain("PRODUCT");
      expect(wrapper.text()).toContain("REVENUE");
    });
  });

  // ── stickyTotalRow prop ───────────────────────────────────────────────────
  describe("stickyTotalRow prop", () => {
    it("should render a tfoot element when stickyTotalRow is set", () => {
      wrapper = mountTable({
        stickyTotalRow: { name: "Total", status: "—" },
        useVirtualScroll: false,
        columns: [
          { name: "name", label: "NAME", field: "name" },
          { name: "status", label: "STATUS", field: "status" },
        ],
        rows: baseRows,
      });
      expect(wrapper.find("tfoot").exists()).toBe(true);
    });

    it("should not render a tfoot element when stickyTotalRow is null", () => {
      wrapper = mountTable({ stickyTotalRow: null });
      expect(wrapper.find("tfoot").exists()).toBe(false);
    });
  });

  // ── enableCellCopy prop ───────────────────────────────────────────────────
  describe("enableCellCopy prop", () => {
    it("should render copy buttons when enableCellCopy=true and dashboard mode", () => {
      const dashCols = [
        { name: "name", label: "NAME", field: "name", align: "left" },
      ];
      wrapper = mountTable({
        columns: dashCols,
        rows: [{ name: "alpha" }],
        useVirtualScroll: false,
        enableCellCopy: true,
      });
      const copyBtns = wrapper.findAll(".copy-btn");
      expect(copyBtns.length).toBeGreaterThan(0);
    });

    it("should not render copy buttons when enableCellCopy=false", () => {
      const dashCols = [
        { name: "name", label: "NAME", field: "name", align: "left" },
      ];
      wrapper = mountTable({
        columns: dashCols,
        rows: [{ name: "alpha" }],
        useVirtualScroll: false,
        enableCellCopy: false,
      });
      const copyBtns = wrapper.findAll(".copy-btn");
      expect(copyBtns.length).toBe(0);
    });
  });

  // ── wrap-enabled class on wrapper ─────────────────────────────────────────
  describe("wrap-enabled class on wrapper", () => {
    it("should add wrap-enabled class to root when wrap=true", () => {
      wrapper = mountTable({ wrap: true });
      // Use combined selector: the root div has BOTH the static class and the dynamic one
      expect(
        wrapper.find(".my-sticky-virtscroll-table.wrap-enabled").exists(),
      ).toBe(true);
    });

    it("should not add wrap-enabled class when wrap=false", () => {
      wrapper = mountTable({ wrap: false });
      expect(
        wrapper.find(".my-sticky-virtscroll-table.wrap-enabled").exists(),
      ).toBe(false);
    });
  });

  // ── stickyRowTotals wrapper class ─────────────────────────────────────────
  describe("stickyRowTotals wrapper class", () => {
    it("should add pivot-sticky-totals class when stickyRowTotals=true", () => {
      wrapper = mountTable({ stickyRowTotals: true });
      expect(
        wrapper
          .find(".my-sticky-virtscroll-table.pivot-sticky-totals")
          .exists(),
      ).toBe(true);
    });

    it("should not add pivot-sticky-totals class when stickyRowTotals=false", () => {
      wrapper = mountTable({ stickyRowTotals: false });
      expect(
        wrapper
          .find(".my-sticky-virtscroll-table.pivot-sticky-totals")
          .exists(),
      ).toBe(false);
    });
  });

  // ── tbody tw:relative class ───────────────────────────────────────────────
  describe("tbody tw:relative class", () => {
    it("should have tw:relative on tbody when useVirtualScroll=true and showPagination=false", () => {
      wrapper = mountTable();
      expect(
        wrapper.find('[data-test="o2-table-body"]').classes(),
      ).toContain("tw:relative");
    });

    it("should not have tw:relative on tbody when useVirtualScroll=false", () => {
      wrapper = mountTable({
        columns: [{ name: "name", label: "NAME", field: "name" }],
        rows: [],
        useVirtualScroll: false,
      });
      expect(
        wrapper.find('[data-test="o2-table-body"]').classes(),
      ).not.toContain("tw:relative");
    });

    it("should not have tw:relative on tbody when showPagination=true", () => {
      wrapper = mountTable({ showPagination: true });
      expect(
        wrapper.find('[data-test="o2-table-body"]').classes(),
      ).not.toContain("tw:relative");
    });
  });

  // ── pivot mode ────────────────────────────────────────────────────────────
  describe("pivot mode", () => {
    const pivotCols = [
      { name: "region", label: "REGION", field: "region", _isRowField: true },
      { name: "jan", label: "JAN", field: "jan" },
      { name: "feb", label: "FEB", field: "feb" },
    ];

    const oneLevel = [
      {
        isLeaf: true,
        cells: [
          { label: "Jan", colspan: 1, _sortColumn: "jan" },
          { label: "Feb", colspan: 1, _sortColumn: "feb" },
        ],
      },
    ];

    const twoLevels = [
      {
        isLeaf: false,
        cells: [{ label: "H1", colspan: 2, hasBorder: true }],
      },
      {
        isLeaf: true,
        cells: [
          { label: "Jan", colspan: 1, _sortColumn: "jan" },
          { label: "Feb", colspan: 1, _sortColumn: "feb" },
        ],
      },
    ];

    it("should render pivot-thead when pivotHeaderLevels is non-empty", () => {
      wrapper = mountTable({
        columns: pivotCols,
        rows: [],
        useVirtualScroll: false,
        pivotHeaderLevels: oneLevel,
      });
      expect(wrapper.find("thead.pivot-thead").exists()).toBe(true);
    });

    it("should not render standard o2-table-th-* headers in pivot mode", () => {
      wrapper = mountTable({
        columns: pivotCols,
        rows: [],
        useVirtualScroll: false,
        pivotHeaderLevels: oneLevel,
      });
      expect(wrapper.find('[data-test="o2-table-th-region"]').exists()).toBe(
        false,
      );
    });

    it("should render pivot value headers for leaf levels", () => {
      wrapper = mountTable({
        columns: pivotCols,
        rows: [],
        useVirtualScroll: false,
        pivotHeaderLevels: oneLevel,
      });
      const valueHeaders = wrapper.findAll(".pivot-value-header");
      expect(valueHeaders.length).toBe(2);
      expect(wrapper.text()).toContain("Jan");
      expect(wrapper.text()).toContain("Feb");
    });

    it("should render pivot group headers for non-leaf levels", () => {
      wrapper = mountTable({
        columns: pivotCols,
        rows: [],
        useVirtualScroll: false,
        pivotHeaderLevels: twoLevels,
      });
      expect(wrapper.text()).toContain("H1");
      const groupHeaders = wrapper.findAll(".pivot-group-header");
      expect(groupHeaders.length).toBeGreaterThan(0);
    });

    it("should render the row-field column label inside pivot-thead", () => {
      wrapper = mountTable({
        columns: pivotCols,
        rows: [],
        useVirtualScroll: false,
        pivotHeaderLevels: oneLevel,
      });
      expect(wrapper.text()).toContain("REGION");
    });

    it("should apply border-collapse:separate to the table in pivot mode", () => {
      wrapper = mountTable({
        columns: pivotCols,
        rows: [],
        useVirtualScroll: false,
        pivotHeaderLevels: oneLevel,
      });
      const style = wrapper.find('[data-test="o2-table"]').attributes("style") ?? "";
      expect(style).toContain("border-collapse: separate");
    });

    it("should apply pivot-section-border to a cell with hasBorder=true", () => {
      const levelsWithBorder = [
        {
          isLeaf: true,
          cells: [{ label: "Q1", colspan: 1, hasBorder: true }],
        },
      ];
      wrapper = mountTable({
        columns: pivotCols,
        rows: [],
        useVirtualScroll: false,
        pivotHeaderLevels: levelsWithBorder,
        stickyColTotals: false,
      });
      expect(wrapper.find(".pivot-section-border").exists()).toBe(true);
    });

    it("should apply pivot-total-col to a cell with _isTotalHeader=true when stickyColTotals=true", () => {
      const totalLevel = [
        {
          isLeaf: true,
          cells: [{ label: "Total", colspan: 1, _isTotalHeader: true }],
        },
      ];
      wrapper = mountTable({
        columns: pivotCols,
        rows: [],
        useVirtualScroll: false,
        pivotHeaderLevels: totalLevel,
        stickyColTotals: true,
      });
      expect(wrapper.find(".pivot-total-col").exists()).toBe(true);
    });

    it("should NOT apply pivot-section-border when _isTotalHeader=true and stickyColTotals=true", () => {
      const totalLevel = [
        {
          isLeaf: true,
          cells: [
            { label: "Total", colspan: 1, hasBorder: true, _isTotalHeader: true },
          ],
        },
      ];
      wrapper = mountTable({
        columns: pivotCols,
        rows: [],
        useVirtualScroll: false,
        pivotHeaderLevels: totalLevel,
        stickyColTotals: true,
      });
      expect(wrapper.find(".pivot-section-border").exists()).toBe(false);
    });
  });

  // ── getCellDisplayValue (dashboard format fn) ─────────────────────────────
  describe("getCellDisplayValue", () => {
    it("should apply the format function to a cell value", () => {
      const cols = [
        {
          name: "amount",
          label: "AMOUNT",
          field: "amount",
          format: (val: any) => `$${val}`,
        },
      ];
      wrapper = mountTable({
        columns: cols,
        rows: [{ amount: 100 }],
        useVirtualScroll: false,
      });
      expect(wrapper.text()).toContain("$100");
    });

    it("should call format(null, row) for null cell values", () => {
      const cols = [
        {
          name: "amount",
          label: "AMOUNT",
          field: "amount",
          format: (val: any) => (val === null ? "N/A" : `$${val}`),
        },
      ];
      wrapper = mountTable({
        columns: cols,
        rows: [{ amount: null }],
        useVirtualScroll: false,
      });
      expect(wrapper.text()).toContain("N/A");
    });

    it("should render the raw value when no format function is provided", () => {
      const cols = [{ name: "score", label: "SCORE", field: "score" }];
      wrapper = mountTable({
        columns: cols,
        rows: [{ score: 42 }],
        useVirtualScroll: false,
      });
      expect(wrapper.text()).toContain("42");
    });
  });

  // ── click:dataRow emit ────────────────────────────────────────────────────
  describe("click:dataRow emit", () => {
    it("should emit click:dataRow with the row data when a dashboard row is clicked", async () => {
      const cols = [{ name: "name", label: "NAME", field: "name" }];
      wrapper = mountTable({
        columns: cols,
        rows: [{ name: "alpha" }],
        useVirtualScroll: false,
      });
      await wrapper.find(".dashboard-data-row").trigger("click");
      expect(wrapper.emitted("click:dataRow")).toBeTruthy();
      const [row] = wrapper.emitted("click:dataRow")![0] as any[];
      expect(row).toMatchObject({ name: "alpha" });
    });

    it("should include the zero-based row index in the click:dataRow payload", async () => {
      const cols = [{ name: "name", label: "NAME", field: "name" }];
      wrapper = mountTable({
        columns: cols,
        rows: [{ name: "alpha" }, { name: "beta" }],
        useVirtualScroll: false,
      });
      const rows = wrapper.findAll(".dashboard-data-row");
      await rows[1].trigger("click");
      const [, rowIndex] = wrapper.emitted("click:dataRow")![0] as any[];
      expect(rowIndex).toBe(1);
    });
  });

  // ── rowClass prop ─────────────────────────────────────────────────────────
  describe("rowClass prop", () => {
    it("should apply the rowClass result as a CSS class on virtual scroll rows", () => {
      wrapper = mountTable({
        rowClass: (row: any) => (row.status === "error" ? "error-row" : ""),
      });
      // baseRows includes { status: "error" }
      expect(wrapper.find(".error-row").exists()).toBe(true);
    });

    it("should not add a custom class when rowClass returns an empty string", () => {
      wrapper = mountTable({
        rowClass: () => "",
      });
      expect(wrapper.find(".error-row").exists()).toBe(false);
    });
  });

  // ── Pagination navigation ─────────────────────────────────────────────────
  describe("pagination navigation", () => {
    function mountWithBottomSlot(propsOverride: Record<string, any> = {}) {
      let slotProps: any = null;
      const w = mountTable(
        { showPagination: true, rowsPerPage: 1, ...propsOverride },
        { bottom: (props: any) => { slotProps = props; return []; } },
      );
      return { w, getProps: () => slotProps };
    }

    it("should start on page 1", () => {
      const { getProps } = mountWithBottomSlot();
      expect(getProps().pagination.page).toBe(1);
    });

    it("should advance to page 2 when nextPage is called", async () => {
      const { w, getProps } = mountWithBottomSlot();
      wrapper = w;
      getProps().nextPage();
      await wrapper.vm.$nextTick();
      expect(getProps().pagination.page).toBe(2);
    });

    it("should return to page 1 when prevPage is called on page 2", async () => {
      const { w, getProps } = mountWithBottomSlot();
      wrapper = w;
      getProps().nextPage();
      await wrapper.vm.$nextTick();
      getProps().prevPage();
      await wrapper.vm.$nextTick();
      expect(getProps().pagination.page).toBe(1);
    });

    it("should not go below page 1 when prevPage is called on page 1", async () => {
      const { w, getProps } = mountWithBottomSlot();
      wrapper = w;
      getProps().prevPage();
      await wrapper.vm.$nextTick();
      expect(getProps().pagination.page).toBe(1);
    });

    it("should jump to last page when lastPage is called", async () => {
      const { w, getProps } = mountWithBottomSlot();
      wrapper = w;
      getProps().lastPage();
      await wrapper.vm.$nextTick();
      expect(getProps().pagination.page).toBe(baseRows.length); // 3 rows / 1 per page = 3 pages
    });

    it("should jump to first page when firstPage is called after navigating away", async () => {
      const { w, getProps } = mountWithBottomSlot();
      wrapper = w;
      getProps().lastPage();
      await wrapper.vm.$nextTick();
      getProps().firstPage();
      await wrapper.vm.$nextTick();
      expect(getProps().pagination.page).toBe(1);
    });

    it("should not advance beyond the last page when nextPage is called on the last page", async () => {
      const { w, getProps } = mountWithBottomSlot();
      wrapper = w;
      getProps().lastPage();
      await wrapper.vm.$nextTick();
      getProps().nextPage();
      await wrapper.vm.$nextTick();
      expect(getProps().pagination.page).toBe(baseRows.length);
    });

    it("should report isFirstPage=true on page 1", () => {
      const { getProps } = mountWithBottomSlot({ rowsPerPage: 2 });
      expect(getProps().isFirstPage).toBe(true);
    });

    it("should report isLastPage=true when on the final page", async () => {
      const { w, getProps } = mountWithBottomSlot({ rowsPerPage: 2 });
      wrapper = w;
      // 3 rows / 2 per page = 2 pages; advance to page 2
      getProps().nextPage();
      await wrapper.vm.$nextTick();
      expect(getProps().isLastPage).toBe(true);
    });

    it("should update rowsPerPage and reset to page 1 when setRowsPerPage is called", async () => {
      const { w, getProps } = mountWithBottomSlot();
      wrapper = w;
      getProps().nextPage(); // go to page 2
      await wrapper.vm.$nextTick();
      getProps().setRowsPerPage(3);
      await wrapper.vm.$nextTick();
      expect(getProps().pagination.rowsPerPage).toBe(3);
      expect(getProps().pagination.page).toBe(1);
    });

    it("should expose totalRows as the full dataset length", () => {
      const { getProps } = mountWithBottomSlot({ rowsPerPage: 1 });
      expect(getProps().totalRows).toBe(baseRows.length);
    });
  });

  // ── paginationOptions ─────────────────────────────────────────────────────
  describe("paginationOptions", () => {
    function getOptions(rowsPerPage: number, showPagination = true) {
      let slotProps: any = null;
      mountTable(
        { showPagination, rowsPerPage },
        { bottom: (props: any) => { slotProps = props; return []; } },
      );
      return slotProps?.paginationOptions ?? [];
    }

    it("should include a custom rowsPerPage value not in the base list", () => {
      expect(getOptions(75)).toContain(75);
    });

    it("should always include 0 (show all) at the end", () => {
      const opts = getOptions(10);
      expect(opts[opts.length - 1]).toBe(0);
    });

    it("should include standard values (10, 20, 50…)", () => {
      const opts = getOptions(10);
      expect(opts).toContain(10);
      expect(opts).toContain(20);
      expect(opts).toContain(50);
    });

    it("should return [0] when showPagination=false", () => {
      expect(getOptions(10, false)).toEqual([0]);
    });
  });

  // ── copy cell — clipboard receives the formatted value, not the raw ISO T-string ──
  // Regression: before the fix, copyCellContent was called with cell.getValue()
  // (raw ISO timestamp like "2024-01-15T10:30:00Z").  After the fix it is called
  // with getCellDisplayValue(cell) which applies the column's format function,
  // producing "2024-01-15 10:30:00" — no "T" separator.
  describe("copy cell — timestamp value is formatted before clipboard write", () => {
    const ISO_RAW = "2024-01-15T10:30:00Z";
    const FORMATTED = "2024-01-15 10:30:00";
    // Minimal simulation of parseTimestampValue: strips the "T" ISO separator and "Z" suffix.
    const timestampFormat = (val: any): string =>
      val ? String(val).replace("T", " ").replace("Z", "") : val;

    beforeEach(() => {
      mockCopyToClipboard.mockClear();
    });

    it("should copy the formatted display value (not raw ISO) when copy button is clicked on a left-aligned timestamp column", async () => {
      const cols = [
        {
          name: "event_time",
          label: "EVENT TIME",
          field: "event_time",
          align: "left",
          format: timestampFormat,
        },
      ];
      wrapper = mountTable({
        columns: cols,
        rows: [{ event_time: ISO_RAW }],
        useVirtualScroll: false,
        enableCellCopy: true,
      });
      await flushPromises();

      const copyBtn = wrapper.find(".copy-btn");
      expect(copyBtn.exists()).toBe(true);
      await wrapper.find(".copy-btn button").trigger("click");
      await flushPromises();

      expect(mockCopyToClipboard).toHaveBeenCalledWith(FORMATTED);
    });

    it("should NOT pass the raw ISO 'T' separator to the clipboard when a timestamp format function is defined", async () => {
      const cols = [
        {
          name: "ts",
          label: "TIMESTAMP",
          field: "ts",
          align: "left",
          format: timestampFormat,
        },
      ];
      wrapper = mountTable({
        columns: cols,
        rows: [{ ts: ISO_RAW }],
        useVirtualScroll: false,
        enableCellCopy: true,
      });
      await flushPromises();

      await wrapper.find(".copy-btn button").trigger("click");
      await flushPromises();

      expect(mockCopyToClipboard).toHaveBeenCalledOnce();
      const copiedValue = mockCopyToClipboard.mock.calls[0][0] as string;
      // The raw ISO "T" separator must not appear in the clipboard value.
      expect(copiedValue).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    });

    it("should copy the formatted display value from the left-side copy button on a right-aligned timestamp column", async () => {
      const cols = [
        {
          name: "ts",
          label: "TIMESTAMP",
          field: "ts",
          align: "right",
          format: timestampFormat,
        },
      ];
      wrapper = mountTable({
        columns: cols,
        rows: [{ ts: ISO_RAW }],
        useVirtualScroll: false,
        enableCellCopy: true,
      });
      await flushPromises();

      const copyBtn = wrapper.find(".copy-btn");
      expect(copyBtn.exists()).toBe(true);
      await wrapper.find(".copy-btn button").trigger("click");
      await flushPromises();

      expect(mockCopyToClipboard).toHaveBeenCalledWith(FORMATTED);
    });

    it("should copy the raw value unchanged when the column has no format function", async () => {
      const cols = [
        { name: "label", label: "LABEL", field: "label", align: "left" },
      ];
      wrapper = mountTable({
        columns: cols,
        rows: [{ label: "plain-text" }],
        useVirtualScroll: false,
        enableCellCopy: true,
      });
      await flushPromises();

      await wrapper.find(".copy-btn button").trigger("click");
      await flushPromises();

      expect(mockCopyToClipboard).toHaveBeenCalledWith("plain-text");
    });

    it("should copy the formatted value for a center-aligned timestamp column", async () => {
      const cols = [
        {
          name: "ts",
          label: "TIMESTAMP",
          field: "ts",
          align: "center",
          format: timestampFormat,
        },
      ];
      wrapper = mountTable({
        columns: cols,
        rows: [{ ts: ISO_RAW }],
        useVirtualScroll: false,
        enableCellCopy: true,
      });
      await flushPromises();

      await wrapper.find(".copy-btn button").trigger("click");
      await flushPromises();

      expect(mockCopyToClipboard).toHaveBeenCalledWith(FORMATTED);
    });
  });

  // ── copy cell — pivot table mode ──────────────────────────────────────────
  // Pivot tables go through the same non-virtual DOM path so the format function
  // must also be applied when a copy button is clicked in pivot mode.
  describe("copy cell — pivot table timestamp formatting", () => {
    const ISO_RAW = "2024-01-15T10:30:00Z";
    const FORMATTED = "2024-01-15 10:30:00";
    const timestampFormat = (val: any): string =>
      val ? String(val).replace("T", " ").replace("Z", "") : val;

    const oneLevel = [
      {
        isLeaf: true,
        cells: [{ label: "TIMESTAMP", colspan: 1, _sortColumn: "ts" }],
      },
    ];

    beforeEach(() => {
      mockCopyToClipboard.mockClear();
    });

    it("should copy the formatted timestamp value when copy button is clicked in pivot mode (left-aligned)", async () => {
      const pivotCols = [
        {
          name: "region",
          label: "REGION",
          field: "region",
          _isRowField: true,
          align: "left",
        },
        {
          name: "ts",
          label: "TIMESTAMP",
          field: "ts",
          align: "left",
          format: timestampFormat,
        },
      ];
      wrapper = mountTable({
        columns: pivotCols,
        rows: [{ region: "EMEA", ts: ISO_RAW }],
        useVirtualScroll: false,
        pivotHeaderLevels: oneLevel,
        enableCellCopy: true,
      });
      await flushPromises();

      // Two copy buttons: index 0 = "region" cell, index 1 = "ts" cell.
      const copyBtns = wrapper.findAll(".copy-btn");
      expect(copyBtns.length).toBeGreaterThanOrEqual(2);
      await wrapper.findAll(".copy-btn button")[1].trigger("click");
      await flushPromises();

      expect(mockCopyToClipboard).toHaveBeenCalledWith(FORMATTED);
    });

    it("should NOT contain the ISO 'T' separator in the copied pivot timestamp value", async () => {
      const pivotCols = [
        {
          name: "region",
          label: "REGION",
          field: "region",
          _isRowField: true,
          align: "left",
        },
        {
          name: "ts",
          label: "TIMESTAMP",
          field: "ts",
          align: "left",
          format: timestampFormat,
        },
      ];
      wrapper = mountTable({
        columns: pivotCols,
        rows: [{ region: "EMEA", ts: ISO_RAW }],
        useVirtualScroll: false,
        pivotHeaderLevels: oneLevel,
        enableCellCopy: true,
      });
      await flushPromises();

      const copyBtns = wrapper.findAll(".copy-btn");
      await wrapper.findAll(".copy-btn button")[1].trigger("click");
      await flushPromises();

      const copiedValue = mockCopyToClipboard.mock.calls[0][0] as string;
      expect(copiedValue).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    });

    it("should copy the formatted timestamp from a right-aligned column in pivot mode", async () => {
      const pivotCols = [
        {
          name: "region",
          label: "REGION",
          field: "region",
          _isRowField: true,
          align: "left",
        },
        {
          name: "ts",
          label: "TS",
          field: "ts",
          align: "right",
          format: timestampFormat,
        },
      ];
      const rightAlignedLevel = [
        {
          isLeaf: true,
          cells: [{ label: "TS", colspan: 1, _sortColumn: "ts" }],
        },
      ];
      wrapper = mountTable({
        columns: pivotCols,
        rows: [{ region: "EMEA", ts: ISO_RAW }],
        useVirtualScroll: false,
        pivotHeaderLevels: rightAlignedLevel,
        enableCellCopy: true,
      });
      await flushPromises();

      // Right-aligned column renders copy button on the LEFT side of the cell.
      // The button for the right-aligned "ts" column is last in the list
      // (region is index 0, ts right-aligned is index 1).
      const copyBtns = wrapper.findAll(".copy-btn");
      expect(copyBtns.length).toBeGreaterThanOrEqual(2);
      await wrapper.findAll(".copy-btn button")[1].trigger("click");
      await flushPromises();

      expect(mockCopyToClipboard).toHaveBeenCalledWith(FORMATTED);
    });
  });
});
