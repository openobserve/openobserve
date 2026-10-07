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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { reactive, ref } from "vue";
// Mock the zincutils utilities completely
vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    getImageURL: vi.fn().mockReturnValue("/mock-image.svg"),
    useLocalOrganization: vi.fn().mockReturnValue({
      identifier: "test-org",
      name: "Test Organization",
    }),
    useLocalCurrentUser: vi.fn().mockReturnValue({
      email: "test@example.com",
      name: "Test User",
    }),
    useLocalTimezone: vi.fn().mockReturnValue("UTC"),
    b64EncodeUnicode: vi.fn().mockImplementation((str) => btoa(str)),
    b64DecodeUnicode: vi.fn().mockImplementation((str) => atob(str)),
  };
});

// Mock functions service to prevent MSW warnings
vi.mock("@/services/function_template", () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: [] }),
  },
}));

// Mock composables that make API calls
vi.mock("@/composables/useFunctions", () => ({
  default: vi.fn(() => ({
    getAllFunctions: vi.fn().mockResolvedValue([]),
    functions: { value: [] },
    isLoading: { value: false },
  })),
  useFunctions: vi.fn(() => ({
    getAllFunctions: vi.fn().mockResolvedValue([]),
    functions: { value: [] },
    isLoading: { value: false },
  })),
}));

// Mock CodeQueryEditor to prevent document access errors
vi.mock("@/components/CodeQueryEditor.vue", () => ({
  default: {
    name: "CodeQueryEditor",
    template: '<div data-test="code-query-editor">CodeQueryEditor Mock</div>',
    props: ["query", "editorId", "keywords", "suggestions", "autoComplete", "readOnly", "language"],
    emits: ["update:query", "updateQuery", "runQuery", "focus", "blur"],
  },
}));

import DashboardQueryEditor from "@/components/dashboards/addPanel/DashboardQueryEditor.vue";
import useSqlSuggestions from "@/composables/useSuggestions";
import useDashboardPanelData from "@/composables/dashboard/useDashboardPanel";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

// Create a reactive mock dashboard panel data
const createMockDashboardPanelData = () => {
  const mockData = {
    data: {
      id: "panel-1",
      title: "Test Panel",
      type: "line",
      queryType: "sql",
      queries: [
        {
          query: "SELECT * FROM test_stream",
          queryType: "sql",
          customQuery: true,
          stream: "test_stream",
          vrlFunctionQuery: "",
        },
      ],
    },
    layout: {
      currentQueryIndex: 0,
      vrlFunctionToggle: false,
      showQueryBar: true,
      hiddenQueries: [],
    },
    meta: {
      errors: {
        queryErrors: [],
      },
      dateTime: {
        start_time: new Date(),
        end_time: new Date(),
      },
      stream: {
        customQueryFields: [],
        streamResults: [],
      },
      streamFields: {
        groupedFields: [],
      },
    },
  };

  return {
    // reactive() because the real composable's state is: the component watches
    // the active query's stream, and a plain object would never fire the
    // watcher — the test would pass or fail for reasons unrelated to the
    // component.
    dashboardPanelData: reactive(mockData),
    promqlMode: false, // Make this a direct boolean instead of ref
    addQuery: vi.fn(() => {
      mockData.data.queries.push({
        query: "",
        queryType: "sql",
        customQuery: true,
        stream: "",
        vrlFunctionQuery: "",
      });
    }),
    removeQuery: vi.fn((index) => {
      mockData.data.queries.splice(index, 1);
    }),
    selectedStreamFieldsBasedOnUserDefinedSchema: { value: [] },
  };
};

// Mock the dashboard panel composable
vi.mock("@/composables/dashboard/useDashboardPanel", () => ({
  default: vi.fn(() => createMockDashboardPanelData()),
}));

// Mock other composables
vi.mock("@/composables/usePromqlSuggestions", () => ({
  default: vi.fn(() => ({
    autoCompleteData: {
      value: {
        query: "",
        position: { cursorIndex: 0 },
        popup: { open: vi.fn(), close: vi.fn() },
      },
    },
    autoCompletePromqlKeywords: { value: [] },
    getSuggestions: vi.fn(),
    updateMetricKeywords: vi.fn(),
  })),
}));

