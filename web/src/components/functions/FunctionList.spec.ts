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
import FunctionList from "./FunctionList.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Notify } from "quasar";
import i18n from "@/locales";
import { createRouter, createWebHistory } from "vue-router";
import { createStore } from "vuex";

installQuasar({ plugins: [Notify] });

const {
  mockJsTransformList,
  mockJsTransformDelete,
  mockBulkDelete,
  mockGetAssociatedPipelines,
} = vi.hoisted(() => ({
  mockJsTransformList: vi.fn(),
  mockJsTransformDelete: vi.fn(),
  mockBulkDelete: vi.fn(),
  mockGetAssociatedPipelines: vi.fn(),
}));

vi.mock("../../services/jstransform", () => ({
  default: {
    list: mockJsTransformList,
    delete: mockJsTransformDelete,
    bulkDelete: mockBulkDelete,
    getAssociatedPipelines: mockGetAssociatedPipelines,
  },
}));

vi.mock("@/services/segment_analytics", () => ({
  default: {
    track: vi.fn(),
  },
}));

vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((url: string) => url),
  verifyOrganizationStatus: vi.fn(),
}));

vi.mock("@/services/reodotdev_analytics", () => ({
  useReo: () => ({
    track: vi.fn(),
  }),
}));

vi.mock("@/composables/useLogs/searchState", () => ({
  default: () => ({
    searchObj: {
      data: {
        transforms: [],
      },
    },
  }),
}));

