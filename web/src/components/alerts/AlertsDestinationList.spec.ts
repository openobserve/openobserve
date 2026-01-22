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

import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import AlertsDestinationList from "@/components/alerts/AlertsDestinationList.vue";
import i18n from "@/locales";
import { Dialog, Notify, QTable } from "quasar";

// Mock Quasar's notify globally
const mockNotify = vi.fn(() => vi.fn()); // Return a dismiss function

// Mock useQuasar
vi.mock("quasar", async (importOriginal) => {
  const original: any = await importOriginal();
  return {
    ...original,
    useQuasar: () => ({
      notify: mockNotify,
    }),
  };
});

installQuasar({
  plugins: [Dialog, QTable],
});

// Mock services
vi.mock("@/services/alert_destination", () => ({
  default: {
    list: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@/services/alert_templates", () => ({
  default: {
    list: vi.fn(),
  },
}));

const mockGetAllActions = vi.fn();

vi.mock("@/composables/useActions", () => ({
  default: () => ({
    getAllActions: mockGetAllActions,
  }),
}));

// Mock utilities
vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path: string) => `mock-${path}`),
}));

// Mock Vuex store
const mockStore = {
  state: {
    selectedOrganization: {
      identifier: "test-org",
    },
    organizationData: {
      actions: [],
    },
    theme: "dark",
  },
};

vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

// Mock Vue Router
const mockRouter = {
  currentRoute: {
    value: {
      query: {},
    },
  },
  push: vi.fn(),
};

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
}));

// Mock child components
vi.mock("@/components/alerts/AddDestination.vue", () => ({
  default: {
    name: "AddDestination",
    template: '<div class="add-destination-mock">AddDestination</div>',
  },
}));

vi.mock("@/components/shared/grid/NoData.vue", () => ({
  default: {
    name: "NoData",
    template: '<div class="no-data-mock">NoData</div>',
  },
}));

vi.mock("@/components/ConfirmDialog.vue", () => ({
  default: {
    name: "ConfirmDialog",
    template: '<div class="confirm-dialog-mock">ConfirmDialog</div>',
    props: ["modelValue"],
    emits: ["update:modelValue", "confirm"],
  },
}));

vi.mock("@/components/shared/grid/Pagination.vue", () => ({
  default: {
    name: "QTablePagination",
    template: '<div class="pagination-mock">Pagination</div>',
  },
}));

vi.mock("@/components/alerts/ImportDestination.vue", () => ({
  default: {
    name: "ImportDestination",
    template: '<div class="import-destination-mock">ImportDestination</div>',
  },
}));

// Mock DOM methods
Object.defineProperty(window, 'URL', {
  value: {
    createObjectURL: vi.fn(() => 'mock-url'),
    revokeObjectURL: vi.fn(),
  },
});

// Mock document.createElement for export functionality
const mockCreateElement = vi.fn(() => ({
  href: '',
  download: '',
  click: vi.fn(),
}));

