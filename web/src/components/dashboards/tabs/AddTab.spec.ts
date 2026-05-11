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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { Quasar } from "quasar";
import AddTab from "./AddTab.vue";

// Mock vue-router
const mockRoute = {
  params: { dashboard: "test-dashboard" },
  query: { folder: "test-folder" } as Record<string, string>,
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
  log: vi.fn(),
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

// ODrawer stub: exposes the migrated props and drives the
// primary/secondary buttons via emits (click:primary / click:secondary).
const ODrawerStub = {
  name: "ODrawer",
  props: [
    "open",
    "width",
    "showClose",
    "persistent",
    "size",
    "title",
    "subTitle",
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
    <div
      data-test-stub="o-drawer"
      :data-open="open"
      :data-title="title"
      :data-primary-label="primaryButtonLabel"
      :data-secondary-label="secondaryButtonLabel"
      :data-primary-loading="primaryButtonLoading"
    >
      <div data-test-stub="o-drawer-header"><slot name="header" /></div>
      <div data-test-stub="o-drawer-body"><slot /></div>
      <div data-test-stub="o-drawer-footer">
        <slot name="footer" />
        <button
          data-test-stub="o-drawer-primary"
          @click="$emit('click:primary', $event)"
        >{{ primaryButtonLabel }}</button>
        <button
          data-test-stub="o-drawer-secondary"
          @click="$emit('click:secondary', $event)"
        >{{ secondaryButtonLabel }}</button>
      </div>
    </div>
  `,
  inheritAttrs: false,
};

describe("AddTab", () => {
  let wrapper: VueWrapper<any>;
  let mockAddTab: any;
  let mockEditTab: any;
  let mockGetDashboard: any;

  const createWrapper = (props = {}) => {
    return mount(AddTab, {
      props: {
        dashboardId: "test-dashboard-id",
        open: true,
        ...props,
      },
      global: {
        plugins: [Quasar],
        stubs: {
          ODrawer: ODrawerStub,
          "q-form": {
            template:
              "<form ref=\"addTabForm\" @submit.prevent=\"$emit('submit', $event)\"><slot /></form>",
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

    mockAddTab = addTab as any;
    mockEditTab = editTab as any;
    mockGetDashboard = getDashboard as any;

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

  // Helper: locate the ODrawer stub instance for emit-driven interactions.
  const findDrawer = (w: VueWrapper<any>) =>
    w.findComponent({ name: "ODrawer" });

  describe("Component Initialization", () => {
    it("should render correctly", () => {
      wrapper = createWrapper();

      expect(wrapper.exists()).toBe(true);
      expect(findDrawer(wrapper).exists()).toBe(true);
    });

    it("should have correct component name", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.$options.name).toBe("AddTab");
    });

    it("should show 'Add Tab' title by default", () => {
      wrapper = createWrapper();

      expect(findDrawer(wrapper).props("title")).toBe("Add Tab");
    });

    it("should show 'Edit Tab' title when editMode is true", () => {
      wrapper = createWrapper({ editMode: true, tabId: "tab1" });

      expect(findDrawer(wrapper).props("title")).toBe("Edit Tab");
    });

    it("should forward 'open' prop to ODrawer", () => {
      wrapper = createWrapper({ open: true });

      expect(findDrawer(wrapper).props("open")).toBe(true);
    });

    it("should not show drawer as open when open prop is false", () => {
      wrapper = createWrapper({ open: false });

      expect(findDrawer(wrapper).props("open")).toBe(false);
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
      expect(wrapper.props("open")).toBe(true);
    });

    it("should default 'open' to false when not passed", () => {
      const component = AddTab as any;
      expect(component.props.open.default).toBe(false);
      expect(component.props.open.type).toBe(Boolean);
    });

    it("should accept all valid props", () => {
      wrapper = createWrapper({
        tabId: "test-tab",
        editMode: true,
        dashboardId: "test-dashboard",
        folderId: "test-folder",
        open: true,
      });

      expect(wrapper.props("tabId")).toBe("test-tab");
      expect(wrapper.props("editMode")).toBe(true);
      expect(wrapper.props("dashboardId")).toBe("test-dashboard");
      expect(wrapper.props("folderId")).toBe("test-folder");
      expect(wrapper.props("open")).toBe(true);
    });
  });

  describe("Form Elements", () => {
    it("should render form with name input", () => {
      wrapper = createWrapper();

      expect(wrapper.find("form").exists()).toBe(true);
      expect(
        wrapper.find('[data-test="dashboard-add-tab-name"]').exists(),
      ).toBe(true);
    });

    it("should expose primary (Save) and secondary (Cancel) buttons via ODrawer", () => {
      wrapper = createWrapper();

      const drawer = findDrawer(wrapper);
      expect(drawer.props("primaryButtonLabel")).toBe("Save");
      expect(drawer.props("secondaryButtonLabel")).toBe("Cancel");
    });
  });

  describe("Form Validation", () => {
    it("should validate name field with rules", () => {
      wrapper = createWrapper();

      const nameInput = wrapper.find('[data-test="dashboard-add-tab-name"]');
      expect(nameInput.exists()).toBe(true);

      // Input should have validation rules
      expect(nameInput.attributes("rules")).toBeDefined();
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
        { name: "New Tab", panels: [] },
      );
    });

    it("should call addTab when the ODrawer primary button is clicked", async () => {
      wrapper = createWrapper();
      wrapper.vm.tabData.name = "From Primary";
      wrapper.vm.addTabForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn(),
      };

      await findDrawer(wrapper).vm.$emit("click:primary");
      await wrapper.vm.$nextTick();

      expect(mockAddTab).toHaveBeenCalledWith(
        mockStore,
        "test-dashboard-id",
        "test-folder",
        { name: "From Primary", panels: [] },
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
      expect(wrapper.emitted("refresh")![0][0]).toEqual({
        tabId: "new-tab",
        name: "New Tab",
      });
    });

    it("should emit update:open(false) after successful add", async () => {
      wrapper = createWrapper();
      wrapper.vm.tabData.name = "New Tab";
      wrapper.vm.addTabForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn(),
      };

      await wrapper.vm.onSubmit.execute();

      const updateOpen = wrapper.emitted("update:open");
      expect(updateOpen).toBeTruthy();
      expect(updateOpen![updateOpen!.length - 1][0]).toBe(false);
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
        { timeout: 2000 },
      );
    });
  });

  describe("Edit Tab Functionality", () => {
    it("should load dashboard data in edit mode", async () => {
      wrapper = createWrapper({ editMode: true, tabId: "tab1" });

      // Wait for loadDashboardData to complete
      await wrapper.vm.$nextTick();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockGetDashboard).toHaveBeenCalledWith(
        mockStore,
        "test-dashboard-id",
        "test-folder",
      );
    });

    it("should call editTab utility when submitting in edit mode", async () => {
      wrapper = createWrapper({ editMode: true, tabId: "tab1" });

      // Wait for component to load dashboard data
      await wrapper.vm.$nextTick();
      await new Promise((resolve) => setTimeout(resolve, 0));

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
        { tabId: "tab1", name: "Updated Tab", panels: [] },
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
      expect(wrapper.emitted("refresh")![0][0]).toEqual({
        tabId: "edit-tab",
        name: "Edited Tab",
      });
    });

    it("should emit update:open(false) after successful edit", async () => {
      wrapper = createWrapper({ editMode: true, tabId: "tab1" });
      wrapper.vm.tabData = { tabId: "tab1", name: "Updated Tab", panels: [] };
      wrapper.vm.addTabForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn(),
      };

      await wrapper.vm.onSubmit.execute();

      const updateOpen = wrapper.emitted("update:open");
      expect(updateOpen).toBeTruthy();
      expect(updateOpen![updateOpen!.length - 1][0]).toBe(false);
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
        { timeout: 2000 },
      );
    });
  });

  describe("Drawer Interactions", () => {
    it("should emit update:open(false) when secondary (Cancel) is clicked", async () => {
      wrapper = createWrapper();

      await findDrawer(wrapper).vm.$emit("click:secondary");

      const updateOpen = wrapper.emitted("update:open");
      expect(updateOpen).toBeTruthy();
      expect(updateOpen![0][0]).toBe(false);
    });

    it("should not call addTab when secondary (Cancel) is clicked", async () => {
      wrapper = createWrapper();
      wrapper.vm.tabData.name = "Some Name";

      await findDrawer(wrapper).vm.$emit("click:secondary");

      expect(mockAddTab).not.toHaveBeenCalled();
    });

    it("should forward update:open from ODrawer to its parent", async () => {
      wrapper = createWrapper();

      await findDrawer(wrapper).vm.$emit("update:open", false);

      const updateOpen = wrapper.emitted("update:open");
      expect(updateOpen).toBeTruthy();
      expect(updateOpen![0][0]).toBe(false);
    });

    it("should forward true on update:open from ODrawer", async () => {
      wrapper = createWrapper({ open: false });

      await findDrawer(wrapper).vm.$emit("update:open", true);

      const updateOpen = wrapper.emitted("update:open");
      expect(updateOpen).toBeTruthy();
      expect(updateOpen![0][0]).toBe(true);
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
          data: { message: "Tab already exists" },
        },
      };

      mockAddTab.mockRejectedValue(conflictError);

      wrapper.vm.addTabForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn(),
      };

      await wrapper.vm.onSubmit.execute();

      expect(mockShowConflictErrorNotification).toHaveBeenCalledWith(
        "Tab already exists",
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

      expect(mockShowErrorNotification).toHaveBeenCalledWith("Network error", {
        timeout: 2000,
      });
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
        { timeout: 2000 },
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
        { timeout: 2000 },
      );
    });
  });

  describe("Loading State", () => {
    it("should use loading composable", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.onSubmit).toBeDefined();
      expect(wrapper.vm.onSubmit.isLoading).toBeDefined();
    });

    it("should pass primaryButtonLoading to ODrawer", () => {
      wrapper = createWrapper();

      // useLoading mock sets isLoading.value=false
      expect(findDrawer(wrapper).props("primaryButtonLoading")).toBe(false);
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
        { name: "Test Tab", panels: [] },
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
        { name: "Test Tab", panels: [] },
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
        { name: "Test Tab", panels: [] },
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
      expect(typeof wrapper.vm.submit).toBe("function");
    });

    it("should initialize isValidIdentifier as true", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.isValidIdentifier).toBe(true);
    });

    it("should expose submit() that triggers onSubmit.execute", async () => {
      wrapper = createWrapper();
      const executeSpy = vi
        .spyOn(wrapper.vm.onSubmit, "execute")
        .mockResolvedValue(undefined as any);

      wrapper.vm.submit();

      expect(executeSpy).toHaveBeenCalled();
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
    it("should use i18n for translations", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.t).toBeDefined();
      expect(wrapper.vm.t("dashboard.nameRequired")).toBe("Name is required");
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
      expect(component.emits).toContain("update:open");
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
      expect(refreshEvents![0][0]).toEqual({
        tabId: "new-tab",
        name: "New Tab",
      });
    });
  });
});
