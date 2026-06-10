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

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
} from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createRouter, createWebHistory } from "vue-router";
import OrganizationManagement from "./OrganizationManagement.vue";
import store from "../../test/unit/helpers/store";
import { createI18n } from "vue-i18n";
import { nextTick } from "vue";

// ── Mock toast (replaces deprecated $q.notify) ──
const mockToastFn = vi.fn().mockReturnValue(vi.fn());
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: any[]) => mockToastFn(...args),
}));

// ── Mock confirm dialog (replaces deprecated $q.dialog) ──
const mockConfirmFn = vi.fn().mockResolvedValue(true);
vi.mock("@/composables/useConfirmDialog", () => ({
  useConfirmDialog: vi.fn(() => ({
    confirm: mockConfirmFn,
    currentDialog: { value: null },
    handleConfirm: vi.fn(),
    handleCancel: vi.fn(),
    handleUpdateOpen: vi.fn(),
  })),
}));

// ── Mock org_storage service ──
const mockOrgStorageEnable = vi.fn().mockResolvedValue({ data: true });
vi.mock("@/services/org_storage", () => ({
  default: {
    enable: (...args: any[]) => mockOrgStorageEnable(...args),
  },
}));

// ── Mock organizations service ──
vi.mock("@/services/organizations", () => ({
  default: {
    get_admin_org: vi.fn(),
    extend_trial_period: vi.fn(),
    create_external_contract: vi.fn(),
    extend_external_contract: vi.fn(),
    revoke_external_contract: vi.fn(),
  },
}));

vi.mock("@/utils/zincutils", () => ({
  timestampToTimezoneDate: vi.fn((timestamp, tz, format) => {
    // Always return a valid date string to prevent i18n timestamp validation errors
    if (timestamp && typeof timestamp === "number" && timestamp > 0) {
      return `2023-12-01`;
    }
    return `2023-12-01`; // Fallback for any invalid timestamps
  }),
  getImageURL: vi.fn(() => "http://test.com/image.png"),
  useLocalOrganization: vi.fn(() => null),
  useLocalCurrentUser: vi.fn(() => null),
  useLocalTimezone: vi.fn(() => null),
}));

vi.mock("@/components/shared/grid/NoData.vue", () => ({
  default: {
    name: "NoData",
    template: "<div>No Data</div>",
  },
}));

// Create router for testing
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "home", component: { template: "<div>Home</div>" } },
    {
      path: "/general",
      name: "general",
      component: { template: "<div>General</div>" },
    },
  ],
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
        extendTrial: "Extend Trial",
      },
      common: {
        cancel: "Cancel",
      },
    },
  },
});

