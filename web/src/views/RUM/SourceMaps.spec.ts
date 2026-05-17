import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import { createStore } from "vuex";
import { createRouter, createWebHistory } from "vue-router";
import { createI18n } from "vue-i18n";

import SourceMaps from "./SourceMaps.vue";

// ---------------------------------------------------------------------------
// Service mocks
// ---------------------------------------------------------------------------
const listSourceMapsMock = vi.fn();
const getSourceMapsValuesMock = vi.fn();
const deleteSourceMapsMock = vi.fn();

vi.mock("@/services/sourcemaps", () => ({
  default: {
    listSourceMaps: (...args: any[]) => listSourceMapsMock(...args),
    getSourceMapsValues: (...args: any[]) => getSourceMapsValuesMock(...args),
    deleteSourceMaps: (...args: any[]) => deleteSourceMapsMock(...args),
  },
}));

// Avoid pulling in the real icon module
vi.mock("@quasar/extras/material-icons-outlined", () => ({
  "delete": "outlined-delete-icon",
}));

// ---------------------------------------------------------------------------
// Test harness setup
// ---------------------------------------------------------------------------
const createMockStore = () =>
  createStore({
    state: {
      selectedOrganization: { identifier: "test-org" },
      userInfo: { name: "Test User" },
    },
  });

const createMockRouter = () =>
  createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/", name: "Home", component: { template: "<div />" } },
      {
        path: "/sourcemaps/upload",
        name: "UploadSourceMaps",
        component: { template: "<div />" },
      },
    ],
  });

const createMockI18n = () =>
  createI18n({
    legacy: false,
    locale: "en",
    messages: { en: {} },
  });

const notifyMock = vi.fn();

const sampleSourceMaps = [
  {
    service: "svc-a",
    version: "1.0.0",
    env: "prod",
    source_file_name: "app.js",
    source_map_file_name: "app.js.map",
    file_type: "js",
    created_at: 1700000000000000,
  },
  {
    service: "svc-a",
    version: "1.0.0",
    env: "prod",
    source_file_name: "vendor.js",
    source_map_file_name: "vendor.js.map",
    file_type: "js",
    created_at: 1700000001000000,
  },
  {
    service: "svc-b",
    version: "2.0.0",
    env: "dev",
    source_file_name: "main.js",
    source_map_file_name: "main.js.map",
    file_type: "js",
    created_at: 1700000002000000,
  },
];

const sampleFilterValues = {
  versions: ["1.0.0", "2.0.0"],
  services: ["svc-a", "svc-b"],
  envs: ["prod", "dev"],
};

// Builds the global mounting configuration with consistent stubs.
const buildGlobalConfig = (store: any, router: any, i18n: any) => ({
  plugins: [store, router, i18n],
  mocks: {
    $q: { notify: notifyMock },
  },
  provide: {
    _q_: { notify: notifyMock },
  },
  stubs: {
    "q-select": {
      name: "QSelect",
      props: ["modelValue", "options", "label"],
      emits: ["update:modelValue", "filter", "new-value"],
      template:
        '<div data-test-stub="q-select" :data-label="label"><slot name="no-option" /></div>',
    },
    "q-item": true,
    "q-item-section": true,
    "q-item-label": true,
    "q-separator": true,
    "q-spinner-hourglass": {
      name: "QSpinnerHourglass",
      template: '<div data-test-stub="q-spinner-hourglass" />',
    },
    "OIcon": true,
    "q-table": {
      name: "QTable",
      props: ["rows", "columns", "rowKey", "pagination"],
      template:
        '<div data-test-stub="q-table" :data-rows="rows.length"><slot name="body" :cols="columns" :row="rows[0]" /></div>',
    },
    "q-tr": true,
    "q-td": true,
    "q-list": true,
    OButton: {
      name: "OButton",
      props: ["variant", "size", "icon", "loading", "title"],
      emits: ["click"],
      template:
        '<button data-test-stub="o-button" :data-variant="variant" :data-loading="loading" @click="$emit(\'click\')"><slot /></button>',
    },
    ODialog: {
      name: "ODialog",
      props: [
        "open",
        "width",
        "title",
        "subTitle",
        "showClose",
        "persistent",
        "size",
        "primaryButtonLabel",
        "secondaryButtonLabel",
        "neutralButtonLabel",
      ],
      emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
      template:
        '<div data-test-stub="o-dialog" :data-open="open" :data-title="title" :data-size="size"><slot /></div>',
    },
    QTablePagination: {
      name: "QTablePagination",
      props: ["scope", "position", "resultTotal", "perPageOptions"],
      emits: ["update:changeRecordPerPage"],
      template: '<div data-test-stub="q-table-pagination" />',
    },
  },
});

