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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import LogStream from "@/views/LogStream.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import streamService from "@/services/stream";
import useStreams from "@/composables/useStreams";
import analytics from "@/services/product_analytics";
import { resetListViewState, useListViewState } from "@/composables/useListViewState";

// Mock services
vi.mock("@/services/stream", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      list: vi.fn(),
      nameList: vi.fn(),
      delete: vi.fn(),
      get: vi.fn(),
    },
  });
});

vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    isValidResourceName: (name) => {
      const regex = /^[a-zA-Z0-9+=,.@_-]+$/;
      return regex.test(name);
    },
    getUUID: () => "test-uuid",
    mergeRoutes: (route1, route2) => {
      return [...(route1 || []), ...(route2 || [])];
    },
    getTimezoneOffset: () => 0,
    getTimezonesByOffset: () => [],
  };
});

vi.mock("@/composables/useStreams", () => ({
  default: vi.fn(() => ({
    removeStream: vi.fn(),
    getStream: vi.fn(),
    getPaginatedStreams: vi.fn(),
    addNewStreams: vi.fn(),
  })),
}));

vi.mock("@/services/product_analytics", () => ({
  default: {
    track: vi.fn(),
  },
}));

// Additional composable mocks to prevent inject() warnings
vi.mock("@/composables/useLogs", () => ({
  default: vi.fn(() => ({
    searchObj: { value: { loading: false, data: { queryResults: [], aggs: { histogram: [] } } } },
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
  default: {
    sign_in_user: vi.fn(),
    sign_out: vi.fn(),
    get_dex_config: vi.fn(),
  },
}));

vi.mock("@/services/organizations", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      get_organization: vi.fn(),
      list: vi.fn(),
      add_members: vi.fn(),
      // Feeds the summary strip above the table.
      get_organization_summary: vi.fn().mockResolvedValue({
        data: {
          streams: {
            num_streams: 3,
            total_records: 1500,
            total_storage_size: 120,
            total_index_size: 20,
          },
        },
      }),
    },
  });
});

vi.mock("@/services/billings", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      get_billing_info: vi.fn(),
      get_invoice_history: vi.fn(),
    },
  });
});

// Mock Toast
const mockNotify = vi.fn(() => vi.fn()); // Return a function for dismiss
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: any[]) => mockNotify(...args),
}));

// ODialog stub — preserves v-model:open behavior and emits primary/secondary/neutral
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
  Pagination: true,
  SchemaIndex: true,
  NoData: true,
  AddStream: true,
  AppTabs: true,
  ODialog: ODialogStub,
};

function mountLogStream() {
  return mount(LogStream, {
    global: {
      provide: { store: store },
      plugins: [i18n, router],
      stubs: defaultStubs,
    },
  });
}

