import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { shallowMount } from "@vue/test-utils";
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

// Settings v2 KV backend for the home pin + per-user favorites — mocked so
// mount-time loads and favorite toggles never hit the network.
vi.mock("@/services/settings", () => ({
  default: {
    getSetting: vi.fn().mockResolvedValue({ data: null }),
    setOrgSetting: vi.fn().mockResolvedValue({}),
    setUserSetting: vi.fn().mockResolvedValue({}),
    deleteOrgSetting: vi.fn().mockResolvedValue({}),
    deleteUserSetting: vi.fn().mockResolvedValue({}),
  },
}));

import settingsService from "@/services/settings";
import { useFavoriteDashboards } from "@/composables/useFavoriteDashboards";
import { markExplicitDashboardFolderNav } from "@/utils/dashboard/explicitFolderNav";

// Mock DOM methods to prevent errors from missing DOM APIs
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
const buildGlobalConfig = (store: any, router: any, i18n: any, routeQuery: any = { folder: "default" }) => ({
  plugins: [store, router, i18n],
  mocks: {
    $route: { query: routeQuery },
  },
  provide: { _q_: { notify: vi.fn(() => vi.fn()), dialog: vi.fn() } },
  stubs: {
    OPageLayout: {
      name: "OPageLayout",
      template: '<div data-test-stub="page-layout"><slot name="header" /><slot /><slot name="footer" /></div>',
    },
    OPageHeader: {
      name: "OPageHeader",
      template: '<div data-test-stub="app-page-header"><slot /><slot name="actions" /></div>',
    },
    FolderList: true,
    OTable: {
      name: "OTable",
      template: '<div data-test-stub="o-table"><slot name="toolbar" /><slot name="toolbar-trailing" /><slot name="empty" /><slot name="bottom" /></div>',
    },
    OEmptyState: true,
    OInput: true,
    ODropdown: true,
    ODropdownItem: true,
    AddDashboardFromGitHub: true,
    "OIcon": true,
    // Migrated overlay primitives — preserve props/emits for assertion
    ODrawer: {
      name: "ODrawer",
      props: ["open", "width", "title", "subTitle", "showClose", "persistent", "size", "primaryButtonLabel", "secondaryButtonLabel", "neutralButtonLabel", "primaryButtonVariant", "secondaryButtonVariant", "neutralButtonVariant", "primaryButtonDisabled", "secondaryButtonDisabled", "primaryButtonLoading"],
      emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
      template: '<div data-test-stub="o-drawer" :data-open="open" :data-title="title"><slot /></div>',
    },
    ODialog: {
      name: "ODialog",
      props: ["open", "width", "title", "subTitle", "showClose", "persistent", "size", "primaryButtonLabel", "secondaryButtonLabel", "neutralButtonLabel", "formId"],
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
      try {
        wrapper.unmount();
      } catch {
        // ignore unmount errors when component failed to initialize
      }
    }
    wrapper = undefined;
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

      // Check specific required columns (columns use id/header, not name).
      // "#" is no longer a member column — it's OTable's built-in show-index.
      const columnIds = columns.map((col: any) => col.id);
      expect(columnIds).not.toContain("#");
      expect(columnIds).toContain("name");
      expect(columnIds).toContain("actions");
    });

    it("should test dashboards computed property", async () => {
      // Create a store with dashboard data
      const testStore = createMockStore();
      testStore.state.organizationData.allDashboardList = {
        default: [
          { dashboardId: "dash1", title: "Dashboard 1", description: "", owner: "", created: "2023-01-01T00:00:00Z" },
          { dashboardId: "dash2", title: "Dashboard 2", description: "", owner: "", created: "2023-01-01T00:00:00Z" }
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
          { dashboardId: "dash1", title: "Dashboard 1", description: "", owner: "", created: "2023-01-01T00:00:00Z" },
          { dashboardId: "dash2", title: "Dashboard 2", description: "", owner: "", created: "2023-01-01T00:00:00Z" },
          { dashboardId: "dash3", title: "Dashboard 3", description: "", owner: "", created: "2023-01-01T00:00:00Z" }
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

  describe("Favorite dashboards", () => {
    const storeWithTwo = () => {
      const testStore = createMockStore();
      testStore.state.organizationData.allDashboardList = {
        default: [
          { dashboardId: "dash1", title: "Dashboard 1", description: "", owner: "", created: "2023-01-01T00:00:00Z" },
          { dashboardId: "dash2", title: "Dashboard 2", description: "", owner: "", created: "2023-01-01T00:00:00Z" },
        ],
      };
      return testStore;
    };

    beforeEach(() => {
      useFavoriteDashboards().favorites.value = [];
    });

    afterEach(() => {
      // Module-level shared ref — never leak favorites into later mounts,
      // which would flip their favorites-first landing.
      useFavoriteDashboards().favorites.value = [];
    });

    it("shows the selected folder normally, and only favorites in the Favorites view", async () => {
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(storeWithTwo(), router, i18n),
      });
      await nextTick();
      await nextTick();

      useFavoriteDashboards().favorites.value = [
        { dashboardId: "dash2", folderId: "default", label: "Dashboard 2" },
      ];
      expect(wrapper.vm.dashboards).toHaveLength(2);

      wrapper.vm.updateActiveFolderId("__favorites__");
      await nextTick();

      expect(wrapper.vm.showFavoritesOnly).toBe(true);
      expect(wrapper.vm.dashboards).toHaveLength(1);
      expect(wrapper.vm.dashboards[0].id).toBe("dash2");
      expect(wrapper.vm.resultTotal).toBe(1);

      wrapper.vm.updateActiveFolderId("default");
      await nextTick();
      expect(wrapper.vm.showFavoritesOnly).toBe(false);
      expect(wrapper.vm.dashboards).toHaveLength(2);
    });

    it("lists favorites from OTHER folders too — favorites are folder-independent", async () => {
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(storeWithTwo(), router, i18n),
      });
      await nextTick();
      await nextTick();

      // This favorite lives in folder1 (whose dashboard list is not cached),
      // so the row must come from the stored favorite entry itself.
      useFavoriteDashboards().favorites.value = [
        { dashboardId: "remote1", folderId: "folder1", label: "Remote Dash" },
        { dashboardId: "dash1", folderId: "default", label: "Dashboard 1" },
      ];
      wrapper.vm.updateActiveFolderId("__favorites__");
      await nextTick();

      expect(wrapper.vm.dashboards).toHaveLength(2);
      const remote = wrapper.vm.dashboards.find((r: any) => r.id === "remote1");
      expect(remote).toBeDefined();
      expect(remote.folder_id).toBe("folder1");
      expect(remote.folder).toBe("Folder 1"); // resolved from the folders list
      expect(remote.name).toBe("Remote Dash"); // stored label, folder not cached
      // The cached default-folder favorite is enriched from the store list.
      const local = wrapper.vm.dashboards.find((r: any) => r.id === "dash1");
      expect(local.name).toBe("Dashboard 1");

      // The favorites view shows the folder column, like cross-folder search.
      const columnIds = wrapper.vm.columns.map((c: any) => c.id);
      expect(columnIds).toContain("folder");
    });

    it("selecting a folder exits the favorites view and shows that folder", async () => {
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(storeWithTwo(), router, i18n),
      });
      await nextTick();
      await nextTick();

      useFavoriteDashboards().favorites.value = [
        { dashboardId: "dash1", folderId: "default", label: "Dashboard 1" },
      ];
      wrapper.vm.updateActiveFolderId("__favorites__");
      await nextTick();
      expect(wrapper.vm.dashboards).toHaveLength(1);

      // A folder click while favorites is on must drop the user into the
      // normal folder view — the view is just another rail location now.
      wrapper.vm.updateActiveFolderId("folder1");
      await nextTick();

      expect(wrapper.vm.showFavoritesOnly).toBe(false);
      expect(wrapper.vm.activeFolderId).toBe("folder1");
    });

    // The component reads the query via useRoute(), so the deep-link tests
    // drive the REAL mock router rather than the $route mock.
    const settle = async () => {
      await nextTick();
      await nextTick();
      await nextTick();
    };

    it("lands on Favorites when the user has favorites and no deep link", async () => {
      useFavoriteDashboards().favorites.value = [
        { dashboardId: "dash1", folderId: "default", label: "Dashboard 1" },
      ];
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(storeWithTwo(), router, i18n),
      });
      await settle();

      expect(wrapper.vm.activeFolderId).toBe("__favorites__");
      expect(wrapper.vm.showFavoritesOnly).toBe(true);
    });

    it("lands on the default folder when there are no favorites", async () => {
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(storeWithTwo(), router, i18n),
      });
      await settle();

      expect(wrapper.vm.activeFolderId).toBe("default");
    });

    it("a folder deep link beats the favorites-first landing", async () => {
      useFavoriteDashboards().favorites.value = [
        { dashboardId: "dash1", folderId: "default", label: "Dashboard 1" },
      ];
      await router.push({ path: "/dashboards", query: { folder: "folder1" } });
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(storeWithTwo(), router, i18n),
      });
      await settle();

      expect(wrapper.vm.activeFolderId).toBe("folder1");
      expect(wrapper.vm.showFavoritesOnly).toBe(false);
    });

    it("an app-stamped ?folder=default does NOT beat the favorites landing", async () => {
      // The folder watcher writes ?folder=default into the URL on every
      // ordinary visit, so a reload always carries it — it is not an explicit
      // deep link and must not suppress favorites-first.
      useFavoriteDashboards().favorites.value = [
        { dashboardId: "dash1", folderId: "default", label: "Dashboard 1" },
      ];
      await router.push({ path: "/dashboards", query: { folder: "default" } });
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(storeWithTwo(), router, i18n),
      });
      await settle();

      expect(wrapper.vm.activeFolderId).toBe("__favorites__");
    });

    it("an explicit back-navigation to folder=default lands on the default folder, not Favorites", async () => {
      // Regression: the dashboard-view back button marks its target folder
      // right before pushing ?folder=default. That marker must beat the
      // favorites-first landing even though the URL alone looks identical to
      // a plain reload of the stamped URL.
      useFavoriteDashboards().favorites.value = [
        { dashboardId: "dash1", folderId: "default", label: "Dashboard 1" },
      ];
      markExplicitDashboardFolderNav("default");
      await router.push({ path: "/dashboards", query: { folder: "default" } });
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(storeWithTwo(), router, i18n),
      });
      await settle();

      expect(wrapper.vm.activeFolderId).toBe("default");
    });

    it("ignores folder emissions that arrive before the landing decision", async () => {
      useFavoriteDashboards().favorites.value = [
        { dashboardId: "dash1", folderId: "default", label: "Dashboard 1" },
      ];
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(storeWithTwo(), router, i18n),
      });
      // FolderList's async init emits "default" before onMounted decides —
      // simulate that immediate emission.
      wrapper.vm.updateActiveFolderId("default");
      await settle();

      expect(wrapper.vm.activeFolderId).toBe("__favorites__");
    });

    it("a Favorites deep link is honored even with zero favorites", async () => {
      await router.push({
        path: "/dashboards",
        query: { folder: "__favorites__" },
      });
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(storeWithTwo(), router, i18n),
      });
      await settle();

      expect(wrapper.vm.activeFolderId).toBe("__favorites__");
    });

    it("toggleFavorite persists the per-user setting resolved to the active folder", async () => {
      const testStore = storeWithTwo();
      (testStore.state.userInfo as any).email = "me@example.com";
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(testStore, router, i18n),
      });
      await nextTick();
      await nextTick();

      await wrapper.vm.toggleFavorite({ id: "dash1", name: "Dashboard 1" });

      expect(settingsService.setUserSetting).toHaveBeenCalledWith(
        "test-org",
        "me@example.com",
        "favorite_dashboards",
        [{ dashboardId: "dash1", folderId: "default", label: "Dashboard 1" }],
        "ui",
      );
      expect(wrapper.vm.isFavorite("dash1")).toBe(true);
    });

    it("toggleFavorite on an existing favorite removes it", async () => {
      const testStore = storeWithTwo();
      (testStore.state.userInfo as any).email = "me@example.com";
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(testStore, router, i18n),
      });
      await nextTick();
      await nextTick();

      useFavoriteDashboards().favorites.value = [
        { dashboardId: "dash1", folderId: "default", label: "Dashboard 1" },
      ];
      await wrapper.vm.toggleFavorite({ id: "dash1", name: "Dashboard 1" });

      expect(wrapper.vm.isFavorite("dash1")).toBe(false);
      expect(settingsService.setUserSetting).toHaveBeenCalledWith(
        "test-org",
        "me@example.com",
        "favorite_dashboards",
        [],
        "ui",
      );
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

  // Helper: locate ODialog instances by title prop.
  // Each migrated dialog differs only by title, so this gives us a
  // deterministic, attribute-free lookup against the global stub.
  const findDrawerByTitle = (w: any, title: string) => {
    const drawers = w.findAllComponents({ name: "ODialog" });
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
      expect(drawer.props("size")).toBe("md");
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

    it("should pass form-id to ODialog for native form submission (add dashboard)", async () => {
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(store, router, i18n),
      });

      await nextTick();
      await nextTick();

      wrapper.vm.showAddDashboardDialog = true;
      await nextTick();

      const drawer = findDrawerByTitle(wrapper, "Create Dashboard");
      expect(drawer.props("formId")).toBe("add-dashboard-form");
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
      expect(drawer.props("size")).toBe("sm");
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

    it("should pass form-id to ODialog for native form submission (add folder)", async () => {
      wrapper = shallowMount(Dashboards, {
        global: buildGlobalConfig(store, router, i18n),
      });

      await nextTick();
      await nextTick();

      wrapper.vm.showAddFolderDialog = true;
      await nextTick();

      const drawer = findDrawerByTitle(wrapper, "New Folder");
      expect(drawer.props("formId")).toBe("add-folder-dashboards-form");
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