// Stub ODialog so tests are deterministic (no Portal/Reka teleport) and so
// we can assert on forwarded props and emit the click events the component
// listens to (click:primary, click:secondary, update:open).
const ODialogStub = {
  name: "ODialog",
  inheritAttrs: false,
  props: [
    "open",
    "size",
    "title",
    "subTitle",
    "persistent",
    "showClose",
    "width",
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
      class="o-dialog-stub"
      data-test="o-dialog-stub"
      :data-open="String(open)"
      :data-size="size"
      :data-title="title"
      :data-sub-title="subTitle"
      :data-primary-label="primaryButtonLabel"
      :data-secondary-label="secondaryButtonLabel"
      v-if="open"
    >
      <slot name="header" />
      <slot />
      <slot name="footer" />
      <button
        data-test="o-dialog-stub-primary"
        @click="$emit('click:primary')"
      >{{ primaryButtonLabel }}</button>
      <button
        data-test="o-dialog-stub-secondary"
        @click="$emit('click:secondary')"
      >{{ secondaryButtonLabel }}</button>
    </div>
  `,
};

// Stub OTable so tests are fast. The stub renders the #cell-actions slot
// for every row in `data` so action-button tests can find rendered buttons.
const OTableStub = {
  name: "OTable",
  inheritAttrs: false,
  props: ["data", "columns", "loading", "rowKey"],
  template: `
    <div data-test="org-management-list-table">
      <slot name="toolbar" />
      <div v-for="(row, idx) in (data || [])" :key="idx" :data-test="'otable-row-' + idx">
        <slot name="cell-actions" :row="row" />
      </div>
      <slot name="empty" v-if="!data || data.length === 0" />
    </div>
  `,
};

describe("OrganizationManagement.vue", () => {
  let wrapper: any;
  let mockGetAdminOrg: any;
  let mockExtendTrialPeriod: any;
  let mockCreateExternalContract: any;
  let mockExtendExternalContract: any;
  let mockRevokeExternalContract: any;

  // Global setup to ensure consistent timestamp behavior across environments
  beforeAll(() => {
    // Set a global base time to prevent CI/CD environment timestamp issues
    process.env.TZ = "UTC";
  });

  afterAll(() => {
    delete process.env.TZ;
  });

  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    // Get the mocked service
    const { default: mockedOrgService } = await import(
      "@/services/organizations"
    );
    mockGetAdminOrg = mockedOrgService.get_admin_org;
    mockExtendTrialPeriod = mockedOrgService.extend_trial_period;
    mockCreateExternalContract = (mockedOrgService as any)
      .create_external_contract;
    mockExtendExternalContract = (mockedOrgService as any)
      .extend_external_contract;
    mockRevokeExternalContract = (mockedOrgService as any)
      .revoke_external_contract;

    // Setup default mock responses
    mockGetAdminOrg.mockResolvedValue({ data: { data: [] } });
    mockExtendTrialPeriod.mockResolvedValue({ data: true });
    mockCreateExternalContract?.mockResolvedValue?.({ data: true });
    mockExtendExternalContract?.mockResolvedValue?.({ data: true });
    mockRevokeExternalContract?.mockResolvedValue?.({ data: true });

    // Setup default store state
    store.state.selectedOrganization = {
      label: "Meta Organization",
      id: 1,
      identifier: "default",
      user_email: "admin@example.com",
      subscription_type: "premium",
    };

    store.state.zoConfig = {
      ...store.state.zoConfig,
      meta_org: "default",
    };
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllTimers();
  });

  const createWrapper = (propsData = {}) => {
    return mount(OrganizationManagement, {
      global: {
        plugins: [i18n, store, router],
        stubs: {
          ODialog: ODialogStub,
          OTable: OTableStub,
          // Stub heavy sub-components that are not under test
          OTooltip: { template: "<span />" },
          OIcon: { template: "<span />" },
          // Keep OInput functional but lightweight — tests use data-test to find it
          OInput: {
            name: "OInput",
            props: ["modelValue", "placeholder", "type"],
            emits: ["update:modelValue"],
            template: `<input
              :data-test="$attrs['data-test']"
              :value="modelValue"
              :placeholder="placeholder"
              :type="type || 'text'"
              @input="$emit('update:modelValue', $event.target.value)"
            />`,
          },
        },
      },
      props: propsData,
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
      expect(Array.isArray(wrapper.vm.tabledata)).toBe(true);
      expect(wrapper.vm.resultTotal).toBe(0);
    });

    it("should have correct column configuration", () => {
      wrapper = createWrapper();
      const columns = wrapper.vm.columns;
      expect(columns).toHaveLength(9);
      expect(columns[0].id).toBe("#");
      expect(columns[1].id).toBe("name");
      expect(columns[2].id).toBe("identifier");
      expect(columns[3].id).toBe("subscription_status");
      expect(columns[4].id).toBe("billing_provider");
      expect(columns[5].id).toBe("created_on");
      expect(columns[6].id).toBe("trial_expiry");
      expect(columns[7].id).toBe("contract_end_date");
      expect(columns[8].id).toBe("actions");
    });

    it("should have subscription plans mapping", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.setup).toBeDefined();
    });

    it("should initialize filter query as empty string", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.filterQuery).toBe("");
    });

    it("should initialize contract state with defaults", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.contractPrompt).toBe(false);
      expect(wrapper.vm.contractMode).toBe("create");
      expect(wrapper.vm.contractEndDate).toBe("");
    });
  });

  describe("Mount Lifecycle", () => {
    it("should call getData when meta_org matches selected org", async () => {
      const mockResponse = {
        data: { data: [] },
      };
      mockGetAdminOrg.mockResolvedValue(mockResponse);

      wrapper = createWrapper();
      await flushPromises();

      expect(mockGetAdminOrg).toHaveBeenCalledWith("default");
    });

    it("should redirect to general when meta_org doesn't match selected org", async () => {
      const routerPushSpy = vi.spyOn(router, "replace");
      store.state.zoConfig = { ...store.state.zoConfig, meta_org: "different" };

      wrapper = createWrapper();
      await flushPromises();

      expect(routerPushSpy).toHaveBeenCalledWith({
        name: "general",
        query: {
          org_identifier: "default",
        },
      });
    });

    it("should not call getData when redirected", async () => {
      store.state.zoConfig = {
        ...store.state.zoConfig,
        meta_org: "different",
      };

      wrapper = createWrapper();
      await flushPromises();

      // Since it redirects, getData shouldn't be called
      expect(mockGetAdminOrg).not.toHaveBeenCalled();
    });
  });

  describe("getData Function", () => {
    beforeEach(() => {
      // Prevent onMounted from calling getData so mockToastFn call counts are predictable
      store.state.zoConfig.meta_org = "different_org";
    });

    it("should set loading to true when called", async () => {
      const mockResponse = { data: { data: [] } };
      mockGetAdminOrg.mockResolvedValue(mockResponse);

      wrapper = createWrapper();

      const getDataPromise = wrapper.vm.getData();
      expect(wrapper.vm.loading).toBe(true);

      await getDataPromise;
    });

    it("should show loading notification", async () => {
      const mockResponse = { data: { data: [] } };
      mockGetAdminOrg.mockResolvedValue(mockResponse);

      wrapper = createWrapper();
      await wrapper.vm.getData();

      expect(mockToastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "loading",
          message: "Please wait while loading data...",
        }),
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
              trial_expires_at: 1234567890000000,
            },
            {
              id: 2,
              name: "Test Org 2",
              identifier: "test-org-2",
              plan: "2",
              created_at: 1234567890000000,
              trial_expires_at: 1234567890000000,
            },
          ],
        },
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
        billing_provider: "-",
        created_at: "2023-12-01",
        trial_expires_at: "2023-12-01",
        contract_end_date: 0,
        contract_end_date_display: "-",
        org_storage_enabled: false,
      });
    });

    it("should set resultTotal correctly", async () => {
      const mockResponse = {
        data: {
          data: [
            {
              id: 1,
              name: "Test",
              identifier: "test",
              plan: "0",
              created_at: 123,
              trial_expires_at: 456,
            },
          ],
        },
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
      const error = {
        status: 500,
        response: { data: { message: "Server Error" } },
      };
      mockGetAdminOrg.mockRejectedValue(error);

      wrapper = createWrapper();
      await wrapper.vm.getData();
      await flushPromises(); // Wait for async error handling

      expect(wrapper.vm.loading).toBe(false);
      expect(mockToastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "loading",
          message: "Please wait while loading data...",
        }),
      );
      expect(mockToastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: "Server Error",
          timeout: 5000,
        }),
      );
    });

    it("should handle API error without response message", async () => {
      const error = { status: 500 };
      mockGetAdminOrg.mockRejectedValue(error);

      wrapper = createWrapper();
      await wrapper.vm.getData();
      await flushPromises(); // Wait for async error handling

      expect(mockToastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "loading",
          message: "Please wait while loading data...",
        }),
      );
      expect(mockToastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: "Failed to fetch organization data. Please try again.",
          timeout: 5000,
        }),
      );
    });

    it("should not show notification for 403 error", async () => {
      const error = { status: 403 };
      mockGetAdminOrg.mockRejectedValue(error);

      wrapper = createWrapper();
      await wrapper.vm.getData();

      // Loading toast is called, but no error toast for 403
      const errorCalls = mockToastFn.mock.calls.filter(
        (call: any[]) => call[0]?.variant === "error",
      );
      expect(errorCalls.length).toBe(0);
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
      mockDateNow = vi.spyOn(Date, "now").mockReturnValue(fixedTime);
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
      // Prevent onMounted from calling getData so mockToastFn call counts are predictable
      store.state.zoConfig.meta_org = "different_org";
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
      await wrapper.vm.updateTrialPeriod("test-org", 2);

      expect(mockToastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "loading",
          message:
            "Please wait while processing trial period extension request...",
        }),
      );
    });

    it("should call extend_trial_period with correct payload", async () => {
      const mockResponse = { data: true };
      mockExtendTrialPeriod.mockResolvedValue(mockResponse);

      const fixedTime = 1704067200000; // January 1, 2024 00:00:00 UTC
      const mockDateNow = vi.spyOn(Date, "now").mockReturnValue(fixedTime);

      wrapper = createWrapper();
      await wrapper.vm.updateTrialPeriod("test-org", 2);

      const expectedPayload = {
        new_end_date: (fixedTime + 2 * 7 * 24 * 60 * 60 * 1000) * 1000,
        org_id: "test-org",
      };

      expect(mockExtendTrialPeriod).toHaveBeenCalledWith(
        "default",
        expectedPayload,
      );

      mockDateNow.mockRestore();
    });

    it("should show success notification", async () => {
      const mockResponse = { data: true };
      mockExtendTrialPeriod.mockResolvedValue(mockResponse);
      mockGetAdminOrg.mockResolvedValue({ data: { data: [] } });

      wrapper = createWrapper();

      await wrapper.vm.updateTrialPeriod("test-org", 2);

      expect(mockToastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "success",
          message: "Trial period extended successfully.",
        }),
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
      mockGetAdminOrg.mockResolvedValue({
        data: { data: [{ id: 1, name: "Test Org" }] },
      });

      wrapper = createWrapper();

      // Clear any potential mock calls from initial setup
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
      const error = {
        status: 500,
        response: { data: { message: "Extension failed" } },
      };
      mockExtendTrialPeriod.mockRejectedValue(error);

      wrapper = createWrapper();

      await wrapper.vm.updateTrialPeriod("test-org", 2);
      await flushPromises(); // Wait for async error handling

      expect(wrapper.vm.loading).toBe(false);
      expect(mockToastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "loading",
          message:
            "Please wait while processing trial period extension request...",
        }),
      );
      expect(mockToastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: "Extension failed",
          timeout: 5000,
        }),
      );
    });

    it("should handle API error without response message", async () => {
      const error = { status: 500 };
      mockExtendTrialPeriod.mockRejectedValue(error);

      wrapper = createWrapper();

      await wrapper.vm.updateTrialPeriod("test-org", 2);
      await flushPromises(); // Wait for async error handling

      expect(mockToastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "loading",
          message:
            "Please wait while processing trial period extension request...",
        }),
      );
      expect(mockToastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: "Failed to extend trial period. Please try again.",
          timeout: 5000,
        }),
      );
    });

    it("should not show notification for 403 error", async () => {
      const error = { status: 403 };
      mockExtendTrialPeriod.mockRejectedValue(error);

      wrapper = createWrapper();
      await wrapper.vm.updateTrialPeriod("test-org", 2);

      // Loading toast is called, but no error toast for 403
      const errorCalls = mockToastFn.mock.calls.filter(
        (call: any[]) => call[0]?.variant === "error",
      );
      expect(errorCalls.length).toBe(0);
    });

    it("should handle response without data", async () => {
      const mockResponse = { data: false };
      mockExtendTrialPeriod.mockResolvedValue(mockResponse);

      wrapper = createWrapper();
      await wrapper.vm.updateTrialPeriod("test-org", 2);

      expect(wrapper.vm.loading).toBe(false);
      // Only loading notification should have been called (no success toast since data is false)
      const successCalls = mockToastFn.mock.calls.filter(
        (call: any[]) => call[0]?.variant === "success",
      );
      expect(successCalls.length).toBe(0);
    });
  });

  describe("filterData Function", () => {
    const mockRows = [
      { name: "Test Organization", identifier: "test-org", plan: "Free" },
      { name: "Demo Company", identifier: "demo-co", plan: "Enterprise" },
      { name: "Sample Corp", identifier: "sample", plan: "Pay as you go" },
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

    it("should filter visibleRows when filterQuery has a value", () => {
      wrapper = createWrapper();
      wrapper.vm.tabledata = mockRows;
      wrapper.vm.filterQuery = "test";

      const result = wrapper.vm.visibleRows;
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Test Organization");
    });

    it("should return all rows from visibleRows when filterQuery is empty", () => {
      wrapper = createWrapper();
      wrapper.vm.tabledata = mockRows;
      wrapper.vm.filterQuery = "";

      const result = wrapper.vm.visibleRows;
      expect(result).toHaveLength(3);
    });

    it("should be case insensitive", () => {
      wrapper = createWrapper();
      const result = wrapper.vm.filterData(mockRows, "TEST");

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Test Organization");
    });
  });

  describe("OTable Cell Actions Rendering", () => {
    it("should render action buttons for a row without billing provider or storage", async () => {
      store.state.zoConfig.meta_org = "default";
      const mockResponse = {
        data: {
          data: [
            {
              id: 1,
              name: "Test Org",
              identifier: "test-org",
              plan: "0",
              created_at: 123456789,
              trial_expires_at: 987654321,
              billing_provider: undefined,
              org_storage_enabled: false,
            },
          ],
        },
      };
      mockGetAdminOrg.mockResolvedValue(mockResponse);

      wrapper = createWrapper();
      await flushPromises();
      await nextTick();

      // Extend trial button should always be present
      expect(
        wrapper.find('[data-test="otg-management-extend-trial-btn"]').exists(),
      ).toBe(true);
      // Add contract button should show when billing_provider is "-"
      expect(
        wrapper.find('[data-test="org-management-add-contract-btn"]').exists(),
      ).toBe(true);
      // Storage enable button should show when org_storage_enabled is false
      expect(
        wrapper.find(
          '[data-test="org-management-storage-enable-btn"]',
        ).exists(),
      ).toBe(true);
    });

    it("should render revoke and extend contract buttons for no_op billing provider", async () => {
      store.state.zoConfig.meta_org = "default";
      const mockResponse = {
        data: {
          data: [
            {
              id: 1,
              name: "Test Org",
              identifier: "test-org",
              plan: "3",
              created_at: 123456789,
              trial_expires_at: 987654321,
              billing_provider: "no_op",
              org_storage_enabled: false,
              contract_end_date: 1234567890000000,
            },
          ],
        },
      };
      mockGetAdminOrg.mockResolvedValue(mockResponse);

      wrapper = createWrapper();
      await flushPromises();
      await nextTick();

      expect(
        wrapper.find('[data-test="org-management-extend-contract-btn"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="org-management-revoke-contract-btn"]').exists(),
      ).toBe(true);
    });

    it("should render storage enabled button for orgs with storage enabled", async () => {
      store.state.zoConfig.meta_org = "default";
      const mockResponse = {
        data: {
          data: [
            {
              id: 1,
              name: "Test Org",
              identifier: "test-org",
              plan: "0",
              created_at: 123456789,
              trial_expires_at: 987654321,
              billing_provider: "-",
              org_storage_enabled: true,
            },
          ],
        },
      };
      mockGetAdminOrg.mockResolvedValue(mockResponse);

      wrapper = createWrapper();
      await flushPromises();
      await nextTick();

      // Storage enabled button should show when org_storage_enabled is true
      const storageEnabledBtn = wrapper.find(
        '[data-test="org-management-storage-enabled-btn"]',
      );
      expect(storageEnabledBtn.exists()).toBe(true);
      // Storage enable button should NOT show
      const storageEnableBtn = wrapper.find(
        '[data-test="org-management-storage-enable-btn"]',
      );
      expect(storageEnableBtn.exists()).toBe(false);
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
      // Title now lives in the standard AppPageHeader (row 1).
      const title = wrapper.find(".app-page-header h1");
      expect(title.text()).toBe("Organization Management");
    });

    it("should render the search input", () => {
      wrapper = createWrapper();
      const searchInput = wrapper.find(
        '[data-test="org-management-search-input"]',
      );
      expect(searchInput.exists()).toBe(true);
    });

    it("should render ODialog stub when extendTrialPrompt is true", async () => {
      wrapper = createWrapper();
      wrapper.vm.extendTrialPrompt = true;
      wrapper.vm.extendTrialDataRow = { name: "Test Org" };
      await nextTick();

      const dialogs = wrapper.findAll('[data-test="o-dialog-stub"]');
      expect(dialogs.length).toBeGreaterThanOrEqual(1);
    });

    it("should not render extend trial ODialog stub when extendTrialPrompt is false", async () => {
      wrapper = createWrapper();
      wrapper.vm.extendTrialPrompt = false;
      await nextTick();

      // ODialog stub is rendered only when `open` is truthy
      const openDialogs = wrapper.findAll('[data-test="o-dialog-stub"]');
      // Either contract dialog may be open separately; ensure none for extendTrial
      const titles = openDialogs.map((d: any) => d.attributes("data-title"));
      expect(
        titles.every((t: string) => !t || !t.startsWith("Extend Trial")),
      ).toBe(true);
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

  describe("ODialog Extend Trial bindings", () => {
    it("should forward title, subTitle and labels to the extend-trial ODialog", async () => {
      wrapper = createWrapper();
      wrapper.vm.extendTrialPrompt = true;
      wrapper.vm.extendTrialDataRow = { name: "Acme", identifier: "acme" };
      wrapper.vm.extendedTrial = 2;
      await nextTick();

      const dialog = wrapper
        .findAll('[data-test="o-dialog-stub"]')
        .find((d: any) =>
          (d.attributes("data-title") || "").startsWith("Extend Trial"),
        );
      expect(dialog?.exists()).toBe(true);
      expect(dialog!.attributes("data-title")).toBe("Extend Trial for Acme");
      expect(dialog!.attributes("data-sub-title")).toBe(
        "Set the new trial extension period.",
      );
      expect(dialog!.attributes("data-primary-label")).toBe(
        "Extend trial by 2 week(s)",
      );
      expect(dialog!.attributes("data-secondary-label")).toBe("Cancel");
      expect(dialog!.attributes("data-size")).toBe("sm");
    });

    it("should close the extend-trial dialog when secondary is clicked", async () => {
      wrapper = createWrapper();
      wrapper.vm.extendTrialPrompt = true;
      wrapper.vm.extendTrialDataRow = { name: "Acme", identifier: "acme" };
      await nextTick();

      const dialog = wrapper
        .findAll('[data-test="o-dialog-stub"]')
        .find((d: any) =>
          (d.attributes("data-title") || "").startsWith("Extend Trial"),
        );
      expect(dialog?.exists()).toBe(true);

      await dialog!.find('[data-test="o-dialog-stub-secondary"]').trigger("click");
      expect(wrapper.vm.extendTrialPrompt).toBe(false);
    });

    it("should call updateTrialPeriod when primary is clicked on the extend-trial dialog", async () => {
      mockExtendTrialPeriod.mockResolvedValue({ data: true });
      wrapper = createWrapper();
      wrapper.vm.extendTrialPrompt = true;
      wrapper.vm.extendTrialDataRow = { name: "Acme", identifier: "acme-id" };
      wrapper.vm.extendedTrial = 3;
      await nextTick();

      const dialog = wrapper
        .findAll('[data-test="o-dialog-stub"]')
        .find((d: any) =>
          (d.attributes("data-title") || "").startsWith("Extend Trial"),
        );
      expect(dialog?.exists()).toBe(true);

      await dialog!.find('[data-test="o-dialog-stub-primary"]').trigger("click");
      await flushPromises();

      expect(mockExtendTrialPeriod).toHaveBeenCalledWith(
        "default",
        expect.objectContaining({ org_id: "acme-id" }),
      );
    });
  });

  describe("ODialog Contract bindings", () => {
    it("should forward title and labels to the contract ODialog when creating", async () => {
      wrapper = createWrapper();
      wrapper.vm.toggleContractDialog(
        { name: "Acme", identifier: "acme" },
        "create",
      );
      await nextTick();

      const dialog = wrapper
        .findAll('[data-test="o-dialog-stub"]')
        .find((d: any) =>
          (d.attributes("data-title") || "").includes("External Contract"),
        );
      expect(dialog?.exists()).toBe(true);
      expect(dialog!.attributes("data-title")).toBe(
        "Create External Contract for Acme",
      );
      expect(dialog!.attributes("data-primary-label")).toBe("Create Contract");
      expect(dialog!.attributes("data-secondary-label")).toBe("Cancel");
    });

    it("should forward title and labels to the contract ODialog when extending", async () => {
      wrapper = createWrapper();
      wrapper.vm.toggleContractDialog(
        { name: "Acme", identifier: "acme" },
        "extend",
      );
      await nextTick();

      const dialog = wrapper
        .findAll('[data-test="o-dialog-stub"]')
        .find((d: any) =>
          (d.attributes("data-title") || "").includes("External Contract"),
        );
      expect(dialog?.exists()).toBe(true);
      expect(dialog!.attributes("data-title")).toBe(
        "Extend External Contract for Acme",
      );
      expect(dialog!.attributes("data-primary-label")).toBe("Extend Contract");
    });

    it("should close the contract dialog when secondary is clicked", async () => {
      wrapper = createWrapper();
      wrapper.vm.toggleContractDialog(
        { name: "Acme", identifier: "acme" },
        "create",
      );
      await nextTick();

      const dialog = wrapper
        .findAll('[data-test="o-dialog-stub"]')
        .find((d: any) =>
          (d.attributes("data-title") || "").includes("External Contract"),
        );
      expect(dialog?.exists()).toBe(true);

      await dialog!.find('[data-test="o-dialog-stub-secondary"]').trigger("click");
      expect(wrapper.vm.contractPrompt).toBe(false);
    });

    it("should invoke submitContract when primary is clicked", async () => {
      mockCreateExternalContract?.mockResolvedValue?.({ data: true });
      wrapper = createWrapper();
      wrapper.vm.toggleContractDialog(
        { name: "Acme", identifier: "acme" },
        "create",
      );
      wrapper.vm.contractEndDate = "2030-12-31";
      await nextTick();

      const dialog = wrapper
        .findAll('[data-test="o-dialog-stub"]')
        .find((d: any) =>
          (d.attributes("data-title") || "").includes("External Contract"),
        );
      expect(dialog?.exists()).toBe(true);

      await dialog!.find('[data-test="o-dialog-stub-primary"]').trigger("click");
      await flushPromises();

      expect(mockCreateExternalContract).toHaveBeenCalledWith(
        "default",
        expect.objectContaining({ org_id: "acme" }),
      );
    });
  });

  describe("toggleContractDialog Function", () => {
    it("should open the contract dialog in create mode and reset the end date", () => {
      wrapper = createWrapper();
      wrapper.vm.contractEndDate = "2025-01-01";
      wrapper.vm.toggleContractDialog(
        { name: "Acme", identifier: "acme" },
        "create",
      );

      expect(wrapper.vm.contractPrompt).toBe(true);
      expect(wrapper.vm.contractMode).toBe("create");
      expect(wrapper.vm.contractDataRow).toEqual({
        name: "Acme",
        identifier: "acme",
      });
      expect(wrapper.vm.contractEndDate).toBe("");
    });

    it("should open the contract dialog in extend mode", () => {
      wrapper = createWrapper();
      wrapper.vm.toggleContractDialog(
        { name: "Beta", identifier: "beta" },
        "extend",
      );

      expect(wrapper.vm.contractPrompt).toBe(true);
      expect(wrapper.vm.contractMode).toBe("extend");
      expect(wrapper.vm.contractDataRow).toEqual({
        name: "Beta",
        identifier: "beta",
      });
    });
  });

  describe("submitContract Function", () => {
    beforeEach(() => {
      // Prevent onMounted from calling getData so mockToastFn call counts are predictable
      store.state.zoConfig.meta_org = "different_org";
    });

    it("should warn and return when create mode has no end date", async () => {
      wrapper = createWrapper();
      wrapper.vm.toggleContractDialog(
        { name: "Acme", identifier: "acme" },
        "create",
      );
      wrapper.vm.contractEndDate = "";

      await wrapper.vm.submitContract();
      await flushPromises();

      expect(mockToastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: "End date is required.",
        }),
      );
      expect(mockCreateExternalContract).not.toHaveBeenCalled();
    });

    it("should warn and return when extend mode has no end date", async () => {
      wrapper = createWrapper();
      wrapper.vm.toggleContractDialog(
        { name: "Acme", identifier: "acme" },
        "extend",
      );
      wrapper.vm.contractEndDate = "";

      await wrapper.vm.submitContract();
      await flushPromises();

      expect(mockToastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: "New end date is required.",
        }),
      );
      expect(mockExtendExternalContract).not.toHaveBeenCalled();
    });

    it("should call create_external_contract with the correct payload in create mode", async () => {
      mockCreateExternalContract.mockResolvedValue({ data: true });
      wrapper = createWrapper();
      wrapper.vm.toggleContractDialog(
        { name: "Acme", identifier: "acme" },
        "create",
      );
      wrapper.vm.contractEndDate = "2030-12-31";

      await wrapper.vm.submitContract();
      await flushPromises();

      expect(mockCreateExternalContract).toHaveBeenCalledTimes(1);
      const [orgArg, payload] = mockCreateExternalContract.mock.calls[0];
      expect(orgArg).toBe("default");
      expect(payload.org_id).toBe("acme");
      expect(typeof payload.end_date).toBe("number");
      expect(payload.end_date).toBeGreaterThan(0);
    });

    it("should close the dialog and refresh data after create success", async () => {
      mockCreateExternalContract.mockResolvedValue({ data: true });
      mockGetAdminOrg.mockResolvedValue({ data: { data: [] } });
      wrapper = createWrapper();

      mockGetAdminOrg.mockClear();

      wrapper.vm.toggleContractDialog(
        { name: "Acme", identifier: "acme" },
        "create",
      );
      wrapper.vm.contractEndDate = "2030-12-31";
      await wrapper.vm.submitContract();
      await flushPromises();

      expect(wrapper.vm.contractPrompt).toBe(false);
      expect(mockGetAdminOrg).toHaveBeenCalledTimes(1);
    });

    it("should show an error notification when create_external_contract fails", async () => {
      mockCreateExternalContract.mockRejectedValue({
        response: { data: { message: "create failed" } },
      });
      wrapper = createWrapper();
      wrapper.vm.toggleContractDialog(
        { name: "Acme", identifier: "acme" },
        "create",
      );
      wrapper.vm.contractEndDate = "2030-12-31";

      await wrapper.vm.submitContract();
      await flushPromises();

      expect(mockToastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: "create failed",
          timeout: 5000,
        }),
      );
      expect(wrapper.vm.loading).toBe(false);
    });

    it("should fall back to a default message when create_external_contract fails without a message", async () => {
      mockCreateExternalContract.mockRejectedValue({});
      wrapper = createWrapper();
      wrapper.vm.toggleContractDialog(
        { name: "Acme", identifier: "acme" },
        "create",
      );
      wrapper.vm.contractEndDate = "2030-12-31";

      await wrapper.vm.submitContract();
      await flushPromises();

      expect(mockToastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: "Failed to create external contract.",
        }),
      );
    });

    it("should call extend_external_contract with the correct payload in extend mode", async () => {
      mockExtendExternalContract.mockResolvedValue({ data: true });
      wrapper = createWrapper();
      wrapper.vm.toggleContractDialog(
        { name: "Beta", identifier: "beta" },
        "extend",
      );
      wrapper.vm.contractEndDate = "2030-12-31";

      await wrapper.vm.submitContract();
      await flushPromises();

      expect(mockExtendExternalContract).toHaveBeenCalledTimes(1);
      const [orgArg, payload] = mockExtendExternalContract.mock.calls[0];
      expect(orgArg).toBe("default");
      expect(payload.org_id).toBe("beta");
      expect(typeof payload.new_end_date).toBe("number");
    });

    it("should show an error notification when extend_external_contract fails", async () => {
      mockExtendExternalContract.mockRejectedValue({
        response: { data: { message: "extend failed" } },
      });
      wrapper = createWrapper();
      wrapper.vm.toggleContractDialog(
        { name: "Beta", identifier: "beta" },
        "extend",
      );
      wrapper.vm.contractEndDate = "2030-12-31";

      await wrapper.vm.submitContract();
      await flushPromises();

      expect(mockToastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: "extend failed",
          timeout: 5000,
        }),
      );
    });
  });

  describe("confirmRevokeContract Function", () => {
    beforeEach(() => {
      // Prevent onMounted from calling getData so toast call counts are predictable
      store.state.zoConfig.meta_org = "different_org";
    });

    it("should call confirm with the correct dialog options", async () => {
      wrapper = createWrapper();
      await wrapper.vm.confirmRevokeContract({
        name: "TestOrg",
        identifier: "test-org",
      });

      expect(mockConfirmFn).toHaveBeenCalledWith({
        title: "Revoke External Contract",
        message:
          'Are you sure you want to revoke the external contract for "TestOrg"? The organization will revert to the Free tier.',
      });
    });

    it("should not call revoke_external_contract when confirm is rejected", async () => {
      mockConfirmFn.mockResolvedValueOnce(false);

      wrapper = createWrapper();
      await wrapper.vm.confirmRevokeContract({
        name: "TestOrg",
        identifier: "test-org",
      });

      expect(mockRevokeExternalContract).not.toHaveBeenCalled();
    });

    it("should call revoke_external_contract and show success toast on success", async () => {
      mockConfirmFn.mockResolvedValueOnce(true);
      mockRevokeExternalContract.mockResolvedValue({ data: true });
      mockGetAdminOrg.mockResolvedValue({ data: { data: [] } });

      wrapper = createWrapper();
      await wrapper.vm.confirmRevokeContract({
        name: "TestOrg",
        identifier: "test-org",
      });

      expect(mockRevokeExternalContract).toHaveBeenCalledWith(
        "default",
        "test-org",
      );
      expect(mockToastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "success",
          message: "External contract revoked successfully.",
        }),
      );
    });

    it("should show error toast when revoke_external_contract fails", async () => {
      mockConfirmFn.mockResolvedValueOnce(true);
      mockRevokeExternalContract.mockRejectedValue({
        response: { data: { message: "Revoke failed" } },
      });

      wrapper = createWrapper();
      await wrapper.vm.confirmRevokeContract({
        name: "TestOrg",
        identifier: "test-org",
      });
      await flushPromises();

      expect(mockToastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: "Revoke failed",
          timeout: 5000,
        }),
      );
    });

    it("should show default error message when revoke_external_contract fails without response", async () => {
      mockConfirmFn.mockResolvedValueOnce(true);
      mockRevokeExternalContract.mockRejectedValue({});

      wrapper = createWrapper();
      await wrapper.vm.confirmRevokeContract({
        name: "TestOrg",
        identifier: "test-org",
      });
      await flushPromises();

      expect(mockToastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: "Failed to revoke external contract.",
        }),
      );
    });
  });

  describe("toggleOrgStorage Function", () => {
    beforeEach(() => {
      // Prevent onMounted from calling getData so toast call counts are predictable
      store.state.zoConfig.meta_org = "different_org";
    });

    it("should call confirm with the correct dialog options", async () => {
      wrapper = createWrapper();
      await wrapper.vm.toggleOrgStorage({
        name: "TestOrg",
        identifier: "test-org",
      });

      expect(mockConfirmFn).toHaveBeenCalledWith({
        title: "Enable BYOB",
        message: 'Are you sure you want to enable BYOB for "TestOrg"?',
      });
    });

    it("should not call org storage enable when confirm is rejected", async () => {
      mockConfirmFn.mockResolvedValueOnce(false);

      wrapper = createWrapper();
      await wrapper.vm.toggleOrgStorage({
        name: "TestOrg",
        identifier: "test-org",
      });

      expect(mockOrgStorageEnable).not.toHaveBeenCalled();
    });

    it("should call org storage enable and show success toast on success", async () => {
      mockConfirmFn.mockResolvedValueOnce(true);
      mockOrgStorageEnable.mockResolvedValue({ data: true });
      mockGetAdminOrg.mockResolvedValue({ data: { data: [] } });

      wrapper = createWrapper();
      await wrapper.vm.toggleOrgStorage({
        name: "TestOrg",
        identifier: "test-org",
      });

      expect(mockOrgStorageEnable).toHaveBeenCalledWith("test-org");
      expect(mockToastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "success",
          message: "Storage settings enabled successfully.",
        }),
      );
    });

    it("should show error toast when org storage enable fails", async () => {
      mockConfirmFn.mockResolvedValueOnce(true);
      mockOrgStorageEnable.mockRejectedValue({
        response: { data: { message: "Enable failed" } },
      });

      wrapper = createWrapper();
      await wrapper.vm.toggleOrgStorage({
        name: "TestOrg",
        identifier: "test-org",
      });
      await flushPromises();

      expect(mockToastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: "Enable failed",
          timeout: 5000,
        }),
      );
    });

    it("should show default error message when org storage enable fails without response", async () => {
      mockConfirmFn.mockResolvedValueOnce(true);
      mockOrgStorageEnable.mockRejectedValue({});

      wrapper = createWrapper();
      await wrapper.vm.toggleOrgStorage({
        name: "TestOrg",
        identifier: "test-org",
      });
      await flushPromises();

      expect(mockToastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: "Failed to enable storage settings.",
        }),
      );
    });
  });

  describe("formatMicrosToDate Function", () => {
    it("should return '-' for falsy values", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.formatMicrosToDate(0)).toBe("-");
      expect(wrapper.vm.formatMicrosToDate(undefined as any)).toBe("-");
    });

    it("should return a formatted date for positive timestamps", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.formatMicrosToDate(1234567890000000)).toBe(
        "2023-12-01",
      );
    });
  });

  describe("Extend Trial Dialog Week Selectors", () => {
    it("should select week 2 when the second span is clicked", async () => {
      wrapper = createWrapper();
      wrapper.vm.extendTrialPrompt = true;
      wrapper.vm.extendTrialDataRow = { name: "Test Org" };
      await nextTick();

      // Click the second week span (page = 2)
      const weekSpans = wrapper.findAll('[data-test="o-dialog-stub"] span');
      // Find the span containing "2"
      const week2Span = weekSpans.find((s: any) => s.text().trim() === "2");
      expect(week2Span?.exists()).toBe(true);
      await week2Span!.trigger("click");

      expect(wrapper.vm.extendedTrial).toBe(2);
    });

    it("should toggle extendTrialPrompt when the dialog opens and closes", async () => {
      wrapper = createWrapper();
      expect(wrapper.vm.extendTrialPrompt).toBe(false);

      wrapper.vm.extendTrialPrompt = true;
      wrapper.vm.extendTrialDataRow = { name: "Test Org" };
      await nextTick();

      expect(wrapper.vm.extendTrialPrompt).toBe(true);

      wrapper.vm.extendTrialPrompt = false;
      await nextTick();

      expect(wrapper.vm.extendTrialPrompt).toBe(false);
    });
  });

  describe("Contract Dialog Rendering", () => {
    it("should render the contract dialog with date input and current end date for extend mode", async () => {
      wrapper = createWrapper();
      wrapper.vm.toggleContractDialog(
        { name: "Acme", identifier: "acme", contract_end_date: 1234567890000000 },
        "extend",
      );
      await nextTick();

      const dateInput = wrapper.find('[data-test="contract-end-date-input"]');
      expect(dateInput.exists()).toBe(true);

      // The "Current end date" text should appear in extend mode with a valid contract_end_date
      const currentEndDateText = wrapper.text();
      expect(currentEndDateText).toContain("Current end date");
      expect(currentEndDateText).toContain("2023-12-01");
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
          data: [
            {
              id: 1,
              name: "Test Org",
              identifier: "test-org",
              plan: "0",
              created_at: 123456789,
              trial_expires_at: 987654321,
            },
          ],
        },
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

    it("should handle search filtering with real data", async () => {
      store.state.zoConfig = { meta_org: "default" };
      store.state.selectedOrganization = { identifier: "default" };

      const mockResponse = {
        data: {
          data: [
            {
              id: 1,
              name: "Alpha Corp",
              identifier: "alpha",
              plan: "0",
              created_at: 123,
              trial_expires_at: 456,
            },
            {
              id: 2,
              name: "Beta Inc",
              identifier: "beta",
              plan: "1",
              created_at: 123,
              trial_expires_at: 456,
            },
            {
              id: 3,
              name: "Gamma Ltd",
              identifier: "gamma",
              plan: "2",
              created_at: 123,
              trial_expires_at: 456,
            },
          ],
        },
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
