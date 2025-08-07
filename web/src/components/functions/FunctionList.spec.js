// Copyright 2023 OpenObserve Inc.
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
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify, Quasar } from "quasar";
import { nextTick } from 'vue';
import FunctionList from "./FunctionList.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import jsTransformService from "@/services/jstransform";
import QTablePagination from "@/components/shared/grid/Pagination.vue";
import * as vueRouter from 'vue-router';
import NoData from "@/components/shared/grid/NoData.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import segment from "@/services/segment_analytics";
import { getImageURL, verifyOrganizationStatus } from "@/utils/zincutils";
import {
  outlinedDelete,
  outlinedAccountTree,
} from "@quasar/extras/material-icons-outlined";
import useLogs from "@/composables/useLogs";
import { ref } from "vue";

// Mock vue-router
vi.mock('vue-router', async () => {
  const actual = await vi.importActual('vue-router');
  return {
    ...actual,
    useRouter: vi.fn(() => ({
      push: vi.fn(),
      replace: vi.fn(),
      currentRoute: {
        value: {
          query: {}
        }
      }
    }))
  };
});

// Mock jsTransformService
vi.mock("@/services/jstransform", () => ({
  default: {
    list: vi.fn(),
    delete: vi.fn(),
    getAssociatedPipelines: vi.fn(),
  },
}));

// Mock segment analytics
vi.mock("@/services/segment_analytics", () => ({
  default: {
    track: vi.fn()
  }
}));

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

// Create platform mock
const platform = {
  is: {
    desktop: true,
    mobile: false,
  },
  has: {
    touch: false,
  },
};

// Install Quasar with platform
installQuasar({
  plugins: [Dialog, Notify],
  config: {
    platform
  }
});

