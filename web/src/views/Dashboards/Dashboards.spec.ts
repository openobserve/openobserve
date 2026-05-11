import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, shallowMount } from "@vue/test-utils";
import { nextTick } from "vue";
import Dashboards from "./Dashboards.vue";
import { createStore } from "vuex";
import { createRouter, createWebHistory } from "vue-router";
import { createI18n } from "vue-i18n";

// Mock external dependencies
vi.mock("@/services/dashboards", () => ({
  default: {
    create: vi.fn().mockResolvedValue({}),
    list: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("@/utils/commons", () => ({
  deleteDashboardById: vi.fn().mockResolvedValue({}),
  deleteFolderById: vi.fn().mockResolvedValue({}),
  getAllDashboards: vi.fn().mockResolvedValue([]),
  getAllDashboardsByFolderId: vi.fn().mockResolvedValue([]),
  getDashboard: vi.fn().mockResolvedValue({}),
  getFoldersList: vi.fn().mockImplementation((store) => {
    // Mock implementation that populates the store's folders
    store.state.organizationData.folders = [
      { folderId: "default", name: "Default" },
      { folderId: "folder1", name: "Folder 1" },
      { folderId: "folder2", name: "Folder 2" },
    ];
    return Promise.resolve();
  }),
  moveModuleToAnotherFolder: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/composables/useNotifications", () => ({
  default: () => ({
    showPositiveNotification: vi.fn(),
    showErrorNotification: vi.fn(),
  }),
}));

vi.mock("@/composables/useLoading", () => ({
  useLoading: vi.fn((fn) => ({
    execute: fn,
    loading: { value: false },
  })),
}));

vi.mock("@/utils/dashboard/convertDashboardSchemaVersion", () => ({
  convertDashboardSchemaVersion: vi.fn((dashboard) => dashboard),
}));

// Mock DOM methods to prevent Quasar errors
Object.defineProperty(Element.prototype, 'removeAttribute', {
  writable: true,
  value: vi.fn(),
});

Object.defineProperty(Element.prototype, 'setAttribute', {
  writable: true,
  value: vi.fn(),
});

Object.defineProperty(Element.prototype, 'getAttribute', {
  writable: true,
  value: vi.fn().mockReturnValue(''),
});

Object.defineProperty(Element.prototype, 'insertBefore', {
  writable: true,
  value: vi.fn(),
});

Object.defineProperty(Element.prototype, 'appendChild', {
  writable: true,
  value: vi.fn(),
});

Object.defineProperty(Element.prototype, 'removeChild', {
  writable: true,
  value: vi.fn(),
});

Object.defineProperty(Element.prototype, 'addEventListener', {
  writable: true,
  value: vi.fn(),
});

Object.defineProperty(Element.prototype, 'removeEventListener', {
  writable: true,
  value: vi.fn(),
});

Object.defineProperty(Node.prototype, 'insertBefore', {
  writable: true,
  value: vi.fn(),
});

Object.defineProperty(Node.prototype, 'appendChild', {
  writable: true,
  value: vi.fn(),
});

Object.defineProperty(Node.prototype, 'removeChild', {
  writable: true,
  value: vi.fn(),
});

// Create mock store
const createMockStore = () => {
  return createStore({
    state: {
      selectedOrganization: {
        identifier: "test-org",
      },
      userInfo: {
        name: "Test User",
      },
      organizationData: {
        folders: [
          { folderId: "default", name: "Default" },
          { folderId: "folder1", name: "Folder 1" },
          { folderId: "folder2", name: "Folder 2" },
        ],
        allDashboardList: {
          default: [
            {
              dashboardId: "dashboard1",
              title: "Dashboard 1",
              description: "Test dashboard",
              owner: "Test User",
              created: "2023-01-01T00:00:00Z",
            },
          ],
          folder1: [],
        },
      },
    },
    getters: {},
    mutations: {},
    actions: {},
  });
};

// Create mock router
const createMockRouter = () => {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/dashboards", component: { template: "<div>Dashboard</div>" } },
      { path: "/dashboards/view", component: { template: "<div>View</div>" } },
    ],
  });
};

// Create mock i18n
const createMockI18n = () => {
  return createI18n({
    legacy: false,
    locale: "en",
    messages: {
      en: {
        dashboard: {
          header: "Dashboards",
          search: "Search dashboards",
          searchAcross: "Search across all folders",
          searchSelf: "Search in current folder",
          searchAll: "Search in all folders",
          import: "Import",
          add: "Add Dashboard",
          folderLabel: "Folders",
          newFolderBtnLabel: "New Folder",
          name: "Name",
          identifier: "Identifier",
          description: "Description",
          owner: "Owner",
          created: "Created",
          actions: "Actions",
          folder: "Folder",
          createdashboard: "Create Dashboard",
          updateFolder: "Update Folder",
          newFolder: "New Folder",
          cancel: "Cancel",
          save: "Save",
        },
      },
    },
  });
};

// Shared stub configuration used across the suite.
// q-dialog is removed in favor of the migrated overlay primitives ODrawer/ODialog.
const buildGlobalConfig = (store: any, router: any, i18n: any, routeQuery: any = { folder: "default" }) => ({
  plugins: [store, router, i18n],
  mocks: {
    $route: { query: routeQuery },
    $q: { notify: vi.fn(() => vi.fn()), dialog: vi.fn() },
  },
  provide: { _q_: { notify: vi.fn(() => vi.fn()), dialog: vi.fn() } },
  stubs: {
    "q-page": true,
    "q-input": true,
    "q-btn": true,
    "q-toggle": true,
    "q-tooltip": true,
    // q-splitter must render both named slots so the drawers nested in
    // <template v-slot:after> are present for assertions.
    "q-splitter": {
      name: "QSplitter",
      template: '<div data-test-stub="q-splitter"><slot name="before" /><slot name="after" /></div>',
    },
    "q-tabs": true,
    "q-tab": true,
    "q-separator": true,
    "q-menu": true,
    "q-list": true,
    "q-item": true,
    "q-item-section": true,
    "q-item-label": true,
    "q-icon": true,
    "q-table": true,
    // Migrated overlay primitives — preserve props/emits for assertion
    ODrawer: {
      name: "ODrawer",
      props: ["open", "width", "title", "subTitle", "showClose", "persistent", "size", "primaryButtonLabel", "secondaryButtonLabel", "neutralButtonLabel", "primaryButtonVariant", "secondaryButtonVariant", "neutralButtonVariant", "primaryButtonDisabled", "secondaryButtonDisabled", "primaryButtonLoading"],
      emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
      template: '<div data-test-stub="o-drawer" :data-open="open" :data-title="title"><slot /></div>',
    },
    ODialog: {
      name: "ODialog",
      props: ["open", "width", "title", "subTitle", "showClose", "persistent", "size", "primaryButtonLabel", "secondaryButtonLabel", "neutralButtonLabel"],
      emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
      template: '<div data-test-stub="o-dialog" :data-open="open" :data-title="title"><slot /></div>',
    },
    AddDashboard: {
      name: "AddDashboard",
      template: "<div data-test-stub=\"add-dashboard\"></div>",
      methods: { submit: vi.fn() },
    },
    AddFolder: {
      name: "AddFolder",
      template: "<div data-test-stub=\"add-folder\"></div>",
      methods: { submit: vi.fn() },
    },
    MoveDashboardToAnotherFolder: {
      name: "MoveDashboardToAnotherFolder",
      props: ["open", "dashboardIds", "activeFolderId"],
      emits: ["update:open", "updated"],
      template: '<div data-test-stub="move-dashboard"></div>',
    },
    ConfirmDialog: true,
    QTablePagination: true,
    NoData: true,
  },
});

describe("Dashboards.vue", () => {
  let wrapper: any;
  let store: any;
  let router: any;
  let i18n: any;

  beforeEach(() => {
    store = createMockStore();
    router = createMockRouter();
    i18n = createMockI18n();

    // Mock window.document methods
    const mockElement = {
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
      getAttribute: vi.fn().mockReturnValue(''),
      insertBefore: vi.fn(),
      appendChild: vi.fn(),
      removeChild: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      click: vi.fn(),
      style: {},
      classList: {
        add: vi.fn(),
        remove: vi.fn(),
        contains: vi.fn().mockReturnValue(false),
      },
      parentNode: null,
      childNodes: [],
    };
    
    document.createElement = vi.fn().mockReturnValue(mockElement);
    document.body.appendChild = vi.fn();
    document.body.insertBefore = vi.fn();
    document.body.removeChild = vi.fn();

    // Mock AbortController
    global.AbortController = vi.fn(function() {
      return {
        abort: vi.fn(),
        signal: {},
      };
    }) as any;

    // Mock window methods
    Object.defineProperty(window, 'getComputedStyle', {
      value: vi.fn().mockReturnValue({
        getPropertyValue: vi.fn().mockReturnValue(''),
      }),
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  describe("Component Initialization", () => {
    it("should mount successfully", async () => {
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(store, router, i18n),
      });

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm).toBeDefined();
    });

    it("should initialize with default folder when no route query parameter", async () => {
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(store, router, i18n, {}),
      });

      // Wait for component initialization to complete
      await nextTick();
      await nextTick();

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.activeFolderId).toBe("default");
    });

    it("should have reactive activeFolderId property", async () => {
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(store, router, i18n),
      });

      // Wait for component initialization to complete
      await nextTick();
      await nextTick();

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.activeFolderId).toBeDefined();

      // Test that updateActiveFolderId method works
      expect(wrapper.vm.updateActiveFolderId).toBeDefined();
      wrapper.vm.updateActiveFolderId("folder1");
      expect(wrapper.vm.activeFolderId).toBe("folder1");
    });

    it("should expose addDashboardRef and addFolderRef on the component surface", async () => {
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(store, router, i18n),
      });

      await nextTick();
      await nextTick();

      // The refs are exposed on the public surface so the drawer's
      // @click:primary handler can invoke addDashboardRef?.submit().
      // After mount, they are bound to the slotted child component instance.
      expect("addDashboardRef" in wrapper.vm).toBe(true);
      expect("addFolderRef" in wrapper.vm).toBe(true);
    });
  });

  describe("Computed Properties", () => {
    it("should define table columns correctly", async () => {
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(store, router, i18n),
      });

      await nextTick();

      const columns = wrapper.vm.columns;
      expect(columns).toBeDefined();
      expect(Array.isArray(columns)).toBe(true);
      expect(columns.length).toBeGreaterThan(0);

      // Check specific required columns
      const columnNames = columns.map((col: any) => col.name);
      expect(columnNames).toContain("#");
      expect(columnNames).toContain("name");
      expect(columnNames).toContain("actions");
    });

    it("should test dashboards computed property", async () => {
      // Create a store with dashboard data
      const testStore = createMockStore();
      testStore.state.organizationData.allDashboardList = {
        default: [
          { dashboardId: "dash1", title: "Dashboard 1" },
          { dashboardId: "dash2", title: "Dashboard 2" }
        ]
      };

      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(testStore, router, i18n),
      });

      await nextTick();
      await nextTick();

      expect(wrapper.vm.dashboards).toBeDefined();
      expect(Array.isArray(wrapper.vm.dashboards)).toBe(true);
    });

    it("should compute resultTotal correctly", async () => {
      // Create a store with dashboard data
      const testStore = createMockStore();
      testStore.state.organizationData.allDashboardList = {
        default: [
          { dashboardId: "dash1", title: "Dashboard 1" },
          { dashboardId: "dash2", title: "Dashboard 2" },
          { dashboardId: "dash3", title: "Dashboard 3" }
        ]
      };

      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(testStore, router, i18n),
      });

      await nextTick();
      await nextTick();

      expect(wrapper.vm.resultTotal).toBe(3);
    });
  });

  describe("Methods", () => {
    it("should handle addDashboard method", async () => {
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(store, router, i18n),
      });

      await nextTick();

      expect(wrapper.vm.showAddDashboardDialog).toBe(false);

      // Call addDashboard method
      wrapper.vm.addDashboard();

      expect(wrapper.vm.showAddDashboardDialog).toBe(true);
    });

    it("should handle addFolder method", async () => {
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(store, router, i18n),
      });

      await nextTick();

      expect(wrapper.vm.showAddFolderDialog).toBe(false);
      expect(wrapper.vm.isFolderEditMode).toBe(false);

      // Call addFolder method
      wrapper.vm.addFolder();

      expect(wrapper.vm.showAddFolderDialog).toBe(true);
      expect(wrapper.vm.isFolderEditMode).toBe(false);
    });

    it("should have showDeleteDialogFn method defined", async () => {
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(store, router, i18n),
      });

      await nextTick();

      expect(wrapper.vm.showDeleteDialogFn).toBeDefined();
      expect(typeof wrapper.vm.showDeleteDialogFn).toBe('function');
    });

    it("should handle editFolder method", async () => {
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(store, router, i18n),
      });

      await nextTick();

      const testFolderId = "test-folder-id";

      expect(wrapper.vm.selectedFolderToEdit).toBeFalsy();
      expect(wrapper.vm.isFolderEditMode).toBe(false);
      expect(wrapper.vm.showAddFolderDialog).toBe(false);

      wrapper.vm.editFolder(testFolderId);

      expect(wrapper.vm.selectedFolderToEdit).toBe(testFolderId);
      expect(wrapper.vm.isFolderEditMode).toBe(true);
      expect(wrapper.vm.showAddFolderDialog).toBe(true);
    });

    it("should handle clearSearchHistory method", async () => {
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(store, router, i18n),
      });

      await nextTick();

      // Set up some search data
      wrapper.vm.searchQuery = "test search";
      wrapper.vm.filteredResults = [{ id: 1, title: "Test Result" }];

      expect(wrapper.vm.searchQuery).toBe("test search");
      expect(wrapper.vm.filteredResults).toHaveLength(1);

      wrapper.vm.clearSearchHistory();

      expect(wrapper.vm.searchQuery).toBe("");
      expect(wrapper.vm.filteredResults).toEqual([]);
    });
  });

  // Helper: locate ODrawer instances by title prop.
  // Each migrated drawer differs only by title, so this gives us a
  // deterministic, attribute-free lookup against the global stub.
  const findDrawerByTitle = (w: any, title: string) => {
    const drawers = w.findAllComponents({ name: "ODrawer" });
    return drawers.find((d: any) => d.props("title") === title);
  };

  describe("ODrawer migration: Add Dashboard drawer", () => {
    it("should render ODrawer for add dashboard, closed by default, with correct props", async () => {
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(store, router, i18n),
      });

      await nextTick();
      await nextTick();

      const drawer = findDrawerByTitle(wrapper, "Create Dashboard");
      expect(drawer).toBeTruthy();
      expect(drawer.props("open")).toBe(false);
      expect(drawer.props("width")).toBe(40);
      expect(drawer.props("primaryButtonLabel")).toBe("Save");
      expect(drawer.props("secondaryButtonLabel")).toBe("Cancel");
    });

    it("should open the add dashboard drawer when addDashboard() is invoked", async () => {
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(store, router, i18n),
      });

      await nextTick();
      await nextTick();

      wrapper.vm.addDashboard();
      await nextTick();

      const drawer = findDrawerByTitle(wrapper, "Create Dashboard");
      expect(drawer.props("open")).toBe(true);
    });

    it("should close drawer when ODrawer emits click:secondary", async () => {
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(store, router, i18n),
      });

      await nextTick();
      await nextTick();

      wrapper.vm.showAddDashboardDialog = true;
      await nextTick();

      const drawer = findDrawerByTitle(wrapper, "Create Dashboard");
      await drawer.vm.$emit("click:secondary");
      await nextTick();

      expect(wrapper.vm.showAddDashboardDialog).toBe(false);
    });

    it("should invoke addDashboardRef.submit when ODrawer emits click:primary", async () => {
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(store, router, i18n),
      });

      await nextTick();
      await nextTick();

      wrapper.vm.showAddDashboardDialog = true;
      await nextTick();

      const submitSpy = vi.fn();
      wrapper.vm.addDashboardRef = { submit: submitSpy };

      const drawer = findDrawerByTitle(wrapper, "Create Dashboard");
      await drawer.vm.$emit("click:primary");
      await nextTick();

      expect(submitSpy).toHaveBeenCalledTimes(1);
    });

    it("should not throw when click:primary fires with null addDashboardRef", async () => {
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(store, router, i18n),
      });

      await nextTick();
      await nextTick();

      // Edge case: optional chaining guards against null refs
      wrapper.vm.addDashboardRef = null;
      const drawer = findDrawerByTitle(wrapper, "Create Dashboard");
      expect(() => drawer.vm.$emit("click:primary")).not.toThrow();
    });

    it("should sync open state when ODrawer emits update:open", async () => {
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(store, router, i18n),
      });

      await nextTick();
      await nextTick();

      wrapper.vm.showAddDashboardDialog = true;
      await nextTick();

      const drawer = findDrawerByTitle(wrapper, "Create Dashboard");
      await drawer.vm.$emit("update:open", false);
      await nextTick();

      expect(wrapper.vm.showAddDashboardDialog).toBe(false);
    });
  });

  describe("ODrawer migration: Add/Edit Folder drawer", () => {
    it("should render the folder drawer closed with 'New Folder' title by default", async () => {
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(store, router, i18n),
      });

      await nextTick();
      await nextTick();

      const drawer = findDrawerByTitle(wrapper, "New Folder");
      expect(drawer).toBeTruthy();
      expect(drawer.props("open")).toBe(false);
      expect(drawer.props("width")).toBe(30);
    });

    it("should switch drawer title to 'Update Folder' when in edit mode", async () => {
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(store, router, i18n),
      });

      await nextTick();
      await nextTick();

      wrapper.vm.editFolder("folder1");
      await nextTick();

      const drawer = findDrawerByTitle(wrapper, "Update Folder");
      expect(drawer).toBeTruthy();
      expect(drawer.props("open")).toBe(true);
    });

    it("should close the folder drawer on click:secondary", async () => {
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(store, router, i18n),
      });

      await nextTick();
      await nextTick();

      wrapper.vm.showAddFolderDialog = true;
      await nextTick();

      const drawer = findDrawerByTitle(wrapper, "New Folder");
      await drawer.vm.$emit("click:secondary");
      await nextTick();

      expect(wrapper.vm.showAddFolderDialog).toBe(false);
    });

    it("should invoke addFolderRef.submit on click:primary", async () => {
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(store, router, i18n),
      });

      await nextTick();
      await nextTick();

      wrapper.vm.showAddFolderDialog = true;
      await nextTick();

      const submitSpy = vi.fn();
      wrapper.vm.addFolderRef = { submit: submitSpy };

      const drawer = findDrawerByTitle(wrapper, "New Folder");
      await drawer.vm.$emit("click:primary");
      await nextTick();

      expect(submitSpy).toHaveBeenCalledTimes(1);
    });

    it("should not throw when click:primary fires with null addFolderRef", async () => {
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(store, router, i18n),
      });

      await nextTick();
      await nextTick();

      wrapper.vm.addFolderRef = null;
      const drawer = findDrawerByTitle(wrapper, "New Folder");
      expect(() => drawer.vm.$emit("click:primary")).not.toThrow();
    });
  });

  describe("Move Dashboard component (v-model:open contract)", () => {
    it("should pass open state and dashboard ids to MoveDashboardToAnotherFolder", async () => {
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(store, router, i18n),
      });

      await nextTick();
      await nextTick();

      const move = wrapper.findComponent({ name: "MoveDashboardToAnotherFolder" });
      expect(move.exists()).toBe(true);
      // Initially closed
      expect(move.props("open")).toBe(false);
    });

    it("should sync close via update:open emit from MoveDashboardToAnotherFolder", async () => {
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(store, router, i18n),
      });

      await nextTick();
      await nextTick();

      // Manually open
      wrapper.vm.showMoveDashboardDialog = true;
      await nextTick();

      const move = wrapper.findComponent({ name: "MoveDashboardToAnotherFolder" });
      expect(move.props("open")).toBe(true);

      await move.vm.$emit("update:open", false);
      await nextTick();

      expect(wrapper.vm.showMoveDashboardDialog).toBe(false);
    });
  });
});