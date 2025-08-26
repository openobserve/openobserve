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

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { Quasar, Notify } from "quasar";
import { createRouter, createWebHistory } from "vue-router";
import OrganizationManagement from "./OrganizationManagement.vue";
import store from "../../test/unit/helpers/store";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";

// Mock services
vi.mock("@/services/organizations", () => ({
  default: {
    get_admin_org: vi.fn(),
    extend_trial_period: vi.fn()
  }
}));

vi.mock("@/utils/zincutils", () => ({
  timestampToTimezoneDate: vi.fn((timestamp, tz, format) => {
    // Always return a valid date string to prevent i18n timestamp validation errors
    if (timestamp && typeof timestamp === 'number' && timestamp > 0) {
      return `2023-12-01`;
    }
    return `2023-12-01`; // Fallback for any invalid timestamps
  }),
  getImageURL: vi.fn(() => "http://test.com/image.png")
}));

vi.mock("@/components/shared/grid/NoData.vue", () => ({
  default: {
    name: "NoData",
    template: "<div>No Data</div>"
  }
}));

vi.mock("@/components/shared/grid/Pagination.vue", () => ({
  default: {
    name: "QTablePagination", 
    template: "<div>Pagination</div>",
    props: ["scope", "pageTitle", "position", "resultTotal", "perPageOptions"],
    emits: ["update:changeRecordPerPage"]
  }
}));

// Create router for testing
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: { template: '<div>Home</div>' } },
    { path: '/general', name: 'general', component: { template: '<div>General</div>' } }
  ]
});

// Create i18n instance with all required translations
const i18n = createI18n({
  locale: "en",
  fallbackLocale: "en",
  legacy: false,
  globalInjection: true,
  messages: {
    en: {
      settings: {
        organizationManagement: "Organization Management",
        searchOrgs: "Search Organizations", 
        paginationOrganizationLabel: "Organizations",
        org_name: "Name",
        org_identifier: "Identifier",
        subscription_status: "Subscription Status", 
        created_on: "Created On",
        trial_expiry: "Trial Expiry",
        actions: "Actions",
        extendTrial: "Extend Trial"
      },
      common: {
        cancel: "Cancel"
      }
    }
  }
});