describe("FunctionList Component", () => {
  let wrapper;
  let mockRouter;
  let dismissMock;
  let notifyMock;
  let dialogMock;

  beforeEach(async () => {
    // Reset mock implementations
    vi.mocked(jsTransformService.list).mockReset();
    vi.mocked(jsTransformService.delete).mockReset();
    vi.mocked(jsTransformService.getAssociatedPipelines).mockReset();

    // Setup default successful response for list
    vi.mocked(jsTransformService.list).mockResolvedValue({
      data: {
        list: [
          {
            name: "Test Function 1",
            function: "function test1() { return true; }",
            params: ["param1"],
            transType: "1",
          },
          {
            name: "Test Function 2",
            function: "function test2() { return false; }",
            params: ["param2"],
            transType: "2",
          },
        ],
      },
    });

    // Setup store state
    store.state.selectedOrganization = { identifier: "test-org", name: "Test Org" };
    store.state.userInfo = { email: "test@example.com" };
    store.state.theme = 'light';

    // Setup router mock
    mockRouter = {
      push: vi.fn(),
      replace: vi.fn(),
      currentRoute: {
        value: {
          query: {},
          name: "functionList"
        }
      }
    };
    vi.mocked(vueRouter.useRouter).mockReturnValue(mockRouter);

    // Setup notify and dialog mocks
    dismissMock = vi.fn();
    notifyMock = vi.fn(() => dismissMock);
    dialogMock = vi.fn().mockResolvedValue(true);

    wrapper = mount(FunctionList, {
      global: {
        plugins: [
          [Quasar, { platform }],
          [i18n]
        ],
        provide: { 
          store,
          platform,
          router: mockRouter
        },
        mocks: {
          $router: mockRouter,
          q: {
            platform,
            notify: notifyMock,
            dialog: dialogMock
          },
          router: mockRouter
        }
      },
      attachTo: document.body
    });

    // Set up wrapper's $q.notify and dialog after mount
    wrapper.vm.q = {
      notify: notifyMock,
      dialog: dialogMock
    };

    await flushPromises();
  });

  afterEach(() => {
    if (wrapper && typeof wrapper.unmount === 'function') {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  describe("Component Initialization", () => {
    it("renders the component", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("fetches functions on mount", async () => {
      expect(jsTransformService.list).toHaveBeenCalledWith(
        1,
        100000,
        "name",
        false,
        "",
        "test-org"
      );
    });

    it("initializes with correct default values", () => {
      expect(wrapper.vm.filterQuery).toBe("");
      expect(wrapper.vm.pagination.rowsPerPage).toBe(20);
    });

    it("displays correct number of functions", async () => {
      expect(wrapper.vm.jsTransforms.length).toBe(2);
    });

    it("updates pagination when rows per page changes", async () => {
      const paginationComponent = wrapper.findComponent(QTablePagination);
      expect(paginationComponent.exists()).toBe(true);
      
      await paginationComponent.vm.$emit('update:changeRecordPerPage', {
        label: "50 / page",
        value: 50
      });
      
      await nextTick();
      expect(wrapper.vm.pagination.rowsPerPage).toBe(50);
      expect(wrapper.vm.selectedPerPage).toBe(50);
    });
  });

  describe("Function Filtering", () => {
    it("filters functions by name", async () => {
      const filtered = wrapper.vm.filterData(wrapper.vm.jsTransforms, "Test Function 1");
      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe("Test Function 1");
    });

    it("handles case-insensitive filtering", () => {
      const filtered = wrapper.vm.filterData(wrapper.vm.jsTransforms, "test function");
      expect(filtered.length).toBe(2);
    });

    it("returns empty array for non-matching filter", () => {
      const filtered = wrapper.vm.filterData(wrapper.vm.jsTransforms, "Non Existent");
      expect(filtered.length).toBe(0);
    });
  });

  describe("Function Actions", () => {
    describe("Add Function", () => {
      it("shows add function dialog when add button is clicked", async () => {
        const addButton = wrapper.find('button.q-btn');
        expect(addButton.exists()).toBe(true);
        await addButton.trigger('click');
        await nextTick();
        expect(wrapper.vm.showAddJSTransformDialog).toBe(true);
      });

      it("sets correct state for adding new function", async () => {
        wrapper.vm.formData = { test: 'old data' };
        await wrapper.vm.showAddUpdateFn({ row: null });
        await nextTick();
        expect(wrapper.vm.isUpdated).toBe(false);
        expect(wrapper.vm.formData).toBe(null);
      });
    });

    describe("Function List Features", () => {
      it("initializes with correct default pagination", () => {
        expect(wrapper.vm.pagination.rowsPerPage).toBe(20);
      });

      it("updates pagination when rows per page changes", async () => {
        await wrapper.vm.changePagination({ value: 50 });
        expect(wrapper.vm.pagination.rowsPerPage).toBe(50);
      });

      it("filters functions correctly", () => {
        const rows = [
          { name: "test1" },
          { name: "test2" },
          { name: "other" }
        ];
        const filtered = wrapper.vm.filterData(rows, "test");
        expect(filtered).toHaveLength(2);
      });

      it("handles empty filter query", () => {
        const rows = [
          { name: "test1" },
          { name: "test2" }
        ];
        const filtered = wrapper.vm.filterData(rows, "");
        expect(filtered).toHaveLength(2);
      });

      it("handles case-insensitive filtering", () => {
        const rows = [
          { name: "TestFunction" },
          { name: "testfunction" }
        ];
        const filtered = wrapper.vm.filterData(rows, "TEST");
        expect(filtered).toHaveLength(2);
      });
    });

    describe("UI Interactions", () => {
      it("shows search input field", () => {
        const searchInput = wrapper.find('[data-test="functions-list-search-input"]');
        expect(searchInput.exists()).toBe(true);
      });

      it("updates filter query when search input changes", async () => {
        wrapper.vm.filterQuery = "test";
        await nextTick();
        expect(wrapper.vm.filterQuery).toBe("test");
      });

      it("displays correct table headers", () => {
        const headers = wrapper.vm.columns;
        expect(headers).toHaveLength(3);
        expect(headers[0].name).toBe("#");
        expect(headers[1].name).toBe("name");
        expect(headers[2].name).toBe("actions");
      });

      it("renders NoData component when list is empty", async () => {
        wrapper.vm.jsTransforms = [];
        await nextTick();
        const noData = wrapper.findComponent(NoData);
        expect(noData.exists()).toBe(true);
      });
    });

  describe("Function Management", () => {
      it("handles refresh list correctly", async () => {
        const routerPushSpy = vi.fn().mockImplementation(() => Promise.resolve());
        wrapper.vm.$router.push = routerPushSpy;
        await wrapper.vm.refreshList();
        expect(routerPushSpy).toHaveBeenCalledWith({
          name: "functionList",
          query: {
            org_identifier: store.state.selectedOrganization.identifier
          }
        });
        expect(wrapper.vm.showAddJSTransformDialog).toBe(false);
      });

      it("handles hide form correctly", async () => {
        const routerReplaceSpy = vi.fn().mockImplementation(() => Promise.resolve());
        wrapper.vm.$router.replace = routerReplaceSpy;
        await wrapper.vm.hideForm();
        expect(routerReplaceSpy).toHaveBeenCalledWith({
          name: "functionList",
          query: {
            org_identifier: store.state.selectedOrganization.identifier
          }
        });
        expect(wrapper.vm.showAddJSTransformDialog).toBe(false);
      });

      it("handles pipeline selection correctly", () => {
        const pipeline = {
          value: "123",
          label: "Test Pipeline"
        };
        const mockResolve = vi.fn().mockReturnValue({ href: '/test-url' });
        wrapper.vm.$router.resolve = mockResolve;
        wrapper.vm.onPipelineSelect(pipeline);
        expect(mockResolve).toHaveBeenCalledWith({
          name: "pipelineEditor",
          query: {
            id: "123",
            name: "Test Pipeline",
            org_identifier: store.state.selectedOrganization.identifier
          }
        });
      });

      it("transforms pipeline list correctly", async () => {
        wrapper.vm.pipelineList = [
          { id: 1, name: "Pipeline 1" },
          { id: 2, name: "Pipeline 2" }
        ];
        await nextTick();
        const transformed = wrapper.vm.transformedPipelineList;
        expect(transformed).toHaveLength(2);
        expect(transformed[0]).toEqual({
          label: "Pipeline 1",
          value: 1
        });
      });

      it("handles dialog close correctly", () => {
        wrapper.vm.confirmForceDelete = true;
        wrapper.vm.closeDialog();
        expect(wrapper.vm.confirmForceDelete).toBe(false);
      });

      it("emits sendToAiChat event correctly", () => {
        const testValue = { test: "data" };
        wrapper.vm.sendToAiChat(testValue);
        expect(wrapper.emitted('sendToAiChat')).toBeTruthy();
        expect(wrapper.emitted('sendToAiChat')[0]).toEqual([testValue]);
      });

      it("handles show delete dialog correctly", () => {
        const testRow = { name: "Test Function" };
        wrapper.vm.showDeleteDialogFn({ row: testRow });
        expect(wrapper.vm.selectedDelete).toEqual(testRow);
        expect(wrapper.vm.confirmDelete).toBe(true);
      });

      it("handles force remove function correctly", () => {
        const message = '["Pipeline1", "Pipeline2"]';
        const pipelineList = ref([]);
        const confirmForceDelete = ref(false);
        const forceRemoveFunction = (message) => {
          const match = message.match(/\[([^\]]+)\]/);
          if (match) {
            pipelineList.value = JSON.parse(match[0].replace(/'/g, '"'));
          }
          confirmForceDelete.value = true;
        };
        forceRemoveFunction(message);
        expect(pipelineList.value).toEqual(["Pipeline1", "Pipeline2"]);
        expect(confirmForceDelete.value).toBe(true);
      });

      it("handles max record change correctly", () => {
        wrapper.vm.changeMaxRecordToReturn(200);
        expect(wrapper.vm.maxRecordToReturn).toBe(200);
      });

      it("initializes with correct per page options", () => {
        expect(wrapper.vm.perPageOptions).toHaveLength(6);
        expect(wrapper.vm.perPageOptions[0].value).toBe(5);
        expect(wrapper.vm.perPageOptions[5].value).toBe(0);
      });
    });
  });

  describe("Error Handling", () => {
      beforeEach(() => {
        notifyMock.mockReset();
        wrapper.vm.$q = {
          notify: notifyMock
        };
      });

      it("handles pipeline fetch error gracefully", async () => {
        const error = new Error("Failed to fetch pipelines");
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.mocked(jsTransformService.getAssociatedPipelines).mockRejectedValue(error);
        await wrapper.vm.getAssociatedPipelines({ row: { name: "test" } });
        await nextTick();
        await nextTick();
        expect(consoleSpy).toHaveBeenCalledWith(error);
        consoleSpy.mockRestore();
      });
    });

    describe("Theme Handling", () => {
      it("applies dark theme classes when theme is dark", async () => {
        store.state.theme = "dark";
        await nextTick();
        const header = wrapper.find(".tw-flex");
        expect(header.classes()).toContain("o2-table-header-dark");
      });

      it("applies light theme classes when theme is light", async () => {
        store.state.theme = "light";
        await nextTick();
        const header = wrapper.find(".tw-flex");
        expect(header.classes()).toContain("o2-table-header-light");
      });

      it("applies dark theme to table when theme is dark", async () => {
        store.state.theme = "dark";
        await nextTick();
        const table = wrapper.find(".o2-quasar-table");
        expect(table.classes()).toContain("o2-quasar-table-dark");
      });

      it("applies light theme to table when theme is light", async () => {
        store.state.theme = "light";
        await nextTick();
        const table = wrapper.find(".o2-quasar-table");
        expect(table.classes()).toContain("o2-quasar-table-light");
      });
    });

    describe("Search Functionality", () => {
      it("filters case-insensitive with special characters", () => {
        const rows = [
          { name: "Test-Function" },
          { name: "test_function" },
          { name: "other" }
        ];
        const filtered = wrapper.vm.filterData(rows, "test");
        expect(filtered).toHaveLength(2);
      });

      it("returns empty array for non-matching complex query", () => {
        const rows = [
          { name: "Test-Function" },
          { name: "test_function" }
        ];
        const filtered = wrapper.vm.filterData(rows, "xyz123");
        expect(filtered).toHaveLength(0);
      });

      it("handles empty rows array", () => {
        const filtered = wrapper.vm.filterData([], "test");
        expect(filtered).toHaveLength(0);
      });

      it("handles null search term", () => {
        const rows = [
          { name: "Test-Function" },
          { name: "test_function" }
        ];
        const filtered = wrapper.vm.filterData(rows, "");
        expect(filtered).toHaveLength(2);
      });
    });

    describe("Pagination Behavior", () => {
      it("updates pagination when changing to All records", async () => {
        await wrapper.vm.changePagination({ label: "All", value: 0 });
        expect(wrapper.vm.pagination.rowsPerPage).toBe(0);
      });

      it("updates selected per page value", async () => {
        await wrapper.vm.changePagination({ label: "50", value: 50 });
        expect(wrapper.vm.selectedPerPage).toBe(50);
      });

      it("updates table pagination", async () => {
        const setPaginationSpy = vi.spyOn(wrapper.vm.qTable, 'setPagination');
        await wrapper.vm.changePagination({ label: "100", value: 100 });
        expect(setPaginationSpy).toHaveBeenCalledWith({ rowsPerPage: 100 });
      });
    });

    describe("Pipeline Management", () => {
      it("opens pipeline in new window", () => {
        const windowOpenSpy = vi.spyOn(window, 'open');
        wrapper.vm.$router.resolve = vi.fn().mockReturnValue({ href: '/test-url' });
        wrapper.vm.onPipelineSelect({ value: "123", label: "Test Pipeline" });
        expect(windowOpenSpy).toHaveBeenCalledWith('/test-url', '_blank');
      });

      it("transforms empty pipeline list", async () => {
        wrapper.vm.pipelineList = [];
        await nextTick();
        expect(wrapper.vm.transformedPipelineList).toHaveLength(0);
      });

      it("transforms pipeline list with multiple items", async () => {
        wrapper.vm.pipelineList = [
          { id: 1, name: "Pipeline 1" },
          { id: 2, name: "Pipeline 2" },
          { id: 3, name: "Pipeline 3" }
        ];
        await nextTick();
        expect(wrapper.vm.transformedPipelineList).toHaveLength(3);
        expect(wrapper.vm.transformedPipelineList[2]).toEqual({
          label: "Pipeline 3",
          value: 3
        });
      });

      it("handles pipeline list with special characters", async () => {
        wrapper.vm.pipelineList = [
          { id: 1, name: "Pipeline-1" },
          { id: 2, name: "Pipeline_2" },
          { id: 3, name: "Pipeline 3!" }
        ];
        await nextTick();
        expect(wrapper.vm.transformedPipelineList[2]).toEqual({
          label: "Pipeline 3!",
          value: 3
        });
      });
    });

    describe("Component Lifecycle", () => {
      it("fetches functions on mount when jsTransforms is empty", async () => {
        const getJSTransformsSpy = vi.spyOn(wrapper.vm, 'getJSTransforms');
        const dismiss = vi.fn();
        notifyMock.mockReturnValueOnce(dismiss);
        vi.mocked(jsTransformService.list).mockResolvedValue({
          data: {
            list: []
          }
        });
        wrapper.vm.jsTransforms = [];
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();
        await wrapper.vm.getJSTransforms();
        expect(getJSTransformsSpy).toHaveBeenCalled();
      });

      it("fetches functions on mount when jsTransforms is undefined", async () => {
        const getJSTransformsSpy = vi.spyOn(wrapper.vm, 'getJSTransforms');
        const dismiss = vi.fn();
        notifyMock.mockReturnValueOnce(dismiss);
        vi.mocked(jsTransformService.list).mockResolvedValue({
          data: {
            list: []
          }
        });
        wrapper.vm.jsTransforms = [];
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();
        await wrapper.vm.getJSTransforms();
        expect(getJSTransformsSpy).toHaveBeenCalled();
      });

      it("updates search object with transforms", async () => {
        const transforms = [
          { name: "Transform 1" },
          { name: "Transform 2" }
        ];
        wrapper.vm.jsTransforms = transforms;
        wrapper.vm.searchObj = { data: {} };
        await wrapper.vm.$nextTick();
        await wrapper.vm.$nextTick();
        wrapper.vm.searchObj.data.transforms = transforms;
        expect(wrapper.vm.searchObj.data.transforms).toEqual(transforms);
      });
    });
}); 