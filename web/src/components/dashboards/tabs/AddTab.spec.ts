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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { Quasar } from "quasar";
import AddTab from "./AddTab.vue";

// Mock vue-router
const mockRoute = {
  params: { dashboard: "test-dashboard" },
  query: { folder: "test-folder" },
  name: "dashboards",
};

vi.mock("vue-router", () => ({
  useRoute: () => mockRoute,
}));

// Mock vue-i18n
const mockI18n = {
  t: (key: string) => {
    const translations: any = {
      "dashboard.nameRequired": "Name is required",
      "dashboard.cancel": "Cancel",
      "dashboard.save": "Save",
    };
    return translations[key] || key;
  },
};

vi.mock("vue-i18n", () => ({
  useI18n: () => mockI18n,
}));

// Mock Vuex store
const mockStore = {
  state: {
    selectedOrganization: {
      identifier: "test-org",
    },
  },
};

vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

// Mock console methods
global.console = {
  ...console,
  error: vi.fn(),
  warn: vi.fn(),
  log: vi.fn()
};

// Mock composables  
const mockShowPositiveNotification = vi.fn();
const mockShowErrorNotification = vi.fn();
const mockShowConflictErrorNotification = vi.fn();

vi.mock("@/composables/useLoading", () => ({
  useLoading: vi.fn((fn) => ({
    execute: fn,
    isLoading: { value: false },
  })),
}));

vi.mock("@/composables/useNotifications", () => ({
  default: () => ({
    showPositiveNotification: mockShowPositiveNotification,
    showErrorNotification: mockShowErrorNotification,
    showConfictErrorNotificationWithRefreshBtn: mockShowConflictErrorNotification,
  }),
}));

// Mock dashboard utilities
vi.mock("@/utils/commons", () => ({
  addTab: vi.fn(),
  getDashboard: vi.fn(),
  editTab: vi.fn(),
}));

vi.mock("../../../utils/commons", () => ({
  editTab: vi.fn(),
  addTab: vi.fn(),
  getDashboard: vi.fn(),
}));

