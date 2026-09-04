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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createStore } from "vuex";
import i18n from "@/locales";
import EnrichmentTableList from "./EnrichmentTableList.vue";

// ── Hoist mocks so they can be referenced in vi.mock factories ─────────────────

const {
  mockGetAllEnrichmentTableStatuses,
  mockGetStreams,
  mockResetStreamType,
  mockGetStream,
  mockPush,
  mockReplace,
} = vi.hoisted(() => ({
  mockGetAllEnrichmentTableStatuses: vi.fn().mockResolvedValue({ data: {} }),
  mockGetStreams: vi.fn().mockResolvedValue({ list: [] }),
  mockResetStreamType: vi.fn(),
  mockGetStream: vi.fn(),
  mockPush: vi.fn(),
  mockReplace: vi.fn(),
}));

// ── Service mocks ──────────────────────────────────────────────────────────────

vi.mock("@/services/jstransform", () => ({
  default: {
    get_all_enrichment_table_statuses: mockGetAllEnrichmentTableStatuses,
  },
}));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: mockGetStreams,
    resetStreamType: mockResetStreamType,
    getStream: mockGetStream,
  }),
}));

vi.mock("@/services/stream", () => ({
  default: { delete: vi.fn() },
}));

vi.mock("@/services/segment_analytics", () => ({ default: { track: vi.fn() } }));
vi.mock("@/services/reodotdev_analytics", () => ({ useReo: () => ({ track: vi.fn() }) }));
vi.mock("@/utils/zincutils", () => ({
  formatSizeFromMB: vi.fn((v) => v + " MB"),
  getImageURL: vi.fn((u) => u),
  verifyOrganizationStatus: vi.fn(),
}));

// ── Toast mock ─────────────────────────────────────────────────────────────────

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  useToast: () => ({
    toast: vi.fn(() => vi.fn()),
  }),
}));

// ── Router mock ────────────────────────────────────────────────────────────────

vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
    currentRoute: { value: { query: {}, name: "enrichmentTables" } },
  }),
  useRoute: () => ({ params: {}, query: {} }),
}));

// ── Component stubs ────────────────────────────────────────────────────────────

const globalStubs = {
  AddEnrichmentTable: { template: '<div data-test="add-enrichment-table-stub" />' },
  NoData: { template: '<div data-test="no-data-stub">No Data</div>' },
  ConfirmDialog: {
    template: '<div data-test="confirm-dialog-stub" />',
    props: ["modelValue"],
    emits: ["update:modelValue", "update:ok", "update:cancel"],
  },
  EnrichmentSchema: {
    template: '<div data-test="enrichment-schema-stub" />',
    props: ["open", "selectedEnrichmentTable"],
    emits: ["update:open"],
  },
  ODrawer: {
    template: '<div data-test="o-drawer-stub" :data-open="String(open)"><slot /></div>',
    props: ["open", "size"],
    emits: ["update:open"],
  },
};

// ── Factory helpers ────────────────────────────────────────────────────────────

const makeTable = (overrides: Record<string, any> = {}) => ({
  name: "test_table",
  doc_num: "100",
  storage_size: "1 MB",
  compressed_size: "0.5 MB",
  urlJobs: [],
  aggregateStatus: null,
  stream_type: "enrichment_tables",
  "#": "01",
  ...overrides,
});

// ── Store + mount helpers ──────────────────────────────────────────────────────

let store: any;

const makeStore = () =>
  createStore({
    state: {
      selectedOrganization: { identifier: "test-org" },
      userInfo: { email: "test@test.com" },
      organizations: [],
      theme: "light",
    },
    modules: {
      logs: {
        namespaced: true,
        actions: { setIsInitialized: vi.fn() },
      },
    },
  });

const mountComponent = () =>
  mount(EnrichmentTableList, {
    global: {
      plugins: [i18n, store],
      stubs: globalStubs,
    },
  });

// ── Test suite ─────────────────────────────────────────────────────────────────