describe("FunctionList", () => {
  let store: any;
  let router: any;

  const mockFunctionData = {
    data: {
      list: [
        { name: "func1", function: "identity()", params: "", transType: 0 },
        { name: "func2", function: "drop()", params: "", transType: 0 },
        { name: "js_func", function: "return event;", params: "", transType: 1 },
      ],
    },
  };

  const ODialogStub = {
    name: "ODialog",
    props: ["open", "persistent", "size", "title"],
    emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
    template:
      '<div data-test-stub="o-dialog" :data-open="open" :data-title="title" :data-size="size" :data-persistent="persistent">' +
      '<span data-test-stub="o-dialog-title">{{ title }}</span>' +
      '<slot name="header"></slot>' +
      '<slot></slot>' +
      '<slot name="footer"></slot>' +
      '<button data-test-stub="o-dialog-update-open" @click="$emit(\'update:open\', false)">close</button>' +
      '</div>',
  };

  const globalStubs = {
    QTablePagination: true,
    AddFunction: true,
    NoData: true,
    ConfirmDialog: true,
    ODialog: ODialogStub,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockJsTransformList.mockResolvedValue(mockFunctionData);
    mockJsTransformDelete.mockResolvedValue({ data: { code: 200, message: "Deleted successfully" } });
    mockBulkDelete.mockResolvedValue({ data: { successful: ["func1"], unsuccessful: [] } });
    mockGetAssociatedPipelines.mockResolvedValue({ data: { list: [] } });

    store = createStore({
      state: {
        selectedOrganization: { identifier: "test-org" },
        userInfo: { email: "test@example.com" },
        theme: "light",
      },
    });

    router = createRouter({
      history: createWebHistory(),
      routes: [
        {
          path: "/functions",
          name: "functionList",
          component: { template: "<div>FunctionList</div>" },
        },
        {
          path: "/pipelines/editor",
          name: "pipelineEditor",
          component: { template: "<div>Pipeline</div>" },
        },
      ],
    });

    router.push("/functions");
  });

  describe("Component Rendering", () => {
    it("should render the component", async () => {
      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      expect(wrapper.exists()).toBe(true);
      await flushPromises();
    });

    it("should render the add function button", async () => {
      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      expect(wrapper.find('[data-test="function-list-add-function-btn"]').exists()).toBe(true);
    });

    it("should render the search input", async () => {
      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      expect(wrapper.find('[data-test="functions-list-search-input"]').exists()).toBe(true);
    });

    it("should show list view by default (not add form)", async () => {
      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.showAddJSTransformDialog).toBe(false);
    });
  });

  describe("Data Loading", () => {
    it("should call jsTransformService.list on mount", async () => {
      mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      expect(mockJsTransformList).toHaveBeenCalledWith(
        1,
        100000,
        "name",
        false,
        "",
        "test-org"
      );
    });

    it("should populate jsTransforms after load", async () => {
      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.jsTransforms).toHaveLength(3);
    });

    it("should set resultTotal after loading", async () => {
      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.resultTotal).toBe(3);
    });

    it("should handle load error for non-403 status", async () => {
      mockJsTransformList.mockRejectedValue({ response: { status: 500 } });

      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });

    it("should not show error notification for 403 status", async () => {
      mockJsTransformList.mockRejectedValue({ response: { status: 403 } });

      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Add/Update Function (showAddUpdateFn)", () => {
    it("should show AddFunction form when add button is clicked", async () => {
      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.showAddJSTransformDialog).toBe(false);

      const addBtn = wrapper.find('[data-test="function-list-add-function-btn"]');
      await addBtn.trigger("click");

      expect(vm.showAddJSTransformDialog).toBe(true);
    });

    it("should set isUpdated to false when adding new function", async () => {
      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.showAddUpdateFn({ row: undefined });
      expect(vm.isUpdated).toBe(false);
    });

    it("should set isUpdated to true when updating existing function", async () => {
      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.showAddUpdateFn({ row: { name: "func1", function: "identity()", transType: "0" } });
      expect(vm.isUpdated).toBe(true);
    });

    it("should set formData when updating function", async () => {
      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      const funcData = { name: "func1", function: "identity()", transType: "0" };
      vm.showAddUpdateFn({ row: funcData });

      expect(vm.formData).toEqual(funcData);
    });
  });

  describe("Delete Function (deleteFn)", () => {
    it("should show delete confirmation dialog", async () => {
      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.showDeleteDialogFn({ row: { name: "func1" } });

      expect(vm.confirmDelete).toBe(true);
      expect(vm.selectedDelete.name).toBe("func1");
    });

    it("should call delete API with correct parameters", async () => {
      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      vi.clearAllMocks();
      mockJsTransformList.mockResolvedValue(mockFunctionData);
      mockJsTransformDelete.mockResolvedValue({ data: { code: 200, message: "Deleted" } });

      const vm = wrapper.vm as any;
      vm.selectedDelete = { name: "func1", ingest: false };
      vm.deleteFn();

      await flushPromises();
      expect(mockJsTransformDelete).toHaveBeenCalledWith("test-org", "func1");
    });

    it("should refresh list after successful delete", async () => {
      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      vi.clearAllMocks();
      mockJsTransformDelete.mockResolvedValue({ data: { code: 200, message: "Deleted" } });
      mockJsTransformList.mockResolvedValue(mockFunctionData);

      const vm = wrapper.vm as any;
      vm.selectedDelete = { name: "func1", ingest: false };
      vm.deleteFn();

      await flushPromises();
      expect(mockJsTransformList).toHaveBeenCalled();
    });

    it("should handle 409 conflict (pipeline association) error", async () => {
      mockJsTransformDelete.mockRejectedValue({
        response: {
          status: 409,
          data: {
            code: 409,
            message: "Function is used in ['pipeline1', 'pipeline2']",
          },
        },
      });

      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.selectedDelete = { name: "func1", ingest: false };
      vm.deleteFn();

      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle delete error for non-403 status", async () => {
      mockJsTransformDelete.mockRejectedValue({
        response: { status: 500, data: { message: "Server error" } },
      });

      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.selectedDelete = { name: "func1", ingest: false };
      vm.deleteFn();

      await flushPromises();
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Associated Pipelines (getAssociatedPipelines)", () => {
    it("should fetch and show associated pipelines dialog", async () => {
      const pipelines = {
        data: { list: [{ id: "p1", name: "Pipeline 1" }, { id: "p2", name: "Pipeline 2" }] },
      };
      mockGetAssociatedPipelines.mockResolvedValue(pipelines);

      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.getAssociatedPipelines({ row: { name: "func1" } });
      await flushPromises();

      expect(mockGetAssociatedPipelines).toHaveBeenCalledWith("test-org", "func1");
      expect(vm.confirmForceDelete).toBe(true);
      expect(vm.pipelineList).toHaveLength(2);
    });

    it("should set selectedDelete when getting associated pipelines", async () => {
      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.getAssociatedPipelines({ row: { name: "func1" } });
      await flushPromises();

      expect(vm.selectedDelete.name).toBe("func1");
    });

    it("should compute transformedPipelineList correctly", async () => {
      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.pipelineList = [
        { id: "p1", name: "Pipeline 1" },
        { id: "p2", name: "Pipeline 2" },
      ];

      expect(vm.transformedPipelineList).toEqual([
        { label: "Pipeline 1", value: "p1" },
        { label: "Pipeline 2", value: "p2" },
      ]);
    });

    it("should close force delete dialog when closeDialog is called", async () => {
      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.confirmForceDelete = true;
      vm.closeDialog();

      expect(vm.confirmForceDelete).toBe(false);
    });

  });

  describe("Bulk Delete (bulkDeleteFunctions)", () => {
    it("should open bulk delete dialog", async () => {
      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.openBulkDeleteDialog();
      expect(vm.confirmBulkDelete).toBe(true);
    });

    it("should call bulkDelete API with selected function names", async () => {
      mockBulkDelete.mockResolvedValue({
        data: { successful: ["func1", "func2"], unsuccessful: [] },
      });

      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      vi.clearAllMocks();
      mockJsTransformList.mockResolvedValue(mockFunctionData);

      const vm = wrapper.vm as any;
      vm.selectedFunctions = [{ name: "func1" }, { name: "func2" }];

      await vm.bulkDeleteFunctions();
      await flushPromises();

      expect(mockBulkDelete).toHaveBeenCalledWith("test-org", { ids: ["func1", "func2"] });
    });

    it("should clear selectedFunctions after successful bulk delete", async () => {
      mockBulkDelete.mockResolvedValue({
        data: { successful: ["func1"], unsuccessful: [] },
      });

      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      vi.clearAllMocks();
      mockJsTransformList.mockResolvedValue(mockFunctionData);

      const vm = wrapper.vm as any;
      vm.selectedFunctions = [{ name: "func1" }];

      await vm.bulkDeleteFunctions();
      await flushPromises();

      expect(vm.selectedFunctions).toHaveLength(0);
    });

    it("should handle partial bulk delete failure", async () => {
      mockBulkDelete.mockResolvedValue({
        data: { successful: ["func1"], unsuccessful: ["func2"] },
      });

      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.selectedFunctions = [{ name: "func1" }, { name: "func2" }];

      await vm.bulkDeleteFunctions();
      await flushPromises();

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle all-failed bulk delete", async () => {
      mockBulkDelete.mockResolvedValue({
        data: { successful: [], unsuccessful: ["func1", "func2"] },
      });

      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.selectedFunctions = [{ name: "func1" }, { name: "func2" }];

      await vm.bulkDeleteFunctions();
      await flushPromises();

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle bulk delete with no response data (fallback message)", async () => {
      mockBulkDelete.mockResolvedValue({});

      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      vi.clearAllMocks();
      mockJsTransformList.mockResolvedValue(mockFunctionData);

      const vm = wrapper.vm as any;
      vm.selectedFunctions = [{ name: "func1" }];

      await vm.bulkDeleteFunctions();
      await flushPromises();

      expect(wrapper.exists()).toBe(true);
    });

    it("should notify when no functions are selected", async () => {
      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.selectedFunctions = [];

      await vm.bulkDeleteFunctions();
      await flushPromises();

      expect(mockBulkDelete).not.toHaveBeenCalled();
    });

    it("should handle bulk delete API error", async () => {
      mockBulkDelete.mockRejectedValue({
        response: { status: 500, data: { message: "Server error" } },
        message: "Server error",
      });

      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.selectedFunctions = [{ name: "func1" }];

      await vm.bulkDeleteFunctions();
      await flushPromises();

      expect(wrapper.exists()).toBe(true);
    });

    it("should reset confirmBulkDelete after bulk delete completes", async () => {
      mockBulkDelete.mockResolvedValue({
        data: { successful: ["func1"], unsuccessful: [] },
      });

      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      vi.clearAllMocks();
      mockJsTransformList.mockResolvedValue(mockFunctionData);

      const vm = wrapper.vm as any;
      vm.selectedFunctions = [{ name: "func1" }];
      vm.confirmBulkDelete = true;

      await vm.bulkDeleteFunctions();
      await flushPromises();

      expect(vm.confirmBulkDelete).toBe(false);
    });
  });

  describe("Navigation (hideForm / refreshList)", () => {
    it("should hide form when hideForm is called", async () => {
      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.showAddJSTransformDialog = true;
      vm.hideForm();

      await flushPromises();
      expect(vm.showAddJSTransformDialog).toBe(false);
    });

    it("should refresh list and hide form when refreshList is called", async () => {
      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      vi.clearAllMocks();
      mockJsTransformList.mockResolvedValue(mockFunctionData);

      const vm = wrapper.vm as any;
      vm.showAddJSTransformDialog = true;
      vm.refreshList();

      await flushPromises();
      expect(vm.showAddJSTransformDialog).toBe(false);
      expect(mockJsTransformList).toHaveBeenCalled();
    });
  });

  describe("Filter and Search", () => {
    it("should filterData by function name", async () => {
      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      const rows = [
        { name: "FUNC_ONE", function: "identity()" },
        { name: "func_two", function: "drop()" },
        { name: "transform_fn", function: "custom()" },
      ];

      const result = vm.filterData(rows, "func");
      expect(result).toHaveLength(2);
    });

    it("should return empty array when filterData finds no match", async () => {
      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.filterData([{ name: "func1", function: "identity()" }], "xyz_no_match")).toHaveLength(0);
    });

    it("should compute visibleRows returning all rows when no filter", async () => {
      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.filterQuery = "";
      expect(vm.visibleRows).toHaveLength(3);
    });

    it("should compute visibleRows with filter applied", async () => {
      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.filterQuery = "func1";
      expect(vm.visibleRows).toHaveLength(1);
      expect(vm.visibleRows[0].name).toBe("func1");
    });

    it("should compute hasVisibleRows as true when rows exist", async () => {
      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.filterQuery = "";
      expect(vm.hasVisibleRows).toBe(true);
    });

    it("should compute hasVisibleRows as false when no rows match filter", async () => {
      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.filterQuery = "zzz_no_match_xyz";
      expect(vm.hasVisibleRows).toBe(false);
    });

    it("should update resultTotal when visibleRows changes", async () => {
      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      expect(vm.resultTotal).toBe(3);

      vm.filterQuery = "func1";
      await flushPromises();
      expect(vm.resultTotal).toBe(1);
    });
  });

  describe("Pagination", () => {
    it("should change pagination correctly", async () => {
      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.qTable = { setPagination: vi.fn() };

      vm.changePagination({ label: "50", value: 50 });
      expect(vm.selectedPerPage).toBe(50);
      expect(vm.pagination.rowsPerPage).toBe(50);
      expect(vm.qTable.setPagination).toHaveBeenCalledWith({ rowsPerPage: 50 });
    });
  });

  describe("AI Chat Integration", () => {
    it("should emit sendToAiChat event", async () => {
      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();

      const vm = wrapper.vm as any;
      vm.sendToAiChat("test AI value");

      expect(wrapper.emitted("sendToAiChat")).toBeTruthy();
      expect(wrapper.emitted("sendToAiChat")?.[0]).toEqual(["test AI value"]);
    });
  });

  describe("Associated Pipelines ODialog (migrated)", () => {
    it("should render ODialog stub for associated pipelines", async () => {
      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      expect(wrapper.find('[data-test-stub="o-dialog"]').exists()).toBe(true);
    });

    it("should bind selectedDelete.name into ODialog title prop", async () => {
      mockGetAssociatedPipelines.mockResolvedValue({
        data: { list: [{ id: "p1", name: "Pipeline 1" }] },
      });

      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      const vm = wrapper.vm as any;
      vm.getAssociatedPipelines({ row: { name: "func1" } });
      await flushPromises();

      const dialog = wrapper.find('[data-test-stub="o-dialog"]');
      expect(dialog.attributes("data-title")).toBe(
        "Pipelines Associated with func1"
      );
    });

    it("should set ODialog size=md and persistent attributes", async () => {
      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      const dialog = wrapper.find('[data-test-stub="o-dialog"]');
      expect(dialog.attributes("data-size")).toBe("md");
      // boolean attribute with `true` renders as the empty string in DOM
      expect(dialog.attributes("data-persistent")).toBe("");
    });

    it("should reflect confirmForceDelete=true on ODialog data-open", async () => {
      mockGetAssociatedPipelines.mockResolvedValue({
        data: { list: [{ id: "p1", name: "Pipeline 1" }] },
      });

      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      const vm = wrapper.vm as any;
      vm.getAssociatedPipelines({ row: { name: "func1" } });
      await flushPromises();

      const dialog = wrapper.find('[data-test-stub="o-dialog"]');
      expect(dialog.attributes("data-open")).toBe("true");
    });

    it("should close ODialog when it emits update:open=false", async () => {
      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      const vm = wrapper.vm as any;
      vm.confirmForceDelete = true;
      await flushPromises();

      await wrapper
        .find('[data-test-stub="o-dialog-update-open"]')
        .trigger("click");

      expect(vm.confirmForceDelete).toBe(false);
    });

    it("should render 'No pipelines' fallback when transformedPipelineList is empty", async () => {
      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      const vm = wrapper.vm as any;
      vm.pipelineList = [];
      vm.confirmForceDelete = true;
      await flushPromises();

      const dialog = wrapper.find('[data-test-stub="o-dialog"]');
      expect(dialog.text()).toContain("No pipelines associated with this function");
    });

    it("should render pipeline items inside ODialog when list is non-empty", async () => {
      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      const vm = wrapper.vm as any;
      vm.pipelineList = [
        { id: "p1", name: "Pipeline 1" },
        { id: "p2", name: "Pipeline 2" },
      ];
      vm.confirmForceDelete = true;
      await flushPromises();

      const dialog = wrapper.find('[data-test-stub="o-dialog"]');
      expect(dialog.text()).toContain("1. Pipeline 1");
      expect(dialog.text()).toContain("2. Pipeline 2");
    });
  });

  describe("Route Query Action Handling", () => {
    it("should trigger getJSTransforms when route has action=add query param", async () => {
      router.push({
        name: "functionList",
        query: { action: "add", org_identifier: "test-org" },
      });
      await flushPromises();

      mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      expect(mockJsTransformList).toHaveBeenCalled();
    });

    it("should show update form when route has action=update with matching function name", async () => {
      router.push({
        name: "functionList",
        query: { action: "update", name: "func1", org_identifier: "test-org" },
      });
      await flushPromises();

      const wrapper = mount(FunctionList, {
        global: { plugins: [i18n, store, router], stubs: globalStubs },
      });

      await flushPromises();
      const vm = wrapper.vm as any;
      expect(vm.isUpdated).toBe(true);
    });
  });
});
