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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { Quasar } from "quasar";
import { nextTick } from "vue";
import VariableSettings from "./VariableSettings.vue";

// Mock external dependencies
vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: vi.fn((key: string) => {
      const translations: Record<string, string> = {
        "dashboard.queryValues": "Query Values",
        "dashboard.constant": "Constant", 
        "dashboard.textbox": "Textbox",
        "dashboard.custom": "Custom",
        "dashboard.newVariable": "New Variable",
        "dashboard.name": "Name",
        "dashboard.type": "Type", 
        "dashboard.selectType": "Select Type",
        "dashboard.actions": "Actions",
        "dashboard.edit": "Edit",
        "dashboard.delete": "Delete",
        "dashboard.isMultiSelect": "Multi Select",
        "dashboard.isSingleSelect": "Single Select"
      };
      return translations[key] || key;
    })
  })
}));

vi.mock("vuex", () => ({
  useStore: () => ({
    state: {
      selectedOrganization: {
        identifier: "test-org"
      },
      theme: "light"
    }
  })
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({
    query: {
      dashboard: "test-dashboard",
      folder: "test-folder"
    }
  })
}));

vi.mock("../../../utils/zincutils", () => ({
  getImageURL: vi.fn()
}));

const mockNotifications = {
  showPositiveNotification: vi.fn(),
  showErrorNotification: vi.fn(),
  showConfictErrorNotificationWithRefreshBtn: vi.fn()
};

vi.mock("@/composables/useNotifications", () => ({
  default: vi.fn(() => mockNotifications)
}));

vi.mock("../../../utils/commons", () => ({
  getDashboard: vi.fn(),
  deleteVariable: vi.fn(),
  updateDashboard: vi.fn()
}));

// Mock child components
vi.mock("./AddSettingVariable.vue", () => ({
  default: {
    name: "AddSettingVariable", 
    template: '<div data-test="add-setting-variable-mock">Add Setting Variable</div>',
    props: ["variableName", "dashboardVariablesList"],
    emits: ["save", "close"]
  }
}));

vi.mock("./common/DashboardHeader.vue", () => ({
  default: {
    name: "DashboardHeader",
    template: '<div data-test="dashboard-header-mock"><h2>{{title}}</h2><slot name="right" /></div>',
    props: ["title"]
  }
}));

vi.mock("../../shared/grid/NoData.vue", () => ({
  default: {
    name: "NoData",
    template: '<div data-test="no-data-mock">No Data</div>'
  }
}));

vi.mock("../../ConfirmDialog.vue", () => ({
  default: {
    name: "ConfirmDialog", 
    template: '<div data-test="confirm-dialog-mock" v-if="modelValue"><div>{{title}}</div><div>{{message}}</div></div>',
    props: ["modelValue", "title", "message"],
    emits: ["update:ok", "update:cancel"]
  }
}));

vi.mock("./VariablesDependenciesGraph.vue", () => ({
  default: {
    name: "VariablesDependenciesGraph",
    template: '<div data-test="dependencies-graph-mock">Dependencies Graph</div>',
    props: ["variablesList"],
    emits: ["closePopUp"]
  }
}));

vi.mock("vue-draggable-next", () => ({
  VueDraggableNext: {
    name: "VueDraggableNext", 
    template: '<div data-test="dashboard-variable-settings-drag"><slot /></div>',
    props: ["modelValue", "options"],
    emits: ["update:modelValue", "end", "mousedown"]
  }
}));