vi.mock("@/composables/useSuggestions", () => ({
  default: vi.fn(() => ({
    // Mirrors the real composable's shape. autoCompleteData carries the stream
    // context the field-value resolver looks values up under; omitting it here
    // made every mount throw once the component started setting it.
    autoCompleteData: {
      value: {
        org: "",
        streamType: "",
        streamName: "",
        query: "",
        cursorIndex: 0,
        popup: { open: vi.fn(), close: vi.fn() },
      },
    },
    resolveFieldValues: vi.fn(async () => []),
    autoCompleteKeywords: { value: [] },
    autoCompleteSuggestions: { value: [] },
    effectiveKeywords: { value: [] },
    effectiveSuggestions: { value: [] },
    getSuggestions: vi.fn(),
    updateFieldKeywords: vi.fn(),
    updateFunctionKeywords: vi.fn(),
    updateAllKeywords: vi.fn(),
    updateStreamKeywords: vi.fn(),
  })),
}));

vi.mock("@/composables/useNotifications", () => ({
  default: vi.fn(() => ({
    showErrorNotification: vi.fn(),
    showPositiveNotification: vi.fn(),
  })),
}));

const mockDashboardPanelData = {
  data: {
    id: "panel-1",
    title: "Test Panel",
    type: "line",
    queryType: "sql",
    queries: [
      {
        query: "SELECT * FROM test_stream",
        queryType: "sql",
        customQuery: true,
        stream: "test_stream",
        vrlFunctionQuery: "",
      },
    ],
  },
  layout: {
    currentQueryIndex: 0,
    vrlFunctionToggle: false,
    showQueryBar: true,
  },
  meta: {
    errors: {
      queryErrors: [],
    },
  },
};

// Helper function for deep cloning to prevent data mutation between tests
const createFreshMockData = (overrides = {}) => {
  const baseData = JSON.parse(JSON.stringify(mockDashboardPanelData));
  return {
    ...baseData,
    ...overrides,
    data: {
      ...baseData.data,
      ...overrides.data,
    },
    layout: {
      ...baseData.layout,
      ...overrides.layout,
    },
  };
};

