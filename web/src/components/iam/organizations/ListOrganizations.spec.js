import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRouter, createMemoryHistory } from 'vue-router';
import i18n from "@/locales";
import ListOrganizations from "./ListOrganizations.vue";
import organizationsService from "@/services/organizations";

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

const { mockToast } = vi.hoisted(() => ({ mockToast: vi.fn(() => vi.fn()) }));
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: mockToast,
}));

vi.mock("@/utils/clipboard", () => ({
  copyToClipboard: vi.fn(),
}));

const stubs = {
  OTable: {
    name: "OTable",
    template: '<div class="o-table-stub" data-test="organizations-table"><slot name="cell-actions" :row="{ identifier: \'test-row\', name: \'Test Row\' }" /></div>',
    props: ["data", "columns", "rowKey", "globalFilter", "pagination", "pageSize", "pageSizeOptions", "footerTitle", "sorting", "filterMode", "defaultColumns", "showGlobalFilter"],
  },
  OInput: {
    name: "OInput",
    template: '<input :data-test="$attrs[\'data-test\']" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
    props: ["modelValue", "placeholder"],
    emits: ["update:modelValue"],
  },
  OButton: {
    name: "OButton",
    template: '<button :data-test="$attrs[\'data-test\']" @click="$emit(\'click\', $event)"><slot /></button>',
    props: ["variant", "size", "title"],
    emits: ["click"],
  },
  OIcon: {
    name: "OIcon",
    template: '<i></i>',
    props: ["name", "size"],
  },
  AddUpdateOrganization: {
    name: 'AddUpdateOrganization',
    template: '<div class="add-update-organization-stub" :data-open="open" />',
    props: ['open', 'modelValue'],
    emits: ['update:open', 'updated'],
  },
  NoData: {
    name: "NoData",
    template: '<div class="no-data-stub" />',
  },
};

describe("ListOrganizations", () => {
  let wrapper;
  let router;
  let mockStore;
  let mockOrganizations;

  beforeEach(() => {
    mockToast.mockClear();
    mockToast.mockReturnValue(vi.fn());

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

    wrapper = mount(ListOrganizations, {
      global: {
        plugins: [i18n, router],
        provide: {
          store: mockStore,
        },
        stubs,
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
          stubs,
        },
      });

      expect(freshWrapper.vm.filterQuery).toBe("");
      expect(freshWrapper.vm.loading).toBe(false);
      freshWrapper.unmount();
    });

    it("should setup columns correctly", () => {
      const columns = wrapper.vm.columns;
      expect(columns.length).toBeGreaterThanOrEqual(5);
      expect(columns.map((c) => c.id)).toContain("name");
      expect(columns.map((c) => c.id)).toContain("identifier");
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

    it("should show success toast on organization update", async () => {
      await wrapper.vm.updateOrganizationList();
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        variant: "success",
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
