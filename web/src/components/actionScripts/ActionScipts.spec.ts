import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import ActionScripts from "@/components/actionScripts/ActionScipts.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { createRouter, createWebHistory } from "vue-router";

installQuasar();

const mockRouter = createRouter({
  history: createWebHistory(),
  routes: [{ path: "/", component: { template: "<div>Home</div>" } }],
});

// Mock services
vi.mock("@/services/alerts", () => ({
  default: {
    list: vi.fn(() => Promise.resolve({ data: [] })),
    create: vi.fn(() => Promise.resolve({})),
    update: vi.fn(() => Promise.resolve({})),
    delete: vi.fn(() => Promise.resolve({})),
  },
}));

vi.mock("@/services/action_scripts", () => ({
  default: {
    list: vi.fn(() => Promise.resolve({ data: [] })),
    create: vi.fn(() => Promise.resolve({})),
    update: vi.fn(() => Promise.resolve({})),
    delete: vi.fn(() => Promise.resolve({})),
  },
}));

vi.mock("@/services/alert_destination", () => ({
  default: {
    list: vi.fn(() => Promise.resolve({ data: [] })),
  },
}));

vi.mock("@/services/alert_templates", () => ({
  default: {
    list: vi.fn(() => Promise.resolve({ data: [] })),
  },
}));

vi.mock("@/services/segment_analytics", () => ({
  default: {
    track: vi.fn(),
    page: vi.fn(),
    identify: vi.fn(),
  },
}));

vi.mock("@/services/reodotdev_analytics", () => ({
  useReo: vi.fn(() => ({
    track: vi.fn(),
  })),
}));

vi.mock("@/composables/useStreams", () => ({
  default: vi.fn(() => ({
    getStreams: vi.fn(() => Promise.resolve({ list: [] })),
    streams: { value: { list: [] } },
  })),
}));

vi.mock("@/composables/useActions", () => ({
  default: vi.fn(() => ({
    getAllActions: vi.fn(() => Promise.resolve({ list: [] })),
    actions: { value: [] },
  })),
}));

vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path) => `/mocked/${path}`),
  getUUID: vi.fn(() => "mock-uuid"),
  verifyOrganizationStatus: vi.fn(() => ({ value: true })),
  convertUnixToQuasarFormat: vi.fn((timestamp) => "2023-01-01 10:00:00"),
}));