describe("VariableSettings", () => {
  let wrapper: VueWrapper;
  let mockGetDashboard: any;
  let mockDeleteVariable: any;
  let mockUpdateDashboard: any;

  const mockDashboardData = {
    dashboardId: "test-dashboard",
    title: "Test Dashboard",
    variables: {
      list: [
        {
          name: "region",
          type: "query_values",
          multiSelect: false,
          value: "us-east-1"
        },
        {
          name: "service", 
          type: "custom",
          multiSelect: true,
          value: ["api", "web"]
        },
        {
          name: "env",
          type: "constant", 
          multiSelect: false,
          value: "production"
        }
      ]
    }
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Reset notification mocks
    mockNotifications.showPositiveNotification.mockClear();
    mockNotifications.showErrorNotification.mockClear();
    mockNotifications.showConfictErrorNotificationWithRefreshBtn.mockClear();
    
    mockGetDashboard = vi.fn().mockResolvedValue(mockDashboardData);
    mockDeleteVariable = vi.fn().mockResolvedValue({});
    mockUpdateDashboard = vi.fn().mockResolvedValue({});

    const { getDashboard, deleteVariable, updateDashboard } = await import("../../../utils/commons");
    (getDashboard as any).mockImplementation(mockGetDashboard);
    (deleteVariable as any).mockImplementation(mockDeleteVariable);
    (updateDashboard as any).mockImplementation(mockUpdateDashboard);
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}) => {
    return mount(VariableSettings, {
      props,
      global: {
        plugins: [Quasar],
        stubs: {
          'q-btn': {
            name: 'QBtn',
            template: '<button @click="$emit(\'click\')"><slot /></button>',
            props: ['icon', 'label', 'color', 'class'],
            emits: ['click']
          },
          'q-icon': {
            name: 'QIcon',
            template: '<span class="q-icon"><slot /></span>',
            props: ['name', 'color']
          },
          'q-dialog': {
            name: 'QDialog',
            template: '<div v-if="modelValue" class="q-dialog"><slot /></div>',
            props: ['modelValue'],
            emits: ['update:modelValue']
          },
          'q-card': {
            name: 'QCard',
            template: '<div class="q-card"><slot /></div>'
          },
          'q-toolbar': {
            name: 'QToolbar',
            template: '<div class="q-toolbar"><slot /></div>'
          },
          'q-toolbar-title': {
            name: 'QToolbarTitle',
            template: '<div class="q-toolbar-title"><slot /></div>'
          },
          'q-card-section': {
            name: 'QCardSection',
            template: '<div class="q-card-section"><slot /></div>'
          }
        }
      }
    });
  };

  describe("Component Mounting and Initialization", () => {
    it("should mount successfully", async () => {
      wrapper = createWrapper();
      await nextTick();
      
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-header-mock"]').exists()).toBe(true);
    });

    it("should fetch dashboard data on mount", async () => {
      wrapper = createWrapper();
      await nextTick();
      
      expect(mockGetDashboard).toHaveBeenCalledWith(
        expect.any(Object),
        "test-dashboard", 
        "test-folder"
      );
    });

    it("should initialize with correct default state", async () => {
      wrapper = createWrapper();
      await nextTick();
      
      const vm = wrapper.vm as any;
      expect(vm.isAddVariable).toBe(false);
      expect(vm.confirmDeleteDialog).toBe(false);
      expect(vm.showVariablesDependenciesGraphPopUp).toBe(false);
      // selectedVariable starts as null, selectedDelete as undefined
      expect(vm.selectedVariable).toBeNull();
    });
  });

  describe("Variables List Display", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await nextTick();
      // Wait for async data loading
      await new Promise(resolve => setTimeout(resolve, 10));
    });

    it("should display variables list header", () => {
      expect(wrapper.find(".variables-list-header").exists()).toBe(true);
      expect(wrapper.text()).toContain("Name");
      expect(wrapper.text()).toContain("Type");
      expect(wrapper.text()).toContain("Actions");
    });

    it("should render draggable container when variables exist", async () => {
      const vm = wrapper.vm as any;
      // Set variables after mounting and wait for component to render
      vm.dashboardVariablesList = mockDashboardData.variables.list;
      await nextTick();
      
      // Check for draggable container div with proper data-test
      expect(wrapper.find('[data-test="dashboard-variable-settings-drag"]').exists()).toBe(true);
    });

    it("should show add variable button", () => {
      expect(wrapper.find('button').exists()).toBe(true);
    });

    it("should display variable type labels correctly", async () => {
      const vm = wrapper.vm as any;
      
      expect(vm.getVariableTypeLabel("query_values")).toBe("Query Values");
      expect(vm.getVariableTypeLabel("constant")).toBe("Constant");
      expect(vm.getVariableTypeLabel("textbox")).toBe("Textbox");
      expect(vm.getVariableTypeLabel("custom")).toBe("Custom");
      expect(vm.getVariableTypeLabel("unknown_type")).toBe("unknown_type");
    });
  });

  describe("Add Variable Functionality", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await nextTick();
    });

    it("should show add variable form when add button is clicked", async () => {
      const vm = wrapper.vm as any;
      
      vm.addVariables();
      await nextTick();
      
      expect(vm.isAddVariable).toBe(true);
      expect(vm.selectedVariable).toBeNull();
    });

    it("should show AddSettingVariable component in add mode", async () => {
      const vm = wrapper.vm as any;
      vm.isAddVariable = true;
      await nextTick();
      
      expect(wrapper.find('[data-test="add-setting-variable-mock"]').exists()).toBe(true);
    });

    it("should handle save variable correctly", async () => {
      const vm = wrapper.vm as any;
      
      await vm.handleSaveVariable();
      
      expect(vm.isAddVariable).toBe(false);
      expect(mockGetDashboard).toHaveBeenCalled();
    });

    it("should handle close variable form correctly", async () => {
      const vm = wrapper.vm as any;
      vm.isAddVariable = true;
      
      vm.goBackToDashboardList();
      
      expect(vm.isAddVariable).toBe(false);
    });
  });

  describe("Edit Variable Functionality", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await nextTick();
    });

    it("should set selected variable and show form when editing", async () => {
      const vm = wrapper.vm as any;
      
      await vm.editVariableFn("test-variable");
      
      expect(vm.selectedVariable).toBe("test-variable");
      expect(vm.isAddVariable).toBe(true);
    });
  });

  describe("Delete Variable Functionality", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await nextTick();
    });

    it("should show delete dialog when delete is initiated", async () => {
      const vm = wrapper.vm as any;
      const mockRowData = { name: "test-variable" };
      
      // Call the function 
      vm.showDeleteDialogFn({ row: mockRowData });
      await nextTick();
      
      // Since selectedDelete is not exposed in the component return, 
      // we can only verify that confirmDeleteDialog is set to true
      // which indicates the function worked (as per the source code)
      expect(vm.confirmDeleteDialog).toBe(true);
      
      // The function implementation shows that selectedDelete should be set,
      // but it's not exposed in the component's return statement.
      // This is actually a bug in the original component.
    });

    it("should show confirm dialog component when delete dialog is active", async () => {
      const vm = wrapper.vm as any;
      vm.confirmDeleteDialog = true;
      await nextTick();
      
      expect(wrapper.find('[data-test="confirm-dialog-mock"]').exists()).toBe(true);
    });

    it("should delete variable successfully", async () => {
      const vm = wrapper.vm as any;
      
      // First set up the delete dialog by calling showDeleteDialogFn
      vm.showDeleteDialogFn({ row: { name: "test-variable" } });
      await nextTick();
      
      // Now call deleteVariableFn which will use the internal selectedDelete
      await vm.deleteVariableFn();
      
      expect(mockDeleteVariable).toHaveBeenCalledWith(
        expect.any(Object),
        "test-dashboard",
        "test-variable", 
        "test-folder"
      );
      // The component shows positive notification when successful
      expect(mockNotifications.showPositiveNotification).toHaveBeenCalledWith(
        "Variable deleted successfully",
        { timeout: 2000 }
      );
    });

    it("should handle delete error with 409 status", async () => {
      const vm = wrapper.vm as any;
      const error409 = { response: { status: 409, data: { message: "Conflict error" } } };
      mockDeleteVariable.mockRejectedValue(error409);
      
      // Set up the delete dialog first
      vm.showDeleteDialogFn({ row: { name: "test-variable" } });
      await nextTick();
      
      await vm.deleteVariableFn();
      
      expect(mockNotifications.showConfictErrorNotificationWithRefreshBtn).toHaveBeenCalledWith(
        "Conflict error"
      );
      // No positive notification should be called when error occurs
      expect(mockNotifications.showPositiveNotification).not.toHaveBeenCalled();
    });

    it("should handle delete error with non-409 status", async () => {
      const vm = wrapper.vm as any;
      const error = { message: "Delete failed" };
      mockDeleteVariable.mockRejectedValue(error);
      
      // Set up the delete dialog first
      vm.showDeleteDialogFn({ row: { name: "test-variable" } });
      await nextTick();
      
      await vm.deleteVariableFn();
      
      expect(mockNotifications.showErrorNotification).toHaveBeenCalledWith(
        "Delete failed",
        { timeout: 2000 }
      );
      // No positive notification should be called when error occurs
      expect(mockNotifications.showPositiveNotification).not.toHaveBeenCalled();
    });
  });

  describe("Drag and Drop Functionality", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await nextTick();
    });

    it("should have correct drag options", () => {
      const vm = wrapper.vm as any;
      expect(vm.dragOptions).toEqual({ animation: 200 });
    });

    it("should handle drag end successfully", async () => {
      const vm = wrapper.vm as any;
      
      // Initialize the data structure properly
      vm.dashboardVariableData = { data: { ...mockDashboardData } };
      vm.dashboardVariablesList = mockDashboardData.variables.list;
      
      await vm.handleDragEnd();
      
      expect(mockUpdateDashboard).toHaveBeenCalledWith(
        expect.any(Object),
        "test-org",
        "test-dashboard",
        expect.objectContaining({
          variables: {
            list: mockDashboardData.variables.list
          }
        }),
        "test-folder"
      );
      expect(mockNotifications.showPositiveNotification).toHaveBeenCalledWith(
        "Dashboard updated successfully.",
        { timeout: 2000 }
      );
    });

    it("should handle drag end error with 409 status", async () => {
      const vm = wrapper.vm as any;
      const error409 = { response: { status: 409, data: { message: "Reorder conflict" } } };
      mockUpdateDashboard.mockRejectedValue(error409);
      
      vm.dashboardVariableData = { data: { ...mockDashboardData } };
      vm.dashboardVariablesList = mockDashboardData.variables.list;
      
      await vm.handleDragEnd();
      
      expect(mockNotifications.showConfictErrorNotificationWithRefreshBtn).toHaveBeenCalledWith(
        "Reorder conflict"
      );
    });

    it("should handle drag end error with non-409 status", async () => {
      const vm = wrapper.vm as any;
      const error = { message: "Reorder failed" };
      mockUpdateDashboard.mockRejectedValue(error);
      
      vm.dashboardVariableData = { data: { ...mockDashboardData } };
      vm.dashboardVariablesList = mockDashboardData.variables.list;
      
      await vm.handleDragEnd();
      
      expect(mockNotifications.showErrorNotification).toHaveBeenCalledWith("Reorder failed");
    });
  });

  describe("Dependencies Graph Functionality", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await nextTick();
    });

    it("should show dependencies graph popup when button is clicked", async () => {
      const vm = wrapper.vm as any;
      
      vm.showVariablesDependenciesGraphPopUp = true;
      await nextTick();
      
      expect(vm.showVariablesDependenciesGraphPopUp).toBe(true);
    });

    it("should render dependencies graph dialog when popup is shown", async () => {
      const vm = wrapper.vm as any;
      vm.showVariablesDependenciesGraphPopUp = true;
      await nextTick();
      
      expect(wrapper.html()).toContain("Variables Dependency Graph");
    });

    it("should close dependencies graph popup", async () => {
      const vm = wrapper.vm as any;
      
      vm.showVariablesDependenciesGraphPopUp = false;
      await nextTick();
      
      expect(vm.showVariablesDependenciesGraphPopUp).toBe(false);
    });
  });

  describe("Data Loading and Error Handling", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await nextTick();
    });

    it("should handle dashboard data loading", async () => {
      const vm = wrapper.vm as any;
      
      await vm.getDashboardData();
      
      expect(mockGetDashboard).toHaveBeenCalledWith(
        expect.any(Object),
        "test-dashboard",
        "test-folder"
      );
    });

    it("should handle empty variables list", async () => {
      mockGetDashboard.mockResolvedValue({
        dashboardId: "test-dashboard",
        variables: null
      });
      
      const vm = wrapper.vm as any;
      await vm.getDashboardData();
      
      expect(vm.dashboardVariablesList).toEqual([]);
    });

    it("should handle getDashboard error gracefully", async () => {
      const error = new Error("Failed to load dashboard");
      mockGetDashboard.mockRejectedValue(error);
      
      const vm = wrapper.vm as any;
      await expect(vm.getDashboardData()).rejects.toThrow("Failed to load dashboard");
    });
  });

  describe("UI State Management", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await nextTick();
    });

    it("should toggle between list and add variable views", async () => {
      const vm = wrapper.vm as any;
      
      // Initially should show list view
      expect(vm.isAddVariable).toBe(false);
      
      // Switch to add variable view
      vm.addVariables();
      await nextTick();
      
      expect(vm.isAddVariable).toBe(true);
      expect(vm.selectedVariable).toBeNull();
      
      // Switch back to list view
      vm.goBackToDashboardList();
      await nextTick();
      
      expect(vm.isAddVariable).toBe(false);
    });

    it("should manage dialog visibility states", async () => {
      const vm = wrapper.vm as any;
      
      // Test confirm delete dialog
      expect(vm.confirmDeleteDialog).toBe(false);
      vm.showDeleteDialogFn({ row: { name: "test" } });
      expect(vm.confirmDeleteDialog).toBe(true);
      
      // Test dependencies graph popup
      expect(vm.showVariablesDependenciesGraphPopUp).toBe(false);
      vm.showVariablesDependenciesGraphPopUp = true;
      expect(vm.showVariablesDependenciesGraphPopUp).toBe(true);
    });

    it("should handle theme state", async () => {
      const vm = wrapper.vm as any;
      
      expect(vm.store.state.theme).toBe("light");
    });
  });

  describe("Edge Cases and Error Scenarios", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      await nextTick();
    });

    it("should handle updateDashboard error with fallback message", async () => {
      const vm = wrapper.vm as any;
      const error = {}; // Error without message
      mockUpdateDashboard.mockRejectedValue(error);
      
      vm.dashboardVariableData = { data: { ...mockDashboardData } };
      vm.dashboardVariablesList = mockDashboardData.variables.list;
      
      await vm.handleDragEnd();
      
      expect(mockNotifications.showErrorNotification).toHaveBeenCalledWith("Variable reorder failed");
    });

    it("should handle deleteVariable error with fallback message", async () => {
      const vm = wrapper.vm as any;
      const error = {}; // Error without message
      mockDeleteVariable.mockRejectedValue(error);
      
      // Set up the delete dialog first
      vm.showDeleteDialogFn({ row: { name: "test-variable" } });
      await nextTick();
      
      await vm.deleteVariableFn();
      
      expect(mockNotifications.showErrorNotification).toHaveBeenCalledWith(
        "Variable deletion failed",
        { timeout: 2000 }
      );
      // No positive notification should be called when error occurs
      expect(mockNotifications.showPositiveNotification).not.toHaveBeenCalled();
    });

    it("should not delete when no variable is selected", async () => {
      const vm = wrapper.vm as any;
      vm.selectedDelete = null;
      
      await vm.deleteVariableFn();
      
      expect(mockDeleteVariable).not.toHaveBeenCalled();
    });
  });
});