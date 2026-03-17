// Copyright 2026 OpenObserve Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ref } from "vue";
import TenstackTable from "./TenstackTable.vue";

// Mock CSS.supports which is not available in jsdom
Object.defineProperty(globalThis, "CSS", {
  value: { supports: vi.fn(() => false) },
  writable: true,
});

// ── Mock vue-i18n ──────────────────────────────────────────────────────────────
vi.mock("vue-i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

// ── Mock Vuex ──────────────────────────────────────────────────────────────────
const mockStore = {
  state: {
    theme: "light",
    zoConfig: {
      timestamp_column: "_timestamp",
    },
  },
};

vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

// ── Mock Quasar ────────────────────────────────────────────────────────────────
vi.mock("quasar", async () => {
  const actual = await vi.importActual("quasar");
  return {
    ...actual,
    debounce: (fn: any) => fn,
  };
});

// ── Mock @tanstack/vue-virtual ─────────────────────────────────────────────────
vi.mock("@tanstack/vue-virtual", () => ({
  useVirtualizer: () =>
    ref({
      getVirtualItems: () => [],
      getTotalSize: () => 0,
      measureElement: vi.fn(),
    }),
}));

// ── Mock @tanstack/vue-table ───────────────────────────────────────────────────
const mockTable = {
  getCenterTotalSize: () => 800,
  getTotalSize: () => 800,
  getHeaderGroups: () => [{ id: "hg-0", headers: [] }],
  getState: () => ({ columnOrder: [] }),
  getRowModel: () => ({ rows: [] }),
  getFlatHeaders: () => [],
  setColumnOrder: vi.fn(),
  resetColumnSizing: vi.fn(),
};

vi.mock("@tanstack/vue-table", () => ({
  FlexRender: { template: "<span />" },
  useVueTable: () => mockTable,
  getCoreRowModel: () => vi.fn(),
  getSortedRowModel: () => vi.fn(),
}));

// ── Mock vue-draggable-next ────────────────────────────────────────────────────
vi.mock("vue-draggable-next", () => ({
  VueDraggableNext: { template: "<tr><slot /></tr>" },
}));

// ── Mock composables ───────────────────────────────────────────────────────────
vi.mock("@/composables/useTextHighlighter", () => ({
  useTextHighlighter: () => ({
    isFTSColumn: vi.fn(() => false),
  }),
}));

vi.mock("@/composables/useLogsHighlighter", () => ({
  useLogsHighlighter: () => ({
    processedResults: ref([]),
    processHitsInChunks: vi.fn(),
  }),
}));

// ── Mock utils ─────────────────────────────────────────────────────────────────
vi.mock("@/utils/logs/statusParser", () => ({
  extractStatusFromLog: () => null,
}));

// ── Stubs ──────────────────────────────────────────────────────────────────────
const globalStubs = {
  JsonPreview: { template: "<div />" },
  CellActions: { template: "<div />" },
  O2AIContextAddBtn: { template: "<div />" },
  FlexRender: { template: "<span />" },
};

const defaultProps = {
  rows: [],
  columns: [],
};

const mountComponent = (propsOverrides = {}) =>
  mount(TenstackTable, {
    global: {
      stubs: globalStubs,
    },
    props: {
      ...defaultProps,
      ...propsOverrides,
    },
  });

describe("TenstackTable", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── Component Initialization ─────────────────────────────────────────────────
  describe("Component Initialization", () => {
    it("mounts successfully with minimal props", () => {
      const wrapper = mountComponent();
      expect(wrapper.exists()).toBe(true);
    });

    it("initializes sorting as empty array", () => {
      const wrapper = mountComponent();
      expect(wrapper.vm.sorting).toEqual([]);
    });

    it("initializes columnOrder as empty array", () => {
      const wrapper = mountComponent();
      expect(wrapper.vm.columnOrder).toEqual([]);
    });

    it("initializes isFunctionErrorOpen as false", () => {
      const wrapper = mountComponent();
      expect(wrapper.vm.isFunctionErrorOpen).toBe(false);
    });

    it("initializes activeCellActionId as empty string", () => {
      const wrapper = mountComponent();
      expect(wrapper.vm.activeCellActionId).toBe("");
    });

    it("initializes expandedRowIndices as empty Set", () => {
      const wrapper = mountComponent();
      expect(wrapper.vm.expandedRowIndices.size).toBe(0);
    });

    it("initializes isResizingHeader as false", () => {
      const wrapper = mountComponent();
      expect(wrapper.vm.isResizingHeader).toBe(false);
    });
  });

  // ── Props ────────────────────────────────────────────────────────────────────
  describe("Props", () => {
    it("accepts rows prop", () => {
      const rows = [{ _timestamp: 1000, log: "test" }];
      const wrapper = mountComponent({ rows });
      expect(wrapper.props("rows")).toEqual(rows);
    });

    it("accepts columns prop", () => {
      const columns = [{ id: "_timestamp", header: "Timestamp" }];
      const wrapper = mountComponent({ columns });
      expect(wrapper.props("columns")).toEqual(columns);
    });

    it("defaults wrap to false", () => {
      const wrapper = mountComponent();
      expect(wrapper.props("wrap")).toBe(false);
    });

    it("defaults loading to false", () => {
      const wrapper = mountComponent();
      expect(wrapper.props("loading")).toBe(false);
    });

    it("defaults defaultColumns to true", () => {
      const wrapper = mountComponent();
      expect(wrapper.props("defaultColumns")).toBe(true);
    });

    it("defaults errMsg to empty string", () => {
      const wrapper = mountComponent();
      expect(wrapper.props("errMsg")).toBe("");
    });

    it("defaults highlightTimestamp to -1", () => {
      const wrapper = mountComponent();
      expect(wrapper.props("highlightTimestamp")).toBe(-1);
    });

    it("defaults hideSearchTermActions to false", () => {
      const wrapper = mountComponent();
      expect(wrapper.props("hideSearchTermActions")).toBe(false);
    });

    it("defaults hideViewRelatedButton to false", () => {
      const wrapper = mountComponent();
      expect(wrapper.props("hideViewRelatedButton")).toBe(false);
    });

    it("accepts wrap=true prop", () => {
      const wrapper = mountComponent({ wrap: true });
      expect(wrapper.props("wrap")).toBe(true);
    });
  });

  // ── Emits via copyLogToClipboard ─────────────────────────────────────────────
  describe("copyLogToClipboard", () => {
    it("emits 'copy' event with value and copyAsJson=true by default", () => {
      const wrapper = mountComponent();
      const logData = { _timestamp: 1000, message: "test log" };
      wrapper.vm.copyLogToClipboard(logData);
      const emitted = wrapper.emitted("copy");
      expect(emitted).toBeTruthy();
      expect(emitted![0]).toEqual([logData, true]);
    });

    it("emits 'copy' event with copyAsJson=false when specified", () => {
      const wrapper = mountComponent();
      const logData = { _timestamp: 1000 };
      wrapper.vm.copyLogToClipboard(logData, false);
      const emitted = wrapper.emitted("copy");
      expect(emitted![0]).toEqual([logData, false]);
    });
  });

  // ── Emits via addSearchTerm ──────────────────────────────────────────────────
  describe("addSearchTerm", () => {
    it("emits 'addSearchTerm' with field, value, action", () => {
      const wrapper = mountComponent();
      wrapper.vm.addSearchTerm("status", "200", "include");
      const emitted = wrapper.emitted("addSearchTerm");
      expect(emitted).toBeTruthy();
      expect(emitted![0]).toEqual(["status", "200", "include"]);
    });

    it("emits 'addSearchTerm' with numeric value", () => {
      const wrapper = mountComponent();
      wrapper.vm.addSearchTerm("latency", 42, "exclude");
      expect(wrapper.emitted("addSearchTerm")![0]).toEqual(["latency", 42, "exclude"]);
    });
  });

  // ── Emits via addFieldToTable ─────────────────────────────────────────────────
  describe("addFieldToTable", () => {
    it("emits 'addFieldToTable' with field name", () => {
      const wrapper = mountComponent();
      wrapper.vm.addFieldToTable("kubernetes.pod");
      const emitted = wrapper.emitted("addFieldToTable");
      expect(emitted).toBeTruthy();
      expect(emitted![0]).toEqual(["kubernetes.pod"]);
    });
  });

  // ── Emits via closeColumn ─────────────────────────────────────────────────────
  describe("closeColumn", () => {
    it("emits 'closeColumn' with column data", () => {
      const wrapper = mountComponent();
      const colData = { id: "status", name: "Status" };
      wrapper.vm.closeColumn(colData);
      const emitted = wrapper.emitted("closeColumn");
      expect(emitted).toBeTruthy();
      expect(emitted![0]).toEqual([colData]);
    });
  });

  // ── handleDragStart ───────────────────────────────────────────────────────────
  describe("handleDragStart", () => {
    it("sets isResizingHeader=true when dragging timestamp column", () => {
      const wrapper = mountComponent();
      wrapper.vm.columnOrder = ["_timestamp", "status", "log"];
      wrapper.vm.handleDragStart({ oldIndex: 0 });
      expect(wrapper.vm.isResizingHeader).toBe(true);
    });

    it("sets isResizingHeader=false when dragging non-timestamp column", () => {
      const wrapper = mountComponent();
      wrapper.vm.columnOrder = ["_timestamp", "status", "log"];
      wrapper.vm.handleDragStart({ oldIndex: 1 });
      expect(wrapper.vm.isResizingHeader).toBe(false);
    });
  });

  // ── handleDragEnd ─────────────────────────────────────────────────────────────
  describe("handleDragEnd", () => {
    it("moves timestamp column back to front if it was reordered away", async () => {
      const wrapper = mountComponent();
      wrapper.vm.columnOrder = ["status", "log", "_timestamp"];
      await wrapper.vm.handleDragEnd();
      expect(wrapper.vm.columnOrder[0]).toBe("_timestamp");
    });

    it("does not modify order when timestamp is already first", async () => {
      const wrapper = mountComponent();
      wrapper.vm.columnOrder = ["_timestamp", "status", "log"];
      await wrapper.vm.handleDragEnd();
      expect(wrapper.vm.columnOrder[0]).toBe("_timestamp");
    });

    it("does nothing when timestamp column is not in order", async () => {
      const wrapper = mountComponent();
      wrapper.vm.columnOrder = ["status", "log"];
      const originalOrder = [...wrapper.vm.columnOrder];
      await wrapper.vm.handleDragEnd();
      expect(wrapper.vm.columnOrder).toEqual(originalOrder);
    });
  });

  // ── expandRow ────────────────────────────────────────────────────────────────
  describe("expandRow", () => {
    it("adds index to expandedRowIndices on expand", async () => {
      const rows = [
        { _timestamp: 1, log: "first" },
        { _timestamp: 2, log: "second" },
      ];
      const wrapper = mountComponent({ rows });
      await wrapper.vm.expandRow(0);
      expect(wrapper.vm.expandedRowIndices.has(0)).toBe(true);
    });

    it("removes index from expandedRowIndices on collapse", async () => {
      const rows = [
        { _timestamp: 1, log: "first" },
        { _timestamp: 2, log: "second" },
      ];
      const wrapper = mountComponent({ rows });
      // Expand first
      await wrapper.vm.expandRow(0);
      expect(wrapper.vm.expandedRowIndices.has(0)).toBe(true);
      // Collapse
      await wrapper.vm.expandRow(0);
      expect(wrapper.vm.expandedRowIndices.has(0)).toBe(false);
    });
  });

  // ── setSorting ────────────────────────────────────────────────────────────────
  describe("setSorting", () => {
    it("updates sorting state via updater function", () => {
      const wrapper = mountComponent();
      const newSorting = [{ id: "_timestamp", desc: true }];
      wrapper.vm.setSorting(() => newSorting);
      expect(wrapper.vm.sorting).toEqual(newSorting);
    });

    it("clears sorting when updater returns empty array", () => {
      const wrapper = mountComponent();
      wrapper.vm.setSorting(() => [{ id: "status", desc: false }]);
      wrapper.vm.setSorting(() => []);
      expect(wrapper.vm.sorting).toEqual([]);
    });
  });

  // ── selectedStreamFtsKeys computed ────────────────────────────────────────────
  describe("selectedStreamFtsKeys computed", () => {
    it("returns empty array when prop is not provided", () => {
      const wrapper = mountComponent();
      expect(wrapper.vm.selectedStreamFtsKeys).toEqual([]);
    });

    it("returns the prop value when provided", () => {
      const ftsKeys = [
        { name: "message", isSchemaField: true },
        { name: "log", isSchemaField: false },
      ];
      const wrapper = mountComponent({ selectedStreamFtsKeys: ftsKeys });
      expect(wrapper.vm.selectedStreamFtsKeys).toEqual(ftsKeys);
    });
  });

  // ── columnResizeMode ──────────────────────────────────────────────────────────
  describe("columnResizeMode", () => {
    it("is set to 'onChange'", () => {
      const wrapper = mountComponent();
      expect(wrapper.vm.columnResizeMode).toBe("onChange");
    });
  });

  // ── isFunctionErrorOpen ───────────────────────────────────────────────────────
  describe("isFunctionErrorOpen", () => {
    it("can be toggled", async () => {
      const wrapper = mountComponent();
      expect(wrapper.vm.isFunctionErrorOpen).toBe(false);
      wrapper.vm.isFunctionErrorOpen = true;
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.isFunctionErrorOpen).toBe(true);
    });
  });
});
