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

import {
  describe,
  expect,
  it,
  beforeEach,
  vi,
  afterEach,
  type Mock,
} from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import LogStream from "@/views/LogStream.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import streamService from "@/services/stream";
import useStreams from "@/composables/useStreams";
import { vueQueryTestPlugin } from "@/test/unit/helpers/withVueQuery";
import mockStreams from "@/test/unit/mockData/streams";

// ── Module mocks (hoisted) ──────────────────────────────────────────────
// `LogStream.vue` imports the default export for delete(); `useStreamsListQuery`
// imports the same default export's nameList(). Both resolve to this mock.
vi.mock("@/services/stream", () => ({
  default: {
    nameList: vi.fn(),
    schema: vi.fn(),
    delete: vi.fn(),
    createStream: vi.fn(),
    updateSettings: vi.fn(),
  },
}));

vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    isValidResourceName: (name: string) => /^[a-zA-Z0-9+=,.@_-]+$/.test(name),
    getUUID: () => "test-uuid",
    mergeRoutes: (route1: any, route2: any) => [
      ...(route1 || []),
      ...(route2 || []),
    ],
    getTimezoneOffset: () => 0,
    getTimezonesByOffset: () => [],
  };
});

vi.mock("@/composables/useStreams", () => ({
  default: vi.fn(() => ({
    removeStream: vi.fn(),
    getStream: vi.fn(),
    addNewStreams: vi.fn(),
  })),
}));

vi.mock("@/services/segment_analytics", () => ({
  default: { track: vi.fn() },
}));