describe("LogStream Component", () => {
  let wrapper: any;
  let mockUseStreams: any;
  let mockStreamService: any;

  beforeEach(async () => {
    // Reset mocks completely
    vi.clearAllMocks();
    mockNotify.mockClear();
    resetListViewState();

    // Setup mock implementations with fresh instances
    mockUseStreams = {
      removeStream: vi.fn(),
      getStream: vi.fn(),
      getPaginatedStreams: vi.fn().mockResolvedValue({
        list: [
          {
            name: "test_stream",
            stream_type: "logs",
            stats: {
              doc_num: 100,
              storage_size: 50,
              compressed_size: 25,
              index_size: 10,
            },
            schema: [],
            storage_type: "local",
          },
        ],
        total: 1,
      }),
      addNewStreams: vi.fn(),
    };

    mockStreamService = {
      list: vi.fn().mockResolvedValue({
        data: {
          list: [],
        },
      }),
      nameList: vi.fn().mockResolvedValue({
        data: {
          list: [
            {
              name: "test_stream",
              stream_type: "logs",
              stats: {
                doc_num: 100,
                storage_size: 50,
                compressed_size: 25,
                index_size: 10,
              },
              schema: [],
              storage_type: "local",
            },
          ],
          total: 1,
        },
      }),

      delete: vi.fn().mockResolvedValue({
        data: { code: 200 },
      }),
      get: vi.fn().mockResolvedValue({
        stats: {
          doc_time_min: 1000000,
          doc_time_max: 2000000,
        },
      }),
    };

    (useStreams as any).mockReturnValue(mockUseStreams);
    Object.assign(streamService, mockStreamService);

    wrapper = mountLogStream();

    // Wait for component to settle
    await wrapper.vm.$nextTick();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("View state restore", () => {
    it("restores saved filter, type, page and sort on mount", async () => {
      resetListViewState();
      useListViewState("logStreams", {
        filterQuery: "abc",
        streamType: "metrics",
        pageSize: 50,
        currentPage: 3,
        sortBy: "doc_num",
        sortOrder: "desc",
      });
      const restored = mountLogStream();
      await flushPromises();
      expect(restored.vm.filterQuery).toBe("abc");
      expect(restored.vm.selectedStreamType).toBe("metrics");
      expect(restored.vm.streamActiveTab).toBe("metrics");
      expect(restored.vm.pageSize).toBe(50);
      expect(restored.vm.currentPage).toBe(3);
      expect(restored.vm.sortBy).toBe("doc_num");
      expect(restored.vm.sortOrder).toBe("desc");
      restored.unmount();
    });

    it("saves changes to the view state", async () => {
      wrapper.vm.pageSize = 100;
      wrapper.vm.sortOrder = "desc";
      await flushPromises();
      const saved: any = useListViewState("logStreams", {});
      expect(saved.pageSize).toBe(100);
      expect(saved.sortOrder).toBe("desc");
    });
  });

  describe("API Interactions", () => {
    it("should request the first stream page on component mount", async () => {
      await flushPromises();
      expect(mockStreamService.nameList).toHaveBeenCalledWith(
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

    it("should handle API errors gracefully", async () => {
      mockNotify.mockClear();

      mockStreamService.nameList.mockRejectedValue(new Error("API Error"));

      // Trigger refresh
      await wrapper.vm.getLogStream(true);
      await flushPromises();

      // Error notification should use variant "error"
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
        }),
      );
    });
  });

  describe("User Interactions", () => {
    it("should handle refresh button click", async () => {
      const refreshBtn = wrapper.find('[data-test="log-stream-refresh-stats-btn"]');

      await refreshBtn.trigger("click");
      await flushPromises();

      expect(mockStreamService.nameList).toHaveBeenCalled();
    });
  });

  describe("Stream Management", () => {
    beforeEach(() => {
      wrapper.vm.logStream = [
        {
          "#": "01",
          name: "test_stream",
          stream_type: "logs",
          doc_num: 100,
          storage_size: "50 MB",
          compressed_size: "25 MB",
          index_size: "10 MB",
          storage_type: "local",
          actions: "action buttons",
          schema: [],
          _rowKey: "test_stream-logs",
        },
      ];
    });

    it("should handle batch deletion via selectedIds", async () => {
      // Component uses selectedIds (array of _rowKey strings)
      wrapper.vm.selectedIds = ["stream1-logs", "stream2-metrics"];
      wrapper.vm.logStream = [
        { name: "stream1", stream_type: "logs", _rowKey: "stream1-logs" },
        { name: "stream2", stream_type: "metrics", _rowKey: "stream2-metrics" },
      ];

      await wrapper.vm.deleteBatchStream();
      await flushPromises();

      expect(mockStreamService.delete).toHaveBeenCalledTimes(2);
    });

    it("should handle explore stream action", async () => {
      const props = {
        row: {
          name: "test_stream",
          stream_type: "logs",
        },
      };

      const routerPushSpy = vi.spyOn(router, "push");

      await wrapper.vm.exploreStream(props);

      expect(routerPushSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "logs",
          query: expect.objectContaining({
            stream_type: "logs",
            stream: "test_stream",
            org_identifier: "default",
          }),
        }),
      );
    });
  });

  describe("explore a profiles stream", () => {
    it("opens the Logs search on that stream, like metrics and traces", async () => {
      const routerPushSpy = vi.spyOn(router, "push");

      await wrapper.vm.exploreStream({ row: { name: "prof_stream", stream_type: "profiles" } });

      expect(routerPushSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "logs",
          query: expect.objectContaining({
            stream_type: "profiles",
            stream: "prof_stream",
            org_identifier: "default",
          }),
        }),
      );
    });
  });

  describe("ODialog — Confirm Delete (single)", () => {
    beforeEach(async () => {
      await wrapper.vm.confirmDeleteAction({
        row: { name: "test_stream", stream_type: "logs" },
      });
      await wrapper.vm.$nextTick();
    });

    it("should open the confirm-delete ODialog when confirmDeleteAction is invoked", () => {
      expect(wrapper.vm.confirmDelete).toBe(true);
      const dialogs = wrapper.findAllComponents({ name: "ODialog" });
      const openDialog = dialogs.find((d: any) => d.props("open") === true);
      expect(openDialog).toBeTruthy();
      expect(openDialog!.props("title")).toBe("Delete Stream");
      expect(openDialog!.props("primaryButtonVariant")).toBe("destructive");
    });

    it("should close ODialog and not call delete when secondary (cancel) is emitted", async () => {
      const dialog = wrapper
        .findAllComponents({ name: "ODialog" })
        .find((d: any) => d.props("open") === true)!;

      await dialog.vm.$emit("click:secondary");
      await flushPromises();

      expect(wrapper.vm.confirmDelete).toBe(false);
      expect(mockStreamService.delete).not.toHaveBeenCalled();
    });

    it("should call deleteStream and close ODialog when primary (ok) is emitted", async () => {
      const dialog = wrapper
        .findAllComponents({ name: "ODialog" })
        .find((d: any) => d.props("open") === true)!;

      await dialog.vm.$emit("click:primary");
      await flushPromises();

      expect(mockStreamService.delete).toHaveBeenCalledWith(
        "default",
        "test_stream",
        "logs",
        false,
      );
      expect(wrapper.vm.confirmDelete).toBe(false);
    });

    it("names the stream being deleted in the dialog message", () => {
      const message = wrapper.find('[data-test="log-stream-delete-dialog-message"]');
      expect(message.text()).toBe("Are you sure you want to delete the test_stream stream?");
      expect(message.find("span.text-text-heading.font-semibold").text()).toBe("test_stream");
    });

    it("starts with the delete-associated checkbox unticked", () => {
      expect(wrapper.vm.deleteAssociatedAlertsPipelines).toBe(false);
      const dialog = wrapper.find('[data-test="log-stream-delete-dialog-message"]').element
        .parentElement!;
      expect(dialog.querySelector('[role="checkbox"], input[type="checkbox"]')).toBeTruthy();
    });

    it("sends delete_all=true when the checkbox is ticked, then resets it", async () => {
      wrapper.vm.deleteAssociatedAlertsPipelines = true;
      const dialog = wrapper
        .findAllComponents({ name: "ODialog" })
        .find((d: any) => d.props("open") === true)!;

      await dialog.vm.$emit("click:primary");
      await flushPromises();

      expect(mockStreamService.delete).toHaveBeenCalledWith("default", "test_stream", "logs", true);
      expect(wrapper.vm.deleteAssociatedAlertsPipelines).toBe(false);
    });

    it("resets a tick left by a cancelled dialog", async () => {
      wrapper.vm.deleteAssociatedAlertsPipelines = true;
      const dialog = wrapper
        .findAllComponents({ name: "ODialog" })
        .find((d: any) => d.props("open") === true)!;

      await dialog.vm.$emit("click:secondary");
      expect(wrapper.vm.deleteAssociatedAlertsPipelines).toBe(false);

      wrapper.vm.deleteAssociatedAlertsPipelines = true;
      wrapper.vm.confirmDelete = false;
      await wrapper.vm.confirmDeleteAction({ row: { name: "other", stream_type: "logs" } });
      expect(wrapper.vm.deleteAssociatedAlertsPipelines).toBe(false);
    });
  });

  describe("ODialog — Confirm Batch Delete", () => {
    beforeEach(async () => {
      // Setup logStream rows so selectedItems computed can resolve
      wrapper.vm.logStream = [
        { name: "stream1", stream_type: "logs", _rowKey: "stream1-logs" },
        { name: "stream2", stream_type: "metrics", _rowKey: "stream2-metrics" },
      ];
      // Use selectedIds (array of _rowKey strings) — matches OTable v-model:selected-ids
      wrapper.vm.selectedIds = ["stream1-logs", "stream2-metrics"];
      await wrapper.vm.confirmBatchDeleteAction();
      await wrapper.vm.$nextTick();
    });

    it("should open the batch-delete ODialog with destructive primary variant", () => {
      expect(wrapper.vm.confirmBatchDelete).toBe(true);
      const dialog = wrapper
        .findAllComponents({ name: "ODialog" })
        .find((d: any) => d.props("open") === true)!;
      expect(dialog).toBeTruthy();
      expect(dialog.props("title")).toBe("Delete Streams");
      expect(dialog.props("primaryButtonVariant")).toBe("destructive");
    });

    it("shows the number of selected streams in the message", () => {
      const message = wrapper.find('[data-test="log-stream-batch-delete-dialog-message"]');
      expect(message.text()).toBe("Are you sure you want to delete 2 streams?");
    });

    it("uses the singular form for one selected stream", async () => {
      wrapper.vm.confirmBatchDelete = false;
      wrapper.vm.selectedIds = ["stream1-logs"];
      await wrapper.vm.confirmBatchDeleteAction();
      await wrapper.vm.$nextTick();
      const message = wrapper.find('[data-test="log-stream-batch-delete-dialog-message"]');
      expect(message.text()).toBe("Are you sure you want to delete 1 stream?");
    });

    it("keeps the count while the selection is cleared after confirming", async () => {
      wrapper.vm.selectedIds = [];
      await wrapper.vm.$nextTick();
      const message = wrapper.find('[data-test="log-stream-batch-delete-dialog-message"]');
      expect(message.text()).toBe("Are you sure you want to delete 2 streams?");
    });

    it("should close batch-delete ODialog without deleting when secondary is emitted", async () => {
      const dialog = wrapper
        .findAllComponents({ name: "ODialog" })
        .find((d: any) => d.props("open") === true)!;

      await dialog.vm.$emit("click:secondary");
      await flushPromises();

      expect(wrapper.vm.confirmBatchDelete).toBe(false);
      expect(mockStreamService.delete).not.toHaveBeenCalled();
    });

    it("should call deleteBatchStream for each selected stream when primary is emitted", async () => {
      const dialog = wrapper
        .findAllComponents({ name: "ODialog" })
        .find((d: any) => d.props("open") === true)!;

      await dialog.vm.$emit("click:primary");
      await flushPromises();

      expect(mockStreamService.delete).toHaveBeenCalledTimes(2);
      expect(mockStreamService.delete).toHaveBeenCalledWith("default", "stream1", "logs", false);
      expect(mockStreamService.delete).toHaveBeenCalledWith("default", "stream2", "metrics", false);
      expect(wrapper.vm.confirmBatchDelete).toBe(false);
    });

    it("sends delete_all=true for every stream when ticked, then resets it", async () => {
      wrapper.vm.deleteAssociatedAlertsPipelines = true;
      const dialog = wrapper
        .findAllComponents({ name: "ODialog" })
        .find((d: any) => d.props("open") === true)!;

      await dialog.vm.$emit("click:primary");
      await flushPromises();

      expect(mockStreamService.delete).toHaveBeenCalledWith("default", "stream1", "logs", true);
      expect(mockStreamService.delete).toHaveBeenCalledWith("default", "stream2", "metrics", true);
      expect(wrapper.vm.deleteAssociatedAlertsPipelines).toBe(false);
    });

    it("opens with the checkbox unticked even after a cancelled tick", async () => {
      wrapper.vm.deleteAssociatedAlertsPipelines = true;
      await wrapper
        .findAllComponents({ name: "ODialog" })
        .find((d: any) => d.props("open") === true)!
        .vm.$emit("click:secondary");
      expect(wrapper.vm.deleteAssociatedAlertsPipelines).toBe(false);

      wrapper.vm.deleteAssociatedAlertsPipelines = true;
      await wrapper.vm.confirmBatchDeleteAction();
      expect(wrapper.vm.deleteAssociatedAlertsPipelines).toBe(false);
    });
  });

  describe("Error Handling", () => {
    it("should not show error for 403 responses", async () => {
      mockNotify.mockClear();

      // Create a fresh wrapper to test 403 handling in isolation
      const testWrapper = mountLogStream();

      // Mock 403 response after component is mounted
      mockStreamService.nameList.mockRejectedValue({
        response: { status: 403 },
      });

      // Call getLogStream manually
      await testWrapper.vm.getLogStream();
      await flushPromises();

      // For 403, no error toast should be shown (loading toast is expected)
      const errorNotifications = mockNotify.mock.calls.filter(
        (call: any) => call[0].variant === "error",
      );

      expect(errorNotifications.length).toBe(0);

      testWrapper.unmount();
    });
  });

  describe("stream_deleted analytics", () => {
    const streams = [
      { name: "s1", stream_type: "logs", _rowKey: "s1-logs" },
      { name: "s2", stream_type: "logs", _rowKey: "s2-logs" },
      { name: "s3", stream_type: "metrics", _rowKey: "s3-metrics" },
    ];

    it("tracks one stream_deleted for a confirmed single delete", async () => {
      mockStreamService.delete.mockResolvedValue({ data: { code: 200 } });
      await wrapper.vm.confirmDeleteAction({ row: { name: "s1", stream_type: "logs" } });

      wrapper.vm.deleteStream();
      await flushPromises();

      expect(analytics.track).toHaveBeenCalledWith("stream_deleted", {
        stream_type: "logs",
        count: 1,
      });
    });

    it("does not track a single delete the server did not confirm", async () => {
      mockStreamService.delete.mockResolvedValue({ data: { code: 500 } });
      await wrapper.vm.confirmDeleteAction({ row: { name: "s1", stream_type: "logs" } });

      wrapper.vm.deleteStream();
      await flushPromises();

      expect(analytics.track).not.toHaveBeenCalledWith("stream_deleted", expect.anything());
    });

    it("tracks one stream_deleted per bulk delete, counting only confirmed deletions", async () => {
      mockStreamService.delete
        .mockResolvedValueOnce({ data: { code: 200 } })
        .mockResolvedValueOnce({ data: { code: 500 } })
        .mockResolvedValueOnce({ data: { code: 200 } });
      wrapper.vm.logStream = streams;
      wrapper.vm.selectedIds = streams.map((s) => s._rowKey);

      wrapper.vm.deleteBatchStream();
      await flushPromises();

      const calls = vi.mocked(analytics.track).mock.calls.filter((c) => c[0] === "stream_deleted");
      expect(calls).toEqual([["stream_deleted", { stream_type: "mixed", count: 2 }]]);
    });

    it("does not track a bulk delete in which nothing was deleted", async () => {
      mockStreamService.delete.mockResolvedValue({ data: { code: 500 } });
      wrapper.vm.logStream = streams;
      wrapper.vm.selectedIds = streams.map((s) => s._rowKey);

      wrapper.vm.deleteBatchStream();
      await flushPromises();

      expect(mockStreamService.delete).toHaveBeenCalledTimes(3);
      expect(analytics.track).not.toHaveBeenCalledWith("stream_deleted", expect.anything());
    });
  });
});