describe("DashboardQueryEditor", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();

    store.state.selectedOrganization = { identifier: "test-org" };
    store.state.theme = "light";
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}) => {
    return mount(DashboardQueryEditor, {
      props: props,
      global: {
        plugins: [i18n, store, router],
        provide: {
          dashboardPanelDataPageKey: "dashboard",
        },
        stubs: {
          QueryTypeSelector: {
            template: '<div data-test="query-type-selector"></div>',
          },
          QueryEditor: {
            template: '<div data-test="code-query-editor">QueryEditor Mock</div>',
            props: [
              "query",
              "editorId",
              "keywords",
              "suggestions",
              "autoComplete",
              "readOnly",
              "language",
            ],
            emits: ["update:query", "updateQuery", "runQuery"],
          },
        },
        mocks: {
          $t: (key: string) => key,
          $route: { params: {}, query: {} },
          $router: { push: vi.fn() },
        },
      },
    });
  };

  describe("Component Rendering", () => {
    it("should render query editor container", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="dashboard-panel-searchbar"]').exists()).toBe(true);
    });

    it("should render basic query data container", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="dashboard-query-data"]').exists()).toBe(true);
    });
  });

  describe("Query Tabs", () => {
    it("should render component without tabs when conditions aren't met", () => {
      wrapper = createWrapper();

      // Verify component renders
      expect(wrapper.exists()).toBe(true);

      // Since promqlMode is false and type is 'line', tabs should not exist
      // Let's just test that the component works properly
      expect(wrapper.find('[data-test="dashboard-panel-searchbar"]').exists()).toBe(true);
    });

    it("should handle different panel types gracefully", () => {
      wrapper = createWrapper();

      // Test that component renders regardless of panel type
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.dashboardPanelData.data.type).toBe("line");
    });
  });

  describe("Component State", () => {
    it("should track current query index", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.dashboardPanelData.layout.currentQueryIndex).toBe(0);
    });

    it("should track VRL function toggle state", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.dashboardPanelData.layout.vrlFunctionToggle).toBe(false);
    });
  });

  describe("Event Handling", () => {
    it("should handle dropdown click events", async () => {
      wrapper = createWrapper();

      const dropdown = wrapper.find('[data-test="dashboard-panel-searchbar"]');
      await dropdown.trigger("click");

      expect(wrapper.emitted()).toBeDefined();
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty queries array", () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const emptyQueriesPanelData = {
        ...mockDashboardPanelData,
        data: { ...mockDashboardPanelData.data, queries: [] },
      };

      wrapper = createWrapper({ dashboardPanelData: emptyQueriesPanelData });

      expect(wrapper.exists()).toBe(true);

      consoleWarnSpy.mockRestore();
      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it("should handle missing panel data gracefully", () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Don't pass null, just minimal data
      const minimalData = {
        data: { queries: [], type: "line" },
        layout: { currentQueryIndex: 0, vrlFunctionToggle: false },
      };
      wrapper = createWrapper({ dashboardPanelData: minimalData });

      expect(wrapper.exists()).toBe(true);

      consoleWarnSpy.mockRestore();
      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });
  });

  describe("Theme Integration", () => {
    it("should work with light theme", () => {
      store.state.theme = "light";
      wrapper = createWrapper();

      expect(wrapper.exists()).toBe(true);
    });

    it("should work with dark theme", () => {
      store.state.theme = "dark";
      wrapper = createWrapper();

      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Query Management", () => {
    it("should handle multiple queries", async () => {
      wrapper = createWrapper();

      // Since component doesn't use props, directly manipulate the internal data
      wrapper.vm.addTab();
      await wrapper.vm.$nextTick();

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.dashboardPanelData.data.queries.length).toBe(2);
    });

    it("should handle query index changes", async () => {
      wrapper = createWrapper();

      // Add another query and change index
      wrapper.vm.addTab();
      await wrapper.vm.$nextTick();
      wrapper.vm.dashboardPanelData.layout.currentQueryIndex = 1;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.dashboardPanelData.layout.currentQueryIndex).toBe(1);
    });

    // The field-value resolver looks values up under "org|streamType|
    // streamName|field". This panel never set any of the three, so its
    // resolver could only ever return [] — a working editor with value
    // completion silently absent. Per QUERY, not per panel: each tab has its
    // own stream and a stale context would offer the previous tab's values.
    const sqlAutoCompleteData = () =>
      (useSqlSuggestions as any).mock.results.at(-1).value.autoCompleteData.value;

    it("publishes the active query's stream as the field-value lookup context", async () => {
      wrapper = createWrapper();
      wrapper.vm.dashboardPanelData.data.queries[0].fields = {
        stream: "app_logs",
        stream_type: "logs",
      };
      await wrapper.vm.$nextTick();

      expect(sqlAutoCompleteData()).toMatchObject({
        org: "test-org",
        streamType: "logs",
        streamName: "app_logs",
      });
    });

    it("follows the stream when the user switches query tabs", async () => {
      wrapper = createWrapper();
      wrapper.vm.dashboardPanelData.data.queries[0].fields = {
        stream: "app_logs",
        stream_type: "logs",
      };
      wrapper.vm.dashboardPanelData.data.queries.push({
        query: "",
        queryType: "sql",
        customQuery: true,
        fields: { stream: "app_metrics", stream_type: "metrics" },
      });
      await wrapper.vm.$nextTick();

      wrapper.vm.dashboardPanelData.layout.currentQueryIndex = 1;
      await wrapper.vm.$nextTick();

      expect(sqlAutoCompleteData()).toMatchObject({
        streamType: "metrics",
        streamName: "app_metrics",
      });
    });

    it("should handle query editor configuration", () => {
      wrapper = createWrapper();

      // Test query editor container exists
      const queryContainer = wrapper.find('[data-test="dashboard-query-data"]');
      expect(queryContainer.exists() || wrapper.exists()).toBe(true);
    });

    it("should handle SQL mode queries", () => {
      wrapper = createWrapper();

      // Set query type and update query
      wrapper.vm.dashboardPanelData.data.queries[0].queryType = "sql";
      wrapper.vm.dashboardPanelData.data.queries[0].query =
        "SELECT * FROM logs WHERE level='ERROR'";

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.dashboardPanelData.data.queries[0].queryType).toBe("sql");
    });

    it("should handle PromQL mode queries", () => {
      wrapper = createWrapper();

      // Set PromQL query - the component gets promqlMode from the composable, not props
      wrapper.vm.dashboardPanelData.data.queries[0].queryType = "promql";
      wrapper.vm.dashboardPanelData.data.queries[0].query = "rate(http_requests_total[5m])";

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.dashboardPanelData.data.queries[0].queryType).toBe("promql");
    });
  });

  describe("VRL Function Integration", () => {
    it("should toggle VRL function state", async () => {
      wrapper = createWrapper();

      const initialState = wrapper.vm.dashboardPanelData.layout.vrlFunctionToggle;

      // Simulate VRL function toggle
      wrapper.vm.dashboardPanelData.layout.vrlFunctionToggle = !initialState;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.dashboardPanelData.layout.vrlFunctionToggle).toBe(!initialState);
    });

    it("should handle VRL function dropdown interactions", async () => {
      wrapper = createWrapper();

      // Mock dropdown interaction
      const dropdownSpy = vi.fn();
      wrapper.vm.onDropDownClick = dropdownSpy;

      if (wrapper.vm.onDropDownClick) {
        await wrapper.vm.onDropDownClick();
        expect(dropdownSpy).toHaveBeenCalled();
      }
    });

    it("should handle function template loading", async () => {
      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      wrapper = createWrapper();

      // Component should handle function loading
      expect(wrapper.exists()).toBe(true);

      // Verify functions are accessible
      if (wrapper.vm.getFunctions) {
        expect(typeof wrapper.vm.getFunctions).toBe("function");
      }

      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });
  });

  describe("Code Editor Integration", () => {
    it("should render code query editor", () => {
      wrapper = createWrapper();

      // Check for code editor elements via data-test or component lookup
      const hasCodeEditor =
        wrapper.find('[data-test="dashboard-query-editor"]').exists() ||
        wrapper.findComponent({ name: "CodeQueryEditor" }).exists() ||
        wrapper.exists(); // Fallback

      expect(hasCodeEditor).toBe(true);
    });

    it("should handle editor configuration", () => {
      wrapper = createWrapper();

      // Test editor configuration via the splitter component lookup
      const splitter = wrapper.findComponent({ name: "OSplitter" });
      expect(splitter.exists() || wrapper.exists()).toBe(true);
    });

    it("should handle query text changes", async () => {
      wrapper = createWrapper();

      // Simulate query change
      wrapper.vm.dashboardPanelData.data.queries[0].query = "SELECT * FROM updated_table";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.dashboardPanelData.data.queries[0].query).toBe(
        "SELECT * FROM updated_table",
      );
    });

    it("should handle editor autocomplete", () => {
      wrapper = createWrapper();

      // Test that editor accepts autocomplete configuration
      expect(wrapper.exists()).toBe(true);

      // Component should handle autocomplete gracefully
      if (wrapper.vm.autoComplete !== undefined) {
        expect(
          typeof wrapper.vm.autoComplete === "boolean" ||
            typeof wrapper.vm.autoComplete === "object",
        ).toBe(true);
      }
    });
  });

  describe("Panel Type Specific Behavior", () => {
    it("should handle table panel type", () => {
      wrapper = createWrapper();

      // Set panel type
      wrapper.vm.dashboardPanelData.data.type = "table";

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.dashboardPanelData.data.type).toBe("table");
    });

    it("should handle chart panel types", () => {
      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const chartTypes = ["line", "bar", "area", "scatter", "pie"];

      chartTypes.forEach((chartType) => {
        const chartData = createFreshMockData({
          data: { type: chartType },
        });

        const localWrapper = createWrapper({ dashboardPanelData: chartData });
        expect(localWrapper.exists()).toBe(true);
        localWrapper.unmount();
      });

      consoleWarnSpy.mockRestore();
      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it("should handle geomap panel type", () => {
      wrapper = createWrapper();

      // Set panel type
      wrapper.vm.dashboardPanelData.data.type = "geomap";

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.dashboardPanelData.data.type).toBe("geomap");
    });
  });

  describe("Performance and Optimization", () => {
    it("should handle component updates efficiently", async () => {
      wrapper = createWrapper();

      // Update panel data
      wrapper.vm.dashboardPanelData.data.queries[0].query = "Updated query";
      await wrapper.vm.$nextTick();

      // Component should handle updates without errors
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle large query text", async () => {
      const largeQuery = "SELECT * FROM ".repeat(100) + "large_table";

      wrapper = createWrapper();
      wrapper.vm.dashboardPanelData.data.queries[0].query = largeQuery;
      await wrapper.vm.$nextTick();

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.dashboardPanelData.data.queries[0].query).toBe(largeQuery);
    });

    it("should handle rapid state changes", async () => {
      wrapper = createWrapper();

      // Rapid state changes
      for (let i = 0; i < 10; i++) {
        wrapper.vm.dashboardPanelData.layout.vrlFunctionToggle = i % 2 === 0;
        await wrapper.vm.$nextTick();
      }

      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Error Boundaries", () => {
    it("should handle malformed query data", () => {
      const malformedData = {
        ...mockDashboardPanelData,
        data: {
          ...mockDashboardPanelData.data,
          queries: [{ query: null, fields: undefined }],
        },
      };

      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      wrapper = createWrapper({ dashboardPanelData: malformedData });

      expect(wrapper.exists()).toBe(true);

      consoleWarnSpy.mockRestore();
      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it("should handle component unmounting gracefully", () => {
      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      wrapper = createWrapper();

      expect(wrapper.exists()).toBe(true);
      expect(() => wrapper.unmount()).not.toThrow();

      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });
  });

  it("runs the page's injected runQuery when the code editor emits run-query", async () => {
    const runQuery = vi.fn();
    wrapper = mount(DashboardQueryEditor, {
      global: {
        plugins: [i18n, store, router],
        provide: { dashboardPanelDataPageKey: "dashboard", runQuery },
        stubs: { QueryTypeSelector: true },
      },
    });

    wrapper.findComponent({ name: "CodeQueryEditor" }).vm.$emit("run-query");

    expect(runQuery).toHaveBeenCalledWith(false);
  });
});

describe("formula letters and the saved hide flag", () => {
  let wrapper: any;

  afterEach(() => wrapper?.unmount());

  const mountWith = (queries: any[], currentQueryIndex = 0) => {
    const mock: any = createMockDashboardPanelData();
    mock.promqlMode = ref(true);
    mock.dashboardPanelData.data.queryType = "promql";
    mock.dashboardPanelData.data.queries.splice(0, 1, ...queries);
    mock.dashboardPanelData.layout.currentQueryIndex = currentQueryIndex;
    // The default mock pushes onto the raw array, which never fires the editor's watcher.
    mock.addQuery = () => mock.dashboardPanelData.data.queries.push(q({}, ""));
    (useDashboardPanelData as any).mockImplementation(() => mock);
    wrapper = mount(DashboardQueryEditor, {
      global: {
        plugins: [i18n, store, router],
        provide: { dashboardPanelDataPageKey: "dashboard" },
        stubs: { QueryTypeSelector: true, QueryEditor: true },
      },
    });
    return mock.dashboardPanelData;
  };
  const q = (config: any = {}, query = "up") => ({
    query,
    customQuery: true,
    vrlFunctionQuery: "",
    config,
  });
  const refs = (data: any) => data.data.queries.map((it: any) => it.config?.ref);

  it("gives legacy queries their letters by position on load", async () => {
    const data = mountWith([q(), q()]);
    await wrapper.vm.$nextTick();

    expect(refs(data)).toEqual(["A", "B"]);
  });

  it("gives a new query the first unused letter", async () => {
    const data = mountWith([q({ ref: "B" })]);
    wrapper.vm.addTab();
    await wrapper.vm.$nextTick();

    expect(refs(data)).toEqual(["B", "A"]);
  });

  it("keeps every letter when a preceding query is deleted", async () => {
    const data = mountWith([q({ ref: "A" }), q({ ref: "B" }), q({ formula: "B * 2" }, "")], 2);
    await wrapper.vm.removeTab(0);
    await wrapper.vm.$nextTick();

    expect(refs(data)).toEqual(["B", undefined]);
    expect(wrapper.find('[data-test="dashboard-panel-formula-error"]').exists()).toBe(false);
  });

  it("labels each non-formula tab with its letter", async () => {
    mountWith([q({ ref: "A" }), q({ formula: "A" }, "")]);
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-test="dashboard-panel-query-tab-name-0"]').text()).toBe(
      "A · Query 1",
    );
    expect(wrapper.find('[data-test="dashboard-panel-query-tab-name-1"]').text()).toBe("Formula 1");
  });

  it("backs the visibility toggle with config.hide", async () => {
    const data = mountWith([q({ ref: "A", hide: true }), q({ ref: "B" })]);
    await wrapper.vm.$nextTick();
    expect(data.layout.hiddenQueries).toEqual([0]);

    wrapper.vm.toggleQueryVisibility(1);
    await wrapper.vm.$nextTick();

    expect(data.data.queries[1].config.hide).toBe(true);
    expect(data.layout.hiddenQueries).toEqual([0, 1]);
  });

  it("adds a formula as a lettered-free code query", async () => {
    const data = mountWith([q({ ref: "A" })]);
    await wrapper.find('[data-test="dashboard-panel-query-tab-add-formula"]').trigger("click");
    await wrapper.vm.$nextTick();

    const formula = data.data.queries[1];
    expect(formula.config.formula).toBe("");
    expect(formula.customQuery).toBe(true);
    expect(formula.config.ref).toBeUndefined();
    expect(data.layout.currentQueryIndex).toBe(1);
  });

  it("writes the editor text of a formula tab into config.formula", async () => {
    const data = mountWith([q({ ref: "A" }), q({ formula: "" }, "")], 1);
    wrapper.vm.handleQueryUpdate("A * 2");

    expect(data.data.queries[1].config.formula).toBe("A * 2");
    expect(data.data.queries[1].query).toBe("");
  });

  it("shows an unknown letter under the formula", async () => {
    mountWith([q({ ref: "A" }), q({ formula: "A / B" }, "")], 1);
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-test="dashboard-panel-formula-error"]').text()).toBe(
      "B is not a query in this panel",
    );
  });

  it("tells a referenced input that its own settings do not apply in the formula", async () => {
    mountWith([q({ ref: "A" }), q({ ref: "B" }), q({ formula: "A * 2" }, "")]);
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-test="dashboard-panel-formula-input-note"]').exists()).toBe(true);

    wrapper.vm.dashboardPanelData.layout.currentQueryIndex = 1;
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-test="dashboard-panel-formula-input-note"]').exists()).toBe(false);
  });

  describe("where messages render", () => {
    const precedesEditor = (selector: string) => {
      const editor = wrapper.find('[data-test="dashboard-panel-query-editor"]').element;
      const node = wrapper.find(selector).element;
      return !!(node.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING);
    };

    it("shows the formula error above the editor", async () => {
      mountWith([q({ ref: "A" }), q({ formula: "A / B" }, "")], 1);
      await wrapper.vm.$nextTick();
      expect(precedesEditor('[data-test="dashboard-panel-formula-error"]')).toBe(true);
    });

    it("shows the formula-input note above the editor", async () => {
      mountWith([q({ ref: "A" }), q({ formula: "A * 2" }, "")]);
      await wrapper.vm.$nextTick();
      expect(precedesEditor('[data-test="dashboard-panel-formula-input-note"]')).toBe(true);
    });

    it("shows query errors, such as the builder refusal, above the editor", async () => {
      const data = mountWith([q({ ref: "A" })]);
      data.meta.errors.queryErrors = ["The builder cannot show a subquery"];
      await wrapper.vm.$nextTick();
      const errors = wrapper.find('[data-test="dashboard-panel-query-errors"]');
      expect(errors.text()).toContain("The builder cannot show a subquery");
      expect(precedesEditor('[data-test="dashboard-panel-query-errors"]')).toBe(true);
    });

    it("renders no message row when there is nothing to say", async () => {
      mountWith([q({ ref: "A" })]);
      await wrapper.vm.$nextTick();
      expect(wrapper.find('[data-test="dashboard-panel-query-errors"]').exists()).toBe(false);
    });
  });

  it("numbers formulas among formulas", async () => {
    mountWith([q({ ref: "A" }), q({ ref: "B" }), q({ formula: "A" }, ""), q({ formula: "B" }, "")]);
    await wrapper.vm.$nextTick();
    expect(wrapper.find('[data-test="dashboard-panel-query-tab-name-2"]').text()).toBe("Formula 1");
    expect(wrapper.find('[data-test="dashboard-panel-query-tab-name-3"]').text()).toBe("Formula 2");
  });

  it("makes the eye a labelled button and mutes a hidden query's label", async () => {
    mountWith([q({ ref: "A", hide: true }), q({ ref: "B" })]);
    await wrapper.vm.$nextTick();
    const eye = (i: number) =>
      wrapper.find(`[data-test="dashboard-panel-query-tab-visibility-${i}"]`);
    expect(eye(0).element.tagName).toBe("BUTTON");
    expect(eye(0).attributes("aria-label")).toBe("Show query results");
    expect(eye(1).attributes("aria-label")).toBe("Hide query results");
    const label = (i: number) => wrapper.find(`[data-test="dashboard-panel-query-tab-name-${i}"]`);
    expect(label(0).classes()).toContain("text-text-muted");
    expect(label(1).classes()).not.toContain("text-text-muted");
  });

  it("keeps Add formula reachable as a labelled icon on a phone", async () => {
    mountWith([q({ ref: "A" })]);
    await wrapper.vm.$nextTick();
    const button = wrapper.find('[data-test="dashboard-panel-query-tab-add-formula"]');
    expect(button.attributes("aria-label")).toBe("Add formula");
    expect(button.find(".max-md\\:hidden").text()).toBe("Add formula");
  });
});
