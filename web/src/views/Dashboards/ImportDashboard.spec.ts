import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import ImportDashboard from "./ImportDashboard.vue";
import { createStore } from "vuex";
import { createRouter, createWebHistory } from "vue-router";
import { createI18n } from "vue-i18n";
import enLocaleFull from "@/locales/languages/en-US.json";
import analytics from "@/services/product_analytics";

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

// Mock external dependencies
vi.mock("@/utils/commons", async () => {
  const actual: any = await vi.importActual("@/utils/commons");
  return {
    getAllDashboards: vi.fn(),
    getFoldersList: vi.fn(),
    dedupeDashboardIds: actual.dedupeDashboardIds,
  };
});

vi.mock("@/services/dashboards", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      create: vi.fn(),
    },
  });
});

vi.mock("@/composables/useNotifications", () => ({
  default: vi.fn(() => ({
    showErrorNotification: vi.fn(),
    showPositiveNotification: vi.fn(),
  })),
}));

vi.mock("@/utils/dashboard/convertDashboardSchemaVersion", () => ({
  convertDashboardSchemaVersion: vi.fn((dashboard) => dashboard),
}));

vi.mock("@/utils/dashboard/panelValidation", () => ({
  validateDashboardJson: vi.fn(() => []),
}));

vi.mock("@/components/dashboards/SelectFolderDropdown.vue", () => ({
  default: {
    name: "SelectFolderDropdown",
    template: '<div data-test="select-folder-dropdown"></div>',
  },
}));

vi.mock("@/components/common/AppTabs.vue", () => ({
  default: {
    name: "AppTabs",
    template: '<div data-test="app-tabs"></div>',
  },
}));

vi.mock("@/components/CodeQueryEditor.vue", async () => {
  const { defineComponent } = await import("vue");
  const component = defineComponent({
    name: "QueryEditor",
    template: '<div data-test="query-editor"></div>',
  });

  return {
    default: component,
  };
});

// Mock axios
vi.mock("axios", () => ({
  default: {
    get: vi.fn(),
  },
}));

// Mock vue-router
const mockRouterPush = vi.fn();
vi.mock("vue-router", async () => {
  const actual = await vi.importActual("vue-router");
  return {
    ...actual,
    useRoute: vi.fn(() => ({
      query: {
        folder: "default",
      },
      params: {},
    })),
    useRouter: vi.fn(() => ({
      push: mockRouterPush,
    })),
  };
});

const createMockStore = () => {
  return createStore({
    state: {
      selectedOrganization: {
        identifier: "test-org",
      },
      organizationData: {
        folders: [
          {
            folderId: "default",
            name: "default",
          },
        ],
      },
      userInfo: {
        name: "test-user",
      },
    },
  });
};

const createMockRouter = () => {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: "/", component: { template: "<div>Home</div>" } },
      { path: "/dashboards", component: { template: "<div>Dashboards</div>" } },
    ],
  });
};

const createMockI18n = () => {
  return createI18n({
    locale: "en",
    messages: { en: enLocaleFull },
  });
};