describe("EnrichmentTableList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStreams.mockResolvedValue({ list: [] });
    mockGetAllEnrichmentTableStatuses.mockResolvedValue({ data: {} });
    store = makeStore();
  });

  // ── rendering ──────────────────────────────────────────────────────────────

  describe("rendering", () => {
    it("mounts without errors", async () => {
      const wrapper = mountComponent();

      await flushPromises();

      expect(wrapper.exists()).toBe(true);
    });

    it("renders [data-test='enrichment-tables-list-page']", async () => {
      const wrapper = mountComponent();

      await flushPromises();

      expect(wrapper.find('[data-test="enrichment-tables-list-page"]').exists()).toBe(true);
    });

    it("renders the section title in the standard OPageHeader", async () => {
      const wrapper = mountComponent();

      await flushPromises();

      // Title now lives in the standard OPageHeader (row 1).
      expect(wrapper.find(".app-page-header h1").exists()).toBe(true);
    });

    it("renders [data-test='enrichment-tables-search-input']", async () => {
      const wrapper = mountComponent();

      await flushPromises();

      expect(wrapper.find('[data-test="enrichment-tables-search-input"]').exists()).toBe(true);
    });

    it("renders [data-test='enrichment-tables-list-tabs']", async () => {
      const wrapper = mountComponent();

      await flushPromises();

      expect(wrapper.find('[data-test="enrichment-tables-list-tabs"]').exists()).toBe(true);
    });

    it("renders [data-test='enrichment-tables-list-table']", async () => {
      const wrapper = mountComponent();

      await flushPromises();

      expect(wrapper.find('[data-test="enrichment-tables-list-table"]').exists()).toBe(true);
    });
  });

  // ── data loading ───────────────────────────────────────────────────────────

  describe("data loading", () => {
    it("calls getStreams('enrichment_tables') on mount", async () => {
      mountComponent();

      await flushPromises();

      expect(mockGetStreams).toHaveBeenCalledWith("enrichment_tables", false, false, false);
    });

    it("calls get_all_enrichment_table_statuses on mount", async () => {
      mountComponent();

      await flushPromises();

      expect(mockGetAllEnrichmentTableStatuses).toHaveBeenCalledWith("test-org");
    });

    it("populates jsTransforms after successful load", async () => {
      mockGetStreams.mockResolvedValue({
        list: [
          {
            name: "my_table",
            stream_type: "enrichment_tables",
            stats: { doc_num: 50, storage_size: 1, compressed_size: 0.5 },
          },
        ],
      });

      const wrapper = mountComponent();
      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.jsTransforms.length).toBe(1);
      expect(vm.jsTransforms[0].name).toBe("my_table");
    });

    it("sets loading to false after load", async () => {
      const wrapper = mountComponent();

      await flushPromises();

      expect((wrapper.vm as any).loading).toBe(false);
    });

    it("handles API error gracefully (loading stays false)", async () => {
      mockGetStreams.mockRejectedValue(new Error("network error"));

      const wrapper = mountComponent();
      await flushPromises();

      expect((wrapper.vm as any).loading).toBe(false);
    });
  });

  // ── tab filtering ──────────────────────────────────────────────────────────

  describe("tab filtering", () => {
    const setupTables = (wrapper: any) => {
      const vm = wrapper.vm as any;
      vm.jsTransforms = [
        makeTable({ name: "uploaded_table", urlJobs: [] }),
        makeTable({
          name: "url_table",
          urlJobs: [{ id: "job1", status: "completed", url: "http://x.com" }],
        }),
      ];
    };

    it("visibleRows returns all rows when selectedFilter is 'all'", async () => {
      const wrapper = mountComponent();
      await flushPromises();

      setupTables(wrapper);
      const vm = wrapper.vm as any;
      vm.selectedFilter = "all";

      expect(vm.visibleRows.length).toBe(2);
    });

    it("visibleRows returns only file rows when filter is 'uploaded' (no urlJobs)", async () => {
      const wrapper = mountComponent();
      await flushPromises();

      setupTables(wrapper);
      const vm = wrapper.vm as any;
      vm.selectedFilter = "uploaded";

      expect(vm.visibleRows.length).toBe(1);
      expect(vm.visibleRows[0].name).toBe("uploaded_table");
    });

    it("visibleRows returns only url rows when filter is 'file_url' (has urlJobs)", async () => {
      const wrapper = mountComponent();
      await flushPromises();

      setupTables(wrapper);
      const vm = wrapper.vm as any;
      vm.selectedFilter = "file_url";

      expect(vm.visibleRows.length).toBe(1);
      expect(vm.visibleRows[0].name).toBe("url_table");
    });

    it("resultTotal updates when visibleRows changes", async () => {
      const wrapper = mountComponent();
      await flushPromises();

      setupTables(wrapper);
      const vm = wrapper.vm as any;
      vm.selectedFilter = "uploaded";

      // Allow computed + watcher to flush
      await flushPromises();

      expect(vm.resultTotal).toBe(1);
    });
  });

  // ── text search ────────────────────────────────────────────────────────────

  describe("text search", () => {
    const populateTables = (vm: any) => {
      vm.jsTransforms = [
        makeTable({ name: "alpha_table" }),
        makeTable({ name: "beta_table" }),
        makeTable({ name: "gamma_table" }),
      ];
    };

    it("visibleRows returns all rows when filterQuery is empty", async () => {
      const wrapper = mountComponent();
      await flushPromises();

      populateTables(wrapper.vm as any);
      const vm = wrapper.vm as any;
      vm.filterQuery = "";

      expect(vm.visibleRows.length).toBe(3);
    });

    it("visibleRows filters rows by name", async () => {
      const wrapper = mountComponent();
      await flushPromises();

      populateTables(wrapper.vm as any);
      const vm = wrapper.vm as any;
      vm.filterQuery = "alpha";

      expect(vm.visibleRows.length).toBe(1);
      expect(vm.visibleRows[0].name).toBe("alpha_table");
    });

    it("filterData is case-insensitive", async () => {
      const wrapper = mountComponent();
      await flushPromises();

      const vm = wrapper.vm as any;
      const rows = [makeTable({ name: "MyTable" }), makeTable({ name: "other" })];
      const result = vm.filterData(rows, "MYTABLE");

      expect(result.length).toBe(1);
      expect(result[0].name).toBe("MyTable");
    });

    it("filterData returns empty array when no match", async () => {
      const wrapper = mountComponent();
      await flushPromises();

      const vm = wrapper.vm as any;
      const rows = [makeTable({ name: "abc" }), makeTable({ name: "xyz" })];
      const result = vm.filterData(rows, "zzz_no_match");

      expect(result).toHaveLength(0);
    });
  });

  // ── add/update form ────────────────────────────────────────────────────────

  describe("add/update form", () => {
    it("clicking add button calls showAddUpdateFn and sets showAddJSTransformDialog to true", async () => {
      const wrapper = mountComponent();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.showAddUpdateFn({});

      expect(vm.showAddJSTransformDialog).toBe(true);
    });

    it("showAddUpdateFn(null) sets isUpdated to false (new)", async () => {
      const wrapper = mountComponent();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.showAddUpdateFn(null);

      expect(vm.isUpdated).toBe(false);
    });

    it("showAddUpdateFn({ name: 'x', ... }) sets isUpdated to true (update)", async () => {
      const wrapper = mountComponent();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.showAddUpdateFn(makeTable({ name: "existing_table" }));

      expect(vm.isUpdated).toBe(true);
    });
  });

  // ── delete dialog ──────────────────────────────────────────────────────────

  describe("delete dialog", () => {
    it("showDeleteDialogFn(row) sets selectedDelete and confirmDelete", async () => {
      const wrapper = mountComponent();
      await flushPromises();

      const vm = wrapper.vm as any;
      const row = makeTable({ name: "to_delete" });

      vm.showDeleteDialogFn(row);

      expect(vm.selectedDelete).toEqual(row);
      expect(vm.confirmDelete).toBe(true);
    });

    it("confirmDelete is false initially", async () => {
      const wrapper = mountComponent();
      await flushPromises();

      expect((wrapper.vm as any).confirmDelete).toBe(false);
    });
  });

  // ── URL jobs drawer ────────────────────────────────────────────────────────

  describe("URL jobs drawer", () => {
    it("showUrlJobsDialog(row) sets showUrlJobsDialogState to true and selectedTableForUrlJobs", async () => {
      const wrapper = mountComponent();
      await flushPromises();

      const vm = wrapper.vm as any;
      const row = makeTable({
        name: "url_table",
        urlJobs: [{ id: "j1", status: "completed", url: "http://example.com" }],
      });

      vm.showUrlJobsDialog(row);

      expect(vm.showUrlJobsDialogState).toBe(true);
      expect(vm.selectedTableForUrlJobs).toEqual(row);
    });
  });

  // ── bulk delete ────────────────────────────────────────────────────────────

  describe("bulk delete", () => {
    it("openBulkDeleteDialog() sets confirmBulkDelete to true", async () => {
      const wrapper = mountComponent();
      await flushPromises();

      const vm = wrapper.vm as any;

      vm.openBulkDeleteDialog();

      expect(vm.confirmBulkDelete).toBe(true);
    });

    it("selectedEnrichmentTableIds computed returns array of names from selectedEnrichmentTables", async () => {
      const wrapper = mountComponent();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.selectedEnrichmentTables = [
        makeTable({ name: "table_a" }),
        makeTable({ name: "table_b" }),
      ];

      expect(vm.selectedEnrichmentTableIds).toEqual(["table_a", "table_b"]);
    });
  });

  // ── navigation ─────────────────────────────────────────────────────────────

  describe("navigation", () => {
    it("hideForm sets showAddJSTransformDialog to false", async () => {
      const wrapper = mountComponent();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.showAddJSTransformDialog = true;

      vm.hideForm();

      expect(vm.showAddJSTransformDialog).toBe(false);
    });

    it("refreshList sets showAddJSTransformDialog to false and calls getLookupTables", async () => {
      const wrapper = mountComponent();
      await flushPromises();

      const vm = wrapper.vm as any;
      vm.showAddJSTransformDialog = true;

      // Reset call counts from mount
      mockGetStreams.mockClear();

      vm.refreshList();
      await flushPromises();

      expect(vm.showAddJSTransformDialog).toBe(false);
      expect(mockGetStreams).toHaveBeenCalled();
    });
  });
});