describe("AddTab", () => {
  let wrapper: VueWrapper<any>;
  let mockAddTab: any;
  let mockEditTab: any;
  let mockGetDashboard: any;
  let mockNotifications: any;

  const createWrapper = (props = {}) => {
    return mount(AddTab, {
      props: {
        dashboardId: "test-dashboard-id",
        ...props,
      },
      global: {
        plugins: [Quasar],
        stubs: {
          "q-card": {
            template: '<div class="q-card"><slot /></div>',
          },
          "q-card-section": {
            template: '<div class="q-card-section"><slot /></div>',
          },
          "q-separator": {
            template: '<div class="q-separator"></div>',
          },
          "q-form": {
            template: '<form ref="addTabForm" @submit.prevent="$emit(\'submit\', $event)"><slot /></form>',
            emits: ["submit"],
            methods: {
              validate: () => Promise.resolve(true),
              resetValidation: () => Promise.resolve(),
            },
          },
          "q-input": {
            template: `<input 
              :value="modelValue" 
              @input="$emit('update:modelValue', $event.target.value)"
              data-test="dashboard-add-tab-name"
              :rules="rules"
            />`,
            props: ["modelValue", "label", "rules", "lazy-rules"],
            emits: ["update:modelValue"],
          },
          "q-btn": {
            template: '<button :disabled="disable" :loading="loading" @click="$emit(\'click\', $event)" :data-test="$attrs[\'data-test\']">{{ label || $slots.default?.[0]?.children || "" }}</button>',
            props: ["disable", "loading", "label"],
            emits: ["click"],
            inheritAttrs: false,
          },
        },
      },
    });
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Clear the notification mocks
    mockShowPositiveNotification.mockClear();
    mockShowErrorNotification.mockClear();
    mockShowConflictErrorNotification.mockClear();
    
    // Import the mocked functions
    const { addTab, getDashboard } = await import("@/utils/commons");
    const { editTab } = await import("../../../utils/commons");
    const useNotifications = (await import("@/composables/useNotifications")).default;
    
    mockAddTab = addTab as any;
    mockEditTab = editTab as any;
    mockGetDashboard = getDashboard as any;
    mockNotifications = useNotifications();
    
    mockAddTab.mockResolvedValue({ tabId: "new-tab", name: "New Tab" });
    mockEditTab.mockResolvedValue({ tabId: "edit-tab", name: "Edited Tab" });
    
    // Return the dashboard data synchronously to prevent undefined parsing
    const mockDashboardData = {
      dashboardId: "test-dashboard-id",
      tabs: [
        { tabId: "tab1", name: "Tab 1", panels: [] },
        { tabId: "tab2", name: "Tab 2", panels: [] },
      ],
    };
    mockGetDashboard.mockResolvedValue(mockDashboardData);
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Component Initialization", () => {
    it("should render correctly", () => {
      wrapper = createWrapper();
      
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find(".q-card").exists()).toBe(true);
    });

    it("should have correct component name", () => {
      wrapper = createWrapper();
      
      expect(wrapper.vm.$options.name).toBe("AddTab");
    });

    it("should show add mode by default", () => {
      wrapper = createWrapper();
      
      expect(wrapper.find('[data-test="dashboard-tab-add"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-tab-edit"]').exists()).toBe(false);
    });

    it("should show edit mode when editMode prop is true", () => {
      wrapper = createWrapper({ editMode: true, tabId: "tab1" });
      
      expect(wrapper.find('[data-test="dashboard-tab-edit"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-tab-add"]').exists()).toBe(false);
    });
  });

  describe("Props Validation", () => {
    it("should require dashboardId prop", () => {
      const component = AddTab as any;
      expect(component.props.dashboardId.required).toBe(true);
    });

    it("should have correct prop validators", () => {
      const component = AddTab as any;
      
      // Test tabId validator
      expect(component.props.tabId.validator("string")).toBe(true);
      expect(component.props.tabId.validator(null)).toBe(true);
      expect(component.props.tabId.validator(123)).toBe(false);
      
      // Test dashboardId validator
      expect(component.props.dashboardId.validator("string")).toBe(true);
      expect(component.props.dashboardId.validator(null)).toBe(true);
      expect(component.props.dashboardId.validator(123)).toBe(false);
    });

    it("should have correct default values", () => {
      wrapper = createWrapper();
      
      expect(wrapper.props("editMode")).toBe(false);
      expect(wrapper.props("tabId")).toBe(null);
    });

    it("should accept all valid props", () => {
      wrapper = createWrapper({
        tabId: "test-tab",
        editMode: true,
        dashboardId: "test-dashboard",
        folderId: "test-folder",
      });
      
      expect(wrapper.props("tabId")).toBe("test-tab");
      expect(wrapper.props("editMode")).toBe(true);
      expect(wrapper.props("dashboardId")).toBe("test-dashboard");
      expect(wrapper.props("folderId")).toBe("test-folder");
    });
  });

  describe("Form Elements", () => {
    it("should render form with name input", () => {
      wrapper = createWrapper();
      
      expect(wrapper.find("form").exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-add-tab-name"]').exists()).toBe(true);
    });

    it("should render cancel and submit buttons", () => {
      wrapper = createWrapper();
      
      expect(wrapper.find('[data-test="dashboard-add-cancel"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-add-tab-submit"]').exists()).toBe(true);
    });

    it("should render close button in header", () => {
      wrapper = createWrapper();
      
      expect(wrapper.find('[data-test="dashboard-tab-cancel"]').exists()).toBe(true);
    });

    it("should have correct button labels", () => {
      wrapper = createWrapper();
      
      const cancelButton = wrapper.find('[data-test="dashboard-add-cancel"]');
      const submitButton = wrapper.find('[data-test="dashboard-add-tab-submit"]');
      
      expect(cancelButton.text()).toBe("Cancel");
      expect(submitButton.text()).toBe("Save");
    });
  });

  describe("Form Validation", () => {
    it("should disable submit button when name is empty", async () => {
      wrapper = createWrapper();
      
      const submitButton = wrapper.find('[data-test="dashboard-add-tab-submit"]');
      expect(submitButton.attributes("disabled")).toBeDefined();
    });

    it("should enable submit button when name is provided", async () => {
      wrapper = createWrapper();
      
      const nameInput = wrapper.find('[data-test="dashboard-add-tab-name"]');
      await nameInput.setValue("Test Tab Name");
      
      const submitButton = wrapper.find('[data-test="dashboard-add-tab-submit"]');
      expect(submitButton.attributes("disabled")).toBeUndefined();
    });

    it("should validate name field with rules", () => {
      wrapper = createWrapper();
      
      const nameInput = wrapper.find('[data-test="dashboard-add-tab-name"]');
      expect(nameInput.exists()).toBe(true);
      
      // Input should have validation rules
      expect(nameInput.attributes("rules")).toBeDefined();
    });

    it("should trim whitespace from name validation", async () => {
      wrapper = createWrapper();
      
      // Set name to only whitespace
      wrapper.vm.tabData.name = "   ";
      await wrapper.vm.$nextTick();
      
      const submitButton = wrapper.find('[data-test="dashboard-add-tab-submit"]');
      expect(submitButton.attributes("disabled")).toBeDefined();
    });
  });

  describe("Data Handling", () => {
    it("should initialize with default data", () => {
      wrapper = createWrapper();
      
      expect(wrapper.vm.tabData.name).toBe("");
      expect(wrapper.vm.tabData.panels).toEqual([]);
    });

    it("should handle input changes", async () => {
      wrapper = createWrapper();
      
      const nameInput = wrapper.find('[data-test="dashboard-add-tab-name"]');
      await nameInput.setValue("New Tab Name");
      
      expect(wrapper.vm.tabData.name).toBe("New Tab Name");
    });

    it("should reset form data after successful submission", async () => {
      wrapper = createWrapper();
      
      wrapper.vm.tabData.name = "Test Tab";
      await wrapper.vm.onSubmit.execute();
      
      expect(wrapper.vm.tabData.name).toBe("");
      expect(wrapper.vm.tabData.panels).toEqual([]);
    });
  });

  describe("Add Tab Functionality", () => {
    it("should call addTab utility when submitting in add mode", async () => {
      wrapper = createWrapper();
      wrapper.vm.tabData.name = "New Tab";
      
      // Mock form validation to return true
      wrapper.vm.addTabForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn(),
      };
      
      await wrapper.vm.onSubmit.execute();
      
      expect(mockAddTab).toHaveBeenCalledWith(
        mockStore,
        "test-dashboard-id",
        "test-folder",
        { name: "New Tab", panels: [] }
      );
    });

    it("should emit refresh event after successful add", async () => {
      wrapper = createWrapper();
      wrapper.vm.tabData.name = "New Tab";
      
      wrapper.vm.addTabForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn(),
      };
      
      await wrapper.vm.onSubmit.execute();
      
      expect(wrapper.emitted("refresh")).toBeTruthy();
      expect(wrapper.emitted("refresh")[0][0]).toEqual({ tabId: "new-tab", name: "New Tab" });
    });

    it("should show success notification after add", async () => {
      wrapper = createWrapper();
      wrapper.vm.tabData.name = "New Tab";
      
      wrapper.vm.addTabForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn(),
      };
      
      await wrapper.vm.onSubmit.execute();
      
      expect(mockShowPositiveNotification).toHaveBeenCalledWith(
        "Tab added successfully",
        { timeout: 2000 }
      );
    });
  });

  describe("Edit Tab Functionality", () => {
    it("should load dashboard data in edit mode", async () => {
      wrapper = createWrapper({ editMode: true, tabId: "tab1" });
      
      // Wait for loadDashboardData to complete
      await wrapper.vm.$nextTick();
      await new Promise(resolve => setTimeout(resolve, 0));
      
      expect(mockGetDashboard).toHaveBeenCalledWith(
        mockStore,
        "test-dashboard-id",
        "test-folder"
      );
    });

    it("should call editTab utility when submitting in edit mode", async () => {
      wrapper = createWrapper({ editMode: true, tabId: "tab1" });
      
      // Wait for component to load dashboard data
      await wrapper.vm.$nextTick();
      await new Promise(resolve => setTimeout(resolve, 0));
      
      // Now update the name
      wrapper.vm.tabData.name = "Updated Tab";
      
      wrapper.vm.addTabForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn(),
      };
      
      await wrapper.vm.onSubmit.execute();
      
      expect(mockEditTab).toHaveBeenCalledWith(
        mockStore,
        "test-dashboard-id",
        "test-folder",
        "tab1",
        { tabId: "tab1", name: "Updated Tab", panels: [] }
      );
    });

    it("should emit refresh event after successful edit", async () => {
      wrapper = createWrapper({ editMode: true, tabId: "tab1" });
      wrapper.vm.tabData = { tabId: "tab1", name: "Updated Tab", panels: [] };
      
      wrapper.vm.addTabForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn(),
      };
      
      await wrapper.vm.onSubmit.execute();
      
      expect(wrapper.emitted("refresh")).toBeTruthy();
      expect(wrapper.emitted("refresh")[0][0]).toEqual({ tabId: "edit-tab", name: "Edited Tab" });
    });

    it("should show success notification after edit", async () => {
      wrapper = createWrapper({ editMode: true, tabId: "tab1" });
      wrapper.vm.tabData.name = "Updated Tab";
      
      wrapper.vm.addTabForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn(),
      };
      
      await wrapper.vm.onSubmit.execute();
      
      expect(mockShowPositiveNotification).toHaveBeenCalledWith(
        "Tab updated successfully",
        { timeout: 2000 }
      );
    });
  });

  describe("Error Handling", () => {
    it("should not submit if form validation fails", async () => {
      wrapper = createWrapper();
      
      wrapper.vm.addTabForm = {
        validate: vi.fn().mockResolvedValue(false),
        resetValidation: vi.fn(),
      };
      
      await wrapper.vm.onSubmit.execute();
      
      expect(mockAddTab).not.toHaveBeenCalled();
      expect(wrapper.emitted("refresh")).toBeFalsy();
    });

    it("should handle 409 conflict errors", async () => {
      wrapper = createWrapper();
      wrapper.vm.tabData.name = "Test Tab";
      
      const conflictError = {
        response: { 
          status: 409, 
          data: { message: "Tab already exists" } 
        }
      };
      
      mockAddTab.mockRejectedValue(conflictError);
      
      wrapper.vm.addTabForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn(),
      };
      
      await wrapper.vm.onSubmit.execute();
      
      expect(mockShowConflictErrorNotification).toHaveBeenCalledWith(
        "Tab already exists"
      );
    });

    it("should handle general errors", async () => {
      wrapper = createWrapper();
      wrapper.vm.tabData.name = "Test Tab";
      
      const generalError = new Error("Network error");
      mockAddTab.mockRejectedValue(generalError);
      
      wrapper.vm.addTabForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn(),
      };
      
      await wrapper.vm.onSubmit.execute();
      
      expect(mockShowErrorNotification).toHaveBeenCalledWith(
        "Network error",
        { timeout: 2000 }
      );
    });

    it("should handle errors without message in add mode", async () => {
      wrapper = createWrapper();
      wrapper.vm.tabData.name = "Test Tab";
      
      mockAddTab.mockRejectedValue({});
      
      wrapper.vm.addTabForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn(),
      };
      
      await wrapper.vm.onSubmit.execute();
      
      expect(mockShowErrorNotification).toHaveBeenCalledWith(
        "Failed to add tab",
        { timeout: 2000 }
      );
    });

    it("should handle errors without message in edit mode", async () => {
      wrapper = createWrapper({ editMode: true, tabId: "tab1" });
      wrapper.vm.tabData.name = "Test Tab";
      
      mockEditTab.mockRejectedValue({});
      
      wrapper.vm.addTabForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn(),
      };
      
      await wrapper.vm.onSubmit.execute();
      
      expect(mockShowErrorNotification).toHaveBeenCalledWith(
        "Failed to update tab",
        { timeout: 2000 }
      );
    });
  });

  describe("Loading State", () => {
    it("should use loading composable", () => {
      wrapper = createWrapper();
      
      expect(wrapper.vm.onSubmit).toBeDefined();
      expect(wrapper.vm.onSubmit.isLoading).toBeDefined();
    });

    it("should show loading state on submit button", () => {
      wrapper = createWrapper();
      
      const submitButton = wrapper.find('[data-test="dashboard-add-tab-submit"]');
      expect(submitButton.attributes("loading")).toBeDefined();
    });
  });

  describe("Folder Handling", () => {
    it("should use folderId prop when provided", async () => {
      wrapper = createWrapper({ folderId: "custom-folder" });
      wrapper.vm.tabData.name = "Test Tab";
      
      wrapper.vm.addTabForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn(),
      };
      
      await wrapper.vm.onSubmit.execute();
      
      expect(mockAddTab).toHaveBeenCalledWith(
        mockStore,
        "test-dashboard-id",
        "custom-folder",
        { name: "Test Tab", panels: [] }
      );
    });

    it("should fall back to route query folder", async () => {
      wrapper = createWrapper();
      wrapper.vm.tabData.name = "Test Tab";
      
      wrapper.vm.addTabForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn(),
      };
      
      await wrapper.vm.onSubmit.execute();
      
      expect(mockAddTab).toHaveBeenCalledWith(
        mockStore,
        "test-dashboard-id",
        "test-folder",
        { name: "Test Tab", panels: [] }
      );
    });

    it("should use default folder when no folder specified", async () => {
      // Modify route to have no folder query
      const originalQuery = mockRoute.query;
      mockRoute.query = {};
      
      wrapper = createWrapper();
      wrapper.vm.tabData.name = "Test Tab";
      
      wrapper.vm.addTabForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn(),
      };
      
      await wrapper.vm.onSubmit.execute();
      
      expect(mockAddTab).toHaveBeenCalledWith(
        mockStore,
        "test-dashboard-id",
        "default",
        { name: "Test Tab", panels: [] }
      );
      
      // Restore original query
      mockRoute.query = originalQuery;
    });
  });

  describe("Component Methods", () => {
    it("should have correct setup return values", () => {
      wrapper = createWrapper();
      
      expect(wrapper.vm.t).toBeDefined();
      expect(wrapper.vm.tabData).toBeDefined();
      expect(wrapper.vm.addTabForm).toBeDefined();
      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.isValidIdentifier).toBeDefined();
      expect(wrapper.vm.onSubmit).toBeDefined();
    });

    it("should initialize isValidIdentifier as true", () => {
      wrapper = createWrapper();
      
      expect(wrapper.vm.isValidIdentifier).toBe(true);
    });
  });

  describe("Form Submission", () => {
    it("should trigger form validation on submit", async () => {
      wrapper = createWrapper();
      
      const mockValidate = vi.fn().mockResolvedValue(true);
      wrapper.vm.addTabForm = {
        validate: mockValidate,
        resetValidation: vi.fn(),
      };
      
      await wrapper.vm.onSubmit.execute();
      
      expect(mockValidate).toHaveBeenCalled();
    });

    it("should reset form validation after success", async () => {
      wrapper = createWrapper();
      wrapper.vm.tabData.name = "Test Tab";
      
      const mockResetValidation = vi.fn();
      wrapper.vm.addTabForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: mockResetValidation,
      };
      
      await wrapper.vm.onSubmit.execute();
      
      expect(mockResetValidation).toHaveBeenCalled();
    });
  });

  describe("Internationalization", () => {
    it("should use i18n for labels", () => {
      wrapper = createWrapper();
      
      expect(wrapper.vm.t).toBeDefined();
      
      const cancelButton = wrapper.find('[data-test="dashboard-add-cancel"]');
      const submitButton = wrapper.find('[data-test="dashboard-add-tab-submit"]');
      
      expect(cancelButton.text()).toBe("Cancel");
      expect(submitButton.text()).toBe("Save");
    });
  });

  describe("Component Lifecycle", () => {
    it("should load dashboard data on component creation in edit mode", async () => {
      wrapper = createWrapper({ editMode: true, tabId: "tab1" });
      
      // Wait for async loadDashboardData to be called
      await wrapper.vm.$nextTick();
      
      expect(mockGetDashboard).toHaveBeenCalled();
    });

    it("should not load dashboard data in add mode", () => {
      wrapper = createWrapper();
      
      expect(mockGetDashboard).not.toHaveBeenCalled();
    });

    it("should handle component unmounting gracefully", () => {
      wrapper = createWrapper();
      
      expect(() => wrapper.unmount()).not.toThrow();
    });
  });

  describe("Event Emissions", () => {
    it("should have correct emits configuration", () => {
      const component = AddTab as any;
      expect(component.emits).toContain("refresh");
    });

    it("should emit refresh with correct payload", async () => {
      wrapper = createWrapper();
      wrapper.vm.tabData.name = "Test Tab";
      
      wrapper.vm.addTabForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn(),
      };
      
      await wrapper.vm.onSubmit.execute();
      
      const refreshEvents = wrapper.emitted("refresh");
      expect(refreshEvents).toBeTruthy();
      expect(refreshEvents[0][0]).toEqual({ tabId: "new-tab", name: "New Tab" });
    });
  });
});