describe("ImportDashboard.vue", () => {
  let wrapper: any;
  let store: any;
  let router: any;
  let i18n: any;

  beforeEach(async () => {
    store = createMockStore();
    router = createMockRouter();
    i18n = createMockI18n();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  const mountComponent = (options = {}) => {
    return mount(ImportDashboard, {
      global: {
        plugins: [store, router, i18n],
        stubs: {
          // Stub QueryEditor component properly
          QueryEditor: {
            name: "QueryEditor",
            template: '<div data-test="query-editor" class="query-editor"><slot /></div>',
            props: ["debounceTime", "language", "editorId", "query"],
            emits: ["update:query"],
          },
        },
      },
      ...options,
    });
  };

  it("should call goBack function and navigate to dashboards", async () => {
    wrapper = mountComponent();
    await nextTick();

    // Clear any previous calls
    mockRouterPush.mockClear();

    // Call goBack method directly to test the function
    await wrapper.vm.goBack();

    expect(mockRouterPush).toHaveBeenCalledWith({
      path: "/dashboards",
      query: {
        org_identifier: "test-org",
        folder: "default",
      },
    });
  });

  it("should open community dashboards in a new window", async () => {
    // Mock window.open
    const mockWindowOpen = vi.fn();
    Object.defineProperty(window, "open", {
      value: mockWindowOpen,
      writable: true,
    });

    wrapper = mountComponent();
    await nextTick();

    // Call goToCommunityDashboards method directly
    wrapper.vm.goToCommunityDashboards();

    expect(mockWindowOpen).toHaveBeenCalledWith(
      "https://github.com/openobserve/dashboards",
      "_blank",
    );
  });

  it("should reset form data when switching tabs", async () => {
    wrapper = mountComponent();
    await flushPromises();

    // url/jsonFiles are now form-owned (rule ②); set them via the form so the
    // read-only projection refs stay coherent.
    wrapper.vm.jsonStr = '{"test": "data"}';
    wrapper.vm.form.setFieldValue("jsonFiles", [{ name: "test.json" }]);
    wrapper.vm.form.setFieldValue("url", "http://example.com");
    await flushPromises();

    // Call updateActiveTab
    wrapper.vm.updateActiveTab();
    await flushPromises();

    // Verify all fields are reset
    expect(wrapper.vm.jsonStr).toBe("");
    expect(wrapper.vm.jsonFiles).toBe(null);
    expect(wrapper.vm.url).toBe("");
  });

  it("should test jsonStr watcher - valid JSON string", async () => {
    wrapper = mountComponent();
    await nextTick();

    const testJson = '{"title": "Test Dashboard", "panels": []}';

    // Test the jsonStr watcher directly
    wrapper.vm.jsonStr = testJson;
    await nextTick();

    // Should format the JSON
    expect(wrapper.vm.jsonStr).toBe(JSON.stringify(JSON.parse(testJson), null, 2));
  });

  it("should test jsonStr watcher - empty string resets other fields", async () => {
    wrapper = mountComponent();
    await flushPromises();

    // url is form-owned (rule ②) — set via the form.
    wrapper.vm.form.setFieldValue("url", "http://example.com");
    await flushPromises();

    // The jsonStr watcher only resets when newVal == "" (exactly empty string)
    wrapper.vm.jsonStr = '{"test": "data"}';
    await nextTick();

    // Now set to empty string to trigger the reset logic
    wrapper.vm.jsonStr = "";
    await flushPromises();

    // The watcher clears the form-owned url/jsonFiles → projected to the refs
    expect(wrapper.vm.url).toBe("");
    expect(wrapper.vm.jsonFiles).toBe(null);
  });

  it("should validate dashboard with missing title through importDashboard", async () => {
    wrapper = mountComponent();
    await nextTick();

    const dashboard = { title: "", panels: [] };
    wrapper.vm.jsonStr = JSON.stringify(dashboard);
    wrapper.vm.activeTab = "import_json_file";

    // Call importDashboard which will trigger validation
    wrapper.vm.importDashboard();

    // Should add error for missing title
    expect(wrapper.vm.dashboardErrorsToDisplay.length).toBe(1);
    expect(wrapper.vm.dashboardErrorsToDisplay[0].field).toBe("dashboard_title");
    expect(wrapper.vm.dashboardErrorsToDisplay[0].message).toContain("Title is required");
  });

  it("should validate dashboard with non-string title through importDashboard", async () => {
    wrapper = mountComponent();
    await nextTick();

    const dashboard = { title: 123, panels: [] };
    wrapper.vm.jsonStr = JSON.stringify(dashboard);
    wrapper.vm.activeTab = "import_json_file";

    // Call importDashboard which will trigger validation
    wrapper.vm.importDashboard();

    // Should add error for invalid title type
    expect(wrapper.vm.dashboardErrorsToDisplay.length).toBe(1);
    expect(wrapper.vm.dashboardErrorsToDisplay[0].field).toBe("dashboard_title");
    expect(wrapper.vm.dashboardErrorsToDisplay[0].message).toContain("should be a string");
  });

  it("should test updateDashboardTitle with array JSON", async () => {
    wrapper = mountComponent();
    await nextTick();

    const dashboards = [{ title: "Old Title 1" }, { title: "Old Title 2" }];

    wrapper.vm.jsonStr = JSON.stringify(dashboards);

    // Update first dashboard title
    wrapper.vm.updateDashboardTitle("New Title", 0);

    const updatedJson = JSON.parse(wrapper.vm.jsonStr);
    expect(updatedJson[0].title).toBe("New Title");
    expect(updatedJson[1].title).toBe("Old Title 2");
  });

  it("should test updateDashboardTitle with single object JSON", async () => {
    wrapper = mountComponent();
    await nextTick();

    const dashboard = { title: "Old Title" };
    wrapper.vm.jsonStr = JSON.stringify(dashboard);

    // Update dashboard title
    wrapper.vm.updateDashboardTitle("New Title", 0);

    const updatedJson = JSON.parse(wrapper.vm.jsonStr);
    expect(updatedJson.title).toBe("New Title");
  });

  it("should test updateStreamType with array JSON", async () => {
    wrapper = mountComponent();
    await nextTick();

    const dashboards = [
      {
        title: "Test",
        tabs: [
          {
            panels: [
              {
                queries: [
                  {
                    fields: { stream_type: "logs" },
                  },
                ],
              },
            ],
          },
        ],
      },
    ];

    wrapper.vm.jsonStr = JSON.stringify(dashboards);

    // Update stream type
    wrapper.vm.updateStreamType("metrics", 0, 0, 0, 0);

    const updatedJson = JSON.parse(wrapper.vm.jsonStr);
    expect(updatedJson[0].tabs[0].panels[0].queries[0].fields.stream_type).toBe("metrics");
  });

  it("should test all template conditional rendering branches", async () => {
    wrapper = mountComponent();
    await nextTick();

    // Test query editor placeholder flag changes
    expect(wrapper.vm.queryEditorPlaceholderFlag).toBe(true);

    // Test loading state
    wrapper.vm.isLoading = "files";
    await nextTick();
    expect(wrapper.vm.isLoading).toBe("files");

    // Test splitter model
    expect(wrapper.vm.splitterModel).toBe(60);

    // Test stream type options
    expect(wrapper.vm.streamTypeOptions).toEqual([
      "logs",
      "metrics",
      "traces",
      "enrichment_tables",
    ]);
  });

  // Real-OForm validation wiring (playbook §5): the OForm covers only the
  // url/jsonFiles input collection. The URL-format rule is the one field check
  // (non-required, so the paste-JSON flow is preserved).
  describe("Import OForm (real form)", () => {
    const submitForm = async (w: any) => {
      await w.vm.form.handleSubmit();
      await nextTick();
    };

    it("rejects a URL without an http(s) protocol", async () => {
      wrapper = mountComponent();
      await nextTick();
      wrapper.vm.form.setFieldValue("url", "ftp://example.com");
      await submitForm(wrapper);

      expect(wrapper.vm.form.state.isValid).toBe(false);
    });

    it("accepts a valid http(s) URL", async () => {
      wrapper = mountComponent();
      await nextTick();
      wrapper.vm.form.setFieldValue("url", "https://example.com/dash.json");
      await submitForm(wrapper);

      expect(wrapper.vm.form.state.isValid).toBe(true);
    });

    it("treats an empty URL as valid (URL is non-required; JSON paste allowed)", async () => {
      wrapper = mountComponent();
      await nextTick();
      wrapper.vm.form.setFieldValue("url", "");
      await submitForm(wrapper);

      expect(wrapper.vm.form.state.isValid).toBe(true);
    });
  });

  describe("import id uniqueness", () => {
    it("dedupes duplicate panel ids and layout ids on import (before create)", async () => {
      const dashboardService = (await import("@/services/dashboards")).default;
      (dashboardService.create as any).mockResolvedValue({ data: { dashboardId: "d1" } });

      wrapper = mountComponent();
      await nextTick();

      wrapper.vm.jsonStr = JSON.stringify({
        title: "Dup Dashboard",
        tabs: [
          {
            tabId: "tab-1",
            panels: [
              { id: "panel-1", layout: { x: 0, y: 0, w: 24, h: 9, i: 1 } },
              { id: "panel-1", layout: { x: 0, y: 0, w: 24, h: 9, i: 1 } },
            ],
          },
        ],
      });

      await wrapper.vm.importFromJsonStr();
      await flushPromises();

      // migrateSchema dedupes after schema migration and before validation,
      // so the dashboard reaching create has unique panel ids and layout ids.
      expect(dashboardService.create).toHaveBeenCalledTimes(1);
      const sentDashboard = (dashboardService.create as any).mock.calls[0][1];
      const panels = sentDashboard.tabs[0].panels;
      expect(new Set(panels.map((p: any) => p.id)).size).toBe(panels.length);
      expect(new Set(panels.map((p: any) => p.layout.i)).size).toBe(panels.length);
    });
  });

  describe("product analytics", () => {
    const dashboard = { title: "Imported", tabs: [{ tabId: "t1", panels: [] }] };

    it("tracks one dashboard_imported with source json for pasted JSON", async () => {
      const dashboardService = (await import("@/services/dashboards")).default;
      (dashboardService.create as any).mockResolvedValue({ data: {} });
      wrapper = mountComponent();
      await nextTick();
      wrapper.vm.jsonStr = JSON.stringify(dashboard);

      await wrapper.vm.importFromJsonStr();
      await flushPromises();

      expect(analytics.track).toHaveBeenCalledWith("dashboard_created");
      expect(analytics.track).toHaveBeenCalledWith("dashboard_imported", {
        source: "json",
        count: 1,
      });
    });

    it("tracks one dashboard_imported counting every dashboard of a URL import", async () => {
      const dashboardService = (await import("@/services/dashboards")).default;
      (dashboardService.create as any)
        .mockResolvedValueOnce({ data: {} })
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValueOnce({ data: {} });
      wrapper = mountComponent();
      await nextTick();
      wrapper.vm.activeTab = "import_json_url";
      wrapper.vm.form.setFieldValue("url", "https://example.com/d.json");
      await flushPromises();
      wrapper.vm.jsonStr = JSON.stringify([dashboard, dashboard, dashboard]);

      await wrapper.vm.importFromUrl();
      await flushPromises();

      const imported = vi
        .mocked(analytics.track)
        .mock.calls.filter((c) => c[0] === "dashboard_imported");
      expect(imported).toEqual([["dashboard_imported", { source: "url", count: 2 }]]);
    });

    it("tracks one dashboard_imported counting every dashboard across uploaded files", async () => {
      const dashboardService = (await import("@/services/dashboards")).default;
      (dashboardService.create as any).mockResolvedValue({ data: {} });
      const content = JSON.stringify([[dashboard, dashboard], dashboard]);
      wrapper = mountComponent();
      await nextTick();
      wrapper.vm.form.setFieldValue("jsonFiles", [
        new File([content], "a.json", { type: "application/json" }),
        new File([content], "b.json", { type: "application/json" }),
      ]);
      await flushPromises();
      wrapper.vm.jsonStr = content;

      await wrapper.vm.importFiles();
      await flushPromises();

      const imported = vi
        .mocked(analytics.track)
        .mock.calls.filter((c) => c[0] === "dashboard_imported");
      expect(imported).toEqual([["dashboard_imported", { source: "file", count: 3 }]]);
      expect(analytics.track).toHaveBeenCalledTimes(4);
    });

    it("still tracks dashboard_imported when the refresh after a confirmed create fails", async () => {
      const dashboardService = (await import("@/services/dashboards")).default;
      const { getAllDashboards } = await import("@/utils/commons");
      (dashboardService.create as any).mockResolvedValue({ data: {} });
      (getAllDashboards as any).mockRejectedValueOnce(new Error("refresh failed"));
      wrapper = mountComponent();
      await nextTick();
      wrapper.vm.jsonStr = JSON.stringify(dashboard);

      await wrapper.vm.importFromJsonStr();
      await flushPromises();

      expect(analytics.track).toHaveBeenCalledWith("dashboard_imported", {
        source: "json",
        count: 1,
      });
    });

    it("does not track dashboard_imported when create rejects", async () => {
      const dashboardService = (await import("@/services/dashboards")).default;
      (dashboardService.create as any).mockRejectedValue(new Error("boom"));
      wrapper = mountComponent();
      await nextTick();
      wrapper.vm.jsonStr = JSON.stringify(dashboard);

      await wrapper.vm.importFromJsonStr();
      await flushPromises();

      expect(analytics.track).not.toHaveBeenCalled();
    });
  });
});
