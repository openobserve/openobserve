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

/**
 * TenstackTable — generic features spec
 *
 * Covers the generic props/features added for traces usage:
 *   - rowClass prop
 *   - #cell-{columnId} scoped slots
 *   - meta.align (center / right)
 *   - meta.cellClass
 *   - #loading / #loading-banner / #empty slots
 *   - sort-change emit (server-side sort mode)
 *
 * The full logs-specific behavior (column resize, drag-reorder, FTS highlight,
 * row expand) is tested in the existing logs test suite.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { h } from "vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";

// ---------------------------------------------------------------------------
// Module mocks (hoisted)
// ---------------------------------------------------------------------------

vi.mock("@tanstack/vue-virtual", () => ({
  useVirtualizer: (optsRef: any) => ({
    // __v_isRef makes Vue auto-unwrap this in templates so rowVirtualizer.measureElement works
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
// Test fixtures
// ---------------------------------------------------------------------------

const baseColumns = [
  { id: "name", accessorKey: "name", header: "NAME", size: 200 },
  { id: "value", accessorKey: "value", header: "VALUE", size: 300 },
];

const baseRows = [
  { name: "alpha", value: "v1" },
  { name: "beta", value: "v2" },
  { name: "gamma", value: "v3" },
];

function mountTable(
  props: Record<string, any> = {},
  slots: Record<string, any> = {},
) {
  return mount(TenstackTable, {
    props: {
      columns: baseColumns,
      rows: baseRows,
      enableColumnReorder: false,
      enableRowExpand: false,
      enableTextHighlight: false,
      enableCellActions: false,
      enableStatusBar: false,
      ...props,
    },
    slots,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TenstackTable — generic features", () => {
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

    it("should accept an empty rows array", () => {
      wrapper = mountTable({ rows: [] });
      expect(wrapper.exists()).toBe(true);
    });
  });

  // ── rowClass prop ─────────────────────────────────────────────────────────
  describe("rowClass prop", () => {
    it("should apply the class returned by rowClass to matching rows", () => {
      wrapper = mountTable({
        rowClass: (row: any) =>
          row.name === "alpha" ? "oz-table__row--error" : "",
      });
      const rows = wrapper.findAll("tr[data-test]");
      expect(rows[0].classes()).toContain("oz-table__row--error");
      expect(rows[1].classes()).not.toContain("oz-table__row--error");
    });

    it("should work without a rowClass prop (no crash)", () => {
      wrapper = mountTable();
      expect(wrapper.findAll("tr[data-test]").length).toBeGreaterThan(0);
    });
  });

  // ── #cell-{columnId} scoped slot ──────────────────────────────────────────
  describe("cell slots", () => {
    it("should render a custom slot for a specific column", () => {
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
            { id: "value", accessorKey: "value", header: "VALUE", size: 300 },
          ],
        },
        {
          "cell-name": ({ item }: any) =>
            h("span", { "data-test": "custom-name-cell" }, item.name),
        },
      );
      const cells = wrapper.findAll('[data-test="custom-name-cell"]');
      expect(cells).toHaveLength(baseRows.length);
      expect(cells[0].text()).toBe("alpha");
    });

    it("should fall back to renderValue when no cell slot is provided", () => {
      wrapper = mountTable();
      expect(wrapper.text()).toContain("alpha");
      expect(wrapper.text()).toContain("v1");
    });
  });

  // ── meta.align ────────────────────────────────────────────────────────────
  describe("meta.align", () => {
    it("should apply tw:text-center for center-aligned columns", () => {
      wrapper = mountTable({
        columns: [
          {
            id: "id",
            accessorKey: "id",
            header: "ID",
            size: 100,
            meta: { align: "center" as const },
          },
        ],
        rows: [{ id: "x" }],
      });
      const tds = wrapper.findAll("td[data-test]");
      expect(tds[0].classes()).toContain("tw:text-center!");
    });

    it("should apply tw:text-right for right-aligned columns", () => {
      wrapper = mountTable({
        columns: [
          {
            id: "val",
            accessorKey: "val",
            header: "VAL",
            size: 100,
            meta: { align: "right" as const },
          },
        ],
        rows: [{ val: 42 }],
      });
      const tds = wrapper.findAll("td[data-test]");
      expect(tds[0].classes()).toContain("tw:text-right!");
    });

    it("should apply no alignment class for default (left) columns", () => {
      wrapper = mountTable({
        columns: [{ id: "name", accessorKey: "name", header: "N", size: 100 }],
        rows: [{ name: "x" }],
      });
      const tds = wrapper.findAll("td[data-test]");
      expect(tds[0].classes()).not.toContain("tw:text-center");
      expect(tds[0].classes()).not.toContain("tw:text-right");
    });
  });

  // ── meta.cellClass ────────────────────────────────────────────────────────
  describe("meta.cellClass", () => {
    it("should apply cellClass to matching td elements", () => {
      wrapper = mountTable({
        columns: [
          {
            id: "svc",
            accessorKey: "svc",
            header: "SVC",
            size: 150,
            meta: { cellClass: "tw:text-[var(--o2-text-1)]" },
          },
        ],
        rows: [{ svc: "auth" }],
      });
      const tds = wrapper.findAll("td[data-test]");
      expect(tds[0].classes()).toContain("tw:text-[var(--o2-text-1)]");
    });
  });

  // ── #loading slot ─────────────────────────────────────────────────────────
  describe("loading slot", () => {
    it("should render the loading slot when loading=true and no rows", () => {
      wrapper = mountTable(
        { rows: [], loading: true },
        { loading: '<div data-test="custom-loading">Loading…</div>' },
      );
      expect(wrapper.find('[data-test="custom-loading"]').exists()).toBe(true);
    });

    it("should not render the loading slot when rows exist", () => {
      wrapper = mountTable(
        { loading: true },
        { loading: '<div data-test="custom-loading">Loading…</div>' },
      );
      expect(wrapper.find('[data-test="custom-loading"]').exists()).toBe(false);
    });
  });

  // ── #loading-banner slot ──────────────────────────────────────────────────
  describe("loading-banner slot", () => {
    it("should render the loading-banner slot when loading=true and rows exist", () => {
      wrapper = mountTable(
        { loading: true },
        { "loading-banner": '<div data-test="banner">Fetching…</div>' },
      );
      expect(wrapper.find('[data-test="banner"]').exists()).toBe(true);
    });

    it("should not render loading-banner when rows are empty", () => {
      wrapper = mountTable(
        { rows: [], loading: true },
        { "loading-banner": '<div data-test="banner">Fetching…</div>' },
      );
      expect(wrapper.find('[data-test="banner"]').exists()).toBe(false);
    });
  });

  // ── #empty slot ───────────────────────────────────────────────────────────
  describe("empty slot", () => {
    it("should render the empty slot when rows is empty and not loading", () => {
      wrapper = mountTable(
        { rows: [], loading: false },
        { empty: '<div data-test="custom-empty">No data</div>' },
      );
      expect(wrapper.find('[data-test="custom-empty"]').exists()).toBe(true);
    });

    it("should not render the empty slot when rows exist", () => {
      wrapper = mountTable(
        {},
        { empty: '<div data-test="custom-empty">No data</div>' },
      );
      expect(wrapper.find('[data-test="custom-empty"]').exists()).toBe(false);
    });
  });

  // ── sort-change emit ──────────────────────────────────────────────────────
  describe("sort-change emit", () => {
    it("should emit sort-change with desc on first click of an unsorted sortable column", async () => {
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
        sortBy: "other_field",
        sortOrder: "asc" as const,
        sortFieldMap: { timestamp: "start_time" },
      });
      await wrapper
        .find('[data-test="o2-table-th-sort-timestamp"]')
        .trigger("click");
      expect(wrapper.emitted("sort-change")).toBeTruthy();
      expect(wrapper.emitted("sort-change")![0]).toEqual([
        "start_time",
        "desc",
      ]);
    });

    it("should toggle sort order when clicking the active sort column", async () => {
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
        sortOrder: "desc" as const,
        sortFieldMap: {},
      });
      await wrapper
        .find('[data-test="o2-table-th-sort-duration"]')
        .trigger("click");
      expect(wrapper.emitted("sort-change")![0]).toEqual(["duration", "asc"]);
    });
  });
});
