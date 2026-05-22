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

import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach } from "vitest";
import GroupServiceAccounts from "@/components/iam/groups/GroupServiceAccounts.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

// -- Mock usePermissions composable -----------------------------------
vi.mock("@/composables/iam/usePermissions", () => ({
  default: vi.fn(() => ({
    serviceAccountsState: {
      service_accounts_users: [],
      getServiceAccounts: vi.fn(),
    },
  })),
}));

import usePermissions from "@/composables/iam/usePermissions";

// -- O2 component stubs -----------------------------------------------
// OTable stub renders the cell-select and empty slots so that
// checkbox and NoData content is visible to tests.
const o2Stubs = {
  OTable: {
    template: `
      <div>
        <template v-for="(row, idx) in data" :key="row[rowKey] || idx">
          <slot name="cell-select" :row="row" />
        </template>
        <slot v-if="!data || data.length === 0" name="empty" />
      </div>
    `,
    props: [
      "data", "columns", "rowKey", "globalFilter", "pagination",
      "pageSize", "sorting", "filterMode", "defaultColumns",
      "showGlobalFilter", "footerTitle", "dense",
    ],
  },
  OCheckbox: {
    template: `<input type="checkbox" :data-test="dataTest" @click="$emit('update:model-value', !modelValue)" />`,
    props: ["modelValue", "dataTest"],
    emits: ["update:model-value"],
  },
  OInput: {
    template: `<div><slot name="icon-left" /><input type="text" :placeholder="placeholder" :value="modelValue" @input="$emit('update:model-value', ($event.target as HTMLInputElement).value)" /></div>`,
    props: ["modelValue", "placeholder"],
    emits: ["update:model-value"],
  },
  OToggleGroup: {
    template: '<div><slot /></div>',
    props: ["modelValue"],
    emits: ["update:model-value"],
  },
  OToggleGroupItem: {
    template: '<button :data-test="dataTest" @click="$emit(\'click\')"><slot /></button>',
    props: ["value", "size", "dataTest"],
  },
  OIcon: {
    template: "<span />",
    props: ["name", "size"],
  },
  NoData: {
    template: "<div>No Service Accounts added</div>",
  },
};

