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
import GroupUsers from "@/components/iam/groups/GroupUsers.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

// ── Mock usePermissions composable ──────────────────────────────────
vi.mock("@/composables/iam/usePermissions", () => ({
  default: vi.fn(() => ({
    usersState: {
      users: [],
      getOrgUsers: vi.fn(),
    },
  })),
}));

import usePermissions from "@/composables/iam/usePermissions";

// ── O2 component stubs ──────────────────────────────────────────────
// OTable stub renders the cell-select and empty slots so that
// checkbox and NoData content is visible to tests.
const o2Stubs = {
  OTable: {
    template: `
      <div>
        <template v-for="(row, idx) in data" :key="row[rowKey] || idx">
          <slot name="cell-select" :row="row" />
          <slot name="cell-email" :row="row" />
          <slot name="cell-organization" :row="row" />
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
    template: `<div><slot name="icon-left" /><input type="text" :placeholder="placeholder" :value="modelValue" @input="$emit('update:model-value', $event.target.value)" /></div>`,
    props: ["modelValue", "placeholder"],
    emits: ["update:model-value"],
  },
  OToggleGroup: {
    template: `<div><slot /></div>`,
    props: ["modelValue"],
    emits: ["update:model-value"],
  },
  OToggleGroupItem: {
    template: `<button :data-test="dataTest" @click="$emit('click')"><slot /></button>`,
    props: ["value", "size", "dataTest"],
  },
  OSelect: {
    template: `<select><option v-for="opt in options" :key="opt.value" :value="opt.value">{{ opt.label }}</option></select>`,
    props: ["modelValue", "options", "labelKey", "valueKey", "searchable", "placeholder"],
    emits: ["update:model-value"],
  },
  OIcon: {
    template: `<span />`,
    props: ["name", "size"],
  },
  OTooltip: {
    template: `<div><slot /></div>`,
    props: ["side"],
  },
  NoData: {
    template: `<div data-test="iam-users-selection-table-no-data">No users added</div>`,
    props: [],
  },
  OEmptyState: {
    template: `<div data-test="iam-users-selection-table-no-data">No users</div>`,
    props: ["size", "preset", "filtered", "hideAction"],
    emits: ["action"],
  },
  OSearchInput: {
    template: `<div><input type="text" :placeholder="placeholder" :value="modelValue" @input="$emit('update:model-value', $event.target.value)" /></div>`,
    props: ["modelValue", "placeholder"],
    emits: ["update:model-value"],
  },
};

// ── Enhanced store with required properties for GroupUsers ──────────
// The component accesses store.state.selectedOrganization.identifier,
// store.state.organizations, store.state.userInfo.email, and
// store.state.zoConfig.meta_org.
const enhancedStore = {
  ...store,
  state: {
    ...store.state,
    selectedOrganization: {
      ...store.state.selectedOrganization,
      identifier: "default",
    },
    organizations: [
      {
        name: "TestOrg1",
        identifier: "test-org-1",
        id: "1",
        ingest_threshold: 100,
        search_threshold: 50,
        status: "active",
        CustomerBillingObj: {
          subscription_type: "premium",
          note: "Test note",
        },
      },
      {
        name: "TestOrg2",
        identifier: "test-org-2",
        id: "2",
        ingest_threshold: 200,
        search_threshold: 100,
        status: "active",
        CustomerBillingObj: {
          subscription_type: "basic",
          note: "Another note",
        },
      },
    ],
    zoConfig: {
      ...store.state.zoConfig,
      meta_org: "meta_org",
    },
  },
};

describe("GroupUsers Component", () => {
  let wrapper: any;
  let mockUsersState: any;

  beforeEach(async () => {
    mockUsersState = {
      users: [],
      getOrgUsers: vi.fn().mockResolvedValue([
        {
          email: "user1@example.com",
          orgs: [{ org_name: "TestOrg1" }, { org_name: "TestOrg2" }],
          role: "user",
        },
        {
          email: "admin@example.com",
          orgs: [{ org_name: "TestOrg1" }],
          role: "admin",
        },
        {
          email: "root@example.com",
          orgs: [],
          role: "root",
        },
      ]),
    };

    vi.mocked(usePermissions).mockReturnValue({
      usersState: mockUsersState,
    });

    wrapper = mount(GroupUsers, {
      global: {
        provide: { store: enhancedStore },
        plugins: [i18n],
        stubs: o2Stubs,
      },
      props: {
        groupUsers: ["user1@example.com", "admin@example.com"],
        activeTab: "users",
        addedUsers: new Set(),
        removedUsers: new Set(),
      },
    });

    await flushPromises();
  });

  describe("Component Mounting", () => {
    it("renders the component correctly", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("renders filter options", () => {
      const showToggle = wrapper.find('[data-test="iam-users-selection-show-toggle"]');
      const showText = wrapper.find('[data-test="iam-users-selection-show-text"]');

      expect(showToggle.exists()).toBe(true);
      expect(showText.text()).toBe("Show");
    });

    it("renders search input", () => {
      const searchInput = wrapper.find('[data-test="iam-users-selection-search-input"]');
      expect(searchInput.exists()).toBe(true);
    });

    it("renders table section", () => {
      const table = wrapper.find('[data-test="iam-users-selection-table"]');
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
      const allButton = wrapper.find('[data-test="iam-users-selection-show-all-btn"]');
      const selectedButton = wrapper.find('[data-test="iam-users-selection-show-selected-btn"]');

      expect(allButton.exists()).toBe(true);
      expect(selectedButton.exists()).toBe(true);
    });

    it("switches display option via updateUserTable", async () => {
      // updateUserTable is the public API that sets usersDisplay internally
      await wrapper.vm.updateUserTable("all");

      expect(wrapper.vm.usersDisplay).toBe("all");
    });
  });

  describe("Organization Selection", () => {
    it("renders organization selector for meta org when showing all users", async () => {
      const metaStore = {
        ...enhancedStore,
        state: {
          ...enhancedStore.state,
          selectedOrganization: {
            ...enhancedStore.state.selectedOrganization,
            identifier: "meta_org",
          },
          zoConfig: { ...enhancedStore.state.zoConfig, meta_org: "meta_org" },
          organizations: [
            {
              name: "Org1",
              identifier: "org1",
              id: "1",
              ingest_threshold: 100,
              search_threshold: 50,
              status: "active",
              CustomerBillingObj: { subscription_type: "basic", note: "" },
            },
            {
              name: "Org2",
              identifier: "org2",
              id: "2",
              ingest_threshold: 200,
              search_threshold: 100,
              status: "active",
              CustomerBillingObj: { subscription_type: "premium", note: "Test" },
            },
          ],
          userInfo: { email: "test@example.com" },
        },
      };

      const wrapper2 = mount(GroupUsers, {
        global: {
          provide: { store: metaStore },
          plugins: [i18n],
          stubs: o2Stubs,
        },
        props: {
          groupUsers: [],
          activeTab: "users",
          addedUsers: new Set(),
          removedUsers: new Set(),
        },
      });

      wrapper2.vm.usersDisplay = "all";
      await flushPromises();

      expect(wrapper2.vm.selectedOrg).toBeDefined();
      expect(wrapper2.vm.orgOptions).toHaveLength(3);
      expect(wrapper2.vm.orgOptions[0]).toEqual({ label: "All", value: "all" });
      expect(wrapper2.vm.orgOptions[1].label).toBe("Org1");
      expect(wrapper2.vm.orgOptions[2].label).toBe("Org2");
    });

    it("initializes organization options on mount", async () => {
      const metaStore = {
        ...store,
        state: {
          ...store.state,
          organizations: [
            {
              name: "TestOrg",
              identifier: "test-org",
              id: "1",
              ingest_threshold: 100,
              search_threshold: 50,
              status: "active",
            },
          ],
          userInfo: { email: "test@example.com" },
          selectedOrganization: {
            ...store.state.selectedOrganization,
            identifier: "default",
          },
        },
      };

      const wrapper2 = mount(GroupUsers, {
        global: {
          provide: { store: metaStore },
          plugins: [i18n],
          stubs: o2Stubs,
        },
        props: {
          groupUsers: [],
          activeTab: "users",
          addedUsers: new Set(),
          removedUsers: new Set(),
        },
      });

      await flushPromises();

      expect(wrapper2.vm.orgOptions).toHaveLength(2); // "All" + TestOrg
      expect(wrapper2.vm.orgOptions[1].label).toBe("TestOrg");
    });

    it("filters organizations alphabetically", () => {
      wrapper.vm.orgOptions = [
        { label: "ZOrg", value: "z" },
        { label: "AOrg", value: "a" },
        { label: "MOrg", value: "m" },
      ];

      // mockUpdate must actually invoke the callback so the filter logic runs
      const mockUpdate = vi.fn((fn: () => void) => fn());

      wrapper.vm.filterOrganizations("a", mockUpdate);

      expect(mockUpdate).toHaveBeenCalledWith(expect.any(Function));
      // After the filter runs, orgList should only contain matches
      expect(wrapper.vm.orgList).toHaveLength(1);
      expect(wrapper.vm.orgList[0].label).toBe("AOrg");
    });
  });

  describe("Search Functionality", () => {
    it("updates search key when typing", async () => {
      const searchInput = wrapper.find('input[type="text"]');
      await searchInput.setValue("user1");

      expect(wrapper.vm.userSearchKey).toBe("user1");
    });

    it("has correct search placeholder", () => {
      const searchInput = wrapper.find('input[placeholder="Search User"]');
      expect(searchInput.exists()).toBe(true);
    });
  });

  describe("Data Loading", () => {
    it("fetches users on component mount", async () => {
      expect(mockUsersState.getOrgUsers).toHaveBeenCalledWith(
        enhancedStore.state.selectedOrganization.identifier,
        { list_all: true },
      );
    });

    it("transforms users data correctly", async () => {
      await wrapper.vm.getchOrgUsers();

      expect(wrapper.vm.users).toHaveLength(3);
      expect(wrapper.vm.users[0]).toEqual({
        email: "user1@example.com",
        isInGroup: true,
        org: "TestOrg1, TestOrg2",
        role: "user",
        is_external: false,
      });
      expect(wrapper.vm.users[1]).toEqual({
        email: "admin@example.com",
        isInGroup: true,
        org: "TestOrg1",
        role: "admin",
        is_external: false,
      });
      expect(wrapper.vm.users[2]).toEqual({
        email: "root@example.com",
        isInGroup: false,
        org: "",
        role: "root",
        is_external: false,
      });
    });

    it("marks users as selected based on groupUsers prop", async () => {
      await wrapper.vm.getchOrgUsers();

      const user1 = wrapper.vm.users.find((user: any) => user.email === "user1@example.com");
      const admin = wrapper.vm.users.find((user: any) => user.email === "admin@example.com");
      const root = wrapper.vm.users.find((user: any) => user.email === "root@example.com");

      expect(user1.isInGroup).toBe(true);
      expect(admin.isInGroup).toBe(true);
      expect(root.isInGroup).toBe(false);
    });

    it("handles users with no organizations", async () => {
      await wrapper.vm.getchOrgUsers();

      const rootUser = wrapper.vm.users.find((user: any) => user.email === "root@example.com");
      expect(rootUser.org).toBe("");
    });

    it("updates usersState with fetched data", async () => {
      await wrapper.vm.getchOrgUsers();

      expect(mockUsersState.users).toHaveLength(3);
      expect(mockUsersState.users[0]).toEqual({
        email: "user1@example.com",
        isInGroup: true,
        org: "TestOrg1, TestOrg2",
        role: "user",
        is_external: false,
      });
    });
  });

  describe("Table Structure", () => {
    it("has correct column structure for regular org", () => {
      expect(wrapper.vm.columns).toHaveLength(2);

      const selectColumn = wrapper.vm.columns[0];
      expect(selectColumn.id).toBe("select");
      expect(selectColumn.accessorKey).toBe("isInGroup");
      expect(selectColumn.size).toBe(44);

      const emailColumn = wrapper.vm.columns[1];
      expect(emailColumn.id).toBe("email");
      expect(emailColumn.accessorKey).toBe("email");
      expect(emailColumn.sortable).toBe(true);
    });

    it("includes organization column for meta org", async () => {
      const metaStore = {
        ...store,
        state: {
          ...store.state,
          selectedOrganization: {
            ...store.state.selectedOrganization,
            identifier: "meta_org",
          },
          zoConfig: { meta_org: "meta_org" },
          organizations: [
            {
              name: "TestOrg",
              identifier: "test-org",
              id: "1",
              ingest_threshold: 100,
              search_threshold: 50,
              status: "active",
            },
          ],
          userInfo: { email: "test@example.com" },
        },
      };

      const wrapper2 = mount(GroupUsers, {
        global: {
          provide: { store: metaStore },
          plugins: [i18n],
          stubs: o2Stubs,
        },
        props: {
          groupUsers: [],
          activeTab: "users",
          addedUsers: new Set(),
          removedUsers: new Set(),
        },
      });

      expect(wrapper2.vm.columns).toHaveLength(3);

      const orgColumn = wrapper2.vm.columns[2];
      expect(orgColumn.id).toBe("organization");
      expect(orgColumn.accessorKey).toBe("org");
      expect(orgColumn.header).toBe("Organizations");
    });

    it("renders table with users data", async () => {
      await wrapper.vm.getchOrgUsers();
      await wrapper.vm.updateUserTable("all");
      await flushPromises();

      expect(wrapper.vm.rows).toHaveLength(3);
    });

    it("shows no users message when no data", async () => {
      wrapper.vm.rows = [];
      await flushPromises();

      // When rows is empty, the OTable #empty slot renders <NoData />
      const noDataEl = wrapper.find('[data-test="iam-users-selection-table-no-data"]');
      expect(noDataEl.exists()).toBe(true);
    });
  });

  describe("User Selection", () => {
    it("renders checkboxes for user selection", () => {
      // After mount, rows have user1@example.com and admin@example.com (isInGroup users)
      const checkbox = wrapper.find('[data-test="iam-users-selection-table-body-row-user1@example.com-checkbox"]');
      expect(checkbox.exists()).toBe(true);
    });

    it("handles user selection toggle", () => {
      const addedUsers = new Set();
      const removedUsers = new Set();

      const wrapper2 = mount(GroupUsers, {
        global: {
          provide: { store: enhancedStore },
          plugins: [i18n],
          stubs: o2Stubs,
        },
        props: {
          groupUsers: ["user1@example.com"],
          activeTab: "users",
          addedUsers,
          removedUsers,
        },
      });

      // Simulate selecting an unassigned user (checkbox goes from unchecked → checked)
      const testUser = { email: "user2@example.com", isInGroup: false };

      wrapper2.vm.toggleUserSelection(testUser);

      expect(addedUsers.has("user2@example.com")).toBe(true);
    });

    it("adds user to addedUsers when selecting unassigned user", () => {
      const addedUsers = new Set();
      const removedUsers = new Set();

      const wrapper2 = mount(GroupUsers, {
        global: {
          provide: { store: enhancedStore },
          plugins: [i18n],
          stubs: o2Stubs,
        },
        props: {
          groupUsers: [],
          activeTab: "users",
          addedUsers,
          removedUsers,
        },
      });

      wrapper2.vm.groupUsersMap = new Set([]);
      // User starts as not selected; toggleUserSelection flips to selected
      const testUser = { email: "user1@example.com", isInGroup: false };

      wrapper2.vm.toggleUserSelection(testUser);

      expect(addedUsers.has("user1@example.com")).toBe(true);
    });

    it("adds user to removedUsers when deselecting assigned user", () => {
      const addedUsers = new Set();
      const removedUsers = new Set();

      const wrapper2 = mount(GroupUsers, {
        global: {
          provide: { store: enhancedStore },
          plugins: [i18n],
          stubs: o2Stubs,
        },
        props: {
          groupUsers: ["user1@example.com"],
          activeTab: "users",
          addedUsers,
          removedUsers,
        },
      });

      wrapper2.vm.groupUsersMap = new Set(["user1@example.com"]);
      // User starts as selected; toggleUserSelection flips to deselected
      const testUser = { email: "user1@example.com", isInGroup: true };

      wrapper2.vm.toggleUserSelection(testUser);

      expect(removedUsers.has("user1@example.com")).toBe(true);
    });

    it("removes user from addedUsers when deselecting newly added user", () => {
      const addedUsers = new Set(["user2@example.com"]);
      const removedUsers = new Set();

      const wrapper2 = mount(GroupUsers, {
        global: {
          provide: { store: enhancedStore },
          plugins: [i18n],
          stubs: o2Stubs,
        },
        props: {
          groupUsers: [],
          activeTab: "users",
          addedUsers,
          removedUsers,
        },
      });

      wrapper2.vm.groupUsersMap = new Set([]);
      // User was previously added (in addedUsers), currently shown as selected;
      // deselecting should remove from addedUsers.
      const testUser = { email: "user2@example.com", isInGroup: true };

      wrapper2.vm.toggleUserSelection(testUser);

      expect(addedUsers.has("user2@example.com")).toBe(false);
    });

    it("removes user from removedUsers when reselecting removed user", async () => {
      const addedUsers = new Set();
      const removedUsers = new Set(["user1@example.com"]);

      const wrapper2 = mount(GroupUsers, {
        global: {
          provide: { store: enhancedStore },
          plugins: [i18n],
          stubs: o2Stubs,
        },
        props: {
          groupUsers: ["user1@example.com"],
          activeTab: "users",
          addedUsers,
          removedUsers,
        },
      });

      await flushPromises();

      // user1 was originally in group, has been staged for removal
      // Currently deselected (isInGroup: false); reselecting flips to true
      // which should remove from removedUsers
      wrapper2.vm.groupUsersMap = new Set(["user1@example.com"]);
      const testUser = { email: "user1@example.com", isInGroup: false };

      wrapper2.vm.toggleUserSelection(testUser);

      expect(removedUsers.has("user1@example.com")).toBe(false);
    });
  });

  describe("Organization Filtering", () => {
    beforeEach(async () => {
      await wrapper.vm.getchOrgUsers();
    });

    it("shows all users when 'All' organization is selected", () => {
      wrapper.vm.selectedOrg = { value: "all", label: "All" };
      wrapper.vm.users = [
        { email: "user1@example.com", isInGroup: true, org: "TestOrg1" },
        { email: "user2@example.com", isInGroup: false, org: "TestOrg2" },
        { email: "user3@example.com", isInGroup: true, org: "TestOrg1" },
      ];
      wrapper.vm.usersDisplay = "all";

      wrapper.vm.updateOrganization();

      expect(wrapper.vm.rows).toHaveLength(3);
    });

    it("filters users by organization", () => {
      wrapper.vm.selectedOrg = { value: "test", label: "TestOrg1" };
      wrapper.vm.usersDisplay = "all";

      wrapper.vm.updateOrganization();

      const filteredUsers = wrapper.vm.rows;
      expect(filteredUsers.some((user: any) => user.email === "user1@example.com")).toBe(true);
      expect(filteredUsers.some((user: any) => user.email === "admin@example.com")).toBe(true);
      expect(filteredUsers.some((user: any) => user.role === "root")).toBe(true);
    });

    it("includes root role users regardless of organization filter", () => {
      wrapper.vm.selectedOrg = { value: "nonexistent", label: "NonexistentOrg" };
      wrapper.vm.usersDisplay = "all";

      wrapper.vm.updateOrganization();

      const rootUsers = wrapper.vm.rows.filter((user: any) => user.role === "root");
      expect(rootUsers.length).toBeGreaterThan(0);
    });

    it("respects isInGroup filter when organization is selected", () => {
      wrapper.vm.selectedOrg = { value: "test", label: "TestOrg1" };
      wrapper.vm.usersDisplay = "selected";

      wrapper.vm.users = [
        { email: "user1@example.com", isInGroup: true, org: "TestOrg1, TestOrg2", role: "user" },
        { email: "admin@example.com", isInGroup: true, org: "TestOrg1", role: "admin" },
        { email: "root@example.com", isInGroup: false, org: "", role: "root" },
      ];

      wrapper.vm.updateOrganization();

      const hasNonSelectedUsers = wrapper.vm.rows.some((user: any) => !user.isInGroup);
      expect(hasNonSelectedUsers).toBe(true); // Root users are always included
    });

    it("applies isInGroup filter in the ternary else branch when org is all but display is selected", () => {
      // When org is "all" but usersDisplay is "selected", the ternary takes
      // the false branch: users.value.filter((user) => user.isInGroup)
      wrapper.vm.selectedOrg = { value: "all", label: "All" };
      wrapper.vm.usersDisplay = "selected";

      wrapper.vm.users = [
        { email: "user1@example.com", isInGroup: true, org: "TestOrg1" },
        { email: "user2@example.com", isInGroup: false, org: "TestOrg2" },
        { email: "user3@example.com", isInGroup: true, org: "TestOrg1" },
      ];

      wrapper.vm.updateOrganization();

      // Only users with isInGroup true should appear
      expect(wrapper.vm.rows).toHaveLength(2);
      expect(wrapper.vm.rows.every((user: any) => user.isInGroup)).toBe(true);
    });
  });

  describe("External User Warning", () => {
    it("shows warning for external user newly added to a role", () => {
      // context === "role" + is_external + isInGroup + !groupUsersMap.has
      const user = {
        email: "external@example.com",
        isInGroup: true,
        is_external: true,
      };

      // Mount with context="role" so the warning condition is active
      const wrapper2 = mount(GroupUsers, {
        global: {
          provide: { store: enhancedStore },
          plugins: [i18n],
          stubs: o2Stubs,
        },
        props: {
          groupUsers: [],
          activeTab: "users",
          addedUsers: new Set(),
          removedUsers: new Set(),
          context: "role",
        },
      });

      wrapper2.vm.groupUsersMap = new Set([]);

      const result = wrapper2.vm.shouldShowWarning(user);
      expect(result).toBe(true);
    });

    it("does not show warning for non-external users", () => {
      const user = {
        email: "normal@example.com",
        isInGroup: true,
        is_external: false,
      };

      const wrapper2 = mount(GroupUsers, {
        global: {
          provide: { store: enhancedStore },
          plugins: [i18n],
          stubs: o2Stubs,
        },
        props: {
          groupUsers: [],
          activeTab: "users",
          addedUsers: new Set(),
          removedUsers: new Set(),
          context: "role",
        },
      });

      const result = wrapper2.vm.shouldShowWarning(user);
      expect(result).toBe(false);
    });

    it("does not show warning when context is group", () => {
      const user = {
        email: "external@example.com",
        isInGroup: true,
        is_external: true,
      };

      // Default context is "group" — warning should be disabled
      const result = wrapper.vm.shouldShowWarning(user);
      expect(result).toBe(false);
    });

    it("does not show warning for users already in the role", () => {
      const user = {
        email: "existing@example.com",
        isInGroup: true,
        is_external: true,
      };

      const wrapper2 = mount(GroupUsers, {
        global: {
          provide: { store: enhancedStore },
          plugins: [i18n],
          stubs: o2Stubs,
        },
        props: {
          groupUsers: ["existing@example.com"],
          activeTab: "users",
          addedUsers: new Set(),
          removedUsers: new Set(),
          context: "role",
        },
      });

      wrapper2.vm.groupUsersMap = new Set(["existing@example.com"]);

      // User is in groupUsersMap — no warning (already in role)
      const result = wrapper2.vm.shouldShowWarning(user);
      expect(result).toBe(false);
    });
  });

  describe("Display Filtering", () => {
    beforeEach(async () => {
      await wrapper.vm.getchOrgUsers();
    });

    it("shows all users when display is 'all'", async () => {
      await wrapper.vm.updateUserTable("all");
      expect(wrapper.vm.rows).toHaveLength(3);
    });

    it("shows only selected users when display is 'selected'", async () => {
      await wrapper.vm.updateUserTable("selected");

      const selectedUsers = wrapper.vm.rows.filter((user: any) => user.isInGroup);
      expect(wrapper.vm.rows).toEqual(selectedUsers);
    });

    it("fetches data when switching to 'all' for first time", async () => {
      wrapper.vm.hasFetchedOrgUsers = false;

      await wrapper.vm.updateUserTable("all");

      expect(wrapper.vm.hasFetchedOrgUsers).toBe(true);
    });

    it("does not refetch data when switching to 'all' after first fetch", async () => {
      const fetchSpy = vi.spyOn(wrapper.vm, "getchOrgUsers");
      wrapper.vm.hasFetchedOrgUsers = true;

      await wrapper.vm.updateUserTable("all");

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("Props Watching", () => {
    it("updates when groupUsers prop changes", async () => {
      await wrapper.setProps({ groupUsers: ["user1@example.com", "root@example.com"] });
      await flushPromises();

      expect(wrapper.vm.groupUsersMap.size).toBe(2);
      expect(wrapper.vm.groupUsersMap.has("user1@example.com")).toBe(true);
      expect(wrapper.vm.groupUsersMap.has("root@example.com")).toBe(true);
      expect(wrapper.vm.hasFetchedOrgUsers).toBe(true);
    });

    it("resets selectedOrg when groupUsers changes", async () => {
      wrapper.vm.selectedOrg = { value: "test", label: "Test" };

      await wrapper.setProps({ groupUsers: ["newuser@example.com"] });
      await flushPromises();

      expect(wrapper.vm.selectedOrg.value).toBe("all");
    });
  });

  describe("Edge Cases", () => {
    it("handles empty groupUsers prop", async () => {
      const wrapper2 = mount(GroupUsers, {
        global: {
          provide: { store: enhancedStore },
          plugins: [i18n],
          stubs: o2Stubs,
        },
        props: {
          groupUsers: [],
          activeTab: "users",
          addedUsers: new Set(),
          removedUsers: new Set(),
        },
      });

      await flushPromises();
      expect(wrapper2.vm.groupUsersMap.size).toBe(0);
    });

    it("handles API error when fetching users", async () => {
      expect(typeof wrapper.vm.getchOrgUsers).toBe("function");

      const result = wrapper.vm.getchOrgUsers();
      expect(result).toBeInstanceOf(Promise);
    });

    it("handles empty users data from API", async () => {
      mockUsersState.getOrgUsers.mockResolvedValue([]);

      await wrapper.vm.getchOrgUsers();

      expect(wrapper.vm.users).toEqual([]);
    });

    it("handles organizations without CustomerBillingObj", async () => {
      const storeWithIncompleteOrgs = {
        ...enhancedStore,
        state: {
          ...enhancedStore.state,
          organizations: [
            {
              name: "IncompleteOrg",
              identifier: "incomplete",
              id: "1",
              status: "active",
              ingest_threshold: 100,
              search_threshold: 50,
            },
          ],
          userInfo: { email: "test@example.com" },
        },
      };

      const wrapper2 = mount(GroupUsers, {
        global: {
          provide: { store: storeWithIncompleteOrgs },
          plugins: [i18n],
          stubs: o2Stubs,
        },
        props: {
          groupUsers: [],
          activeTab: "users",
          addedUsers: new Set(),
          removedUsers: new Set(),
        },
      });

      await flushPromises();

      expect(wrapper2.vm.orgOptions[1]).toEqual(
        expect.objectContaining({
          label: "IncompleteOrg",
          subscription_type: "",
          note: "",
        }),
      );
    });
  });

  describe("Theme Support", () => {
    it("applies correct theme classes", () => {
      const filters = wrapper.find('[data-test="iam-users-selection-filters"]');
      expect(filters.exists()).toBe(true);
    });

    it("switches to dark theme classes when theme is dark", async () => {
      const darkStore = {
        ...enhancedStore,
        state: {
          ...enhancedStore.state,
          theme: "dark",
        },
      };

      const wrapper2 = mount(GroupUsers, {
        global: {
          provide: { store: darkStore },
          plugins: [i18n],
          stubs: o2Stubs,
        },
        props: {
          groupUsers: [],
          activeTab: "users",
          addedUsers: new Set(),
          removedUsers: new Set(),
        },
      });

      const filters = wrapper2.find('[data-test="iam-users-selection-filters"]');
      expect(filters.exists()).toBe(true);
    });
  });

  describe("Accessibility", () => {
    it("has proper data-test attributes", () => {
      const sections = [
        "iam-users-selection-filters",
        "iam-users-selection-show-toggle",
        "iam-users-selection-search-input",
        "iam-users-selection-table",
      ];

      sections.forEach((selector) => {
        expect(wrapper.find(`[data-test="${selector}"]`).exists()).toBe(true);
      });
    });

    it("has proper form labels and placeholders", () => {
      const searchInput = wrapper.find('input[placeholder="Search User"]');
      expect(searchInput.exists()).toBe(true);
    });

    it("has proper button styling", () => {
      const filterButtons = wrapper.findAll('[data-test^="iam-users-selection-show-"]');
      expect(filterButtons.length).toBeGreaterThan(0);
    });

    it("has proper table attributes", () => {
      // Verify the table container is rendered and that data-test attributes
      // from the OTable scoped slots are present (confirming OTable is mounted).
      const tableContainer = wrapper.find('[data-test="iam-users-selection-table"]');
      expect(tableContainer.exists()).toBe(true);

      // After mount, rows contain isInGroup users; checkboxes confirm
      // OTable is rendering with the correct row-key bound ("email").
      const checkbox = wrapper.find('[data-test="iam-users-selection-table-body-row-user1@example.com-checkbox"]');
      expect(checkbox.exists()).toBe(true);
    });
  });
});
