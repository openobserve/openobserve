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

// Mock toast so notification tests can verify calls
const toastMock = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: any[]) => toastMock(...args),
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
  stubs: {
    OSelect: {
      name: "OSelect",
      props: ["modelValue", "options", "label", "clearable", "searchable", "creatable"],
      emits: ["update:modelValue"],
      template: '<div data-test-stub="o-select" :data-label="label"></div>',
    },
    OSeparator: { template: '<hr data-test-stub="o-separator" />' },
    OIcon: true,
    OTable: {
      name: "OTable",
      props: ["data", "columns", "rowKey", "pagination", "pageSize", "loading"],
      emits: ["update:expandedIds"],
      template:
        '<div data-test-stub="o-table" :data-rows="data ? data.length : 0"><slot name="empty" /></div>',
    },
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
    OSpinner: { template: '<div data-test-stub="o-spinner" />' },
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
    toastMock.mockReset();

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

      expect((wrapper.vm as any).filteredVersionOptions).toEqual(["1.0.0", "2.0.0"]);
      expect((wrapper.vm as any).filteredServiceOptions).toEqual(["svc-a", "svc-b"]);
      expect((wrapper.vm as any).filteredEnvironmentOptions).toEqual(["prod", "dev"]);
    });

    it("handles getSourceMapsValues failure by leaving filter options empty", async () => {
      getSourceMapsValuesMock.mockRejectedValueOnce(new Error("boom"));
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      wrapper = await mountComponent();

      expect((wrapper.vm as any).filteredVersionOptions).toEqual([]);
      expect((wrapper.vm as any).filteredServiceOptions).toEqual([]);
      expect((wrapper.vm as any).filteredEnvironmentOptions).toEqual([]);
      consoleErrorSpy.mockRestore();
    });

    it("handles listSourceMaps failure by clearing source maps", async () => {
      listSourceMapsMock.mockRejectedValueOnce(new Error("network"));
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

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

      const groupA = grouped.find((g: any) => g.service === "svc-a" && g.version === "1.0.0");
      expect(groupA.fileCount).toBe(2);
      expect(groupA.files).toHaveLength(2);

      const groupB = grouped.find((g: any) => g.service === "svc-b" && g.version === "2.0.0");
      expect(groupB.fileCount).toBe(1);
    });

    it("retains the most recent created_at as uploaded_at for a group", async () => {
      wrapper = await mountComponent();

      const groupA = (wrapper.vm as any).groupedSourceMaps.find((g: any) => g.service === "svc-a");
      expect(groupA.uploaded_at).toBe(1700000001000000);
    });

    it("returns empty grouped list when response.data is empty", async () => {
      listSourceMapsMock.mockResolvedValueOnce({ data: [] });

      wrapper = await mountComponent();

      expect((wrapper.vm as any).groupedSourceMaps).toEqual([]);
      expect((wrapper.vm as any).groupedSourceMaps.length).toBe(0);
    });

    it("groupedSourceMaps length reflects the number of distinct service-version-env groups", async () => {
      wrapper = await mountComponent();

      // 3 items → 2 distinct groups (svc-a/1.0.0/prod and svc-b/2.0.0/dev)
      expect((wrapper.vm as any).groupedSourceMaps.length).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Conditional rendering branches
  // -------------------------------------------------------------------------
  describe("Conditional rendering", () => {
    it("shows loading spinner while isLoading is true", async () => {
      // The component delegates loading display entirely to OTable via the
      // :loading prop — there is no separate standalone loading indicator.
      // Capture the loading state mid-fetch by using a deferred listSourceMaps.
      let resolveFetch!: (value: any) => void;
      listSourceMapsMock.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
      );

      const w = mount(SourceMaps, {
        global: buildGlobalConfig(store, router, i18n),
      });

      // Flush getSourceMapsValuesMock (resolves immediately) so that
      // fetchSourceMaps() has been invoked and isLoading is now true.
      // The deferred listSourceMapsMock keeps isLoading = true.
      await flushPromises();

      const table = w.findComponent({ name: "OTable" });
      expect(table.exists()).toBe(true);
      expect(table.props("loading")).toBe(true);

      // Resolve the deferred fetch so the component finishes mounting cleanly.
      resolveFetch({ data: sampleSourceMaps });
      await flushPromises();

      expect(table.props("loading")).toBe(false);
      w.unmount();
    });

    it("shows the empty state when no source maps exist and not loading", async () => {
      listSourceMapsMock.mockResolvedValueOnce({ data: [] });

      wrapper = await mountComponent();

      // OTable is always rendered; when data is empty it renders #empty slot with OEmptyState.
      // The i18n keys are not translated in the test environment, so we verify the
      // empty state component is rendered rather than checking for translated text.
      expect(wrapper.find('[data-test-stub="o-table"]').exists()).toBe(true);
      expect(wrapper.find('[data-test-stub="o-table"]').text()).toContain("emptyState");
    });

    it("shows OTable when grouped source maps exist", async () => {
      wrapper = await mountComponent();

      expect(wrapper.find('[data-test-stub="o-table"]').exists()).toBe(true);
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
  // Row expansion — OTable handles expansion via expandedIds ref
  // -------------------------------------------------------------------------
  describe("Row expansion", () => {
    it("grouped rows have composite id field used as row key", async () => {
      wrapper = await mountComponent();

      const groupA = (wrapper.vm as any).groupedSourceMaps.find((g: any) => g.service === "svc-a");
      expect(groupA.id).toBe("svc-a-1.0.0-prod");
    });

    it("expandedIds starts empty", async () => {
      wrapper = await mountComponent();

      expect((wrapper.vm as any).expandedIds).toEqual([]);
    });

    it("expanding a row by adding its id to expandedIds works", async () => {
      wrapper = await mountComponent();

      (wrapper.vm as any).expandedIds = ["svc-a-1.0.0-prod"];
      expect((wrapper.vm as any).expandedIds).toContain("svc-a-1.0.0-prod");
    });

    it("collapsing a row by removing its id from expandedIds works", async () => {
      wrapper = await mountComponent();

      (wrapper.vm as any).expandedIds = ["svc-a-1.0.0-prod"];
      (wrapper.vm as any).expandedIds = [];
      expect((wrapper.vm as any).expandedIds).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Pagination — OTable uses selectedPerPage ref directly
  // -------------------------------------------------------------------------
  describe("Pagination", () => {
    it("selectedPerPage defaults to 20", async () => {
      wrapper = await mountComponent();

      expect((wrapper.vm as any).selectedPerPage).toBe(20);
    });

    it("updating selectedPerPage changes the page size", async () => {
      wrapper = await mountComponent();

      (wrapper.vm as any).selectedPerPage = 50;
      expect((wrapper.vm as any).selectedPerPage).toBe(50);
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
      expect(dialog.props("primaryButtonLabel")).toBe("common.ok");
      expect(dialog.props("secondaryButtonLabel")).toBe("common.cancel");
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

      const target = (wrapper.vm as any).groupedSourceMaps.find((g: any) => g.service === "svc-a");
      (wrapper.vm as any).confirmDeleteSourceMap(target);
      await nextTick();

      await (wrapper.vm as any).deleteSourceMap();
      await flushPromises();

      expect((wrapper.vm as any).groupedSourceMaps).toHaveLength(1);
      expect(
        (wrapper.vm as any).groupedSourceMaps.find((g: any) => g.service === "svc-a"),
      ).toBeUndefined();
    });

    it("fires a success toast on successful delete", async () => {
      wrapper = await mountComponent();

      const target = (wrapper.vm as any).groupedSourceMaps[0];
      (wrapper.vm as any).confirmDeleteSourceMap(target);
      await nextTick();

      await (wrapper.vm as any).deleteSourceMap();
      await flushPromises();

      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
    });

    it("fires an error toast with server message on delete failure", async () => {
      wrapper = await mountComponent();

      deleteSourceMapsMock.mockRejectedValueOnce({
        response: { data: { message: "Server rejected" } },
      });
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const target = (wrapper.vm as any).groupedSourceMaps[0];
      (wrapper.vm as any).confirmDeleteSourceMap(target);
      await nextTick();

      await (wrapper.vm as any).deleteSourceMap();
      await flushPromises();

      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: "Server rejected",
        }),
      );
      consoleErrorSpy.mockRestore();
    });

    it("falls back to error.message when server response has no data.message", async () => {
      wrapper = await mountComponent();

      deleteSourceMapsMock.mockRejectedValueOnce(new Error("plain failure"));
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const target = (wrapper.vm as any).groupedSourceMaps[0];
      (wrapper.vm as any).confirmDeleteSourceMap(target);
      await nextTick();

      await (wrapper.vm as any).deleteSourceMap();
      await flushPromises();

      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: "plain failure",
        }),
      );
      consoleErrorSpy.mockRestore();
    });

    it("uses default failure message when no error info available", async () => {
      wrapper = await mountComponent();

      // Reject with an object that has neither response nor message
      deleteSourceMapsMock.mockRejectedValueOnce({});
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const target = (wrapper.vm as any).groupedSourceMaps[0];
      (wrapper.vm as any).confirmDeleteSourceMap(target);
      await nextTick();

      await (wrapper.vm as any).deleteSourceMap();
      await flushPromises();

      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
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
    it("defines all required column ids in order", async () => {
      wrapper = await mountComponent();

      const ids = (wrapper.vm as any).columns.map((c: any) => c.id);
      expect(ids).toEqual([
        "service",
        "version",
        "environment",
        "file_count",
        "uploaded_at",
        "actions",
      ]);
    });

    it("formatTimestamp converts microseconds to a date string", async () => {
      wrapper = await mountComponent();

      // formatTimestamp is exposed on the component instance
      const formatted = (wrapper.vm as any).formatTimestamp(1700000000000000);

      expect(typeof formatted).toBe("string");
      expect(formatted).not.toBe("-");
    });

    it("formatTimestamp returns '-' for falsy values", async () => {
      wrapper = await mountComponent();

      expect((wrapper.vm as any).formatTimestamp(0)).toBe("-");
      expect((wrapper.vm as any).formatTimestamp(null)).toBe("-");
    });
  });
});
