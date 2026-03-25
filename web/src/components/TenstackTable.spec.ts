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
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { h } from "vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";

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
  return { ...actual, debounce: (fn: any) => fn };
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
});
