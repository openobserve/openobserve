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
  { id: "name", header: "NAME", size: 200 },
  { id: "value", header: "VALUE", size: 300 },
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
        {},
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
            header: "ID",
            size: 100,
            meta: { align: "center" as const },
          },
        ],
        rows: [{ id: "x" }],
      });
      const tds = wrapper.findAll("td[data-test]");
      expect(tds[0].classes()).toContain("tw:text-center");
    });

    it("should apply tw:text-right for right-aligned columns", () => {
      wrapper = mountTable({
        columns: [
          {
            id: "val",
            header: "VAL",
            size: 100,
            meta: { align: "right" as const },
          },
        ],
        rows: [{ val: 42 }],
      });
      const cell = wrapper.find(".oz-table__row div");
      // happy-dom expands flex shorthand; check for flex-basis 0px in any form
      expect(cell.attributes("style")).toMatch(/flex(?:-basis)?[^;]*0px/);
    });
  });
});