vi.mock("@/composables/useLogs", () => ({
  default: vi.fn(() => ({
    searchObj: {
      value: { loading: false, data: { queryResults: [], aggs: { histogram: [] } } },
    },
    searchAggData: { value: { histogram: [], total: 0 } },
    searchResultData: { value: { list: [] } },
    getFunctions: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock("@/composables/useDashboard", () => ({
  default: vi.fn(() => ({
    dashboards: { value: [] },
    loading: { value: false },
    error: { value: null },
  })),
}));

vi.mock("@/services/auth", () => ({
  default: { sign_in_user: vi.fn(), sign_out: vi.fn(), get_dex_config: vi.fn() },
}));

vi.mock("@/services/organizations", () => ({
  default: { get_organization: vi.fn(), list: vi.fn(), add_members: vi.fn() },
}));

vi.mock("@/services/billings", () => ({
  default: { get_billing_info: vi.fn(), get_invoice_history: vi.fn() },
}));

// Toast (replaces quasar notify) — returns a dismiss fn for loading toasts.
const mockNotify = vi.fn(() => vi.fn());
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: any[]) => mockNotify(...args),
}));

// ── ODialog stub — preserves v-model:open and emits primary/secondary ─────
const ODialogStub = {
  name: "ODialog",
  props: [
    "open",
    "modelValue",
    "size",
    "title",
    "subTitle",
    "showClose",
    "width",
    "persistent",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "neutralButtonLabel",
    "primaryButtonVariant",
    "secondaryButtonVariant",
    "neutralButtonVariant",
    "primaryButtonDisabled",
    "secondaryButtonDisabled",
    "neutralButtonDisabled",
    "primaryButtonLoading",
    "secondaryButtonLoading",
    "neutralButtonLoading",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div data-test="o-dialog-stub" v-if="open">
      <div data-test="o-dialog-title">{{ title }}</div>
      <slot />
      <button data-test="o-dialog-primary" @click="$emit('click:primary')">{{ primaryButtonLabel }}</button>
      <button data-test="o-dialog-secondary" @click="$emit('click:secondary')">{{ secondaryButtonLabel }}</button>
    </div>
  `,
};

const defaultStubs = {
  QTablePagination: true,
  SchemaIndex: true,
  NoData: true,
  AddStream: true,
  AppTabs: true,
  ODialog: ODialogStub,
};

// Typed handles to the mocked modules.
const nameListMock = streamService.nameList as unknown as Mock;
const deleteMock = streamService.delete as unknown as Mock;
const useStreamsMock = useStreams as unknown as Mock;

// A default useStreams instance shared across tests. removeStream/getStream/
// addNewStreams are the only members the component destructures.
let removeStreamMock: Mock;
let getStreamMock: Mock;
let addNewStreamsMock: Mock;

// Standard successful nameList response driven by the shared fixture.
const successList = mockStreams.streams_name_list.list;
const successTotal = mockStreams.streams_name_list.total;

function resolveNameListWith(list: any[], total: number) {
  nameListMock.mockResolvedValue({ data: { list, total } });
}

// Mount with a FRESH Vue Query client per call so the cache never leaks
// between tests. Returns both the wrapper and its queryClient.
function mountLogStream() {
  const { queryClient, plugins } = vueQueryTestPlugin();
  const wrapper = mount(LogStream, {
    global: {
      provide: { store },
      plugins: [i18n, router, ...plugins],
      stubs: defaultStubs,
    },
  }) as VueWrapper;
  return { wrapper, queryClient };
}

describe("LogStream Component", () => {
  let wrapper: VueWrapper;

  beforeEach(async () => {
    vi.clearAllMocks();

    removeStreamMock = vi.fn();
    getStreamMock = vi.fn().mockResolvedValue({
      stats: { doc_time_min: 1000000, doc_time_max: 2000000 },
    });
    addNewStreamsMock = vi.fn();

    useStreamsMock.mockReturnValue({
      removeStream: removeStreamMock,
      getStream: getStreamMock,
      addNewStreams: addNewStreamsMock,
    });

    resolveNameListWith(successList, successTotal);
    deleteMock.mockResolvedValue({ data: { code: 200 } });

    ({ wrapper } = mountLogStream());
    await flushPromises();
    await nextTick();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("Component Mounting", () => {
    it("should mount successfully", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should display the streams title", () => {
      const title = wrapper.find('[data-test="log-stream-title-text"]');
      expect(title.exists()).toBe(true);
      expect(title.text()).toBe("Streams");
    });

    it("should render the main table", () => {
      expect(wrapper.find('[data-test="log-stream-table"]').exists()).toBe(true);
    });

    it("should display the refresh stats button", () => {
      const refreshBtn = wrapper.find(
        '[data-test="log-stream-refresh-stats-btn"]',
      );
      expect(refreshBtn.exists()).toBe(true);
      expect(refreshBtn.text()).toContain("Refresh Stats");
    });
  });

  describe("Query-backed data loading", () => {
    it("should call nameList with the initial query params on mount", () => {
      expect(nameListMock).toHaveBeenCalledWith(
        "default",
        "logs",
        false,
        0,
        20,
        "",
        "name",
        true,
      );
    });

    it("should map the fetched streams into table rows", () => {
      expect(wrapper.vm.logStream).toHaveLength(3);
      expect(wrapper.vm.logStream[0].name).toBe("stream_one");
      expect(wrapper.vm.logStream[0]._rowKey).toBe("stream_one-logs");
      expect(wrapper.vm.logStream[0].doc_num).toBe(100);
      expect(wrapper.vm.logStream[0].storage_size).toBe("50 MB");
    });

    it("should pass the mapped rows into the OTable data prop", () => {
      const table = wrapper.findComponent('[data-test="log-stream-table"]');
      expect(table.exists()).toBe(true);
      const rows = table.props("data") as any[];
      expect(rows.map((r) => r.name)).toEqual([
        "stream_one",
        "stream_two",
        "stream_three",
      ]);
    });

    it("should fall back to '--' when a stream has no stats", () => {
      const noStatsRow = wrapper.vm.logStream[2];
      expect(noStatsRow.name).toBe("stream_three");
      expect(noStatsRow.doc_num).toBe("--");
      expect(noStatsRow.storage_size).toBe("--");
    });

    it("should expose totalCount and resultTotal from the query data", () => {
      expect(wrapper.vm.totalCount).toBe(3);
      expect(wrapper.vm.resultTotal).toBe(3);
    });

    it("should not be loading after the query resolves", () => {
      expect(wrapper.vm.isLoading).toBe(false);
      expect(wrapper.vm.isFetching).toBe(false);
    });

    it("should seed the shared Vuex cache via addNewStreams", () => {
      expect(addNewStreamsMock).toHaveBeenCalledWith("logs", successList);
    });
  });

  describe("Initial state", () => {
    it("should start on page 1 with default page size and sort", () => {
      expect(wrapper.vm.currentPage).toBe(1);
      expect(wrapper.vm.pageSize).toBe(20);
      expect(wrapper.vm.sortBy).toBe("name");
      expect(wrapper.vm.sortOrder).toBe("asc");
    });

    it("should default to the logs stream type with an empty filter", () => {
      expect(wrapper.vm.selectedStreamType).toBe("logs");
      expect(wrapper.vm.filterQuery).toBe("");
      expect(wrapper.vm.selectedIds).toEqual([]);
    });
  });

  describe("Computed: isSchemaUDSEnabled", () => {
    afterEach(() => {
      store.state.zoConfig.user_defined_schemas_enabled = false;
    });

    it("should be true when user_defined_schemas_enabled is true", async () => {
      store.state.zoConfig.user_defined_schemas_enabled = true;
      await nextTick();
      expect(wrapper.vm.isSchemaUDSEnabled).toBe(true);
    });

    it("should be false when user_defined_schemas_enabled is false", async () => {
      store.state.zoConfig.user_defined_schemas_enabled = false;
      await nextTick();
      expect(wrapper.vm.isSchemaUDSEnabled).toBe(false);
    });
  });

  describe("Refresh", () => {
    it("should refetch the streams list when the refresh button is clicked", async () => {
      nameListMock.mockClear();

      await wrapper
        .find('[data-test="log-stream-refresh-stats-btn"]')
        .trigger("click");
      await flushPromises();

      expect(nameListMock).toHaveBeenCalledTimes(1);
    });

    it("should refetch when getLogStream() is called directly", async () => {
      nameListMock.mockClear();

      wrapper.vm.getLogStream();
      await flushPromises();

      expect(nameListMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("Query key reactivity", () => {
    it("should refetch with a new limit when pageSize changes", async () => {
      nameListMock.mockClear();

      wrapper.vm.onPaginationChange({ page: 1, size: 50 });
      await flushPromises();

      expect(wrapper.vm.pageSize).toBe(50);
      expect(nameListMock).toHaveBeenLastCalledWith(
        "default",
        "logs",
        false,
        0,
        50,
        "",
        "name",
        true,
      );
    });

    it("should refetch with a new offset when the page changes", async () => {
      nameListMock.mockClear();

      wrapper.vm.onPaginationChange({ page: 2, size: 20 });
      await flushPromises();

      expect(wrapper.vm.currentPage).toBe(2);
      expect(nameListMock).toHaveBeenLastCalledWith(
        "default",
        "logs",
        false,
        20,
        20,
        "",
        "name",
        true,
      );
    });

    it("should refetch with the new sort column and order on sort change", async () => {
      nameListMock.mockClear();

      wrapper.vm.onSortChange({ column: "doc_num", order: "desc" });
      await flushPromises();

      expect(wrapper.vm.sortBy).toBe("doc_num");
      expect(wrapper.vm.sortOrder).toBe("desc");
      expect(nameListMock).toHaveBeenLastCalledWith(
        "default",
        "logs",
        false,
        0,
        20,
        "",
        "doc_num",
        false,
      );
    });

    it("should refetch with the selected stream type when the tab changes", async () => {
      nameListMock.mockClear();

      wrapper.vm.filterLogStreamByTab("metrics");
      await flushPromises();

      expect(wrapper.vm.selectedStreamType).toBe("metrics");
      expect(nameListMock).toHaveBeenLastCalledWith(
        "default",
        "metrics",
        false,
        0,
        20,
        "",
        "name",
        true,
      );
    });

    it("should refetch with the keyword when the filter query changes", async () => {
      nameListMock.mockClear();

      wrapper.vm.filterQuery = "err";
      await flushPromises();

      expect(nameListMock).toHaveBeenLastCalledWith(
        "default",
        "logs",
        false,
        0,
        20,
        "err",
        "name",
        true,
      );
    });

    it("should reset to page 1 when the filter query changes", async () => {
      wrapper.vm.onPaginationChange({ page: 3, size: 20 });
      await flushPromises();
      expect(wrapper.vm.currentPage).toBe(3);

      wrapper.vm.filterQuery = "search";
      await flushPromises();

      expect(wrapper.vm.currentPage).toBe(1);
    });
  });

  describe("Fetch errors", () => {
    // These tests need a wrapper mounted with a failing/empty query, so they
    // manage their own wrapper lifecycle inside the test with try/finally to
    // guarantee unmount even on assertion failure.
    it("should show an error toast when the query fails", async () => {
      nameListMock.mockRejectedValue({
        response: { status: 500, data: { message: "Server Error" } },
      });
      const { wrapper: errorWrapper } = mountLogStream();
      try {
        await flushPromises();
        await nextTick();

        expect(mockNotify).toHaveBeenCalledWith(
          expect.objectContaining({
            variant: "error",
            message: "Server Error",
          }),
        );
        expect(errorWrapper.vm.logStream).toHaveLength(0);
      } finally {
        errorWrapper.unmount();
      }
    });

    it("should NOT show an error toast for 403 responses", async () => {
      nameListMock.mockRejectedValue({ response: { status: 403 } });
      const { wrapper: forbiddenWrapper } = mountLogStream();
      try {
        await flushPromises();
        await nextTick();

        const errorToasts = mockNotify.mock.calls.filter(
          (call: any) => call[0]?.variant === "error",
        );
        expect(errorToasts.length).toBe(0);
      } finally {
        forbiddenWrapper.unmount();
      }
    });

    it("should render an empty table when the list is empty", async () => {
      resolveNameListWith([], 0);
      const { wrapper: emptyWrapper } = mountLogStream();
      try {
        await flushPromises();
        await nextTick();

        expect(emptyWrapper.vm.logStream).toHaveLength(0);
        expect(emptyWrapper.vm.totalCount).toBe(0);
      } finally {
        emptyWrapper.unmount();
      }
    });
  });

  describe("Schema dialog", () => {
    it("should open the schema dialog with the row's schema data", async () => {
      wrapper.vm.listSchema({
        row: { name: "stream_one", schema: [], stream_type: "logs" },
      });
      await nextTick();

      expect(wrapper.vm.schemaData.name).toBe("stream_one");
      expect(wrapper.vm.schemaData.stream_type).toBe("logs");
      expect(wrapper.vm.showIndexSchemaDialog).toBe(true);
    });
  });

  describe("Explore stream", () => {
    it("should navigate to logs with the stream context", async () => {
      const routerPushSpy = vi.spyOn(router, "push");

      await wrapper.vm.exploreStream({
        row: { name: "stream_one", stream_type: "logs" },
      });

      expect(routerPushSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "logs",
          query: expect.objectContaining({
            stream_type: "logs",
            stream: "stream_one",
            org_identifier: "default",
          }),
        }),
      );
      routerPushSpy.mockRestore();
    });

    it("should fetch the stream time range for enrichment tables", async () => {
      getStreamMock.mockResolvedValueOnce({
        stats: { doc_time_min: 1_000_000_000, doc_time_max: 2_000_000_000 },
      });

      await wrapper.vm.exploreStream({
        row: { name: "lookup", stream_type: "enrichment_tables" },
      });

      expect(getStreamMock).toHaveBeenCalledWith(
        "lookup",
        "enrichment_tables",
        true,
      );
    });
  });

  describe("ODialog — Confirm Delete (single)", () => {
    beforeEach(async () => {
      wrapper.vm.confirmDeleteAction({
        row: { name: "stream_one", stream_type: "logs" },
      });
      await nextTick();
    });

    it("should open the confirm-delete dialog with a destructive primary", () => {
      expect(wrapper.vm.confirmDelete).toBe(true);
      const openDialog = wrapper
        .findAllComponents({ name: "ODialog" })
        .find((d) => d.props("open") === true);
      expect(openDialog).toBeTruthy();
      expect(openDialog!.props("title")).toBe("Delete Stream");
      expect(openDialog!.props("primaryButtonVariant")).toBe("destructive");
    });

    it("should close the dialog and not delete when cancel is emitted", async () => {
      const dialog = wrapper
        .findAllComponents({ name: "ODialog" })
        .find((d) => d.props("open") === true)!;

      await dialog.vm.$emit("click:secondary");
      await flushPromises();

      expect(wrapper.vm.confirmDelete).toBe(false);
      expect(deleteMock).not.toHaveBeenCalled();
    });

    it("should call streamService.delete and remove the stream on confirm", async () => {
      const dialog = wrapper
        .findAllComponents({ name: "ODialog" })
        .find((d) => d.props("open") === true)!;

      await dialog.vm.$emit("click:primary");
      await flushPromises();

      expect(deleteMock).toHaveBeenCalledWith(
        "default",
        "stream_one",
        "logs",
        true,
      );
      expect(removeStreamMock).toHaveBeenCalledWith("stream_one", "logs");
      expect(wrapper.vm.confirmDelete).toBe(false);
    });

    it("should invalidate the streams cache and refetch after a successful delete", async () => {
      nameListMock.mockClear();
      const dialog = wrapper
        .findAllComponents({ name: "ODialog" })
        .find((d) => d.props("open") === true)!;

      await dialog.vm.$emit("click:primary");
      await flushPromises();

      // invalidateQueries on the active list key triggers a refetch.
      expect(nameListMock).toHaveBeenCalledTimes(1);
    });

    it("should show an error toast when delete fails (non-403)", async () => {
      deleteMock.mockRejectedValueOnce({
        response: { status: 500, data: { message: "Delete failed" } },
      });
      mockNotify.mockClear();

      const dialog = wrapper
        .findAllComponents({ name: "ODialog" })
        .find((d) => d.props("open") === true)!;

      await dialog.vm.$emit("click:primary");
      await flushPromises();

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "error" }),
      );
    });

    it("should propagate v-model:open updates to confirmDelete", async () => {
      const dialog = wrapper
        .findAllComponents({ name: "ODialog" })
        .find((d) => d.props("open") === true)!;

      await dialog.vm.$emit("update:open", false);
      await nextTick();

      expect(wrapper.vm.confirmDelete).toBe(false);
    });
  });

  describe("ODialog — Confirm Batch Delete", () => {
    beforeEach(async () => {
      // Rows come from the query; select the first two by their _rowKey.
      wrapper.vm.selectedIds = ["stream_one-logs", "stream_two-logs"];
      wrapper.vm.confirmBatchDeleteAction();
      await nextTick();
    });

    it("should open the batch-delete dialog with a destructive primary", () => {
      expect(wrapper.vm.confirmBatchDelete).toBe(true);
      const dialog = wrapper
        .findAllComponents({ name: "ODialog" })
        .find((d) => d.props("open") === true)!;
      expect(dialog).toBeTruthy();
      expect(dialog.props("title")).toBe("Delete Streams");
      expect(dialog.props("primaryButtonVariant")).toBe("destructive");
    });

    it("should close without deleting when cancel is emitted", async () => {
      const dialog = wrapper
        .findAllComponents({ name: "ODialog" })
        .find((d) => d.props("open") === true)!;

      await dialog.vm.$emit("click:secondary");
      await flushPromises();

      expect(wrapper.vm.confirmBatchDelete).toBe(false);
      expect(deleteMock).not.toHaveBeenCalled();
    });

    it("should delete every selected stream on confirm", async () => {
      const dialog = wrapper
        .findAllComponents({ name: "ODialog" })
        .find((d) => d.props("open") === true)!;

      await dialog.vm.$emit("click:primary");
      await flushPromises();

      expect(deleteMock).toHaveBeenCalledTimes(2);
      expect(deleteMock).toHaveBeenCalledWith(
        "default",
        "stream_one",
        "logs",
        true,
      );
      expect(deleteMock).toHaveBeenCalledWith(
        "default",
        "stream_two",
        "logs",
        true,
      );
      expect(wrapper.vm.confirmBatchDelete).toBe(false);
    });

    it("should clear the selection after a successful batch delete", async () => {
      const dialog = wrapper
        .findAllComponents({ name: "ODialog" })
        .find((d) => d.props("open") === true)!;

      await dialog.vm.$emit("click:primary");
      await flushPromises();

      expect(wrapper.vm.selectedIds).toEqual([]);
    });

    it("should show an error toast when a batch delete rejects (non-403)", async () => {
      deleteMock.mockRejectedValue({
        response: { status: 500, data: { message: "Batch failed" } },
      });
      mockNotify.mockClear();

      const dialog = wrapper
        .findAllComponents({ name: "ODialog" })
        .find((d) => d.props("open") === true)!;

      await dialog.vm.$emit("click:primary");
      await flushPromises();

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "error" }),
      );
    });

    it("should propagate v-model:open updates to confirmBatchDelete", async () => {
      const dialog = wrapper
        .findAllComponents({ name: "ODialog" })
        .find((d) => d.props("open") === true)!;

      await dialog.vm.$emit("update:open", false);
      await nextTick();

      expect(wrapper.vm.confirmBatchDelete).toBe(false);
    });
  });

  describe("Selection", () => {
    it("should track selected row keys via selectedIds", async () => {
      wrapper.vm.selectedIds = ["stream_one-logs"];
      await nextTick();

      expect(wrapper.vm.selectedIds).toEqual(["stream_one-logs"]);
      expect(wrapper.vm.selectedItems).toHaveLength(1);
      expect(wrapper.vm.selectedItems[0].name).toBe("stream_one");
    });

    it("should resolve selectedItems from selected _rowKeys", async () => {
      wrapper.vm.selectedIds = ["stream_one-logs", "stream_two-logs"];
      await nextTick();

      expect(wrapper.vm.selectedItems.map((s: any) => s.name)).toEqual([
        "stream_one",
        "stream_two",
      ]);
    });
  });

  describe("Add stream dialog", () => {
    it("should open the add-stream dialog when addStream is called", async () => {
      wrapper.vm.addStream();
      await nextTick();
      expect(wrapper.vm.addStreamDialog.show).toBe(true);
    });
  });

  describe("Search filter", () => {
    it("should update filterQuery reactively", async () => {
      wrapper.vm.filterQuery = "test search";
      await nextTick();
      expect(wrapper.vm.filterQuery).toBe("test search");
    });
  });

  describe("Internationalization", () => {
    it("should expose a working translation function", () => {
      expect(typeof wrapper.vm.t).toBe("function");
      expect(wrapper.vm.t("logStream.header")).toBe("Streams");
    });
  });
});
