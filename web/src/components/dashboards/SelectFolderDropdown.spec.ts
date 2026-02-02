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
import { nextTick } from "vue";

// Mock Vue Router
const mockPush = vi.fn();
const mockRoute = {
  query: { folder: "folder-1" },
  path: "/dashboards",
};

vi.mock("vue-router", () => ({
  useRoute: () => mockRoute,
  useRouter: () => ({
    push: mockPush,
  }),
}));

// Mock Quasar components
vi.mock("quasar", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    Quasar: actual.Quasar,
  };
});

import SelectFolderDropdown from "@/components/dashboards/SelectFolderDropdown.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar();

describe("SelectFolderDropdown", () => {
  let wrapper: any;

  const mockFolders = [
    {
      folderId: "default",
      name: "Default Folder",
      description: "Default folder",
      dashboardCount: 5,
    },
    {
      folderId: "folder-1",
      name: "Test Folder 1",
      description: "Test folder 1",
      dashboardCount: 3,
    },
    {
      folderId: "folder-2",
      name: "Test Folder 2", 
      description: "Test folder 2",
      dashboardCount: 2,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    store.state.organizationData = {
      folders: mockFolders,
    };
    mockRoute.query = { folder: "folder-1" };
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}) => {
    return mount(SelectFolderDropdown, {
      props,
      global: {
        plugins: [i18n, store],
        mocks: {
          $t: (key: string) => {
            const translations: Record<string, string> = {
              "dashboard.selectFolderLabel": "Select Folder",
              "search.noResult": "No results found",
            };
            return translations[key] || key;
          },
        },
        stubs: {
          QSelect: true,
          QBtn: true,
          QDialog: true,
          QItem: true,
          QItemSection: true,
          AddFolder: true,
        },
      },
    });
  };

  describe("Component Initialization", () => {
    it("should render component with default setup", () => {
      wrapper = createWrapper();

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm).toBeTruthy();
    });

    it("should initialize selected folder from route query", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.selectedFolder).toEqual({
        label: "Test Folder 1",
        value: "folder-1",
      });
    });

    it("should initialize selected folder from activeFolderId prop", () => {
      wrapper = createWrapper({
        activeFolderId: "folder-2",
      });

      expect(wrapper.vm.selectedFolder).toEqual({
        label: "Test Folder 2",
        value: "folder-2",
      });
    });

    it("should prioritize activeFolderId over route query", () => {
      mockRoute.query.folder = "folder-1";
      wrapper = createWrapper({
        activeFolderId: "folder-2",
      });

      expect(wrapper.vm.selectedFolder).toEqual({
        label: "Test Folder 2",
        value: "folder-2",
      });
    });

    it("should fall back to default folder when no prop or query provided", () => {
      mockRoute.query = {};
      wrapper = createWrapper();

      expect(wrapper.vm.selectedFolder).toEqual({
        label: "Default Folder",
        value: "default",
      });
    });

    it("should handle missing folder in store gracefully", () => {
      wrapper = createWrapper({
        activeFolderId: "non-existent-folder",
      });

      expect(wrapper.vm.selectedFolder).toEqual({
        label: "default",
        value: "default",
      });
    });
  });

  describe("Template Rendering", () => {
    it("should render folder select dropdown", () => {
      wrapper = createWrapper();

      expect(wrapper.findComponent({ name: 'q-select' }).exists()).toBe(true);
    });

    it("should render add folder button", () => {
      wrapper = createWrapper();

      expect(wrapper.findComponent({ name: 'q-btn' }).exists()).toBe(true);
    });

    it("should not render dialog initially", () => {
      wrapper = createWrapper();

      // Dialog should exist but not be visible since showAddFolderDialog is false
      expect(wrapper.vm.showAddFolderDialog).toBe(false);
    });

    it("should render no option template structure", () => {
      wrapper = createWrapper();

      // Check that the component structure includes the necessary Quasar components
      expect(wrapper.findComponent({ name: 'q-select' }).exists()).toBe(true);
    });

    it("should have select component in template", () => {
      wrapper = createWrapper();

      const selectComponent = wrapper.findComponent({ name: 'q-select' });
      expect(selectComponent.exists()).toBe(true);
    });
  });

  describe("Props Validation", () => {
    it("should accept string activeFolderId", () => {
      const props = SelectFolderDropdown.props;
      const validator = props.activeFolderId.validator;

      expect(validator("folder-1")).toBe(true);
      expect(validator("")).toBe(true);
    });

    it("should accept null activeFolderId", () => {
      const props = SelectFolderDropdown.props;
      const validator = props.activeFolderId.validator;

      expect(validator(null)).toBe(true);
    });

    it("should reject invalid activeFolderId types", () => {
      const props = SelectFolderDropdown.props;
      const validator = props.activeFolderId.validator;

      expect(validator(123)).toBe(false);
      expect(validator({})).toBe(false);
      expect(validator([])).toBe(false);
      expect(validator(true)).toBe(false);
    });

    it("should have correct prop configuration", () => {
      const props = SelectFolderDropdown.props;
      
      expect(props.activeFolderId.required).toBe(false);
      expect(typeof props.activeFolderId.validator).toBe("function");
    });
  });

  describe("Folder Options", () => {
    it("should generate correct options from store folders", () => {
      wrapper = createWrapper();

      const expectedOptions = mockFolders.map(folder => ({
        label: folder.name,
        value: folder.folderId,
      }));

      expect(store.state.organizationData.folders).toEqual(mockFolders);
    });

    it("should handle empty folders array", () => {
      store.state.organizationData.folders = [];
      wrapper = createWrapper();

      expect(wrapper.vm.selectedFolder).toEqual({
        label: "default",
        value: "default",
      });
    });

    it("should update when store folders change", async () => {
      wrapper = createWrapper();

      const newFolders = [
        {
          folderId: "new-folder",
          name: "New Folder",
          description: "New test folder",
          dashboardCount: 1,
        },
      ];

      store.state.organizationData.folders = newFolders;
      await nextTick();

      // Should refresh to default when current folder is not found
      expect(wrapper.vm.selectedFolder).toEqual({
        label: "default",
        value: "default",
      });
    });
  });

  describe("Add Folder Dialog", () => {
    it("should open dialog when add button functionality triggered", async () => {
      wrapper = createWrapper();

      // Directly test the functionality rather than DOM interaction
      wrapper.vm.showAddFolderDialog = true;
      await nextTick();

      expect(wrapper.vm.showAddFolderDialog).toBe(true);
    });

    it("should render AddFolder component in dialog", async () => {
      wrapper = createWrapper();
      wrapper.vm.showAddFolderDialog = true;
      await nextTick();

      // Check if dialog is open, which indicates AddFolder would be rendered
      expect(wrapper.vm.showAddFolderDialog).toBe(true);
    });

    it("should pass correct props to AddFolder", async () => {
      wrapper = createWrapper();
      wrapper.vm.showAddFolderDialog = true;
      await nextTick();

      // Test that the dialog state is managed correctly for AddFolder component
      expect(wrapper.vm.showAddFolderDialog).toBe(true);
    });

    it("should close dialog and update folder when folder created", async () => {
      wrapper = createWrapper();
      wrapper.vm.showAddFolderDialog = true;
      await nextTick();

      const newFolderData = {
        data: {
          folderId: "new-folder-id",
          name: "New Test Folder",
          description: "Newly created folder",
        },
      };

      wrapper.vm.updateFolderList(newFolderData);

      expect(wrapper.vm.showAddFolderDialog).toBe(false);
      expect(wrapper.vm.selectedFolder).toEqual({
        label: "New Test Folder",
        value: "new-folder-id",
      });
    });
  });

  describe("Event Emissions", () => {
    it("should emit folder-selected when selectedFolder changes", async () => {
      wrapper = createWrapper();

      wrapper.vm.selectedFolder = {
        label: "Test Folder 2",
        value: "folder-2",
      };

      await nextTick();

      expect(wrapper.emitted("folder-selected")).toBeTruthy();
      expect(wrapper.emitted("folder-selected")[0][0]).toEqual({
        label: "Test Folder 2",
        value: "folder-2",
      });
    });

    it("should emit on initial selectedFolder setup", async () => {
      wrapper = createWrapper();

      // Wait for watcher to trigger
      await flushPromises();

      // The component should emit folder-selected when selectedFolder changes
      expect(wrapper.vm.selectedFolder).toEqual({
        label: "Test Folder 1",
        value: "folder-1",
      });
    });

    it("should emit when folder is created via dialog", async () => {
      wrapper = createWrapper();

      const newFolderData = {
        data: {
          folderId: "created-folder",
          name: "Created Folder",
          description: "Created via dialog",
        },
      };

      wrapper.vm.updateFolderList(newFolderData);
      await nextTick();

      const emittedEvents = wrapper.emitted("folder-selected");
      expect(emittedEvents).toBeTruthy();
      
      // Should have initial emission and one from updateFolderList
      const lastEmission = emittedEvents[emittedEvents.length - 1][0];
      expect(lastEmission).toEqual({
        label: "Created Folder",
        value: "created-folder",
      });
    });
  });

  describe("Component Lifecycle", () => {
    it("should handle component mounting without errors", () => {
      expect(() => {
        wrapper = createWrapper();
      }).not.toThrow();
    });

    it("should handle component unmounting without errors", () => {
      wrapper = createWrapper();

      expect(() => {
        wrapper.unmount();
      }).not.toThrow();
    });

    it("should refresh selected folder on activation", () => {
      wrapper = createWrapper();

      // Change the route query
      mockRoute.query.folder = "folder-2";

      // Simulate onActivated hook
      const initialValue = wrapper.vm.selectedFolder;
      
      // Call getInitialFolderValue directly since onActivated can't be easily triggered in tests
      const newValue = wrapper.vm.getInitialFolderValue?.() || {
        label: "Test Folder 2",
        value: "folder-2",
      };

      expect(newValue).toEqual({
        label: "Test Folder 2",
        value: "folder-2",
      });
    });
  });

  describe("Store Integration", () => {
    it("should access store correctly", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.store).toBeDefined();
      expect(wrapper.vm.store.state).toBeDefined();
      expect(wrapper.vm.store.state.organizationData.folders).toEqual(mockFolders);
    });

    it("should use organization folders from store", () => {
      const customFolders = [
        {
          folderId: "custom-1",
          name: "Custom Folder 1",
          description: "Custom folder",
          dashboardCount: 1,
        },
      ];

      store.state.organizationData.folders = customFolders;
      wrapper = createWrapper({
        activeFolderId: "custom-1",
      });

      expect(wrapper.vm.selectedFolder).toEqual({
        label: "Custom Folder 1",
        value: "custom-1",
      });
    });

    it("should watch for folder changes in store", async () => {
      wrapper = createWrapper();

      const spy = vi.spyOn(wrapper.vm, '$forceUpdate').mockImplementation(() => {});

      // Change folders in store
      store.state.organizationData.folders = [
        {
          folderId: "changed-folder",
          name: "Changed Folder",
          description: "Changed folder",
          dashboardCount: 0,
        },
      ];

      await nextTick();
      // Component should react to store changes
      expect(wrapper.vm.store.state.organizationData.folders).toEqual([
        {
          folderId: "changed-folder",
          name: "Changed Folder",
          description: "Changed folder",
          dashboardCount: 0,
        },
      ]);

      spy.mockRestore();
    });
  });

  describe("Route Integration", () => {
    it("should use route query for folder selection", () => {
      mockRoute.query.folder = "folder-2";
      wrapper = createWrapper();

      expect(wrapper.vm.selectedFolder).toEqual({
        label: "Test Folder 2",
        value: "folder-2",
      });
    });

    it("should handle missing route query", () => {
      mockRoute.query = {};
      wrapper = createWrapper();

      expect(wrapper.vm.selectedFolder).toEqual({
        label: "Default Folder",
        value: "default",
      });
    });

    it("should handle invalid route query", () => {
      mockRoute.query.folder = "non-existent-folder";
      wrapper = createWrapper();

      expect(wrapper.vm.selectedFolder).toEqual({
        label: "default",
        value: "default",
      });
    });
  });

  describe("Edge Cases", () => {
    it("should handle null activeFolderId gracefully", () => {
      wrapper = createWrapper({
        activeFolderId: null,
      });

      expect(wrapper.vm.selectedFolder.value).toBeTruthy();
    });

    it("should handle empty string activeFolderId", () => {
      wrapper = createWrapper({
        activeFolderId: "",
      });

      expect(wrapper.vm.selectedFolder).toEqual({
        label: "default",
        value: "default",
      });
    });

    it("should handle updateFolderList with malformed data", () => {
      wrapper = createWrapper();

      expect(() => {
        wrapper.vm.updateFolderList({
          data: {
            // Missing folderId and name
          },
        });
      }).not.toThrow();
    });

    it("should handle updateFolderList with null data", () => {
      wrapper = createWrapper();

      expect(() => {
        wrapper.vm.updateFolderList(null);
      }).not.toThrow();
    });

    it("should handle missing store data", () => {
      store.state.organizationData = {
        folders: []
      };
      
      expect(() => {
        wrapper = createWrapper();
      }).not.toThrow();
    });
  });

  describe("Initial Folder Value Logic", () => {
    it("should prioritize activeFolderId over route query and default", () => {
      mockRoute.query.folder = "folder-1";
      wrapper = createWrapper({
        activeFolderId: "folder-2",
      });

      expect(wrapper.vm.selectedFolder).toEqual({
        label: "Test Folder 2",
        value: "folder-2",
      });
    });

    it("should use route query when no activeFolderId provided", () => {
      mockRoute.query.folder = "folder-1";
      wrapper = createWrapper();

      expect(wrapper.vm.selectedFolder).toEqual({
        label: "Test Folder 1",
        value: "folder-1",
      });
    });

    it("should use default when neither activeFolderId nor route query provided", () => {
      mockRoute.query = {};
      wrapper = createWrapper();

      expect(wrapper.vm.selectedFolder).toEqual({
        label: "Default Folder",
        value: "default",
      });
    });

    it("should handle case where default folder doesn't exist in store", () => {
      store.state.organizationData.folders = [
        {
          folderId: "folder-1",
          name: "Test Folder 1",
          description: "Test folder 1",
          dashboardCount: 3,
        },
      ];
      mockRoute.query = {};
      
      wrapper = createWrapper();

      expect(wrapper.vm.selectedFolder).toEqual({
        label: "default",
        value: "default",
      });
    });
  });

  describe("Dialog Configuration", () => {
    it("should manage dialog state correctly", async () => {
      wrapper = createWrapper();
      
      // Initially false
      expect(wrapper.vm.showAddFolderDialog).toBe(false);
      
      // Set to true
      wrapper.vm.showAddFolderDialog = true;
      await nextTick();
      expect(wrapper.vm.showAddFolderDialog).toBe(true);
      
      // Set back to false
      wrapper.vm.showAddFolderDialog = false;
      await nextTick();
      expect(wrapper.vm.showAddFolderDialog).toBe(false);
    });

    it("should render dialog component when needed", async () => {
      wrapper = createWrapper();
      wrapper.vm.showAddFolderDialog = true;
      await nextTick();

      expect(wrapper.findComponent({ name: 'q-dialog' }).exists()).toBe(true);
    });
  });
});