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

// Mock service_accounts service
vi.mock("@/services/service_accounts", () => ({
  default: {
    list: vi.fn(),
    delete: vi.fn(),
    get_service_token: vi.fn(),
    refresh_token: vi.fn()
  }
}));

// Mock usePermissions composable
const mockServiceAccountsState = {
  service_accounts_users: []
};

vi.mock("@/composables/iam/usePermissions", () => ({
  default: () => ({
    serviceAccountsState: mockServiceAccountsState
  })
}));

// Mock aws-exports
vi.mock("@/aws-exports", () => ({
  default: {
    isEnterprise: "true",
    isCloud: false
  }
}));

import ServiceAccountsList from "@/components/iam/serviceAccounts/ServiceAccountsList.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import service_accounts from "@/services/service_accounts";

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

describe("ServiceAccountsList Component", () => {
  let wrapper;
  let mockRouter;
  let dismissMock;
  let notifyMock;
  let dialogMock;

  beforeEach(async () => {
    // Reset mock implementations
    vi.mocked(service_accounts.list).mockReset();
    vi.mocked(service_accounts.delete).mockReset();
    vi.mocked(service_accounts.get_service_token).mockReset();
    vi.mocked(service_accounts.refresh_token).mockReset();

    // Setup default successful response for list
    vi.mocked(service_accounts.list).mockResolvedValue({
      data: { 
        data: [],
        code: 200 
      }
    });

    // Setup store state
    store.state.selectedOrganization = { identifier: "test-org", name: "Test Org" };
    store.state.userInfo = { email: "test@example.com" };
    store.state.theme = 'light';

    // Setup router mock
    mockRouter = {
      push: vi.fn(),
      replace: vi.fn()
    };

    // Setup notify and dialog mocks
    dismissMock = vi.fn();
    notifyMock = vi.fn().mockReturnValue(dismissMock);
    dialogMock = vi.fn().mockResolvedValue(true);

    wrapper = mount(ServiceAccountsList, {
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
          $q: {
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
    wrapper.vm.$q = {
      ...wrapper.vm.$q,
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
    mockServiceAccountsState.service_accounts_users = [];
  });

  it("renders the component", () => {
    expect(wrapper.exists()).toBe(true);
  });

  describe("Service Accounts List", () => {
    it("fetches service accounts on mount", async () => {
      const mockServiceAccounts = [
        { email: "service1@example.com", first_name: "Service 1", last_name: "Account" },
        { email: "service2@example.com", first_name: "Service 2", last_name: "Account" }
      ];

      vi.mocked(service_accounts.list).mockResolvedValue({
        data: { data: mockServiceAccounts }
      });

      const newWrapper = mount(ServiceAccountsList, {
        global: {
          plugins: [[Quasar, { platform }], [i18n]],
          provide: { store, platform, router: mockRouter },
          mocks: {
            $router: mockRouter,
            $q: { 
              platform, 
              notify: notifyMock, 
              dialog: dialogMock 
            },
            router: mockRouter
          }
        }
      });

      await flushPromises();

      expect(service_accounts.list).toHaveBeenCalledWith("test-org");
      
      newWrapper.unmount();
    });
  });

  describe("Service Account Actions", () => {
    it("gets service account token", async () => {
      const mockToken = "test-token-123";
      vi.mocked(service_accounts.get_service_token).mockResolvedValue({
        data: { token: mockToken }
      });

      const row = {
        email: "service1@example.com",
        isLoading: false,
        isTokenVisible: false
      };

      await wrapper.vm.getServiceToken(row);
      await flushPromises();

      expect(service_accounts.get_service_token).toHaveBeenCalledWith(
        "test-org",
        "service1@example.com"
      );
      expect(row.token).toBe(mockToken);
      expect(row.isTokenVisible).toBe(true);
    });
  });

  describe("UI Interactions", () => {
    it("filters service accounts based on search query", async () => {
      mockServiceAccountsState.service_accounts_users = [
        { email: "service1@example.com", first_name: "Service 1" },
        { email: "service2@example.com", first_name: "Service 2" }
      ];

      wrapper.vm.filterQuery = "service1";
      await nextTick();

      const filtered = wrapper.vm.filterData(
        mockServiceAccountsState.service_accounts_users,
        "service1"
      );
      expect(filtered.length).toBe(1);
      expect(filtered[0].email).toContain("service1");
    });

    it("filters service accounts by first name", async () => {
      mockServiceAccountsState.service_accounts_users = [
        { email: "service1@example.com", first_name: "First" },
        { email: "service2@example.com", first_name: "Second" }
      ];

      const filtered = wrapper.vm.filterData(
        mockServiceAccountsState.service_accounts_users,
        "First"
      );
      expect(filtered.length).toBe(1);
      expect(filtered[0].first_name).toBe("First");
    });

    it("downloads token as file", () => {
      const token = "test-token-123";
      const mockCreateElement = document.createElement;
      const mockClick = vi.fn();
      const mockLink = {
        href: "",
        download: "",
        click: mockClick
      };

      document.createElement = vi.fn().mockReturnValue(mockLink);
      URL.createObjectURL = vi.fn().mockReturnValue("blob:test");
      URL.revokeObjectURL = vi.fn();

      wrapper.vm.downloadTokenAsFile(token);

      expect(mockLink.download).toBe("service_account_token.txt");
      expect(mockClick).toHaveBeenCalled();
      expect(URL.revokeObjectURL).toHaveBeenCalled();

      document.createElement = mockCreateElement;
    });
  });

  describe("Token Display", () => {
    it("masks token correctly", () => {
      const token = "abcd1234efgh5678";
      const maskedToken = wrapper.vm.maskToken(token);
      expect(maskedToken).toBe("abcd **** 5678");
    });

    it("handles short tokens in maskToken", () => {
      const shortToken = "1234";
      const maskedToken = wrapper.vm.maskToken(shortToken);
      expect(maskedToken).toBe(shortToken);
    });

    it("displays correct token based on visibility", () => {
      const row = {
        token: "abcd1234efgh5678",
        isTokenVisible: false
      };
      let displayToken = wrapper.vm.getDisplayToken(row);
      expect(displayToken).toBe("* * * * * * * * * * * * * * * *");

      row.isTokenVisible = true;
      displayToken = wrapper.vm.getDisplayToken(row);
      expect(displayToken).toBe("abcd **** 5678");
    });

    it("handles undefined token in getDisplayToken", () => {
      const row = {
        isTokenVisible: false
      };
      const displayToken = wrapper.vm.getDisplayToken(row);
      expect(displayToken).toBe("* * * * * * * * * * * * * * * *");
    });
  });


  describe("Pagination", () => {
    it("changes pagination settings", async () => {
      const newPageSize = { label: "50", value: 50 };
      await wrapper.vm.changePagination(newPageSize);

      expect(wrapper.vm.selectedPerPage).toBe(50);
      expect(wrapper.vm.pagination.rowsPerPage).toBe(50);
    });

    it("updates max records to return", async () => {
      const newMaxRecords = 200;
      await wrapper.vm.changeMaxRecordToReturn(newMaxRecords);

      expect(wrapper.vm.maxRecordToReturn).toBe(newMaxRecords);
    });
  });
});