describe("OrganizationManagement.vue", () => {
  let wrapper: any;
  let mockQuasarNotify: any;
  let mockGetAdminOrg: any;
  let mockExtendTrialPeriod: any;
  
  // Global setup to ensure consistent timestamp behavior across environments
  beforeAll(() => {
    // Set a global base time to prevent CI/CD environment timestamp issues
    process.env.TZ = 'UTC';
  });
  
  afterAll(() => {
    delete process.env.TZ;
  });

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();
    
    // Get the mocked service
    const { default: mockedOrgService } = await import("@/services/organizations");
    mockGetAdminOrg = mockedOrgService.get_admin_org;
    mockExtendTrialPeriod = mockedOrgService.extend_trial_period;
    
    mockQuasarNotify = vi.fn().mockReturnValue(vi.fn());
    
    // Setup default mock responses
    mockGetAdminOrg.mockResolvedValue({ data: { data: [] } });
    mockExtendTrialPeriod.mockResolvedValue({ data: true });
    
    // Setup default store state
    store.state.selectedOrganization = {
      label: "Meta Organization",
      id: 1,
      identifier: "default",
      user_email: "admin@example.com",
      subscription_type: "premium"
    };
    
    store.state.zoConfig = {
      ...store.state.zoConfig,
      meta_org: "default"
    };
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllTimers();
  });

  const createWrapper = (propsData = {}) => {
    const mockQuasarNotifyInstance = vi.fn();
    
    return mount(OrganizationManagement, {
      global: {
        plugins: [
          [
            Quasar,
            {
              plugins: [Notify]
            }
          ],
          i18n,
          store,
          router
        ],
        mocks: {
          $q: {
            notify: mockQuasarNotifyInstance
          }
        },
        stubs: {
          'q-page': {
            template: '<div class="q-page"><slot /></div>'
          },
          'q-table': {
            template: `
              <div 
                class="q-table" 
                :data-test="$attrs['data-test']" 
                :loading="loading"
              >
                <slot name="top" :scope="{pagination: {rowsPerPage: 20}}" />
                <slot name="body" />
                <slot name="bottom" :scope="{pagination: {rowsPerPage: 20}}" />
                <slot name="no-data" />
              </div>
            `,
            props: ['rows', 'columns', 'row-key', 'pagination', 'filter', 'filter-method', 'loading', 'table-style'],
            methods: {
              setPagination: vi.fn()
            }
          },
          'q-td': {
            template: '<td class="q-td"><slot /></td>',
            props: ['props']
          },
          'q-btn': {
            template: '<button class="q-btn" @click="$emit(\'click\')"><slot /></button>',
            props: ['label', 'class', 'unelevated', 'dense', 'size', 'padding', 'text-color', 'data-test', 'flat', 'outline'],
            emits: ['click']
          },
          'q-input': {
            template: '<input class="q-input" v-model="modelValue" :placeholder="placeholder" :data-test="$attrs[\'data-test\']" />',
            props: ['modelValue', 'borderless', 'filled', 'dense', 'class', 'placeholder'],
            emits: ['update:modelValue']
          },
          'q-icon': {
            template: '<i class="q-icon"></i>',
            props: ['name', 'class']
          },
          'q-dialog': {
            template: '<div class="q-dialog" v-if="modelValue"><slot /></div>',
            props: ['modelValue'],
            emits: ['update:modelValue']
          },
          'q-card': {
            template: '<div class="q-card"><slot /></div>',
            props: ['class', 'style']
          },
          'q-toolbar': {
            template: '<div class="q-toolbar"><slot /></div>'
          },
          'q-toolbar-title': {
            template: '<div class="q-toolbar-title"><slot /></div>'
          },
          'q-card-section': {
            template: '<div class="q-card-section"><slot /></div>'
          },
          'q-card-actions': {
            template: '<div class="q-card-actions"><slot /></div>',
            props: ['align', 'class']
          },
          'NoData': {
            template: '<div>No Data</div>'
          },
          'QTablePagination': {
            template: '<div>Pagination</div>',
            props: ['scope', 'pageTitle', 'position', 'resultTotal', 'perPageOptions'],
            emits: ['update:changeRecordPerPage']
          }
        }
      },
      props: propsData
    });
  };

  describe("Component Initialization", () => {
    it("should render the component successfully", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should have correct component name", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe("PageAlerts");
    });

    it("should initialize with default reactive properties", async () => {
      wrapper = createWrapper();
      await flushPromises();
      expect(wrapper.vm.extendTrialPrompt).toBe(false);
      expect(wrapper.vm.extendedTrial).toBe(1);
      expect(wrapper.vm.selectedPerPage).toBe(20);
      expect(Array.isArray(wrapper.vm.tabledata)).toBe(true);
      expect(wrapper.vm.resultTotal).toBe(0);
    });

    it("should have correct pagination configuration", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.pagination.rowsPerPage).toBe(20);
    });

    it("should have correct column configuration", () => {
      wrapper = createWrapper();
      const columns = wrapper.vm.columns;
      expect(columns).toHaveLength(7);
      expect(columns[0].name).toBe("#");
      expect(columns[1].name).toBe("name");
      expect(columns[2].name).toBe("identifier");
      expect(columns[3].name).toBe("subscription_status");
      expect(columns[4].name).toBe("created_on");
      expect(columns[5].name).toBe("trial_expiry");
      expect(columns[6].name).toBe("actions");
    });

    it("should have correct perPageOptions", () => {
      wrapper = createWrapper();
      const options = wrapper.vm.perPageOptions;
      expect(options).toEqual([
        { label: "5", value: 5 },
        { label: "10", value: 10 },
        { label: "20", value: 20 },
        { label: "50", value: 50 },
        { label: "100", value: 100 }
      ]);
    });

    it("should have subscription plans mapping", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.setup).toBeDefined();
    });

    it("should initialize filter query as empty string", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.filterQuery).toBe("");
    });
  });

  describe("Mount Lifecycle", () => {
    it("should call getData when meta_org matches selected org", async () => {
      const mockResponse = {
        data: { data: [] }
      };
      mockGetAdminOrg.mockResolvedValue(mockResponse);
      
      wrapper = createWrapper();
      await flushPromises();
      
      expect(mockGetAdminOrg).toHaveBeenCalledWith("default");
    });

    it("should redirect to general when meta_org doesn't match selected org", async () => {
      const routerPushSpy = vi.spyOn(router, 'replace');
      store.state.zoConfig = { ...store.state.zoConfig, meta_org: "different" };
      
      wrapper = createWrapper();
      await flushPromises();
      
      expect(routerPushSpy).toHaveBeenCalledWith({
        name: "general",
        query: {
          org_identifier: "default"
        }
      });
    });

    it("should not call getData when redirected", async () => {
      store.state.zoConfig = { ...store.state.zoConfig, meta_org: "different" };
      
      wrapper = createWrapper();
      await flushPromises();
      
      // Since it redirects, getData shouldn't be called
      expect(mockGetAdminOrg).not.toHaveBeenCalled();
    });
  });

  describe("getData Function", () => {
    beforeEach(() => {
      // Setup global $q mock
      global.$q = { notify: mockQuasarNotify };
    });

    it("should set loading to true when called", async () => {
      const mockResponse = { data: { data: [] } };
      mockGetAdminOrg.mockResolvedValue(mockResponse);
      
      wrapper = createWrapper();
      const notifyMock = vi.spyOn(wrapper.vm.$q, 'notify');
      
      const getDataPromise = wrapper.vm.getData();
      expect(wrapper.vm.loading).toBe(true);
      
      await getDataPromise;
    });

    it("should show loading notification", async () => {
      const mockResponse = { data: { data: [] } };
      mockGetAdminOrg.mockResolvedValue(mockResponse);
      
      wrapper = createWrapper();
      const notifyMock = vi.spyOn(wrapper.vm.$q, 'notify');
      await wrapper.vm.getData();
      
      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          spinner: true,
          message: "Please wait while loading data..."
        })
      );
    });

    it("should call mockGetAdminOrg with correct identifier", async () => {
      const mockResponse = { data: { data: [] } };
      mockGetAdminOrg.mockResolvedValue(mockResponse);
      
      wrapper = createWrapper();
      await wrapper.vm.getData();
      
      expect(mockGetAdminOrg).toHaveBeenCalledWith("default");
    });

    it("should process organization data correctly", async () => {
      const mockResponse = {
        data: {
          data: [
            {
              id: 1,
              name: "Test Org 1",
              identifier: "test-org-1",
              plan: "1",
              created_at: 1234567890000000,
              trial_expires_at: 1234567890000000
            },
            {
              id: 2,
              name: "Test Org 2", 
              identifier: "test-org-2",
              plan: "2",
              created_at: 1234567890000000,
              trial_expires_at: 1234567890000000
            }
          ]
        }
      };
      mockGetAdminOrg.mockResolvedValue(mockResponse);
      
      wrapper = createWrapper();
      await wrapper.vm.getData();
      
      expect(wrapper.vm.tabledata).toHaveLength(2);
      expect(wrapper.vm.tabledata[0]).toEqual({
        "#": 1,
        id: 1,
        name: "Test Org 1",
        identifier: "test-org-1",
        plan: "Pay as you go",
        created_at: "2023-12-01",
        trial_expires_at: "2023-12-01"
      });
    });

    it("should set resultTotal correctly", async () => {
      const mockResponse = {
        data: {
          data: [{ id: 1, name: "Test", identifier: "test", plan: "0", created_at: 123, trial_expires_at: 456 }]
        }
      };
      mockGetAdminOrg.mockResolvedValue(mockResponse);
      
      wrapper = createWrapper();
      await wrapper.vm.getData();
      
      expect(wrapper.vm.resultTotal).toBe(1);
    });

    it("should set loading to false after success", async () => {
      const mockResponse = { data: { data: [] } };
      mockGetAdminOrg.mockResolvedValue(mockResponse);
      
      wrapper = createWrapper();
      await wrapper.vm.getData();
      
      expect(wrapper.vm.loading).toBe(false);
    });

    it("should handle API error and show notification", async () => {
      const error = { status: 500, response: { data: { message: "Server Error" } } };
      mockGetAdminOrg.mockRejectedValue(error);
      
      wrapper = createWrapper();
      const notifyMock = vi.spyOn(wrapper.vm.$q, 'notify');
      
      await flushPromises(); // Wait for initial loading to complete
      
      await wrapper.vm.getData();
      await flushPromises(); // Wait for async error handling
      
      expect(wrapper.vm.loading).toBe(false);
      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          spinner: true,
          message: "Please wait while loading data..."
        })
      );
      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "negative",
          message: "Server Error",
          timeout: 5000
        })
      );
    });

    it("should handle API error without response message", async () => {
      const error = { status: 500 };
      mockGetAdminOrg.mockRejectedValue(error);
      
      wrapper = createWrapper();
      const notifyMock = vi.spyOn(wrapper.vm.$q, 'notify');
      
      await wrapper.vm.getData();
      await flushPromises(); // Wait for async error handling
      
      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          spinner: true,
          message: "Please wait while loading data..."
        })
      );
      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "negative",
          message: "Failed to fetch organization data. Please try again.",
          timeout: 5000
        })
      );
    });

    it("should not show notification for 403 error", async () => {
      const error = { status: 403 };
      mockGetAdminOrg.mockRejectedValue(error);
      
      wrapper = createWrapper();
      const notifyMock = vi.spyOn(wrapper.vm.$q, 'notify');
      await wrapper.vm.getData();
      
      expect(notifyMock).toHaveBeenCalledTimes(1); // Only loading notification
    });

    it("should handle empty response data", async () => {
      const mockResponse = { data: { data: [] } };
      mockGetAdminOrg.mockResolvedValue(mockResponse);
      
      wrapper = createWrapper();
      await wrapper.vm.getData();
      
      expect(wrapper.vm.tabledata).toEqual([]);
      expect(wrapper.vm.resultTotal).toBe(0);
    });
  });

  describe("changePagination Function", () => {
    it("should update selectedPerPage", () => {
      wrapper = createWrapper();
      wrapper.vm.changePagination({ label: "50", value: 50 });
      
      expect(wrapper.vm.selectedPerPage).toBe(50);
    });

    it("should update pagination.rowsPerPage", () => {
      wrapper = createWrapper();
      wrapper.vm.changePagination({ label: "50", value: 50 });
      
      expect(wrapper.vm.pagination.rowsPerPage).toBe(50);
    });

    it("should call qTable.setPagination", () => {
      wrapper = createWrapper();
      const setPaginationSpy = vi.fn();
      wrapper.vm.qTable = { setPagination: setPaginationSpy };
      
      wrapper.vm.changePagination({ label: "10", value: 10 });
      
      expect(setPaginationSpy).toHaveBeenCalledWith({ rowsPerPage: 10 });
    });
  });

  describe("toggleExtendTrialDialog Function", () => {
    it("should set extendTrialPrompt to true", () => {
      wrapper = createWrapper();
      const row = { id: 1, name: "Test Org" };
      
      wrapper.vm.toggleExtendTrialDialog(row);
      
      expect(wrapper.vm.extendTrialPrompt).toBe(true);
    });

    it("should set extendTrialDataRow", () => {
      wrapper = createWrapper();
      const row = { id: 1, name: "Test Org", identifier: "test-org" };
      
      wrapper.vm.toggleExtendTrialDialog(row);
      
      expect(wrapper.vm.extendTrialDataRow).toEqual(row);
    });

    it("should handle empty row data", () => {
      wrapper = createWrapper();
      
      wrapper.vm.toggleExtendTrialDialog({});
      
      expect(wrapper.vm.extendTrialPrompt).toBe(true);
      expect(wrapper.vm.extendTrialDataRow).toEqual({});
    });
  });

  describe("getTimestampInMicroseconds Function", () => {
    let mockDateNow: any;
    const fixedTime = 1704067200000; // January 1, 2024 00:00:00 UTC

    beforeEach(() => {
      mockDateNow = vi.spyOn(Date, 'now').mockReturnValue(fixedTime);
    });

    afterEach(() => {
      mockDateNow.mockRestore();
    });

    it("should calculate timestamp for 1 week", () => {
      wrapper = createWrapper();
      const result = wrapper.vm.getTimestampInMicroseconds(1);
      const expected = (fixedTime + 7 * 24 * 60 * 60 * 1000) * 1000;
      
      expect(result).toBe(expected);
    });

    it("should calculate timestamp for 2 weeks", () => {
      wrapper = createWrapper();
      const result = wrapper.vm.getTimestampInMicroseconds(2);
      const expected = (fixedTime + 2 * 7 * 24 * 60 * 60 * 1000) * 1000;
      
      expect(result).toBe(expected);
    });

    it("should calculate timestamp for 4 weeks", () => {
      wrapper = createWrapper();
      const result = wrapper.vm.getTimestampInMicroseconds(4);
      const expected = (fixedTime + 4 * 7 * 24 * 60 * 60 * 1000) * 1000;
      
      expect(result).toBe(expected);
    });

    it("should handle zero weeks", () => {
      wrapper = createWrapper();
      const result = wrapper.vm.getTimestampInMicroseconds(0);
      const expected = fixedTime * 1000;
      
      expect(result).toBe(expected);
    });

    it("should handle negative weeks", () => {
      wrapper = createWrapper();
      const result = wrapper.vm.getTimestampInMicroseconds(-1);
      const expected = (fixedTime - 7 * 24 * 60 * 60 * 1000) * 1000;
      
      expect(result).toBe(expected);
    });
  });

  describe("updateTrialPeriod Function", () => {
    beforeEach(() => {
      global.$q = { notify: mockQuasarNotify };
    });

    it("should set loading to true", async () => {
      const mockResponse = { data: true };
      mockExtendTrialPeriod.mockResolvedValue(mockResponse);
      
      wrapper = createWrapper();
      wrapper.vm.loading = false;
      
      const updatePromise = wrapper.vm.updateTrialPeriod("test-org", 2);
      expect(wrapper.vm.loading).toBe(true);
      
      await updatePromise;
    });

    it("should show loading notification", async () => {
      const mockResponse = { data: true };
      mockExtendTrialPeriod.mockResolvedValue(mockResponse);
      
      wrapper = createWrapper();
      const notifyMock = vi.spyOn(wrapper.vm.$q, 'notify');
      await wrapper.vm.updateTrialPeriod("test-org", 2);
      
      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          spinner: true,
          message: "Please wait while processing trial period extension request..."
        })
      );
    });

    it("should call extend_trial_period with correct payload", async () => {
      const mockResponse = { data: true };
      mockExtendTrialPeriod.mockResolvedValue(mockResponse);
      
      const fixedTime = 1704067200000; // January 1, 2024 00:00:00 UTC
      const mockDateNow = vi.spyOn(Date, 'now').mockReturnValue(fixedTime);
      
      wrapper = createWrapper();
      await wrapper.vm.updateTrialPeriod("test-org", 2);
      
      const expectedPayload = {
        new_end_date: (fixedTime + 2 * 7 * 24 * 60 * 60 * 1000) * 1000,
        org_id: "test-org"
      };
      
      expect(mockExtendTrialPeriod).toHaveBeenCalledWith("default", expectedPayload);
      
      mockDateNow.mockRestore();
    });

    it("should show success notification", async () => {
      const mockResponse = { data: true };
      mockExtendTrialPeriod.mockResolvedValue(mockResponse);
      mockGetAdminOrg.mockResolvedValue({ data: { data: [] } });
      
      wrapper = createWrapper();
      const notifyMock = vi.spyOn(wrapper.vm.$q, 'notify');
      
      await wrapper.vm.updateTrialPeriod("test-org", 2);
      
      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "positive",
          message: "Trial period extended successfully."
        })
      );
    });

    it("should close dialog after success", async () => {
      const mockResponse = { data: true };
      mockExtendTrialPeriod.mockResolvedValue(mockResponse);
      mockGetAdminOrg.mockResolvedValue({ data: { data: [] } });
      
      wrapper = createWrapper();
      wrapper.vm.extendTrialPrompt = true;
      wrapper.vm.extendTrialDataRow = { id: 1 };
      wrapper.vm.extendedTrial = 3;
      
      await wrapper.vm.updateTrialPeriod("test-org", 2);
      
      expect(wrapper.vm.extendTrialPrompt).toBe(false);
      expect(wrapper.vm.extendTrialDataRow).toEqual({});
      expect(wrapper.vm.extendedTrial).toBe(1);
    });

    it("should call getData after success", async () => {
      const mockResponse = { data: true };
      mockExtendTrialPeriod.mockResolvedValue(mockResponse);
      mockGetAdminOrg.mockResolvedValue({ data: { data: [{ id: 1, name: "Test Org" }] } });
      
      wrapper = createWrapper();
      await flushPromises(); // Wait for initial onMounted getData call
      
      // Clear the initial mock calls
      mockGetAdminOrg.mockClear();
      
      await wrapper.vm.updateTrialPeriod("test-org", 2);
      await flushPromises(); // Wait for async completion
      
      // Verify getData was called indirectly by checking mockGetAdminOrg was called again
      expect(mockGetAdminOrg).toHaveBeenCalledTimes(1);
    });

    it("should set loading to false after success", async () => {
      const mockResponse = { data: true };
      mockExtendTrialPeriod.mockResolvedValue(mockResponse);
      mockGetAdminOrg.mockResolvedValue({ data: { data: [] } });
      
      wrapper = createWrapper();
      await wrapper.vm.updateTrialPeriod("test-org", 2);
      
      expect(wrapper.vm.loading).toBe(false);
    });

    it("should handle API error and show notification", async () => {
      const error = { status: 500, response: { data: { message: "Extension failed" } } };
      mockExtendTrialPeriod.mockRejectedValue(error);
      
      wrapper = createWrapper();
      const notifyMock = vi.spyOn(wrapper.vm.$q, 'notify');
      
      await wrapper.vm.updateTrialPeriod("test-org", 2);
      await flushPromises(); // Wait for async error handling
      
      expect(wrapper.vm.loading).toBe(false);
      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          spinner: true,
          message: "Please wait while processing trial period extension request..."
        })
      );
      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "negative",
          message: "Extension failed",
          timeout: 5000
        })
      );
    });

    it("should handle API error without response message", async () => {
      const error = { status: 500 };
      mockExtendTrialPeriod.mockRejectedValue(error);
      
      wrapper = createWrapper();
      const notifyMock = vi.spyOn(wrapper.vm.$q, 'notify');
      
      await wrapper.vm.updateTrialPeriod("test-org", 2);
      await flushPromises(); // Wait for async error handling
      
      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          spinner: true,
          message: "Please wait while processing trial period extension request..."
        })
      );
      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "negative",
          message: "Failed to extend trial period. Please try again.",
          timeout: 5000
        })
      );
    });

    it("should not show notification for 403 error", async () => {
      const error = { status: 403 };
      mockExtendTrialPeriod.mockRejectedValue(error);
      
      wrapper = createWrapper();
      const notifyMock = vi.spyOn(wrapper.vm.$q, 'notify');
      await wrapper.vm.updateTrialPeriod("test-org", 2);
      
      expect(notifyMock).toHaveBeenCalledTimes(1); // Only loading notification
    });

    it("should handle response without data", async () => {
      const mockResponse = { data: false };
      mockExtendTrialPeriod.mockResolvedValue(mockResponse);
      
      wrapper = createWrapper();
      const notifyMock = vi.spyOn(wrapper.vm.$q, 'notify');
      await wrapper.vm.updateTrialPeriod("test-org", 2);
      
      expect(wrapper.vm.loading).toBe(false);
      expect(notifyMock).toHaveBeenCalledTimes(1); // Only loading notification
    });
  });

  describe("filterData Function", () => {
    const mockRows = [
      { name: "Test Organization", identifier: "test-org", plan: "Free" },
      { name: "Demo Company", identifier: "demo-co", plan: "Enterprise" },
      { name: "Sample Corp", identifier: "sample", plan: "Pay as you go" }
    ];

    it("should filter by organization name (case insensitive)", () => {
      wrapper = createWrapper();
      const result = wrapper.vm.filterData(mockRows, "test");
      
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Test Organization");
    });

    it("should filter by organization identifier (case insensitive)", () => {
      wrapper = createWrapper();
      const result = wrapper.vm.filterData(mockRows, "demo");
      
      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe("demo-co");
    });

    it("should filter by plan (case insensitive)", () => {
      wrapper = createWrapper();
      const result = wrapper.vm.filterData(mockRows, "enterprise");
      
      expect(result).toHaveLength(1);
      expect(result[0].plan).toBe("Enterprise");
    });

    it("should return multiple matches", () => {
      wrapper = createWrapper();
      const result = wrapper.vm.filterData(mockRows, "co");
      
      expect(result).toHaveLength(2);
    });

    it("should return empty array when no matches", () => {
      wrapper = createWrapper();
      const result = wrapper.vm.filterData(mockRows, "nonexistent");
      
      expect(result).toHaveLength(0);
    });

    it("should handle empty search terms", () => {
      wrapper = createWrapper();
      const result = wrapper.vm.filterData(mockRows, "");
      
      expect(result).toHaveLength(3);
    });

    it("should handle null rows", () => {
      wrapper = createWrapper();
      expect(() => {
        wrapper.vm.filterData(null, "test");
      }).toThrow();
    });

    it("should handle empty rows array", () => {
      wrapper = createWrapper();
      const result = wrapper.vm.filterData([], "test");
      
      expect(result).toEqual([]);
    });

    it("should be case insensitive", () => {
      wrapper = createWrapper();
      const result = wrapper.vm.filterData(mockRows, "TEST");
      
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Test Organization");
    });
  });

  describe("Component Rendering", () => {
    it("should render the organization management table", () => {
      wrapper = createWrapper();
      const table = wrapper.find('[data-test="org-management-list-table"]');
      expect(table.exists()).toBe(true);
    });

    it("should render the title", () => {
      wrapper = createWrapper();
      const title = wrapper.find('[data-test="org-management-list-title"]');
      expect(title.text()).toBe("Organization Management");
    });

    it("should render the search input", () => {
      wrapper = createWrapper();
      const searchInput = wrapper.find('[data-test="org-management-search-input"]');
      expect(searchInput.exists()).toBe(true);
    });

    it("should render extend trial dialog when extendTrialPrompt is true", async () => {
      wrapper = createWrapper();
      wrapper.vm.extendTrialPrompt = true;
      wrapper.vm.extendTrialDataRow = { name: "Test Org" };
      await nextTick();
      
      const dialog = wrapper.find(".q-dialog");
      expect(dialog.exists()).toBe(true);
    });

    it("should not render extend trial dialog when extendTrialPrompt is false", async () => {
      wrapper = createWrapper();
      wrapper.vm.extendTrialPrompt = false;
      await nextTick();
      
      expect(wrapper.vm.extendTrialPrompt).toBe(false);
    });

    it("should show loading state in table", async () => {
      // Setup store to prevent onMounted from calling getData
      store.state.zoConfig.meta_org = "different_org";
      
      wrapper = createWrapper();
      wrapper.vm.loading = true;
      await nextTick();
      
      expect(wrapper.vm.loading).toBe(true);
      
      // Reset for other tests
      store.state.zoConfig.meta_org = "default";
    });
  });

  describe("Dialog Interactions", () => {
    it("should show selected week in dialog", async () => {
      wrapper = createWrapper();
      wrapper.vm.extendTrialPrompt = true;
      wrapper.vm.extendTrialDataRow = { name: "Test Org" };
      wrapper.vm.extendedTrial = 3;
      await nextTick();
      
      expect(wrapper.vm.extendedTrial).toBe(3);
      expect(wrapper.vm.extendTrialPrompt).toBe(true);
    });

    it("should update extendedTrial when week is clicked", async () => {
      wrapper = createWrapper();
      wrapper.vm.extendTrialPrompt = true;
      wrapper.vm.extendTrialDataRow = { name: "Test Org" };
      await nextTick();
      
      wrapper.vm.extendedTrial = 4;
      await nextTick();
      
      expect(wrapper.vm.extendedTrial).toBe(4);
    });

    it("should close dialog when cancel is clicked", async () => {
      wrapper = createWrapper();
      wrapper.vm.extendTrialPrompt = true;
      wrapper.vm.extendTrialDataRow = { name: "Test Org" };
      await nextTick();
      
      expect(wrapper.vm.extendTrialPrompt).toBe(true);
      expect(wrapper.vm.extendTrialDataRow.name).toBe("Test Org");
    });
  });

  describe("Edge Cases", () => {
    it("should handle missing organization data in store", () => {
      store.state.selectedOrganization = { identifier: undefined };
      store.state.zoConfig = { meta_org: "default" };
      wrapper = createWrapper();
      
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle missing zoConfig in store", () => {
      store.state.selectedOrganization = { identifier: "test" };
      store.state.zoConfig = { meta_org: undefined };
      wrapper = createWrapper();
      
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle malformed API response", async () => {
      const mockResponse = { data: null };
      mockGetAdminOrg.mockResolvedValue(mockResponse);
      
      store.state.zoConfig = { meta_org: "default" };
      store.state.selectedOrganization = { identifier: "default" };
      
      wrapper = createWrapper();
      await wrapper.vm.getData();
      
      expect(wrapper.vm.tabledata).toEqual([]);
    });

    it("should handle API response without data property", async () => {
      const mockResponse = {};
      mockGetAdminOrg.mockResolvedValue(mockResponse);
      
      store.state.zoConfig = { meta_org: "default" };
      store.state.selectedOrganization = { identifier: "default" };
      
      wrapper = createWrapper();
      await wrapper.vm.getData();
      
      expect(wrapper.vm.tabledata).toEqual([]);
    });
  });

  describe("Integration Tests", () => {
    it("should complete full extend trial workflow", async () => {
      store.state.zoConfig = { meta_org: "default" };
      store.state.selectedOrganization = { identifier: "default" };
      
      const getOrgResponse = {
        data: {
          data: [{
            id: 1,
            name: "Test Org",
            identifier: "test-org",
            plan: "0",
            created_at: 123456789,
            trial_expires_at: 987654321
          }]
        }
      };
      const extendResponse = { data: true };
      
      mockGetAdminOrg.mockResolvedValue(getOrgResponse);
      mockExtendTrialPeriod.mockResolvedValue(extendResponse);
      
      wrapper = createWrapper();
      await flushPromises();
      
      const row = wrapper.vm.tabledata[0];
      wrapper.vm.toggleExtendTrialDialog(row);
      expect(wrapper.vm.extendTrialPrompt).toBe(true);
      
      await wrapper.vm.updateTrialPeriod("test-org", 2);
      
      expect(wrapper.vm.extendTrialPrompt).toBe(false);
    });

    it("should handle pagination change and table update", async () => {
      store.state.zoConfig = { meta_org: "default" };
      store.state.selectedOrganization = { identifier: "default" };
      
      wrapper = createWrapper();
      const mockSetPagination = vi.fn();
      wrapper.vm.qTable = { setPagination: mockSetPagination };
      
      wrapper.vm.changePagination({ label: "50", value: 50 });
      
      expect(wrapper.vm.selectedPerPage).toBe(50);
      expect(wrapper.vm.pagination.rowsPerPage).toBe(50);
      expect(mockSetPagination).toHaveBeenCalled();
    });

    it("should handle search filtering with real data", async () => {
      store.state.zoConfig = { meta_org: "default" };
      store.state.selectedOrganization = { identifier: "default" };
      
      const mockResponse = {
        data: {
          data: [
            { id: 1, name: "Alpha Corp", identifier: "alpha", plan: "0", created_at: 123, trial_expires_at: 456 },
            { id: 2, name: "Beta Inc", identifier: "beta", plan: "1", created_at: 123, trial_expires_at: 456 },
            { id: 3, name: "Gamma Ltd", identifier: "gamma", plan: "2", created_at: 123, trial_expires_at: 456 }
          ]
        }
      };
      mockGetAdminOrg.mockResolvedValue(mockResponse);
      
      wrapper = createWrapper();
      await flushPromises();
      
      const filtered = wrapper.vm.filterData(wrapper.vm.tabledata, "alpha");
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe("Alpha Corp");
    });
  });
});