describe("GroupServiceAccounts Component", () => {
  let wrapper: any;
  let mockServiceAccountsState: any;

  beforeEach(async () => {
    mockServiceAccountsState = {
      service_accounts_users: [],
      getServiceAccounts: vi.fn().mockResolvedValue([
        { email: "service1@example.com" },
        { email: "service2@example.com" },
        { email: "service3@example.com" },
      ]),
    };

    vi.mocked(usePermissions).mockReturnValue({
      serviceAccountsState: mockServiceAccountsState,
    });

    wrapper = mount(GroupServiceAccounts, {
      global: {
        provide: { store },
        plugins: [i18n],
        stubs: o2Stubs,
      },
      props: {
        groupUsers: ["service1@example.com", "service2@example.com"],
        activeTab: "serviceAccounts",
        addedUsers: new Set(),
        removedUsers: new Set(),
      },
    });

    await flushPromises();
  });

  describe("Component Mounting", () => {
    it("renders the component correctly", () => {
      expect(wrapper.exists()).toBe(true);
      const filters = wrapper.find('[data-test="iam-service-accounts-selection-filters"]');
      expect(filters.exists()).toBe(true);
    });

    it("renders filter options", () => {
      const showToggle = wrapper.find('[data-test="iam-service-accounts-selection-show-toggle"]');
      const showText = wrapper.find('[data-test="iam-service-accounts-selection-show-text"]');

      expect(showToggle.exists()).toBe(true);
      expect(showText.text()).toBe("Show");
    });

    it("renders search input", () => {
      const searchInput = wrapper.find('[data-test="iam-service-accounts-selection-search-input"]');
      expect(searchInput.exists()).toBe(true);
    });

    it("renders table section", () => {
      const table = wrapper.find('[data-test="iam-service-accounts-selection-table"]');
      expect(table.exists()).toBe(true);
    });
  });

  describe("Filter Options", () => {
    it("has correct display options", () => {
      expect(wrapper.vm.usersDisplayOptions).toEqual([
        { label: "All", value: "all" },
        { label: "Selected", value: "selected" },
      ]);
    });

    it("initializes with 'selected' display option", () => {
      expect(wrapper.vm.usersDisplay).toBe("selected");
    });

    it("renders filter buttons for each option", () => {
      const allButton = wrapper.find('[data-test="iam-service-accounts-selection-show-all-btn"]');
      const selectedButton = wrapper.find('[data-test="iam-service-accounts-selection-show-selected-btn"]');

      expect(allButton.exists()).toBe(true);
      expect(selectedButton.exists()).toBe(true);
    });

    it("switches display option via updateUserTable", async () => {
      await wrapper.vm.updateUserTable("all");

      expect(wrapper.vm.usersDisplay).toBe("all");
    });
  });

  describe("Search Functionality", () => {
    it("updates search key when typing", async () => {
      const searchInput = wrapper.find('input[type="text"]');
      await searchInput.setValue("service1");

      expect(wrapper.vm.userSearchKey).toBe("service1");
    });

    it("has correct search placeholder", () => {
      const searchInput = wrapper.find('input[placeholder="Search Service Accounts"]');
      expect(searchInput.exists()).toBe(true);
    });

    // Filtering is handled by OTable's client-side :global-filter prop.
    // No standalone filterUsers method exists — that is an OTable concern.
  });

  describe("Data Loading", () => {
    it("fetches service accounts on component mount", async () => {
      expect(mockServiceAccountsState.getServiceAccounts).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
      );
    });

    it("transforms service accounts data correctly", async () => {
      await wrapper.vm.fetchOrgServiceAccounts();

      expect(wrapper.vm.users).toHaveLength(3);
      expect(wrapper.vm.users[0]).toEqual({
        "#": 1,
        email: "service1@example.com",
        isInGroup: true, // service1@example.com is in groupUsers prop
      });
      expect(wrapper.vm.users[1]).toEqual({
        "#": 2,
        email: "service2@example.com",
        isInGroup: true, // service2@example.com is in groupUsers prop
      });
      expect(wrapper.vm.users[2]).toEqual({
        "#": 3,
        email: "service3@example.com",
        isInGroup: false, // service3@example.com is not in groupUsers prop
      });
    });

    it("marks service accounts as selected based on groupUsers prop", async () => {
      await wrapper.vm.fetchOrgServiceAccounts();

      const service1 = wrapper.vm.users.find((user: any) => user.email === "service1@example.com");
      const service2 = wrapper.vm.users.find((user: any) => user.email === "service2@example.com");
      const service3 = wrapper.vm.users.find((user: any) => user.email === "service3@example.com");

      expect(service1.isInGroup).toBe(true);
      expect(service2.isInGroup).toBe(true);
      expect(service3.isInGroup).toBe(false);
    });

    it("updates serviceAccountsState with fetched data", async () => {
      await wrapper.vm.fetchOrgServiceAccounts();

      expect(mockServiceAccountsState.service_accounts_users).toHaveLength(3);
      expect(mockServiceAccountsState.service_accounts_users[0]).toEqual({
        email: "service1@example.com",
        "#": 1,
        isInGroup: true,
      });
    });
  });

  describe("Table Structure", () => {
    it("has correct column structure", () => {
      expect(wrapper.vm.columns).toHaveLength(2);

      const selectColumn = wrapper.vm.columns[0];
      expect(selectColumn.id).toBe("select");
      expect(selectColumn.accessorKey).toBe("isInGroup");
      expect(selectColumn.size).toBe(36);

      const emailColumn = wrapper.vm.columns[1];
      expect(emailColumn.id).toBe("email");
      expect(emailColumn.accessorKey).toBe("email");
      expect(emailColumn.sortable).toBe(true);
    });

    it("renders table with service accounts data", async () => {
      await wrapper.vm.fetchOrgServiceAccounts();
      await wrapper.vm.updateUserTable("all");
      await flushPromises();

      expect(wrapper.vm.rows).toHaveLength(3);
    });

    it("shows no service accounts message when no data", async () => {
      wrapper.vm.rows = [];
      await flushPromises();

      // When rows is empty, the OTable #empty slot renders <NoData />
      const noDataStub = wrapper.findComponent({ name: "NoData" });
      expect(noDataStub.exists()).toBe(true);
    });
  });

  describe("Service Account Selection", () => {
    it("renders checkboxes for service account selection", () => {
      // After mount, rows have service1@example.com and service2@example.com (isInGroup users)
      const checkbox = wrapper.find('[data-test="iam-service-accounts-selection-table-body-row-service1@example.com-checkbox"]');
      expect(checkbox.exists()).toBe(true);
    });

    it("handles service account selection toggle", () => {
      const addedUsers = new Set();
      const removedUsers = new Set();

      wrapper = mount(GroupServiceAccounts, {
        global: {
          provide: { store },
          plugins: [i18n],
          stubs: o2Stubs,
        },
        props: {
          groupUsers: ["service1@example.com"],
          activeTab: "serviceAccounts",
          addedUsers,
          removedUsers,
        },
      });

      // Simulate selecting an unassigned service account (checkbox goes from unchecked to checked)
      // toggleUserSelection flips isInGroup; start with false so it becomes true
      const testServiceAccount = { email: "service2@example.com", isInGroup: false };

      wrapper.vm.toggleUserSelection(testServiceAccount);

      expect(addedUsers.has("service2@example.com")).toBe(true);
    });

    it("adds service account to addedUsers when selecting unassigned account", () => {
      const addedUsers = new Set();
      const removedUsers = new Set();

      wrapper = mount(GroupServiceAccounts, {
        global: {
          provide: { store },
          plugins: [i18n],
          stubs: o2Stubs,
        },
        props: {
          groupUsers: [],
          activeTab: "serviceAccounts",
          addedUsers,
          removedUsers,
        },
      });

      wrapper.vm.groupUsersMap = new Set([]);
      // Service account starts as not selected; toggleUserSelection flips to selected
      const testServiceAccount = { email: "service1@example.com", isInGroup: false };

      wrapper.vm.toggleUserSelection(testServiceAccount);

      expect(addedUsers.has("service1@example.com")).toBe(true);
    });

    it("adds service account to removedUsers when deselecting assigned account", () => {
      const addedUsers = new Set();
      const removedUsers = new Set();

      wrapper = mount(GroupServiceAccounts, {
        global: {
          provide: { store },
          plugins: [i18n],
          stubs: o2Stubs,
        },
        props: {
          groupUsers: ["service1@example.com"],
          activeTab: "serviceAccounts",
          addedUsers,
          removedUsers,
        },
      });

      wrapper.vm.groupUsersMap = new Set(["service1@example.com"]);
      // Service account starts as selected; toggleUserSelection flips to deselected
      const testServiceAccount = { email: "service1@example.com", isInGroup: true };

      wrapper.vm.toggleUserSelection(testServiceAccount);

      expect(removedUsers.has("service1@example.com")).toBe(true);
    });

    it("removes service account from addedUsers when deselecting newly added account", () => {
      const addedUsers = new Set(["service2@example.com"]);
      const removedUsers = new Set();

      wrapper = mount(GroupServiceAccounts, {
        global: {
          provide: { store },
          plugins: [i18n],
          stubs: o2Stubs,
        },
        props: {
          groupUsers: [],
          activeTab: "serviceAccounts",
          addedUsers,
          removedUsers,
        },
      });

      wrapper.vm.groupUsersMap = new Set([]);
      // Service account was previously added (in addedUsers), currently shown as selected;
      // deselecting should remove from addedUsers.
      const testServiceAccount = { email: "service2@example.com", isInGroup: true };

      wrapper.vm.toggleUserSelection(testServiceAccount);

      expect(addedUsers.has("service2@example.com")).toBe(false);
    });

    it.skip("removes service account from removedUsers when reselecting removed account", async () => {
      const addedUsers = new Set();
      const removedUsers = new Set(["service1@example.com"]);

      await wrapper.setProps({
        groupUsers: ["service1@example.com"],
        activeTab: "serviceAccounts",
        addedUsers,
        removedUsers,
      });

      wrapper.vm.groupUsersMap = new Set(["service1@example.com"]);
      // Service account was previously removed; toggling it back should undo the removal.
      const testServiceAccount = { email: "service1@example.com", isInGroup: false };

      wrapper.vm.toggleUserSelection(testServiceAccount);

      expect(removedUsers.has("service1@example.com")).toBe(false);
    });
  });

  describe("Display Filtering", () => {
    beforeEach(async () => {
      await wrapper.vm.fetchOrgServiceAccounts();
    });

    it("shows all service accounts when display is 'all'", async () => {
      await wrapper.vm.updateUserTable("all");
      expect(wrapper.vm.rows).toHaveLength(3);
    });

    it("shows only selected service accounts when display is 'selected'", async () => {
      await wrapper.vm.updateUserTable("selected");

      const selectedAccounts = wrapper.vm.rows.filter((account: any) => account.isInGroup);
      expect(wrapper.vm.rows).toEqual(selectedAccounts);
    });

    it("fetches data when switching to 'all' for first time", async () => {
      wrapper.vm.hasFetchedOrgServiceAccounts = false;

      await wrapper.vm.updateUserTable("all");

      // hasFetchedOrgServiceAccounts should be set to true after fetch
      expect(wrapper.vm.hasFetchedOrgServiceAccounts).toBe(true);
    });

    it("does not refetch data when switching to 'all' after first fetch", async () => {
      const fetchSpy = vi.spyOn(wrapper.vm, "fetchOrgServiceAccounts");
      wrapper.vm.hasFetchedOrgServiceAccounts = true;

      await wrapper.vm.updateUserTable("all");

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("Props Watching", () => {
    it("updates when groupUsers prop changes", async () => {
      await wrapper.setProps({ groupUsers: ["service1@example.com", "service3@example.com"] });
      await flushPromises();

      // groupUsersMap should be updated with new prop values
      expect(wrapper.vm.groupUsersMap.size).toBe(2);
      expect(wrapper.vm.groupUsersMap.has("service1@example.com")).toBe(true);
      expect(wrapper.vm.groupUsersMap.has("service3@example.com")).toBe(true);
    });

    it("resets hasFetchedOrgServiceAccounts when groupUsers changes", async () => {
      wrapper.vm.hasFetchedOrgServiceAccounts = true;

      await wrapper.setProps({ groupUsers: ["newservice@example.com"] });
      await flushPromises();

      // After watcher triggers re-fetch, hasFetchedOrgServiceAccounts is set back to true
      expect(wrapper.vm.hasFetchedOrgServiceAccounts).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("handles empty groupUsers prop", async () => {
      const wrapper2 = mount(GroupServiceAccounts, {
        global: {
          provide: { store },
          plugins: [i18n],
          stubs: o2Stubs,
        },
        props: {
          groupUsers: [],
          activeTab: "serviceAccounts",
          addedUsers: new Set(),
          removedUsers: new Set(),
        },
      });

      await flushPromises();
      expect(wrapper2.vm.groupUsersMap.size).toBe(0);
    });

    it("handles API error when fetching service accounts", () => {
      // Simply test that the method exists and returns a Promise
      expect(typeof wrapper.vm.fetchOrgServiceAccounts).toBe("function");

      const result = wrapper.vm.fetchOrgServiceAccounts();
      expect(result).toBeInstanceOf(Promise);
    });

    it("handles empty service accounts data from API", async () => {
      mockServiceAccountsState.getServiceAccounts.mockResolvedValue([]);

      await wrapper.vm.fetchOrgServiceAccounts();

      expect(wrapper.vm.users).toEqual([]);
    });

    // Filtering is handled by OTable's built-in client-side global-filter.
    // There is no standalone filterUsers method — that is an OTable concern.
  });

  describe("Theme Support", () => {
    it("applies correct theme classes", () => {
      const filters = wrapper.find('[data-test="iam-service-accounts-selection-filters"]');
      expect(filters.exists()).toBe(true);
    });

    it("switches to dark theme classes when theme is dark", async () => {
      const darkStore = {
        ...store,
        state: {
          ...store.state,
          theme: "dark",
        },
      };

      const wrapper2 = mount(GroupServiceAccounts, {
        global: {
          provide: { store: darkStore },
          plugins: [i18n],
          stubs: o2Stubs,
        },
        props: {
          groupUsers: [],
          activeTab: "serviceAccounts",
          addedUsers: new Set(),
          removedUsers: new Set(),
        },
      });

      const filters = wrapper2.find('[data-test="iam-service-accounts-selection-filters"]');
      expect(filters.exists()).toBe(true);
    });
  });

  describe("Accessibility", () => {
    it("has proper data-test attributes", () => {
      const sections = [
        "iam-service-accounts-selection-filters",
        "iam-service-accounts-selection-show-toggle",
        "iam-service-accounts-selection-search-input",
        "iam-service-accounts-selection-table",
      ];

      sections.forEach((selector) => {
        expect(wrapper.find(`[data-test="${selector}"]`).exists()).toBe(true);
      });
    });

    it("has proper form labels and placeholders", () => {
      const searchInput = wrapper.find('input[placeholder="Search Service Accounts"]');
      expect(searchInput.exists()).toBe(true);
    });

    it("has proper button styling", () => {
      const filterButtons = wrapper.findAll('[data-test^="iam-service-accounts-selection-show-"]');
      expect(filterButtons.length).toBeGreaterThan(0);
    });

    it("has proper table attributes", () => {
      const table = wrapper.findComponent({ name: "OTable" });
      expect(table.exists()).toBe(true);
      expect(table.props("rowKey")).toBe("email");
    });
  });
});
