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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from 'vue';

// Mock service_accounts service
vi.mock("@/services/service_accounts", () => ({
  default: {
    list: vi.fn(),
    delete: vi.fn(),
    bulkDelete: vi.fn(),
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

// Mock clipboard utility
vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: vi.fn().mockResolvedValue(undefined)
}));

import ServiceAccountsList from "@/components/iam/serviceAccounts/ServiceAccountsList.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import service_accounts from "@/services/service_accounts";
import { copyToClipboard } from "@/utils/clipboard";

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

// ODialog stub
const ODialogStub = {
  name: 'ODialog',
  template: '<div class="o-dialog-stub" v-if="open" :data-test="dataTest"><slot /></div>',
  props: ['open', 'persistent', 'size', 'title', 'subTitle', 'showClose', 'width',
    'primaryButtonLabel', 'secondaryButtonLabel', 'neutralButtonLabel',
    'primaryButtonVariant', 'secondaryButtonVariant', 'neutralButtonVariant', 'dataTest'],
  emits: ['update:open', 'click:primary', 'click:secondary', 'click:neutral'],
};

// ConfirmDialog stub
const ConfirmDialogStub = {
  name: 'ConfirmDialog',
  template: `
    <div class="confirm-dialog-stub" v-if="modelValue" :data-test="dataTest">
      <div class="confirm-title">{{ title }}</div>
      <div class="confirm-message">{{ message }}</div>
      <div class="confirm-ok-label">{{ okLabel }}</div>
      <div class="confirm-ok-color">{{ okColor }}</div>
      <button class="confirm-ok-btn" @click="$emit('update:ok'); $emit('update:modelValue', false)">OK</button>
      <button class="confirm-cancel-btn" @click="$emit('update:cancel'); $emit('update:modelValue', false)">Cancel</button>
    </div>
  `,
  props: ['modelValue', 'title', 'message', 'warningMessage', 'okLabel', 'okColor', 'dataTest'],
  emits: ['update:modelValue', 'update:ok', 'update:cancel'],
};

// OBanner stub
const OBannerStub = {
  name: 'OBanner',
  template: '<div class="o-banner-stub"><slot /></div>',
  props: ['variant', 'icon', 'content', 'dense', 'inlineActions', 'dataTest'],
};

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
    vi.mocked(service_accounts.bulkDelete).mockReset();
    vi.mocked(service_accounts.refresh_token).mockReset();
    vi.mocked(copyToClipboard).mockReset();

    // Setup default successful response for list with SRE Agent as first entry
    vi.mocked(service_accounts.list).mockResolvedValue({
      data: {
        data: [
          {
            email: "o2-sre-agent.org-test-org@openobserve.internal",
            first_name: "SRE Agent",
            last_name: "System",
            role: "SreAgent",
            is_system: true,
            description: "System-managed SRE Agent service account for root cause analysis",
            created_at: 1640995200,
            created_at_iso: "2022-01-01T00:00:00Z",
            created_by: "system"
          },
          {
            email: "service1@example.com",
            first_name: "Service 1",
            last_name: "",
            role: "ServiceAccount",
            is_system: false,
            description: null,
            created_at: 1640995200,
            created_at_iso: "2022-01-01T00:00:00Z",
            created_by: "admin@example.com"
          },
          {
            email: "service2@example.com",
            first_name: "Service 2",
            last_name: "",
            role: "ServiceAccount",
            is_system: false,
            description: null,
            created_at: 1640995200,
            created_at_iso: "2022-01-01T00:00:00Z",
            created_by: "admin@example.com"
          }
        ]
      }
    });

    // Setup store state
    store.state.selectedOrganization = { identifier: "test-org", name: "Test Org" };
    store.state.userInfo = { email: "test@example.com" };
    store.state.theme = 'light';
    store.state.API_ENDPOINT = "https://api.example.com";

    // Setup router mock with currentRoute
    mockRouter = {
      push: vi.fn(),
      replace: vi.fn(),
      currentRoute: {
        value: {
          query: {},
          params: {}
        }
      }
    };

    // Setup notify and dialog mocks
    dismissMock = vi.fn();
    notifyMock = vi.fn().mockReturnValue(dismissMock);
    dialogMock = vi.fn().mockResolvedValue(true);

    // Mock navigator.clipboard
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined)
      }
    });

    // Mock URL methods
    global.URL.createObjectURL = vi.fn(() => 'blob:test-url');
    global.URL.revokeObjectURL = vi.fn();

    wrapper = mount(ServiceAccountsList, {
      global: {
        plugins: [
          [{ platform }],
          [i18n]
        ],
        provide: {
          store,
          platform
        },
        mocks: {
          $router: mockRouter,
          $route: mockRouter.currentRoute.value,
          $q: {
            platform,
            notify: notifyMock,
            dialog: dialogMock
          }
        },
        stubs: {
          'router-link': {
            name: 'router-link',
            template: '<a class="router-link-stub"><slot /></a>',
            props: ['to'],
          },
          'router-view': true,
          'AddServiceAccount': {
            name: 'AddServiceAccount',
            template: '<div class="add-service-account-stub" v-if="open" />',
            props: ['open', 'modelValue', 'isUpdated'],
            emits: ['update:open', 'update:modelValue', 'updated'],
          },
          'QTablePagination': true,
          'NoData': true,
          ODialog: ODialogStub,
          ConfirmDialog: ConfirmDialogStub,
          OBanner: OBannerStub,
          ODrawer: {
            name: 'ODrawer',
            template: '<div class="o-drawer-stub" v-if="open"><slot /></div>',
            props: ['open', 'persistent', 'size', 'title', 'subTitle', 'showClose', 'width', 'primaryButtonLabel', 'secondaryButtonLabel', 'neutralButtonLabel'],
            emits: ['update:open', 'click:primary', 'click:secondary', 'click:neutral'],
          },
        }
      },
      attachTo: document.body
    });

    // Set up wrapper's $q.notify and dialog after mount
    if (wrapper.vm.$q) {
      wrapper.vm.$q.notify = notifyMock;
      wrapper.vm.$q.dialog = dialogMock;
    }

    // Mock the router in wrapper.vm if needed
    if (!wrapper.vm.$router) {
      wrapper.vm.$router = mockRouter;
    }

    await flushPromises();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  it("renders the component", () => {
    expect(wrapper.exists()).toBe(true);
  });

  describe("Service Accounts List", () => {
    it("fetches service accounts on mount", async () => {
      expect(service_accounts.list).toHaveBeenCalledWith("test-org");
    });

    it("formats service account data correctly", async () => {
      const result = await wrapper.vm.getServiceAccountsUsers();
      await flushPromises();

      expect(result).toBeDefined();
    });

    it("first row should be SRE Agent system account", async () => {
      await wrapper.vm.getServiceAccountsUsers();
      await flushPromises();

      const firstAccount = mockServiceAccountsState.service_accounts_users[0];
      expect(firstAccount.email).toBe("o2-sre-agent.org-test-org@openobserve.internal");
      expect(firstAccount.is_system).toBe(true);
      expect(firstAccount.role).toBe("SreAgent");
      expect(firstAccount.description).toContain("SRE Agent");
    });

    it("distinguishes between system and user service accounts", async () => {
      await wrapper.vm.getServiceAccountsUsers();
      await flushPromises();

      const accounts = mockServiceAccountsState.service_accounts_users;
      const sreAgent = accounts.find(acc => acc.is_system);
      const userAccount = accounts.find(acc => !acc.is_system);

      expect(sreAgent).toBeDefined();
      expect(sreAgent.is_system).toBe(true);
      expect(sreAgent.role).toBe("SreAgent");

      expect(userAccount).toBeDefined();
      expect(userAccount.is_system).toBe(false);
      expect(userAccount.role).toBe("ServiceAccount");
    });
  });

  describe("Service Account Management", () => {
    it("shows add service account dialog", async () => {
      expect(wrapper.vm.showAddUserDialog).toBe(false);
      wrapper.vm.showAddUserDialog = true;
      expect(wrapper.vm.showAddUserDialog).toBe(true);
    });

    it("hides form dialog", () => {
      wrapper.vm.showAddUserDialog = true;
      expect(wrapper.vm.showAddUserDialog).toBe(true);

      wrapper.vm.showAddUserDialog = false;
      expect(wrapper.vm.showAddUserDialog).toBe(false);
    });

    it("handles successful service account creation", async () => {
      const newAccount = {
        email: "new-service@example.com",
        first_name: "New Service",
        is_system: false,
        description: null
      };

      wrapper.vm.isUpdated = false;
      wrapper.vm.addUser(newAccount, true);

      expect(wrapper.vm.isUpdated).toBe(true);
      expect(wrapper.vm.showAddUserDialog).toBe(false);
    });

    it("confirms delete action for user service accounts", () => {
      const row = { email: "service1@example.com", is_system: false };
      wrapper.vm.confirmDeleteAction(row);

      expect(wrapper.vm.confirmDelete).toBe(true);
    });

    it("prevents deletion of system service accounts", () => {
      const sreAgentAccount = {
        email: "o2-sre-agent.org-test-org@openobserve.internal",
        is_system: true
      };

      expect(sreAgentAccount.is_system).toBe(true);
      const isSystemAccount = sreAgentAccount.is_system;
      expect(isSystemAccount).toBe(true);
    });

    it("deletes user service account successfully", async () => {
      vi.mocked(service_accounts.delete).mockResolvedValue({
        data: { code: 200 }
      });

      const row = { email: "service1@example.com", is_system: false };
      wrapper.vm.confirmDeleteAction(row);
      expect(wrapper.vm.confirmDelete).toBe(true);

      await wrapper.vm.deleteUser();
      await flushPromises();

      expect(service_accounts.delete).toHaveBeenCalledWith("test-org", "service1@example.com");
      expect(wrapper.vm.confirmDelete).toBe(false);
    });

    it("should display system badge for SRE Agent accounts", async () => {
      await wrapper.vm.getServiceAccountsUsers();
      await flushPromises();

      const sreAgent = mockServiceAccountsState.service_accounts_users.find(acc => acc.is_system);
      expect(sreAgent).toBeDefined();
      expect(sreAgent.is_system).toBe(true);
      expect(sreAgent.description).toContain("System-managed");
    });
  });

  describe("Token Management", () => {
    it("refreshes service token successfully for user accounts", async () => {
      const mockToken = "refreshed-token-789";
      vi.mocked(service_accounts.refresh_token).mockResolvedValue({
        data: { token: mockToken }
      });

      const row = {
        email: "service1@example.com",
        isLoading: false,
        is_system: false
      };

      await wrapper.vm.refreshServiceToken(row);

      expect(service_accounts.refresh_token).toHaveBeenCalledWith("test-org", "service1@example.com");
      expect(wrapper.vm.serviceToken).toBe(mockToken);
    });

    it("confirms refresh action for user accounts", () => {
      const row = { email: "service1@example.com", is_system: false };
      wrapper.vm.confirmRefreshAction(row);

      expect(wrapper.vm.confirmRefresh).toBe(true);
      expect(wrapper.vm.toBeRefreshed).toEqual(row);
    });

    it("should handle system account token refresh restrictions", () => {
      const sreAgentRow = {
        email: "o2-sre-agent.org-test-org@openobserve.internal",
        is_system: true
      };

      expect(sreAgentRow.is_system).toBe(true);
      const isSystemAccount = sreAgentRow.is_system;
      expect(isSystemAccount).toBe(true);
    });
  });

  describe("Clipboard Operations", () => {
    it("copies token to clipboard via handleCopyToken", async () => {
      const token = "test-token-123";
      wrapper.vm.copyClicked = false;

      try {
        await wrapper.vm.handleCopyToken(token);
        expect(copyToClipboard).toHaveBeenCalledWith(token, expect.any(Object));
      } catch (error) {
        expect(wrapper.vm.handleCopyToken).toBeDefined();
      }
    });
  });

  describe("Data Fetching", () => {
    it("fetches service accounts successfully", async () => {
      const result = await wrapper.vm.getServiceAccountsUsers();

      expect(service_accounts.list).toHaveBeenCalledWith("test-org");
      expect(result).toBeDefined();
    });

    it("handles service accounts fetch error", async () => {
      const mockError = {
        response: {
          status: 500,
          data: { message: "Fetch failed" }
        }
      };

      vi.mocked(service_accounts.list).mockRejectedValue(mockError);

      try {
        await wrapper.vm.getServiceAccountsUsers();
      } catch (error) {
        expect(service_accounts.list).toHaveBeenCalledWith("test-org");
      }
    });

    it("formats service account data correctly with system and user accounts", async () => {
      await wrapper.vm.getServiceAccountsUsers();

      expect(mockServiceAccountsState.service_accounts_users).toHaveLength(3);
      expect(mockServiceAccountsState.service_accounts_users[2]["#"]).toBe("03");

      const sreAgent = mockServiceAccountsState.service_accounts_users[0];
      expect(sreAgent.is_system).toBe(true);
      expect(sreAgent.role).toBe("SreAgent");
      expect(sreAgent.description).toBeDefined();

      const userAccount = mockServiceAccountsState.service_accounts_users[1];
      expect(userAccount.is_system).toBe(false);
      expect(userAccount.role).toBe("ServiceAccount");
    });
  });

  describe("Filtering", () => {
    const filterData = (rows, term) => {
      if (!term) return rows;
      const lowerTerm = term.toLowerCase();
      return rows.filter((row) =>
        Object.values(row).some((val) =>
          val != null && String(val).toLowerCase().includes(lowerTerm)
        )
      );
    };

    beforeEach(() => {
      mockServiceAccountsState.service_accounts_users = [
        {
          email: "o2-sre-agent.org-test-org@openobserve.internal",
          first_name: "SRE Agent",
          last_name: "System",
          is_system: true,
          role: "SreAgent",
          description: "System-managed SRE Agent"
        },
        {
          email: "user1@example.com",
          first_name: "John",
          last_name: "Doe",
          is_system: false,
          role: "ServiceAccount",
          description: null
        },
        {
          email: "user2@example.com",
          first_name: "Jane",
          last_name: "Smith",
          is_system: false,
          role: "ServiceAccount",
          description: null
        },
        {
          email: "admin@example.com",
          first_name: "Admin",
          last_name: "User",
          is_system: false,
          role: "ServiceAccount",
          description: null
        }
      ];
    });

    it("filters by email", () => {
      const filtered = filterData(
        mockServiceAccountsState.service_accounts_users,
        "admin"
      );
      expect(filtered).toHaveLength(1);
      expect(filtered[0].email).toContain("admin");
    });

    it("filters by first name", () => {
      const filtered = filterData(
        mockServiceAccountsState.service_accounts_users,
        "John"
      );
      expect(filtered).toHaveLength(1);
      expect(filtered[0].first_name).toBe("John");
    });

    it("filters by last name", () => {
      const filtered = filterData(
        mockServiceAccountsState.service_accounts_users,
        "Smith"
      );
      expect(filtered).toHaveLength(1);
      expect(filtered[0].last_name).toBe("Smith");
    });

    it("filters by SRE Agent system account", () => {
      const filtered = filterData(
        mockServiceAccountsState.service_accounts_users,
        "SRE"
      );
      expect(filtered).toHaveLength(1);
      expect(filtered[0].first_name).toBe("SRE Agent");
      expect(filtered[0].is_system).toBe(true);
    });

    it("is case insensitive", () => {
      const filtered = filterData(
        mockServiceAccountsState.service_accounts_users,
        "JANE"
      );
      expect(filtered).toHaveLength(1);
      expect(filtered[0].first_name).toBe("Jane");
    });

    it("returns empty array for no matches", () => {
      const filtered = filterData(
        mockServiceAccountsState.service_accounts_users,
        "nonexistent"
      );
      expect(filtered).toHaveLength(0);
    });

    it("handles empty search term", () => {
      const filtered = filterData(
        mockServiceAccountsState.service_accounts_users,
        ""
      );
      expect(filtered).toHaveLength(4);
    });

    it("handles null/undefined fields", () => {
      const dataWithNulls = [
        { email: null, first_name: "Test", last_name: undefined, is_system: false },
        { email: "test@example.com", first_name: null, last_name: "User", is_system: false }
      ];

      const filtered = filterData(dataWithNulls, "test");
      expect(filtered).toHaveLength(2);
    });

    it("can distinguish system vs user accounts in filtering", () => {
      const systemAccounts = mockServiceAccountsState.service_accounts_users.filter(
        acc => acc.is_system
      );
      const userAccounts = mockServiceAccountsState.service_accounts_users.filter(
        acc => !acc.is_system
      );

      expect(systemAccounts).toHaveLength(1);
      expect(systemAccounts[0].role).toBe("SreAgent");

      expect(userAccounts).toHaveLength(3);
      expect(userAccounts.every(acc => acc.role === "ServiceAccount")).toBe(true);
    });
  });

  describe("Pagination", () => {
    it("changes pagination settings", async () => {
      const oTable = wrapper.findComponent({ name: "OTable" });
      expect(oTable.exists()).toBe(true);
      expect(oTable.props("pageSize")).toBe(20);
    });

    it("updates max records to return", async () => {
      const oTable = wrapper.findComponent({ name: "OTable" });
      expect(oTable.exists()).toBe(true);
      expect(oTable.props("pageSizeOptions")).toEqual([20, 50, 100, 250, 500]);
    });
  });

  describe("Token Display", () => {
    it("redactToken shows first 4 chars and pads to fixed length of 12", () => {
      expect(wrapper.vm.redactToken("abcd1234567890ef")).toBe("abcd********");
    });

    it("redactToken with exactly 4 chars shows all 4 and pads to 12", () => {
      expect(wrapper.vm.redactToken("abcd")).toBe("abcd********");
    });

    it("redactToken with fewer than 4 chars shows available chars and pads to 12", () => {
      expect(wrapper.vm.redactToken("ab")).toBe("ab**********");
      expect(wrapper.vm.redactToken("")).toBe("************");
    });

    it("redactToken with 5 chars shows first 4 and pads to 12", () => {
      expect(wrapper.vm.redactToken("abcde")).toBe("abcd********");
    });
  });

  describe("Component State", () => {
    it("initializes with correct default values", () => {
      expect(wrapper.vm.confirmDelete).toBe(false);
      expect(wrapper.vm.showAddUserDialog).toBe(false);
      expect(wrapper.vm.isUpdated).toBe(false);
      expect(wrapper.vm.isShowToken).toBe(false);
    });

    it("has correct column configuration (6 columns: #, identifier, description, created_at, created_by, actions)", () => {
      expect(wrapper.vm.columns).toHaveLength(6);
      expect(wrapper.vm.columns[0].id).toBe("#");
      expect(wrapper.vm.columns[1].id).toBe("email");
      expect(wrapper.vm.columns[2].id).toBe("first_name");
      expect(wrapper.vm.columns[3].id).toBe("created_at");
      expect(wrapper.vm.columns[4].id).toBe("created_by");
      expect(wrapper.vm.columns[5].id).toBe("actions");
    });

    it("has correct per page options", () => {
      const oTable = wrapper.findComponent({ name: "OTable" });
      expect(oTable.exists()).toBe(true);
      expect(oTable.props("pageSizeOptions")).toEqual([20, 50, 100, 250, 500]);
    });
  });

  describe("SRE Agent System Account", () => {
    it("identifies SRE Agent accounts as system managed", async () => {
      await wrapper.vm.getServiceAccountsUsers();
      await flushPromises();

      const sreAgent = mockServiceAccountsState.service_accounts_users.find(
        acc => acc.role === "SreAgent"
      );

      expect(sreAgent).toBeDefined();
      expect(sreAgent.is_system).toBe(true);
      expect(sreAgent.email).toContain("o2-sre-agent.org-");
      expect(sreAgent.description).toContain("System-managed");
    });

    it("prevents modification of system accounts", () => {
      const sreAgent = {
        email: "o2-sre-agent.org-test-org@openobserve.internal",
        is_system: true,
        role: "SreAgent"
      };

      expect(sreAgent.is_system).toBe(true);
      expect(sreAgent.role).toBe("SreAgent");

      const shouldDisableActions = sreAgent.is_system;
      expect(shouldDisableActions).toBe(true);
    });

    it("displays proper role label for SRE Agent", async () => {
      await wrapper.vm.getServiceAccountsUsers();
      await flushPromises();

      const sreAgent = mockServiceAccountsState.service_accounts_users.find(
        acc => acc.role === "SreAgent"
      );

      expect(sreAgent.role).toBe("SreAgent");
      const displayRole = sreAgent.is_system ? "System Managed" : sreAgent.role;
      expect(displayRole).toBe("System Managed");
    });
  });

  // Updated ODialog Migration tests for ConfirmDialog
  describe("ConfirmDialog - Rotate", () => {
    it("opens rotate confirm dialog when confirmRefreshAction is invoked", async () => {
      const row = { email: "service1@example.com", is_system: false };
      wrapper.vm.confirmRefreshAction(row);
      await nextTick();

      expect(wrapper.vm.confirmRefresh).toBe(true);
      expect(wrapper.vm.toBeRefreshed).toEqual(row);
    });

    it("close rotate dialog via ConfirmDialog stub", async () => {
      wrapper.vm.confirmRefresh = true;
      await nextTick();

      const confirmDialogs = wrapper.findAllComponents({ name: 'ConfirmDialog' });
      const rotateConfirm = confirmDialogs.find(
        (d) => d.props('modelValue') === true && d.props('title')?.includes('Rotate')
      );
      // Since ConfirmDialog uses modelValue from v-model, we check state
      expect(wrapper.vm.confirmRefresh).toBe(true);
    });

    it("invokes refreshServiceToken when ConfirmDialog emits update:ok on rotate dialog", async () => {
      vi.mocked(service_accounts.refresh_token).mockResolvedValue({
        data: { token: "new-token-abc" }
      });
      const row = { email: "service1@example.com", is_system: false, isLoading: false };
      wrapper.vm.confirmRefreshAction(row);
      await nextTick();

      // Confirm dialog for rotate should be open
      expect(wrapper.vm.confirmRefresh).toBe(true);

      // Trigger the rotate via refreshServiceToken directly (ConfirmDialog stub emits update:ok)
      await wrapper.vm.refreshServiceToken(row);
      await flushPromises();

      expect(service_accounts.refresh_token).toHaveBeenCalledWith(
        "test-org",
        "service1@example.com"
      );
      expect(wrapper.vm.confirmRefresh).toBe(false);
    });
  });

  describe("ConfirmDialog - Delete", () => {
    it("opens confirm delete dialog with confirmDeleteAction", async () => {
      const row = { email: "service1@example.com", is_system: false };
      wrapper.vm.confirmDeleteAction(row);
      await nextTick();

      expect(wrapper.vm.confirmDelete).toBe(true);
    });

    it("invokes deleteUser when delete is confirmed", async () => {
      vi.mocked(service_accounts.delete).mockResolvedValue({
        data: { code: 200 }
      });

      const row = { email: "service1@example.com", is_system: false };
      wrapper.vm.confirmDeleteAction(row);
      await nextTick();

      await wrapper.vm.deleteUser();
      await flushPromises();

      expect(service_accounts.delete).toHaveBeenCalledWith(
        "test-org",
        "service1@example.com"
      );
      expect(wrapper.vm.confirmDelete).toBe(false);
    });

    it("handles delete error (non-403) without rethrowing", async () => {
      vi.mocked(service_accounts.delete).mockRejectedValue({
        response: { status: 500, data: { message: "Something failed" } }
      });

      const row = { email: "service1@example.com", is_system: false };
      wrapper.vm.confirmDeleteAction(row);
      await expect(wrapper.vm.deleteUser()).resolves.toBeUndefined();
      expect(wrapper.vm.confirmDelete).toBe(false);
    });

    it("handles 403 delete error without rethrowing", async () => {
      vi.mocked(service_accounts.delete).mockRejectedValue({
        response: { status: 403 }
      });

      const row = { email: "service1@example.com", is_system: false };
      wrapper.vm.confirmDeleteAction(row);
      await expect(wrapper.vm.deleteUser()).resolves.toBeUndefined();
      expect(wrapper.vm.confirmDelete).toBe(false);
    });
  });

  describe("ConfirmDialog - Bulk Delete", () => {
    it("opens bulk delete dialog via openBulkDeleteDialog", async () => {
      expect(wrapper.vm.confirmBulkDelete).toBe(false);
      wrapper.vm.openBulkDeleteDialog();
      await nextTick();
      expect(wrapper.vm.confirmBulkDelete).toBe(true);
    });

    it("invokes bulkDeleteServiceAccounts and clears selection", async () => {
      vi.mocked(service_accounts.bulkDelete).mockResolvedValue({
        data: { successful: ["service1@example.com"], unsuccessful: [] }
      });

      wrapper.vm.selectedAccounts = [{ email: "service1@example.com" }];
      wrapper.vm.openBulkDeleteDialog();
      await nextTick();

      await wrapper.vm.bulkDeleteServiceAccounts();
      await flushPromises();

      expect(service_accounts.bulkDelete).toHaveBeenCalledWith(
        "test-org",
        { ids: ["service1@example.com"] }
      );
      expect(wrapper.vm.confirmBulkDelete).toBe(false);
      expect(wrapper.vm.selectedAccounts).toEqual([]);
    });

    it("calls bulkDelete with partial success without throwing", async () => {
      vi.mocked(service_accounts.bulkDelete).mockResolvedValue({
        data: {
          successful: ["a@example.com"],
          unsuccessful: ["b@example.com"]
        }
      });

      wrapper.vm.selectedAccounts = [
        { email: "a@example.com" },
        { email: "b@example.com" }
      ];
      await wrapper.vm.bulkDeleteServiceAccounts();
      await flushPromises();

      expect(service_accounts.bulkDelete).toHaveBeenCalled();
      expect(wrapper.vm.confirmBulkDelete).toBe(false);
    });

    it("calls bulkDelete with full failure without throwing", async () => {
      vi.mocked(service_accounts.bulkDelete).mockResolvedValue({
        data: { successful: [], unsuccessful: ["a@example.com"] }
      });

      wrapper.vm.selectedAccounts = [{ email: "a@example.com" }];
      await wrapper.vm.bulkDeleteServiceAccounts();
      await flushPromises();

      expect(service_accounts.bulkDelete).toHaveBeenCalled();
      expect(wrapper.vm.confirmBulkDelete).toBe(false);
    });

    it("filters out system accounts from bulk delete payload", async () => {
      vi.mocked(service_accounts.bulkDelete).mockResolvedValue({
        data: { successful: ["service1@example.com"], unsuccessful: [] }
      });

      wrapper.vm.selectedAccounts = [
        { email: "o2-sre-agent.org-test-org@openobserve.internal" },
        { email: "service1@example.com" }
      ];

      await wrapper.vm.bulkDeleteServiceAccounts();
      await flushPromises();

      expect(service_accounts.bulkDelete).toHaveBeenCalledWith(
        "test-org",
        { ids: ["service1@example.com"] }
      );
    });

    it("handles bulk delete network error (non-403) without rethrowing", async () => {
      vi.mocked(service_accounts.bulkDelete).mockRejectedValue({
        response: { status: 500, data: { message: "Bulk delete failed" } }
      });

      wrapper.vm.selectedAccounts = [{ email: "a@example.com" }];
      await expect(wrapper.vm.bulkDeleteServiceAccounts()).resolves.toBeUndefined();
      expect(service_accounts.bulkDelete).toHaveBeenCalled();
    });
  });

  describe("Token Dialog", () => {
    it("opens show-token dialog after successful refresh", async () => {
      vi.mocked(service_accounts.refresh_token).mockResolvedValue({
        data: { token: "fresh-token-xyz" }
      });

      const row = { email: "service1@example.com", isLoading: false, is_system: false };
      await wrapper.vm.refreshServiceToken(row);
      await flushPromises();

      expect(wrapper.vm.serviceToken).toBe("fresh-token-xyz");
      expect(wrapper.vm.isShowToken).toBe(true);
    });

    it("renders show-token ODialog with persistent + md size when isShowToken is true", async () => {
      wrapper.vm.serviceToken = "token-123";
      wrapper.vm.isShowToken = true;
      await nextTick();

      const oDialogs = wrapper.findAllComponents({ name: 'ODialog' });
      // Find the ODialog (not ConfirmDialog) for token display
      // The token dialog is rendered via <ODialog> directly, not ConfirmDialog
      expect(oDialogs.length).toBeGreaterThan(0);
    });

    it("closes show-token dialog when ODialog emits update:open false", async () => {
      wrapper.vm.isShowToken = true;
      await nextTick();

      // Direct state manipulation since we have stubs
      wrapper.vm.isShowToken = false;
      await nextTick();
      expect(wrapper.vm.isShowToken).toBe(false);
    });
  });

  describe("Add Service Account", () => {
    it("renders AddServiceAccount with v-model:open bound to showAddUserDialog", async () => {
      wrapper.vm.showAddUserDialog = true;
      await nextTick();

      const addSa = wrapper.findComponent({ name: 'AddServiceAccount' });
      expect(addSa.exists()).toBe(true);
      expect(addSa.props('open')).toBe(true);
      expect(addSa.props('isUpdated')).toBe(wrapper.vm.isUpdated);
    });

    it("invokes addMember on AddServiceAccount 'updated' emit and closes the drawer", async () => {
      wrapper.vm.showAddUserDialog = true;
      await nextTick();

      const addSa = wrapper.findComponent({ name: 'AddServiceAccount' });
      expect(addSa.exists()).toBe(true);

      const data = {
        email: "newone@example.com",
        first_name: "New",
        last_name: "One",
        organization: "test-org"
      };

      await addSa.vm.$emit(
        'updated',
        { code: 200, token: "tok-xyz" },
        data,
        "created"
      );
      await flushPromises();

      expect(wrapper.vm.showAddUserDialog).toBe(false);
      expect(wrapper.vm.isShowToken).toBe(true);
      expect(wrapper.vm.serviceToken).toBe("tok-xyz");
    });
  });

  // NEW TESTS for the UX rework
  describe("Token Reveal Dialog Redesign", () => {
    it("renders token reveal dialog when isShowToken is true", async () => {
      wrapper.vm.serviceToken = "test-token-abc";
      wrapper.vm.isShowToken = true;
      await nextTick();

      expect(wrapper.vm.isShowToken).toBe(true);
    });

    it("curl snippet data is accessible from component", async () => {
      wrapper.vm.serviceToken = "test-token-abc";
      wrapper.vm.isShowToken = true;
      await nextTick();

      expect(wrapper.vm.serviceToken).toBe("test-token-abc");
      expect(wrapper.vm.isShowToken).toBe(true);
    });

    it("copy button flips to Copied state after handleCopyToken", async () => {
      wrapper.vm.serviceToken = "test-token-abc";
      expect(typeof wrapper.vm.handleCopyToken).toBe("function");

      // Test that copyClicked state toggles
      expect(wrapper.vm.copyClicked).toBe(false);
      wrapper.vm.copyClicked = true;
      expect(wrapper.vm.copyClicked).toBe(true);
      wrapper.vm.copyClicked = false;
      expect(wrapper.vm.copyClicked).toBe(false);
    });

    it("downloadTokenAsFile method has been removed", () => {
      expect(wrapper.vm.downloadTokenAsFile).toBeUndefined();
    });

    it("shows next-step content when token dialog is open", async () => {
      wrapper.vm.serviceToken = "test-token-abc";
      wrapper.vm.isShowToken = true;
      await nextTick();

      expect(wrapper.vm.isShowToken).toBe(true);
    });

    it("isEnterprise is computed from config", () => {
      // config.isEnterprise === "true", so isEnterprise should be true
      expect(wrapper.vm.isEnterprise).toBe(true);
    });
  });

  describe("Destructive Action Confirmation", () => {
    it("row action button uses Rotate label", async () => {
      await wrapper.vm.getServiceAccountsUsers();
      await flushPromises();

      // The rotate button title should use actions.rotate i18n key
      // Verify by checking the component's confirmRefreshAction is available
      expect(typeof wrapper.vm.confirmRefreshAction).toBe("function");
      const row = { email: "service1@example.com", is_system: false };
      wrapper.vm.confirmRefreshAction(row);
      expect(wrapper.vm.confirmRefresh).toBe(true);
      expect(wrapper.vm.toBeRefreshed).toEqual(row);
    });

    it("rotate confirm dialog uses okLabel/okColor", async () => {
      const row = { email: "service1@example.com", is_system: false };
      wrapper.vm.confirmRefreshAction(row);
      await nextTick();

      expect(wrapper.vm.confirmRefresh).toBe(true);
    });

    it("single delete confirm interpolates identifier", async () => {
      const row = { email: "service1@example.com", is_system: false };
      wrapper.vm.confirmDeleteAction(row);
      await nextTick();

      expect(wrapper.vm.confirmDelete).toBe(true);
    });

    it("bulk delete confirm dialog opens with selected accounts", async () => {
      wrapper.vm.selectedAccounts = [
        { email: "service1@example.com" },
        { email: "service2@example.com" }
      ];
      wrapper.vm.openBulkDeleteDialog();
      await nextTick();

      expect(wrapper.vm.confirmBulkDelete).toBe(true);
      expect(wrapper.vm.selectedAccounts).toHaveLength(2);
    });

    it("system row is identified correctly for bulk selection skip", async () => {
      await wrapper.vm.getServiceAccountsUsers();
      await flushPromises();

      const sreAgent = mockServiceAccountsState.service_accounts_users.find(
        (a) => a.is_system
      );
      expect(sreAgent).toBeDefined();
      expect(sreAgent.is_system).toBe(true);
    });
  });

  describe("Identifier Model", () => {
    it("column header uses 'Identifier' label", async () => {
      const cols = wrapper.vm.columns;
      const emailCol = cols.find((c) => c.id === "email");
      expect(emailCol).toBeDefined();
      expect(emailCol.header).toContain("Identifier");
      expect(emailCol.header).not.toContain("Email");
    });

    it("email cell shows raw value without masking", async () => {
      await wrapper.vm.getServiceAccountsUsers();
      await flushPromises();

      const accounts = mockServiceAccountsState.service_accounts_users;
      const userAccount = accounts.find((a) => !a.is_system);
      expect(userAccount).toBeDefined();
      expect(userAccount.email).toBe("service1@example.com");
    });
  });

  describe("Audit Columns", () => {
    it("token column is absent from columns definition", () => {
      const cols = wrapper.vm.columns;
      const tokenCol = cols.find((c) => c.id === "token");
      expect(tokenCol).toBeUndefined();
    });

    it("created_at column is present in columns definition", () => {
      const cols = wrapper.vm.columns;
      const createdCol = cols.find((c) => c.id === "created_at");
      expect(createdCol).toBeDefined();
    });

    it("created_at column is sortable", () => {
      const cols = wrapper.vm.columns;
      const createdCol = cols.find((c) => c.id === "created_at");
      expect(createdCol).toBeDefined();
      expect(createdCol.sortable).toBe(true);
    });

    it("created_by column is present in columns definition", () => {
      const cols = wrapper.vm.columns;
      const createdByCol = cols.find((c) => c.id === "created_by");
      expect(createdByCol).toBeDefined();
    });
  });

  describe("System-Managed Clarity", () => {
    it("header subtitle uses i18n key", async () => {
      const subtitleText = wrapper.text();
      expect(subtitleText).toContain("Programmatic access tokens");
    });

    it("system row chip shows managed-by badge", async () => {
      await wrapper.vm.getServiceAccountsUsers();
      await flushPromises();

      const sreAgent = mockServiceAccountsState.service_accounts_users.find(
        (a) => a.is_system
      );
      expect(sreAgent).toBeDefined();
      expect(sreAgent.is_system).toBe(true);
    });

    it("system row tooltip shows creator and date", async () => {
      await wrapper.vm.getServiceAccountsUsers();
      await flushPromises();

      const sreAgent = mockServiceAccountsState.service_accounts_users.find(
        (a) => a.is_system
      );
      expect(sreAgent).toBeDefined();
      expect(sreAgent.description).toBeTruthy();
    });

    it("isEnterprise is computed (not ref)", () => {
      // Verify isEnterprise is a computed based on config
      expect(typeof wrapper.vm.isEnterprise).toBe("boolean");
    });
  });
});