describe("SourceMaps.vue", () => {
  let store: any;
  let router: any;
  let i18n: any;
  let wrapper: any;

  beforeEach(() => {
    store = createMockStore();
    router = createMockRouter();
    i18n = createMockI18n();

    // Reset all service mock implementations to defaults
    listSourceMapsMock.mockReset();
    getSourceMapsValuesMock.mockReset();
    deleteSourceMapsMock.mockReset();
    notifyMock.mockReset();

    listSourceMapsMock.mockResolvedValue({ data: sampleSourceMaps });
    getSourceMapsValuesMock.mockResolvedValue({ data: sampleFilterValues });
    deleteSourceMapsMock.mockResolvedValue({ data: { ok: true } });
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.clearAllMocks();
  });

  const mountComponent = async () => {
    const w = mount(SourceMaps, {
      global: buildGlobalConfig(store, router, i18n),
    });
    await flushPromises();
    await nextTick();
    return w;
  };

  // -------------------------------------------------------------------------
  // Mounting & initial fetch
  // -------------------------------------------------------------------------
  describe("Component Initialization", () => {
    it("renders the source maps container", async () => {
      wrapper = await mountComponent();

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find(".source-maps-container").exists()).toBe(true);
    });

    it("calls getSourceMapsValues with org identifier on mount", async () => {
      wrapper = await mountComponent();

      expect(getSourceMapsValuesMock).toHaveBeenCalledTimes(1);
      expect(getSourceMapsValuesMock).toHaveBeenCalledWith("test-org");
    });

    it("calls listSourceMaps with org identifier on mount", async () => {
      wrapper = await mountComponent();

      expect(listSourceMapsMock).toHaveBeenCalledTimes(1);
      expect(listSourceMapsMock).toHaveBeenCalledWith("test-org", {});
    });

    it("populates filter options from API response", async () => {
      wrapper = await mountComponent();

      expect((wrapper.vm as any).filteredVersionOptions).toEqual([
        "1.0.0",
        "2.0.0",
      ]);
      expect((wrapper.vm as any).filteredServiceOptions).toEqual([
        "svc-a",
        "svc-b",
      ]);
      expect((wrapper.vm as any).filteredEnvironmentOptions).toEqual([
        "prod",
        "dev",
      ]);
    });

    it("handles getSourceMapsValues failure by leaving filter options empty", async () => {
      getSourceMapsValuesMock.mockRejectedValueOnce(new Error("boom"));
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      wrapper = await mountComponent();

      expect((wrapper.vm as any).filteredVersionOptions).toEqual([]);
      expect((wrapper.vm as any).filteredServiceOptions).toEqual([]);
      expect((wrapper.vm as any).filteredEnvironmentOptions).toEqual([]);
      consoleErrorSpy.mockRestore();
    });

    it("handles listSourceMaps failure by clearing source maps", async () => {
      listSourceMapsMock.mockRejectedValueOnce(new Error("network"));
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      wrapper = await mountComponent();

      expect((wrapper.vm as any).groupedSourceMaps).toEqual([]);
      expect((wrapper.vm as any).isLoading).toBe(false);
      consoleErrorSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // Computed & grouping logic
  // -------------------------------------------------------------------------
  describe("Source Map Grouping", () => {
    it("groups source maps by service-version-env composite key", async () => {
      wrapper = await mountComponent();

      const grouped = (wrapper.vm as any).groupedSourceMaps;
      expect(grouped).toHaveLength(2);

      const groupA = grouped.find(
        (g: any) => g.service === "svc-a" && g.version === "1.0.0",
      );
      expect(groupA.fileCount).toBe(2);
      expect(groupA.files).toHaveLength(2);

      const groupB = grouped.find(
        (g: any) => g.service === "svc-b" && g.version === "2.0.0",
      );
      expect(groupB.fileCount).toBe(1);
    });

    it("retains the most recent created_at as uploaded_at for a group", async () => {
      wrapper = await mountComponent();

      const groupA = (wrapper.vm as any).groupedSourceMaps.find(
        (g: any) => g.service === "svc-a",
      );
      expect(groupA.uploaded_at).toBe(1700000001000000);
    });

    it("returns empty grouped list when response.data is empty", async () => {
      listSourceMapsMock.mockResolvedValueOnce({ data: [] });

      wrapper = await mountComponent();

      expect((wrapper.vm as any).groupedSourceMaps).toEqual([]);
      expect((wrapper.vm as any).resultTotal).toBe(0);
    });

    it("resultTotal computed reflects grouped source maps count", async () => {
      wrapper = await mountComponent();

      expect((wrapper.vm as any).resultTotal).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Conditional rendering branches
  // -------------------------------------------------------------------------
  describe("Conditional rendering", () => {
    it("shows loading spinner while isLoading is true", async () => {
      wrapper = await mountComponent();

      (wrapper.vm as any).isLoading = true;
      await nextTick();

      expect(wrapper.find('[data-test-stub="q-spinner-hourglass"]').exists()).toBe(
        true,
      );
    });

    it("shows the empty state when no source maps exist and not loading", async () => {
      listSourceMapsMock.mockResolvedValueOnce({ data: [] });

      wrapper = await mountComponent();

      expect(wrapper.text()).toContain("No Source Maps Found");
      expect(wrapper.find('[data-test-stub="q-table"]').exists()).toBe(false);
    });

    it("shows the table when grouped source maps exist", async () => {
      wrapper = await mountComponent();

      expect(wrapper.find('[data-test-stub="q-table"]').exists()).toBe(true);
      expect(wrapper.text()).not.toContain("No Source Maps Found");
    });
  });

  // -------------------------------------------------------------------------
  // Filter dropdown behaviour
  // -------------------------------------------------------------------------
  describe("Filter dropdowns", () => {
    it("filterVersions returns all options for empty input", async () => {
      wrapper = await mountComponent();

      const update = (fn: () => void) => fn();
      (wrapper.vm as any).filterVersions("", update);

      expect((wrapper.vm as any).filteredVersionOptions).toEqual([
        "1.0.0",
        "2.0.0",
      ]);
    });

    it("filterVersions filters case-insensitively by substring", async () => {
      wrapper = await mountComponent();

      const update = (fn: () => void) => fn();
      (wrapper.vm as any).filterVersions("2.0", update);

      expect((wrapper.vm as any).filteredVersionOptions).toEqual(["2.0.0"]);
    });

    it("filterServices filters services list", async () => {
      wrapper = await mountComponent();

      const update = (fn: () => void) => fn();
      (wrapper.vm as any).filterServices("svc-b", update);

      expect((wrapper.vm as any).filteredServiceOptions).toEqual(["svc-b"]);
    });

    it("filterEnvironments returns all when input is empty", async () => {
      wrapper = await mountComponent();

      const update = (fn: () => void) => fn();
      (wrapper.vm as any).filterEnvironments("", update);

      expect((wrapper.vm as any).filteredEnvironmentOptions).toEqual([
        "prod",
        "dev",
      ]);
    });

    it("addNewVersion invokes done callback only when value has length", async () => {
      wrapper = await mountComponent();

      const done = vi.fn();
      (wrapper.vm as any).addNewVersion("custom-1.2.3", done);
      expect(done).toHaveBeenCalledWith("custom-1.2.3");

      done.mockClear();
      (wrapper.vm as any).addNewVersion("", done);
      expect(done).not.toHaveBeenCalled();
    });

    it("addNewService invokes done with the value when non-empty", async () => {
      wrapper = await mountComponent();

      const done = vi.fn();
      (wrapper.vm as any).addNewService("new-service", done);
      expect(done).toHaveBeenCalledWith("new-service");
    });

    it("addNewEnvironment invokes done with the value when non-empty", async () => {
      wrapper = await mountComponent();

      const done = vi.fn();
      (wrapper.vm as any).addNewEnvironment("staging", done);
      expect(done).toHaveBeenCalledWith("staging");

      done.mockClear();
      (wrapper.vm as any).addNewEnvironment("", done);
      expect(done).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Apply filters / fetch with params
  // -------------------------------------------------------------------------
  describe("Apply Filters", () => {
    it("re-fetches source maps with all selected filters as params", async () => {
      wrapper = await mountComponent();
      listSourceMapsMock.mockClear();

      (wrapper.vm as any).filters.version = "1.0.0";
      (wrapper.vm as any).filters.service = "svc-a";
      (wrapper.vm as any).filters.environment = "prod";

      (wrapper.vm as any).applyFilters();
      await flushPromises();

      expect(listSourceMapsMock).toHaveBeenCalledWith("test-org", {
        version: "1.0.0",
        service: "svc-a",
        env: "prod",
      });
    });

    it("omits null filter values from the API params", async () => {
      wrapper = await mountComponent();
      listSourceMapsMock.mockClear();

      (wrapper.vm as any).filters.service = "svc-a";
      (wrapper.vm as any).applyFilters();
      await flushPromises();

      expect(listSourceMapsMock).toHaveBeenCalledWith("test-org", {
        service: "svc-a",
      });
    });
  });

  // -------------------------------------------------------------------------
  // Row expansion
  // -------------------------------------------------------------------------
  describe("Row expansion", () => {
    it("getRowKey composes service-version-env key", async () => {
      wrapper = await mountComponent();

      const key = (wrapper.vm as any).getRowKey({
        service: "svc-a",
        version: "1.0.0",
        env: "prod",
      });
      expect(key).toBe("svc-a-1.0.0-prod");
    });

    it("toggleExpand expands a collapsed row", async () => {
      wrapper = await mountComponent();

      const row = { service: "svc-a", version: "1.0.0", env: "prod" };
      expect((wrapper.vm as any).expandedRow).toBeNull();

      (wrapper.vm as any).toggleExpand(row);
      expect((wrapper.vm as any).expandedRow).toBe("svc-a-1.0.0-prod");
    });

    it("toggleExpand collapses the row when already expanded", async () => {
      wrapper = await mountComponent();

      const row = { service: "svc-a", version: "1.0.0", env: "prod" };
      (wrapper.vm as any).toggleExpand(row);
      (wrapper.vm as any).toggleExpand(row);

      expect((wrapper.vm as any).expandedRow).toBeNull();
    });

    it("toggleExpand switches between different rows", async () => {
      wrapper = await mountComponent();

      (wrapper.vm as any).toggleExpand({
        service: "svc-a",
        version: "1.0.0",
        env: "prod",
      });
      (wrapper.vm as any).toggleExpand({
        service: "svc-b",
        version: "2.0.0",
        env: "dev",
      });

      expect((wrapper.vm as any).expandedRow).toBe("svc-b-2.0.0-dev");
    });
  });

  // -------------------------------------------------------------------------
  // Pagination
  // -------------------------------------------------------------------------
  describe("Pagination", () => {
    it("changePagination updates rowsPerPage and calls setPagination on table ref", async () => {
      wrapper = await mountComponent();

      const setPaginationSpy = vi.fn();
      (wrapper.vm as any).qTableRef = { setPagination: setPaginationSpy };

      (wrapper.vm as any).changePagination({ label: "50", value: 50 });

      expect((wrapper.vm as any).pagination.rowsPerPage).toBe(50);
      expect(setPaginationSpy).toHaveBeenCalledWith(
        (wrapper.vm as any).pagination,
      );
    });

    it("changePagination is safe when qTableRef is null", async () => {
      wrapper = await mountComponent();

      (wrapper.vm as any).qTableRef = null;

      expect(() =>
        (wrapper.vm as any).changePagination({ label: "100", value: 100 }),
      ).not.toThrow();
      expect((wrapper.vm as any).pagination.rowsPerPage).toBe(100);
    });
  });

  // -------------------------------------------------------------------------
  // Delete dialog (ODialog migration)
  // -------------------------------------------------------------------------
  describe("Delete confirmation dialog (ODialog)", () => {
    it("renders ODialog closed by default with xs size", async () => {
      wrapper = await mountComponent();

      const dialog = wrapper.findComponent({ name: "ODialog" });
      expect(dialog.exists()).toBe(true);
      expect(dialog.props("open")).toBe(false);
      expect(dialog.props("size")).toBe("xs");
      expect(dialog.props("primaryButtonLabel")).toBe("OK");
      expect(dialog.props("secondaryButtonLabel")).toBe("Cancel");
    });

    it("confirmDeleteSourceMap opens dialog and populates title/message/data", async () => {
      wrapper = await mountComponent();

      const row = {
        service: "svc-a",
        version: "1.0.0",
        env: "prod",
        fileCount: 2,
      };

      (wrapper.vm as any).confirmDeleteSourceMap(row);
      await nextTick();

      const dialog = wrapper.findComponent({ name: "ODialog" });
      expect(dialog.props("open")).toBe(true);
      expect(dialog.props("title")).toBe("Delete Source Maps");
      expect((wrapper.vm as any).deleteDialog.message).toContain("svc-a");
      expect((wrapper.vm as any).deleteDialog.message).toContain("1.0.0");
      expect((wrapper.vm as any).deleteDialog.message).toContain("prod");
      expect((wrapper.vm as any).deleteDialog.message).toContain("2 file(s)");
      expect((wrapper.vm as any).deleteDialog.data).toEqual(row);
    });

    it("closes dialog when ODialog emits click:secondary", async () => {
      wrapper = await mountComponent();

      (wrapper.vm as any).confirmDeleteSourceMap({
        service: "svc-a",
        version: "1.0.0",
        env: "prod",
        fileCount: 1,
      });
      await nextTick();

      const dialog = wrapper.findComponent({ name: "ODialog" });
      await dialog.vm.$emit("click:secondary");
      await nextTick();

      expect((wrapper.vm as any).deleteDialog.show).toBe(false);
    });

    it("invokes deleteSourceMaps service and closes dialog on click:primary", async () => {
      wrapper = await mountComponent();

      const row = {
        service: "svc-a",
        version: "1.0.0",
        env: "prod",
        fileCount: 2,
      };
      (wrapper.vm as any).confirmDeleteSourceMap(row);
      await nextTick();

      const dialog = wrapper.findComponent({ name: "ODialog" });
      await dialog.vm.$emit("click:primary");
      await flushPromises();

      expect(deleteSourceMapsMock).toHaveBeenCalledWith("test-org", {
        service: "svc-a",
        version: "1.0.0",
        env: "prod",
      });
      expect((wrapper.vm as any).deleteDialog.show).toBe(false);
    });

    it("removes the deleted row from groupedSourceMaps after successful delete", async () => {
      wrapper = await mountComponent();

      expect((wrapper.vm as any).groupedSourceMaps).toHaveLength(2);

      const target = (wrapper.vm as any).groupedSourceMaps.find(
        (g: any) => g.service === "svc-a",
      );
      (wrapper.vm as any).confirmDeleteSourceMap(target);
      await nextTick();

      await (wrapper.vm as any).deleteSourceMap();
      await flushPromises();

      expect((wrapper.vm as any).groupedSourceMaps).toHaveLength(1);
      expect(
        (wrapper.vm as any).groupedSourceMaps.find(
          (g: any) => g.service === "svc-a",
        ),
      ).toBeUndefined();
    });

    it("fires a positive notification on successful delete", async () => {
      wrapper = await mountComponent();

      const target = (wrapper.vm as any).groupedSourceMaps[0];
      (wrapper.vm as any).confirmDeleteSourceMap(target);
      await nextTick();

      await (wrapper.vm as any).deleteSourceMap();
      await flushPromises();

      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: "positive" }),
      );
    });

    it("fires a negative notification with server message on delete failure", async () => {
      wrapper = await mountComponent();

      deleteSourceMapsMock.mockRejectedValueOnce({
        response: { data: { message: "Server rejected" } },
      });
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const target = (wrapper.vm as any).groupedSourceMaps[0];
      (wrapper.vm as any).confirmDeleteSourceMap(target);
      await nextTick();

      await (wrapper.vm as any).deleteSourceMap();
      await flushPromises();

      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "negative",
          message: "Server rejected",
        }),
      );
      consoleErrorSpy.mockRestore();
    });

    it("falls back to error.message when server response has no data.message", async () => {
      wrapper = await mountComponent();

      deleteSourceMapsMock.mockRejectedValueOnce(new Error("plain failure"));
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const target = (wrapper.vm as any).groupedSourceMaps[0];
      (wrapper.vm as any).confirmDeleteSourceMap(target);
      await nextTick();

      await (wrapper.vm as any).deleteSourceMap();
      await flushPromises();

      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "negative",
          message: "plain failure",
        }),
      );
      consoleErrorSpy.mockRestore();
    });

    it("uses default failure message when no error info available", async () => {
      wrapper = await mountComponent();

      // Reject with an object that has neither response nor message
      deleteSourceMapsMock.mockRejectedValueOnce({});
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const target = (wrapper.vm as any).groupedSourceMaps[0];
      (wrapper.vm as any).confirmDeleteSourceMap(target);
      await nextTick();

      await (wrapper.vm as any).deleteSourceMap();
      await flushPromises();

      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "negative",
          message: "Failed to delete source maps",
        }),
      );
      consoleErrorSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // Upload navigation
  // -------------------------------------------------------------------------
  describe("Navigation", () => {
    it("navigateToUpload pushes to UploadSourceMaps route with org_identifier", async () => {
      wrapper = await mountComponent();

      const pushSpy = vi.spyOn(router, "push").mockResolvedValue(undefined);

      (wrapper.vm as any).navigateToUpload();

      expect(pushSpy).toHaveBeenCalledWith({
        name: "UploadSourceMaps",
        query: { org_identifier: "test-org" },
      });
    });
  });

  // -------------------------------------------------------------------------
  // Table columns
  // -------------------------------------------------------------------------
  describe("Table columns", () => {
    it("defines all required column names in order", async () => {
      wrapper = await mountComponent();

      const names = (wrapper.vm as any).columns.map((c: any) => c.name);
      expect(names).toEqual([
        "expand",
        "service",
        "version",
        "environment",
        "file_count",
        "uploaded_at",
        "actions",
      ]);
    });

    it("uploaded_at format converts microseconds to a date string", async () => {
      wrapper = await mountComponent();

      const uploadedCol = (wrapper.vm as any).columns.find(
        (c: any) => c.name === "uploaded_at",
      );
      const formatted = uploadedCol.format(1700000000000000);

      // Should produce a non-empty, non-default value
      expect(typeof formatted).toBe("string");
      expect(formatted).not.toBe("-");
    });

    it("uploaded_at format returns '-' for falsy values", async () => {
      wrapper = await mountComponent();

      const uploadedCol = (wrapper.vm as any).columns.find(
        (c: any) => c.name === "uploaded_at",
      );
      expect(uploadedCol.format(0)).toBe("-");
      expect(uploadedCol.format(null)).toBe("-");
    });
  });
});
