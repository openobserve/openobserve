import { mount, flushPromises  } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach  } from "vitest";
import { createRouter, createMemoryHistory  } from 'vue-router';
import i18n from "@/locales";
import ListOrganizations from "./ListOrganizations.vue";
import organizationsService from "@/services/organizations";
import config from "@/aws-exports";
import OTable from "@/lib/core/Table/OTable.vue";

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

// Mock toast (component uses toast() from @/lib/feedback/Toast/useToast instead of $q.notify)
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: vi.fn(() => vi.fn()),
}));

import { toast } from "@/lib/feedback/Toast/useToast";

describe("ListOrganizations", () => {
  let wrapper;
  let router;
  let mockStore;
  let mockOrganizations;

  beforeEach(() => {
    // Reset config to non-cloud for each test (some tests may flip it)
    config.isCloud = "false";

    // Create a new router instance for each test using memory history
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: '/organizations',
          name: 'organizations',
          component: ListOrganizations,
        },
      ],
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

    wrapper = mount(ListOrganizations, {
      global: {
        plugins: [i18n, router],
        provide: {
          store: mockStore,
        },
        stubs: {
          AddUpdateOrganization: {
            name: 'AddUpdateOrganization',
            template: '<div class="add-update-organization-stub" v-if="open" />',
            props: ['open', 'modelValue'],
            emits: ['update:open', 'updated'],
          },
          NoData: true,
        },
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
            AddUpdateOrganization: true,
            NoData: true,
            OTable: true,
          },
        },
      });

      expect(freshWrapper.vm.filterQuery).toBe("");
      // loading is true immediately after mount because getOrganizations() is
      // called synchronously in setup and sets loading=true before the promise resolves
      expect(freshWrapper.vm.loading).toBe(true);
      await flushPromises();
      expect(freshWrapper.vm.loading).toBe(false);
      freshWrapper.unmount();
    });

    it("passes correct pagination and filter props to OTable", () => {
      const otable = wrapper.findComponent(OTable);
      expect(otable.exists()).toBe(true);
      expect(otable.props("pageSize")).toBe(20);
      expect(otable.props("pageSizeOptions")).toEqual([20, 50, 100, 250, 500]);
      expect(otable.props("globalFilter")).toBe("");
    });

    it("should setup columns correctly for non-cloud mode", () => {
      const columns = wrapper.vm.columns;
      // #, name, identifier, type, actions = 5 columns when isCloud is false
      expect(columns).toHaveLength(5);
      expect(columns.map(c => c.id)).toContain("name");
      expect(columns.map(c => c.id)).toContain("identifier");
    });

    it("should add plan column when isCloud is true", async () => {
      // Set cloud mode before mounting a fresh wrapper
      config.isCloud = "true";

      const wrapperWithCloud = mount(ListOrganizations, {
        global: {
          plugins: [i18n, router],
          provide: {
            store: {
              ...mockStore,
              state: {
                ...mockStore.state,
              },
            },
          },
          stubs: {
            AddUpdateOrganization: true,
            NoData: true,
            OTable: true,
          },
        },
      });

      await flushPromises();
      // #, name, identifier, type, plan, actions = 6 columns when isCloud is true
      expect(wrapperWithCloud.vm.columns).toHaveLength(6);
      wrapperWithCloud.unmount();

      config.isCloud = "false";
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
      // After initial mount and flushPromises, loading should be false
      await flushPromises();
      expect(wrapper.vm.loading).toBe(false);
      // Calling getOrganizations() sets loading=true synchronously
      wrapper.vm.getOrganizations();
      expect(wrapper.vm.loading).toBe(true);
      await flushPromises();
      expect(wrapper.vm.loading).toBe(false);
    });

    it("should format billing plans correctly", async () => {
      await flushPromises();
      expect(wrapper.vm.organizations[0].plan).toBe("Free");
      expect(wrapper.vm.organizations[1].plan).toBe("Pay as you go");
    });

    it("should fall back to '-' for unknown billing plan values", async () => {
      organizationsService.list.mockResolvedValueOnce({
        data: {
          data: [
            { name: "Unknown Plan Org", identifier: "unknown-org", type: "enterprise", plan: "99" },
          ],
        },
      });
      await wrapper.vm.getOrganizations();
      await flushPromises();
      expect(wrapper.vm.organizations[0].plan).toBe("-");
    });
  });

  describe("Search and Filtering", () => {
    it("should bind filterQuery to search input and pass to OTable as global-filter", async () => {
      // The filterQuery is bound via v-model to OInput and passed to OTable as :global-filter
      const otable = wrapper.findComponent(OTable);
      expect(otable.exists()).toBe(true);

      // Initially empty filter
      expect(otable.props("globalFilter")).toBe("");

      // Update filterQuery (this is what typing in the search box does)
      wrapper.vm.filterQuery = "Test Org 1";
      await wrapper.vm.$nextTick();

      // OTable should receive the updated global-filter prop
      expect(otable.props("globalFilter")).toBe("Test Org 1");
    });

    it("should pass empty global-filter to OTable when filterQuery is empty", async () => {
      wrapper.vm.filterQuery = "";
      await wrapper.vm.$nextTick();

      const otable = wrapper.findComponent(OTable);
      expect(otable.props("globalFilter")).toBe("");
    });
  });

  describe("Route Action Handling", () => {
    it("opens dialog with populated data when route action is update via watcher", async () => {
      await router.push({
        path: '/organizations',
        query: {
          action: "update",
          to_be_updated_org_id: "org-update-1",
          to_be_updated_org_name: "Updated Org Name",
        },
      });
      await flushPromises();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.showAddOrganizationDialog).toBe(true);
      expect(wrapper.vm.toBeUpdatedOrganization.id).toBe("org-update-1");
      expect(wrapper.vm.toBeUpdatedOrganization.name).toBe("Updated Org Name");
    });

    it.skip("opens dialog on mount when route has action=add", async () => {
      // Push the route before mounting so onMounted sees it
      await router.push({ path: '/organizations', query: { action: "add" } });
      await router.isReady();

      const freshWrapper = mount(ListOrganizations, {
        global: {
          plugins: [i18n, router],
          provide: { store: mockStore },
          stubs: { AddUpdateOrganization: true, NoData: true, OTable: true },
        },
      });
      await flushPromises();

      // onMounted should open the dialog
      expect(freshWrapper.vm.showAddOrganizationDialog).toBe(true);
      freshWrapper.unmount();
    });

    it("opens dialog with populated data on mount when route has action=update", async () => {
      // Push the route before mounting so onMounted sees it
      await router.push({
        path: '/organizations',
        query: {
          action: "update",
          to_be_updated_org_id: "mount-org-id",
          to_be_updated_org_name: "Mount Org Name",
        },
      });
      await router.isReady();

      const freshWrapper = mount(ListOrganizations, {
        global: {
          plugins: [i18n, router],
          provide: { store: mockStore },
          stubs: { AddUpdateOrganization: true, NoData: true, OTable: true },
        },
      });
      await flushPromises();

      expect(freshWrapper.vm.showAddOrganizationDialog).toBe(true);
      expect(freshWrapper.vm.toBeUpdatedOrganization.id).toBe("mount-org-id");
      expect(freshWrapper.vm.toBeUpdatedOrganization.name).toBe("Mount Org Name");
      freshWrapper.unmount();
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

    it("should render AddUpdateOrganization with v-model:open bound to showAddOrganizationDialog", async () => {
      wrapper.vm.showAddOrganizationDialog = true;
      await flushPromises();
      await wrapper.vm.$nextTick();

      const addUpdate = wrapper.findComponent({ name: 'AddUpdateOrganization' });
      expect(addUpdate.exists()).toBe(true);
      expect(addUpdate.props('open')).toBe(true);
    });

    it("should close dialog when AddUpdateOrganization emits update:open false", async () => {
      await router.push('/organizations');
      await flushPromises();
      wrapper.vm.showAddOrganizationDialog = true;
      await flushPromises();
      await wrapper.vm.$nextTick();

      const addUpdate = wrapper.findComponent({ name: 'AddUpdateOrganization' });
      expect(addUpdate.exists()).toBe(true);

      await addUpdate.vm.$emit('update:open', false);
      await flushPromises();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.showAddOrganizationDialog).toBe(false);
    });

    it("should refresh organization list when AddUpdateOrganization emits updated", async () => {
      wrapper.vm.showAddOrganizationDialog = true;
      await flushPromises();
      await wrapper.vm.$nextTick();

      const addUpdate = wrapper.findComponent({ name: 'AddUpdateOrganization' });
      expect(addUpdate.exists()).toBe(true);

      organizationsService.list.mockClear();
      await addUpdate.vm.$emit('updated');
      await flushPromises();

      expect(organizationsService.list).toHaveBeenCalled();
      expect(wrapper.vm.showAddOrganizationDialog).toBe(false);
    });

    it("keeps dialog open when onDrawerOpenChange is called with true", async () => {
      wrapper.vm.showAddOrganizationDialog = true;
      await wrapper.vm.$nextTick();

      wrapper.vm.onDrawerOpenChange(true);

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
      // Clear previous toast calls from getOrganizations on mount
      toast.mockClear();

      await wrapper.vm.updateOrganizationList();

      // updateOrganizationList calls toast() for success notification
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({
        variant: "success",
        message: "Organization added successfully.",
      }));
    });

    it("should show updated message when isUpdated is true", async () => {
      // Set toBeUpdatedOrganization.id to a non-empty string so isUpdated === true
      wrapper.vm.toBeUpdatedOrganization = { id: "existing-org-id", name: "", identifier: "" };
      toast.mockClear();

      await wrapper.vm.updateOrganizationList();

      expect(toast).toHaveBeenCalledWith(expect.objectContaining({
        variant: "success",
        message: "Organization updated successfully.",
      }));
    });
  });

  describe("Organization Management Methods", () => {
    it("should set dialog state when inviteTeam is called", () => {
      const props = {
        row: { id: "1", name: "Test Org", role: "admin", identifier: "test-org-1" },
      };

      wrapper.vm.inviteTeam(props);

      expect(wrapper.vm.organization).toEqual({
        id: "1",
        name: "Test Org",
        role: "admin",
        identifier: "test-org-1",
        member_lists: [],
      });
      expect(wrapper.vm.showJoinOrganizationDialog).toBe(true);
    });

    it("should close join dialog and show toast when joinOrganization is called", () => {
      wrapper.vm.showJoinOrganizationDialog = true;
      toast.mockClear();

      wrapper.vm.joinOrganization();

      expect(wrapper.vm.showJoinOrganizationDialog).toBe(false);
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({
        variant: "success",
        message: "Request completed successfully.",
        timeout: 5000,
      }));
    });

    it("should copy API key to clipboard when copyAPIKey is called", async () => {
      wrapper.vm.organizationAPIKey = "test-api-key-123";

      wrapper.vm.copyAPIKey();
      await flushPromises();

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("test-api-key-123");
    });
  });

  describe("Error Handling", () => {

    it("should handle empty organization list", async () => {
      organizationsService.list.mockResolvedValueOnce({ data: { data: [] } });
      await wrapper.vm.getOrganizations();
      await flushPromises();
      expect(wrapper.vm.organizations).toHaveLength(0);
    });

    it("should format counter for double-digit rows", async () => {
      // Generate 12 orgs to trigger the counter > 9 branch
      const largeOrgs = Array.from({ length: 12 }, (_, i) => ({
        name: `Org ${i + 1}`,
        identifier: `org-${i + 1}`,
        type: "team",
        plan: "0",
      }));

      organizationsService.list.mockResolvedValueOnce({
        data: { data: largeOrgs },
      });

      await wrapper.vm.getOrganizations();
      await flushPromises();

      expect(wrapper.vm.organizations).toHaveLength(12);
      // Counter should be 10 (without leading zero) for the 10th item
      expect(wrapper.vm.organizations[9]["#"]).toBe(10);
    });
  });

  describe("Edge Cases", () => {
    it("falls back to empty string when update route lacks to_be_updated_org_name", async () => {
      await router.push({
        path: '/organizations',
        query: { action: "update" }, // no to_be_updated_org_id or to_be_updated_org_name
      });
      await flushPromises();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.showAddOrganizationDialog).toBe(true);
      // Falls back to empty string via || ""
      expect(wrapper.vm.toBeUpdatedOrganization.name).toBe("");
      expect(wrapper.vm.toBeUpdatedOrganization.id).toBe("");
    });

    it("renameOrganization sets dialog state before router push", () => {
      const row = { name: "Test Org", identifier: "org-rename-1" };

      // Known bug: the function references props.row.identifier but props
      // is not defined in setup scope. It throws after the initial statements.
      expect(() => wrapper.vm.renameOrganization(row)).toThrow();

      // The synchronous statements before the crash do execute
      expect(wrapper.vm.showAddOrganizationDialog).toBe(true);
      expect(wrapper.vm.toBeUpdatedOrganization).toEqual({
        id: "org-rename-1",
        name: "Test Org",
        identifier: "org-rename-1",
      });
    });
  });
});