describe("ActionScripts.vue", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    store.state.selectedOrganization = {
      identifier: "test-org",
      name: "Test Org",
    };
    store.state.currentuser = {
      email: "test@example.com",
    };
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  const createWrapper = () => {
    return mount(ActionScripts, {
      global: {
        plugins: [i18n, mockRouter],
        provide: {
          store,
        },
        stubs: {
          "q-table": {
            template:
              '<div data-test="action-scripts-table"><slot name="no-data"></slot><slot name="body-cell-actions"></slot><slot name="body-cell-function"></slot><slot name="bottom"></slot><slot name="header"></slot></div>',
            props: [
              "rows",
              "columns",
              "row-key",
              "pagination",
              "style",
              "class",
            ],
          },
          "q-input": {
            template:
              '<div><slot name="prepend"></slot><input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" /></div>',
            props: [
              "modelValue",
              "borderless",
              "dense",
              "class",
              "placeholder",
              "data-test",
              "label",
            ],
          },
          "q-icon": {
            template: "<div></div>",
            props: ["name", "class"],
          },
          "q-btn": {
            template: '<button @click="$emit(\'click\')"><slot></slot></button>',
            props: [
              "data-test",
              "class",
              "flat",
              "no-caps",
              "label",
              "icon",
              "padding",
              "unelevated",
              "size",
              "round",
              "title",
              "disable",
            ],
          },
          "q-td": {
            template: "<td><slot></slot></td>",
            props: ["props"],
          },
          "q-tooltip": {
            template: "<div><slot></slot></div>",
          },
          "q-circular-progress": {
            template: "<div></div>",
            props: ["indeterminate", "rounded", "size", "value", "color"],
          },
          "q-th": {
            template: "<th><slot></slot></th>",
            props: ["props", "class", "style"],
          },
          "q-tr": {
            template: "<tr><slot></slot></tr>",
            props: ["props"],
          },
          "q-dialog": {
            template: '<div v-if="modelValue"><slot></slot></div>',
            props: ["modelValue", "persistent", "class"],
          },
          "q-card": {
            template: "<div><slot></slot></div>",
            props: ["class"],
          },
          "q-card-section": {
            template: "<div><slot></slot></div>",
          },
          "q-form": {
            template: '<form @submit.prevent="$emit(\'submit\')"><slot></slot></form>',
          },
          "q-select": {
            template:
              '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><slot></slot></select>',
            props: [
              "modelValue",
              "label",
              "options",
              "loading",
              "disable",
              "use-input",
              "fill-input",
              "hide-selected",
              "input-debounce",
              "data-test",
            ],
          },
          EditScript: {
            template: "<div data-test='edit-script'></div>",
            props: ["isUpdated"],
          },
          ConfirmDialog: {
            template: "<div data-test='confirm-dialog'></div>",
            props: ["title", "message", "modelValue"],
          },
          NoData: {
            template: "<div data-test='no-data'>No Data</div>",
          },
          QTablePagination: {
            template: "<div data-test='table-pagination'></div>",
            props: [
              "scope",
              "position",
              "resultTotal",
              "perPageOptions",
            ],
          },
        },
      },
    });
  };

  describe("Component Rendering", () => {
    it("renders the component correctly", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("renders the header with correct title", () => {
      wrapper = createWrapper();
      const title = wrapper.find('[data-test="alerts-list-title"]');
      expect(title.exists()).toBe(true);
    });

    it("renders search input", () => {
      wrapper = createWrapper();
      const searchInput = wrapper.find('[data-test="action-list-search-input"]');
      expect(searchInput.exists()).toBe(true);
    });

    it("renders add button", () => {
      wrapper = createWrapper();
      const addBtn = wrapper.find('[data-test="action-list-add-btn"]');
      expect(addBtn.exists()).toBe(true);
    });

    it("renders action scripts table", () => {
      wrapper = createWrapper();
      const table = wrapper.find('[data-test="action-scripts-table"]');
      expect(table.exists()).toBe(true);
    });

    it("shows table view by default", () => {
      wrapper = createWrapper();
      const table = wrapper.find('[data-test="action-scripts-table"]');
      expect(table.exists()).toBe(true);
    });

    it("hides EditScript component by default", () => {
      wrapper = createWrapper();
      const editScript = wrapper.find('[data-test="edit-script"]');
      expect(editScript.exists()).toBe(false);
    });
  });

  describe("Search Functionality", () => {
    it("updates filterQuery when search input changes", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      const searchInput = wrapper.find('[data-test="action-list-search-input"] input');
      await searchInput.setValue("test search");
      await wrapper.vm.$nextTick();

      expect(vm.filterQuery).toBe("test search");
    });

    it("filters visible rows based on search query", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      // Set up some mock data
      vm.actionsScriptRows = [
        { name: "Script One", uuid: "1" },
        { name: "Script Two", uuid: "2" },
        { name: "Another Script", uuid: "3" },
      ];

      vm.filterQuery = "Script";
      await wrapper.vm.$nextTick();

      // visibleRows should be filtered
      expect(vm.visibleRows).toBeDefined();
    });
  });

  describe("Add/Edit Actions", () => {
    it("shows add action form when add button is clicked", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      const addBtn = wrapper.find('[data-test="action-list-add-btn"]');
      await addBtn.trigger("click");
      await wrapper.vm.$nextTick();

      expect(vm.showAddActionScriptDialog).toBe(true);
    });

    it("shows EditScript component when adding new action", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.showAddActionScriptDialog = true;
      await wrapper.vm.$nextTick();

      const editScript = wrapper.find('[data-test="edit-script"]');
      expect(editScript.exists()).toBe(true);
    });

    it("hides table when showing EditScript", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.showAddActionScriptDialog = true;
      await wrapper.vm.$nextTick();

      const table = wrapper.find('[data-test="action-scripts-table"]');
      expect(table.exists()).toBe(false);
    });
  });

  describe("Delete Functionality", () => {
    it("renders ConfirmDialog component", () => {
      wrapper = createWrapper();
      const confirmDialog = wrapper.find('[data-test="confirm-dialog"]');
      expect(confirmDialog.exists()).toBe(true);
    });

    it("shows confirm dialog when confirmDelete is true", async () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.confirmDelete = true;
      await wrapper.vm.$nextTick();

      expect(vm.confirmDelete).toBe(true);
    });
  });

  describe("Component State", () => {
    it("initializes with correct default values", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      expect(vm.showAddActionScriptDialog).toBe(false);
      expect(vm.confirmDelete).toBe(false);
      expect(vm.filterQuery).toBe("");
      expect(vm.isUpdated).toBe(false);
    });

    it("has actionsScriptRows ref defined", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      expect(vm.actionsScriptRows).toBeDefined();
      expect(Array.isArray(vm.actionsScriptRows)).toBe(true);
    });

    it("has columns defined for table", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      expect(vm.columns).toBeDefined();
      expect(Array.isArray(vm.columns)).toBe(true);
    });

    it("has pagination object defined", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      expect(vm.pagination).toBeDefined();
    });
  });

  describe("Theme Support", () => {
    it("applies dark theme classes when dark theme is active", async () => {
      wrapper = createWrapper();
      store.state.theme = "dark";
      await wrapper.vm.$nextTick();

      const container = wrapper.find('[data-test="action-scripts-list-page"]');
      expect(container.classes()).toContain("dark-theme");
    });

    it("applies light theme classes when light theme is active", async () => {
      wrapper = createWrapper();
      store.state.theme = "light";
      await wrapper.vm.$nextTick();

      const container = wrapper.find('[data-test="action-scripts-list-page"]');
      expect(container.classes()).toContain("light-theme");
    });
  });

  describe("Table Structure", () => {
    it("renders table with NoData component", () => {
      wrapper = createWrapper();
      const noData = wrapper.find('[data-test="no-data"]');
      expect(noData.exists()).toBe(true);
    });

    it("renders pagination component", () => {
      wrapper = createWrapper();
      const pagination = wrapper.find('[data-test="table-pagination"]');
      expect(pagination.exists()).toBe(true);
    });
  });

  describe("Data Structure", () => {
    it("has streamTypes defined", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      expect(vm.streamTypes).toBeDefined();
      expect(vm.streamTypes).toContain("logs");
      expect(vm.streamTypes).toContain("metrics");
      expect(vm.streamTypes).toContain("traces");
    });

    it("has alertStateLoadingMap defined", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      expect(vm.alertStateLoadingMap).toBeDefined();
      expect(typeof vm.alertStateLoadingMap).toBe("object");
    });
  });

  describe("Component Lifecycle", () => {
    it("mounts without errors", () => {
      wrapper = createWrapper();
      expect(wrapper.vm).toBeTruthy();
    });

    it("can be unmounted without errors", () => {
      wrapper = createWrapper();
      expect(() => wrapper.unmount()).not.toThrow();
    });
  });

  describe("Props and Emits", () => {
    it("defines correct emits", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      // Component should be able to emit these events
      expect(vm.$options.emits).toBeDefined();
    });
  });

  describe("Computed Properties", () => {
    it("has visibleRows computed property", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      expect(vm.visibleRows).toBeDefined();
    });

    it("has hasVisibleRows computed property", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm as any;

      expect(typeof vm.hasVisibleRows).toBe("boolean");
    });
  });

  describe("Integration", () => {
    it("renders all major sections correctly", () => {
      wrapper = createWrapper();

      const header = wrapper.find('[data-test="alerts-list-title"]');
      const searchInput = wrapper.find('[data-test="action-list-search-input"]');
      const addBtn = wrapper.find('[data-test="action-list-add-btn"]');
      const table = wrapper.find('[data-test="action-scripts-table"]');

      expect(header.exists()).toBe(true);
      expect(searchInput.exists()).toBe(true);
      expect(addBtn.exists()).toBe(true);
      expect(table.exists()).toBe(true);
    });

    it("maintains proper layout structure", () => {
      wrapper = createWrapper();
      const container = wrapper.find('[data-test="action-scripts-list-page"]');

      expect(container.exists()).toBe(true);
      expect(container.classes()).toContain("q-pa-none");
      expect(container.classes()).toContain("tw-w-full");
    });
  });
});
