import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Dialog, Notify } from "quasar";
import store from "@/test/unit/helpers/store";
import { installQuasar } from "@/test/unit/helpers";
import { createRouter, createWebHistory, createMemoryHistory } from 'vue-router';
import i18n from "@/locales";
import ListOrganizations from "./ListOrganizations.vue";
import organizationsService from "@/services/organizations";

installQuasar({
  plugins: [Dialog, Notify],
});

// Mock the organizations service
vi.mock("@/services/organizations", () => ({
  default: {
    list: vi.fn(),
  },
}));

// Mock segment analytics
vi.mock("@/services/segment_analytics", () => ({
  default: {
    track: vi.fn(),
  },
}));

// Mock config
vi.mock("@/aws-exports", () => ({
  default: {
    isCloud: "false",
  },
}));

describe("ListOrganizations", () => {
  let wrapper;
  let router;
  let mockStore;
  let mockOrganizations;
  let mockNotify;

  beforeEach(() => {
    // Create a new router instance for each test using memory history
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: '/organizations',
          name: 'organizations',
          component: ListOrganizations
        }
      ]
    });

    // Setup mock store
    mockStore = {
      state: {
        selectedOrganization: {
          identifier: "test-org",
        },
        userInfo: {
          email: "test@example.com",
        },
        theme: "light",
      },
      dispatch: vi.fn(),
    };

    // Setup mock organizations data
    mockOrganizations = {
      data: {
        data: [
          {
            name: "Test Org 1",
            identifier: "test-org-1",
            type: "personal",
            plan: "0",
          },
          {
            name: "Test Org 2",
            identifier: "test-org-2",
            type: "team",
            plan: "1",
          },
        ],
      },
    };

    // Mock the organizations service list method
    organizationsService.list.mockResolvedValue(mockOrganizations);

    // Mock Quasar notify
    mockNotify = vi.fn();
    mockNotify.mockReturnValue({ dismiss: vi.fn() });

    wrapper = mount(ListOrganizations, {
      global: {
        plugins: [i18n, router],
        provide: {
          store: mockStore,
        },
        stubs: {
          QTable: {
            template: '<div class="o2-quasar-table" :class="$attrs.class"><slot></slot></div>',
            props: ['rows', 'columns'],
            methods: {
              setPagination: vi.fn(),
            }
          },
          QInput: true,
          QIcon: true,
          QBtn: true,
          QDialog: true,
          QTablePagination: true,
          NoData: true,
        },
        mocks: {
          $q: {
            notify: mockNotify
          }
        }
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    wrapper.unmount();
  });

  describe("Component Initialization", () => {
    it("should mount successfully", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should initialize with correct default values", async () => {
      const freshWrapper = mount(ListOrganizations, {
        global: {
          plugins: [i18n, router],
          provide: {
            store: mockStore,
          },
          stubs: {
            QTable: true,
            QInput: true,
            QIcon: true,
            QBtn: true,
            QDialog: true,
            QTablePagination: true,
            NoData: true,
          },
          mocks: {
            $q: {
              notify: mockNotify
            }
          }
        },
      });
      
      expect(freshWrapper.vm.filterQuery).toBe("");
      expect(freshWrapper.vm.loading).toBe(false);
      freshWrapper.unmount();
    });

    it("should have correct pagination settings", () => {
      expect(wrapper.vm.pagination.rowsPerPage).toBe(20);
      expect(wrapper.vm.perPageOptions).toHaveLength(5);
    });

    it("should setup columns correctly", () => {
      const columns = wrapper.vm.columns;
      expect(columns).toHaveLength(6); // Base columns without plan
      expect(columns.map(c => c.name)).toContain("name");
      expect(columns.map(c => c.name)).toContain("identifier");
    });

    it("should add plan column when isCloud is true", async () => {
      vi.mock("@/aws-exports", () => ({
        default: {
          isCloud: "true",
        },
      }));
      
      const wrapperWithCloud = mount(ListOrganizations, {
        global: {
          plugins: [i18n, router],
          provide: {
            store: {
              ...mockStore,
              state: {
                ...mockStore.state,
                config: { isCloud: "true" },
              },
            },
          },
          stubs: {
            QTable: true,
            QInput: true,
            QIcon: true,
            QBtn: true,
            QDialog: true,
            QTablePagination: true,
            NoData: true,
          },
        },
      });
      
      await wrapperWithCloud.vm.$nextTick();
      expect(wrapperWithCloud.vm.columns).toHaveLength(6); // Including plan column
      wrapperWithCloud.unmount();
    });
  });

  describe("Data Loading", () => {
    it("should load organizations on mount", async () => {
      await flushPromises();
      expect(organizationsService.list).toHaveBeenCalled();
    });

    it("should transform organization data correctly", async () => {
      await flushPromises();
      expect(wrapper.vm.organizations[0].name).toBe("Test Org 1");
      expect(wrapper.vm.organizations[1].type).toBe("Team");
    });

    it("should update store with organizations", async () => {
      await flushPromises();
      expect(mockStore.dispatch).toHaveBeenCalledWith("setOrganizations", mockOrganizations.data.data);
    });

    it("should handle loading state correctly", async () => {
      expect(wrapper.vm.loading).toBe(false);
      wrapper.vm.getOrganizations();
      expect(wrapper.vm.loading).toBe(false);
      await flushPromises();
      expect(wrapper.vm.loading).toBe(false);
    });

    it("should format billing plans correctly", async () => {
      await flushPromises();
      expect(wrapper.vm.organizations[0].plan).toBe("Free");
      expect(wrapper.vm.organizations[1].plan).toBe("Pay as you go");
    });
  });

  describe("Search and Filtering", () => {
    it("should filter organizations by name", async () => {
      await flushPromises();
      wrapper.vm.filterQuery = "Test Org 1";
      const filtered = wrapper.vm.filterData(wrapper.vm.organizations, "Test Org 1");
      expect(filtered).toHaveLength(1);
    });

    it("should handle case-insensitive search", async () => {
      await flushPromises();
      const filtered = wrapper.vm.filterData(wrapper.vm.organizations, "test ORG");
      expect(filtered).toHaveLength(2);
    });

    it("should return empty array for no matches", async () => {
      await flushPromises();
      const filtered = wrapper.vm.filterData(wrapper.vm.organizations, "nonexistent");
      expect(filtered).toHaveLength(0);
    });

    it("should handle empty search query", async () => {
      await flushPromises();
      const filtered = wrapper.vm.filterData(wrapper.vm.organizations, "");
      expect(filtered).toHaveLength(2);
    });
  });

  describe("Pagination", () => {
    it("should change pagination settings", () => {
      wrapper.vm.changePagination({ value: 50 });
      expect(wrapper.vm.pagination.rowsPerPage).toBe(50);
    });

    it("should update selected per page value", () => {
      wrapper.vm.changePagination({ value: 100 });
      expect(wrapper.vm.selectedPerPage).toBe(100);
    });

    it("should have correct initial pagination state", () => {
      expect(wrapper.vm.pagination.rowsPerPage).toBe(20);
    });

    it("should update table pagination", async () => {
      wrapper.vm.changePagination({ value: 50 });
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.pagination.rowsPerPage).toBe(50);
    });
  });

  describe("Add Organization Dialog", () => {
    it("should open add organization dialog", async () => {
      await router.push('/organizations');
      await flushPromises();
      
      await wrapper.vm.addOrganization();
      await flushPromises();
      
      expect(router.currentRoute.value.query).toEqual({
        action: "add",
        org_identifier: "test-org",
      });
    });

    it("should track add organization button click", async () => {
      await router.push('/organizations');
      await flushPromises();
      
      const mockEvent = {
        target: {
          innerText: "Add Organization",
        },
      };
      await wrapper.vm.addOrganization(mockEvent);
      await flushPromises();
      
      expect(router.currentRoute.value.query.action).toBe("add");
    });

    it("should hide add organization dialog", async () => {
      await router.push({
        path: '/organizations',
        query: { action: 'add', org_identifier: 'test-org' }
      });
      await flushPromises();
      
      await wrapper.vm.hideAddOrgDialog();
      await flushPromises();
      
      expect(router.currentRoute.value.query).toEqual({
        org_identifier: "test-org",
      });
    });

    it("should handle dialog state on route change", async () => {
      await router.push({
        path: '/organizations',
        query: { action: "add" }
      });
      await flushPromises();
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.showAddOrganizationDialog).toBe(true);
    });
  });

  describe("Organization Updates", () => {
    it("should handle successful organization addition", async () => {
      await router.push('/organizations');
      await flushPromises();
      
      await wrapper.vm.updateOrganizationList();
      await flushPromises();
      
      expect(router.currentRoute.value.name).toBe("organizations");
      expect(wrapper.vm.showAddOrganizationDialog).toBe(false);
    });

    it("should refresh organization list after update", async () => {
      const spy = vi.spyOn(wrapper.vm, "getOrganizations");
      await wrapper.vm.updateOrganizationList();
      expect(spy).toHaveBeenCalled();
    });

    it("should show success notification on organization update", async () => {
      await wrapper.vm.updateOrganizationList();
      expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
        type: "positive",
        message: "Organization added successfully.",
      }));
    });
  });


  describe("Error Handling", () => {

    it("should handle empty organization list", async () => {
      organizationsService.list.mockResolvedValueOnce({ data: { data: [] } });
      await wrapper.vm.getOrganizations();
      await flushPromises();
      expect(wrapper.vm.organizations).toHaveLength(0);
    });
  });
});