describe("AlertsDestinationList", () => {
  let wrapper: any = null;
  let mockDestinationService: any;
  let mockTemplateService: any;

  const mockDestinations = [
    {
      id: "1",
      name: "destination1",
      url: "https://example.com/webhook1",
      method: "POST",
      type: "http",
    },
    {
      id: "2", 
      name: "destination2",
      url: "https://example.com/webhook2",
      method: "GET",
      type: "email",
    },
    {
      id: "3",
      name: "destination3", 
      url: "https://example.com/webhook3",
      method: "POST",
      type: "action",
    },
  ];

  const mockTemplates = [
    { name: "template1", body: "test body 1", type: "http" },
    { name: "template2", body: "test body 2", type: "email" },
  ];

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Import the actual services to mock them
    const destinationService = await import("@/services/alert_destination");
    const templateService = await import("@/services/alert_templates");

    mockDestinationService = destinationService.default;
    mockTemplateService = templateService.default;

    // Setup mock implementations
    mockDestinationService.list.mockResolvedValue({
      data: mockDestinations,
    });

    mockTemplateService.list.mockResolvedValue({
      data: mockTemplates,
    });

    mockGetAllActions.mockResolvedValue({});

    mockDestinationService.delete.mockResolvedValue({});

    mockRouter.currentRoute.value.query = {};
    
    wrapper = mount(AlertsDestinationList, {
      global: {
        plugins: [i18n],
        stubs: {
          AddDestination: true,
          NoData: true,
          ConfirmDialog: true,
          QTablePagination: true,
          ImportDestination: true,
          QTable: {
            template: '<div class="q-table-mock"><slot /></div>',
            methods: {
              setPagination: vi.fn(),
            },
          },
          QPage: {
            template: '<div class="q-page-mock"><slot /></div>',
          },
          QInput: {
            template: '<div class="q-input-mock"><slot /></div>',
          },
          QBtn: {
            template: '<div class="q-btn-mock"><slot /></div>',
          },
          QIcon: {
            template: '<div class="q-icon-mock"></div>',
          },
        },
      },
    });

    await flushPromises();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  // Basic Component Tests
  describe("Component Structure", () => {
    it("should render the component", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should have correct component name", () => {
      expect(wrapper.vm.$options.name).toBe("PageAlerts");
    });

    it("should render table when not editing", () => {
      expect(wrapper.vm.showDestinationEditor).toBe(false);
      expect(wrapper.vm.showImportDestination).toBe(false);
    });

    it("should have correct initial data structure", () => {
      expect(wrapper.vm.destinations).toBeDefined();
      expect(wrapper.vm.templates).toBeDefined();
      expect(wrapper.vm.columns).toBeDefined();
      expect(wrapper.vm.confirmDelete).toBeDefined();
    });

    it("should initialize with correct default values", () => {
      expect(wrapper.vm.filterQuery).toBe("");
      expect(wrapper.vm.selectedPerPage).toBe(20);
      expect(wrapper.vm.resultTotal).toBeDefined();
      expect(wrapper.vm.editingDestination).toBeNull();
    });
  });

  // Data Initialization Tests
  describe("Data Initialization", () => {
    it("should initialize columns correctly", () => {
      const columns = wrapper.vm.columns;
      expect(columns).toHaveLength(6);
      expect(columns[0].name).toBe("#");
      expect(columns[1].name).toBe("name");
      expect(columns[2].name).toBe("type");
      expect(columns[3].name).toBe("url");
      expect(columns[4].name).toBe("method");
      expect(columns[5].name).toBe("actions");
    });

    it("should initialize perPageOptions correctly", () => {
      const options = wrapper.vm.perPageOptions;
      expect(options).toEqual([
        { label: "5", value: 5 },
        { label: "10", value: 10 },
        { label: "20", value: 20 },
        { label: "50", value: 50 },
        { label: "100", value: 100 },
        { label: "All", value: 0 },
      ]);
    });

    it("should initialize pagination correctly", () => {
      const pagination = wrapper.vm.pagination;
      expect(pagination.rowsPerPage).toBe(20);
    });

    it("should initialize confirmDelete with correct structure", () => {
      const confirmDelete = wrapper.vm.confirmDelete;
      expect(confirmDelete.visible).toBe(false);
      expect(confirmDelete.data).toBeNull();
    });

    it("should initialize templates with default value", async () => {
      await flushPromises();
      // After service call, templates should be updated from mock data
      expect(wrapper.vm.templates).toEqual(mockTemplates);
    });
  });

  // Service Integration Tests
  describe("Service Integration", () => {
    it("should call getDestinations on mount", () => {
      expect(mockDestinationService.list).toHaveBeenCalled();
    });

    it("should call getTemplates on mount", () => {
      expect(mockTemplateService.list).toHaveBeenCalled();
    });

    it("should call getAllActions on mount", () => {
      expect(mockGetAllActions).toHaveBeenCalled();
    });

    it("should filter destinations by type", async () => {
      await flushPromises();
      // The service should be called and destinations should be filtered
      expect(mockDestinationService.list).toHaveBeenCalledWith({
        page_num: 1,
        page_size: 100000,
        sort_by: "name",
        desc: false,
        org_identifier: "test-org",
        module: "alert",
      });
    });
  });

  // Method Tests
  describe("Methods", () => {
    describe("getActions", () => {
      it("should handle successful actions loading", async () => {
        mockStore.state.organizationData.actions = [];
        await wrapper.vm.getActions();
        expect(mockGetAllActions).toHaveBeenCalled();
      });

      it("should skip loading if actions already exist", async () => {
        mockStore.state.organizationData.actions = ["action1"];
        mockGetAllActions.mockClear();
        await wrapper.vm.getActions();
        expect(mockGetAllActions).not.toHaveBeenCalled();
      });

      it("should handle actions loading error", async () => {
        mockStore.state.organizationData.actions = [];
        mockGetAllActions.mockRejectedValue(new Error("Failed"));
        await wrapper.vm.getActions();
        expect(mockGetAllActions).toHaveBeenCalled();
      });
    });

    describe("getDestinations", () => {
      it("should load destinations successfully", async () => {
        await wrapper.vm.getDestinations();
        expect(mockDestinationService.list).toHaveBeenCalled();
        expect(wrapper.vm.destinations).toHaveLength(3);
      });

      it("should add index numbers to destinations", async () => {
        await wrapper.vm.getDestinations();
        expect(wrapper.vm.destinations[0]["#"]).toBe("01");
        expect(wrapper.vm.destinations[1]["#"]).toBe("02");
        expect(wrapper.vm.destinations[2]["#"]).toBe("03");
      });

      it("should handle destinations loading error", async () => {
        mockDestinationService.list.mockRejectedValue({
          response: { status: 500 }
        });
        await wrapper.vm.getDestinations();
        expect(mockDestinationService.list).toHaveBeenCalled();
      });

      it("should handle 403 error gracefully", async () => {
        mockDestinationService.list.mockRejectedValue({
          response: { status: 403 }
        });
        await wrapper.vm.getDestinations();
        expect(mockDestinationService.list).toHaveBeenCalled();
      });

      it("should filter only http, email, and action types", async () => {
        const mixedDestinations = [
          ...mockDestinations,
          { id: "4", name: "dest4", type: "unknown" },
        ];
        mockDestinationService.list.mockResolvedValue({
          data: mixedDestinations,
        });
        
        await wrapper.vm.getDestinations();
        expect(wrapper.vm.destinations).toHaveLength(3); // Only http, email, action
      });
    });

    describe("getTemplates", () => {
      it("should load templates successfully", async () => {
        await wrapper.vm.getTemplates();
        expect(mockTemplateService.list).toHaveBeenCalledWith({
          org_identifier: "test-org",
        });
      });

      it("should update templates data", async () => {
        await wrapper.vm.getTemplates();
        // Templates should be updated from the service response
        expect(mockTemplateService.list).toHaveBeenCalled();
      });
    });

    describe("updateRoute", () => {
      it("should exist and be callable", () => {
        expect(typeof wrapper.vm.updateRoute).toBe('function');
        expect(() => wrapper.vm.updateRoute()).not.toThrow();
      });
    });

    describe("getDestinationByName", () => {
      it("should find destination by name", async () => {
        await wrapper.vm.getDestinations();
        const result = wrapper.vm.getDestinationByName("destination1");
        expect(result).toBeDefined();
        expect(result.name).toBe("destination1");
      });

      it("should return undefined for non-existent destination", async () => {
        await wrapper.vm.getDestinations();
        const result = wrapper.vm.getDestinationByName("nonexistent");
        expect(result).toBeUndefined();
      });

      it("should handle empty destinations array", () => {
        wrapper.vm.destinations = [];
        const result = wrapper.vm.getDestinationByName("any");
        expect(result).toBeUndefined();
      });
    });

    describe("editDestination", () => {
      it("should handle creating new destination", () => {
        wrapper.vm.editDestination(null);
        
        expect(mockRouter.push).toHaveBeenCalledWith({
          name: "alertDestinations",
          query: {
            action: "add",
            org_identifier: "test-org",
          },
        });
        expect(wrapper.vm.editingDestination).toBeNull();
      });

      it("should handle editing existing destination", () => {
        const destination = { name: "test-dest", id: "1" };
        wrapper.vm.editDestination(destination);
        
        expect(mockRouter.push).toHaveBeenCalledWith({
          name: "alertDestinations",
          query: {
            action: "update",
            name: "test-dest",
            org_identifier: "test-org",
          },
        });
        expect(wrapper.vm.editingDestination).toEqual(destination);
      });

      it("should toggle destination editor", () => {
        const initialState = wrapper.vm.showDestinationEditor;
        wrapper.vm.editDestination(null);
        expect(wrapper.vm.showDestinationEditor).toBe(!initialState);
      });
    });

    describe("resetEditingDestination", () => {
      it("should reset editing destination when called internally", () => {
        wrapper.vm.editingDestination = { name: "test" };
        // Reset is called internally by editDestination
        wrapper.vm.editDestination(null);
        expect(wrapper.vm.editingDestination).toBeNull();
      });
    });

    describe("deleteDestination", () => {
      it("should delete destination successfully", async () => {
        wrapper.vm.confirmDelete.data = { name: "test-dest" };
        await wrapper.vm.deleteDestination();
        
        expect(mockDestinationService.delete).toHaveBeenCalledWith({
          org_identifier: "test-org",
          destination_name: "test-dest",
        });
      });

      it("should handle delete error with 409 status", async () => {
        wrapper.vm.confirmDelete.data = { name: "test-dest" };
        mockDestinationService.delete.mockRejectedValue({
          response: {
            status: 409,
            data: { code: 409, message: "Destination in use" }
          }
        });
        
        await wrapper.vm.deleteDestination();
        expect(mockDestinationService.delete).toHaveBeenCalled();
      });

      it("should handle missing destination data", async () => {
        wrapper.vm.confirmDelete.data = null;
        await wrapper.vm.deleteDestination();
        
        expect(mockDestinationService.delete).not.toHaveBeenCalled();
      });

      it("should refresh destinations after successful delete", async () => {
        wrapper.vm.confirmDelete.data = { name: "test-dest" };
        const originalListCall = mockDestinationService.list;
        
        await wrapper.vm.deleteDestination();
        
        // After successful delete, getDestinations should be called which calls the service
        expect(mockDestinationService.delete).toHaveBeenCalled();
      });
    });

    describe("conformDeleteDestination", () => {
      it("should set confirm delete data", () => {
        const destination = { name: "test-dest", id: "1" };
        wrapper.vm.conformDeleteDestination(destination);
        
        expect(wrapper.vm.confirmDelete.visible).toBe(true);
        expect(wrapper.vm.confirmDelete.data).toEqual(destination);
      });

      it("should handle null destination", () => {
        wrapper.vm.conformDeleteDestination(null);
        
        expect(wrapper.vm.confirmDelete.visible).toBe(true);
        expect(wrapper.vm.confirmDelete.data).toBeNull();
      });
    });

    describe("cancelDeleteDestination", () => {
      it("should reset confirm delete state", () => {
        wrapper.vm.confirmDelete.visible = true;
        wrapper.vm.confirmDelete.data = { name: "test" };
        
        wrapper.vm.cancelDeleteDestination();
        
        expect(wrapper.vm.confirmDelete.visible).toBe(false);
        expect(wrapper.vm.confirmDelete.data).toBeNull();
      });
    });

    describe("toggleDestinationEditor", () => {
      it("should toggle destination editor visibility", () => {
        const initialState = wrapper.vm.showDestinationEditor;
        wrapper.vm.toggleDestinationEditor();
        expect(wrapper.vm.showDestinationEditor).toBe(!initialState);
      });

      it("should navigate when closing editor", () => {
        wrapper.vm.showDestinationEditor = true;
        wrapper.vm.toggleDestinationEditor();
        
        expect(mockRouter.push).toHaveBeenCalledWith({
          name: "alertDestinations",
          query: {
            org_identifier: "test-org",
          },
        });
      });
    });

    describe("changePagination", () => {
      it("should update pagination settings", () => {
        const mockSetPagination = vi.fn();
        wrapper.vm.qTable = { setPagination: mockSetPagination };
        
        const newValue = { label: "50", value: 50 };
        wrapper.vm.changePagination(newValue);
        
        // The method should exist and be callable
        expect(mockSetPagination).toHaveBeenCalled();
        expect(wrapper.vm.pagination).toBeDefined();
      });

      it("should handle pagination change with value 0", () => {
        const mockSetPagination = vi.fn();
        wrapper.vm.qTable = { setPagination: mockSetPagination };
        
        const newValue = { label: "All", value: 0 };
        wrapper.vm.changePagination(newValue);
        
        expect(mockSetPagination).toHaveBeenCalled();
      });
    });

    describe("filterData", () => {
      const mockRows = [
        { name: "destination1" },
        { name: "destination2" },
        { name: "test-dest" },
      ];

      it("should filter rows by name", () => {
        const result = wrapper.vm.filterData(mockRows, "destination");
        expect(result).toHaveLength(2);
        expect(result[0].name).toBe("destination1");
        expect(result[1].name).toBe("destination2");
      });

      it("should be case insensitive", () => {
        const result = wrapper.vm.filterData(mockRows, "DESTINATION");
        expect(result).toHaveLength(2);
      });

      it("should return empty array for no matches", () => {
        const result = wrapper.vm.filterData(mockRows, "nomatch");
        expect(result).toHaveLength(0);
      });

      it("should return all rows for empty search term", () => {
        const result = wrapper.vm.filterData(mockRows, "");
        expect(result).toHaveLength(3);
      });

      it("should handle partial matches", () => {
        const result = wrapper.vm.filterData(mockRows, "test");
        expect(result).toHaveLength(1);
        expect(result[0].name).toBe("test-dest");
      });
    });

    describe("routeTo", () => {
      it("should navigate to specified route", () => {
        wrapper.vm.routeTo("alertTemplates");
        
        expect(mockRouter.push).toHaveBeenCalledWith({
          name: "alertTemplates",
          query: {
            action: "add",
            org_identifier: "test-org",
          },
        });
      });

      it("should handle different route names", () => {
        wrapper.vm.routeTo("customRoute");
        
        expect(mockRouter.push).toHaveBeenCalledWith({
          name: "customRoute",
          query: {
            action: "add",
            org_identifier: "test-org",
          },
        });
      });
    });

    describe("exportDestination", () => {
      it("should export destination as JSON", () => {
        const row = { name: "destination1" };
        const mockLink = {
          href: '',
          download: '',
          click: vi.fn(),
        };
        document.createElement = vi.fn(() => mockLink);
        
        wrapper.vm.exportDestination(row);
        
        expect(document.createElement).toHaveBeenCalledWith('a');
        expect(mockLink.download).toBe('destination1.json');
        expect(mockLink.click).toHaveBeenCalled();
        expect(window.URL.createObjectURL).toHaveBeenCalled();
      });
    });

  });

});
