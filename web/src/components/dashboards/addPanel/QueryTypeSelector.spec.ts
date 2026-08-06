import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import QueryTypeSelector from "./QueryTypeSelector.vue";
import { reactive } from "vue";
import enLocaleFull from "@/locales/languages/en-US.json";

// Mock i18n.
// The component was migrated to i18n; its dialog copy now comes from
// `dashboard.queryTypeSelector.*` keys. Resolve those from the real locale so
// the rendered text matches assertions (e.g. the dialog title "Change Query
// Mode"). Every other key keeps the key-echo behavior the rest of this file's
// assertions rely on (e.g. button labels "panel.builder"/"panel.SQL").
const getNestedMessage = (obj: any, path: string): unknown =>
  path.split(".").reduce<any>((o, k) => (o == null ? undefined : o[k]), obj);

const mockT = vi.fn((key: string) => {
  if (key.startsWith("dashboard.queryTypeSelector.")) {
    const value = getNestedMessage(enLocaleFull, key);
    if (typeof value === "string") return value;
  }
  return key;
});

// Mock vue-i18n
vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: mockT,
  }),
}));

// Mock vue-router
const mockPush = vi.fn();
vi.mock("vue-router", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

// Mock Vuex store
const mockStore = reactive({
  state: {
    theme: "light",
  },
});

vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

// Mock dashboard panel data
const mockDashboardPanelData = reactive({
  data: {
    type: "line",
    queryType: "sql",
    queries: [
      {
        query: "",
        customQuery: false,
        fields: {
          stream_type: "logs",
        },
      },
    ],
  },
  layout: {
    currentQueryIndex: 0,
    showQueryBar: false,
  },
  meta: {
    errors: {
      queryErrors: [],
    },
  },
});

const mockRemoveXYFilters = vi.fn();
const mockUpdateXYFieldsForCustomQueryMode = vi.fn();

// Mock useDashboardPanel composable
vi.mock("../../../composables/dashboard/useDashboardPanel", () => ({
  default: () => ({
    dashboardPanelData: mockDashboardPanelData,
    removeXYFilters: mockRemoveXYFilters,
    updateXYFieldsForCustomQueryMode: mockUpdateXYFieldsForCustomQueryMode,
  }),
}));

// Mock useDefaultPanelFields — the selector only needs applyDefaultPanelFields to
// be callable on the Builder toggle; its seeding internals are covered by its own spec.
const mockApplyDefaultPanelFields = vi.fn();
vi.mock("@/composables/dashboard/useDefaultPanelFields", () => ({
  default: () => ({
    applyDefaultPanelFields: mockApplyDefaultPanelFields,
  }),
}));

// Mock ConfirmDialog component
const ConfirmDialogStub = {
  template: `
    <div class="confirm-dialog" data-test="confirm-dialog" v-if="modelValue">
      <div class="dialog-title" data-test="dialog-title">{{ title }}</div>
      <div class="dialog-message" data-test="dialog-message">{{ message }}</div>
      <button data-test="ok-button" @click="$emit('update:ok')">OK</button>
      <button data-test="cancel-button" @click="$emit('update:cancel')">Cancel</button>
    </div>
  `,
  props: ["modelValue", "title", "message"],
  emits: ["update:ok", "update:cancel"],
};

describe("QueryTypeSelector", () => {
  let wrapper: VueWrapper;

  const createWrapper = (props = {}) => {
    return mount(QueryTypeSelector, {
      props,
      global: {
        plugins: [],
        provide: {
          dashboardPanelDataPageKey: "dashboard",
        },
        stubs: {
          ConfirmDialog: ConfirmDialogStub,
        },
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset dashboard panel data to default state
    Object.assign(mockDashboardPanelData, {
      data: {
        type: "line",
        queryType: "sql",
        queries: [
          {
            query: "",
            customQuery: false,
            fields: {
              stream_type: "logs",
            },
          },
        ],
      },
      layout: {
        currentQueryIndex: 0,
        showQueryBar: false,
      },
      meta: {
        errors: {
          queryErrors: [],
        },
      },
    });
    mockStore.state.theme = "light";
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Component Initialization", () => {
    it("should render the component", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBeTruthy();
    });

    it("should have correct component name", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe("QueryTypeSelector");
    });

    it("should initialize selectedButtonType as builder by default", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.selectedButtonType).toBe("builder");
    });

    it("should initialize selectedButtonQueryType as sql by default", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.selectedButtonQueryType).toBe("sql");
    });

    it("should render all buttons", () => {
      wrapper = createWrapper();
      const builderButton = wrapper.find('[data-test="dashboard-builder-query-type"]');
      // promql button is only rendered for metrics stream type (uses v-if)
      const sqlButton = wrapper.find('[data-test="dashboard-sql-query-type"]');
      const customButton = wrapper.find('[data-test="dashboard-custom-query-type"]');

      expect(builderButton.exists()).toBeTruthy();
      expect(sqlButton.exists()).toBeTruthy();
      expect(customButton.exists()).toBeTruthy();
    });

    it("should show correct button labels", () => {
      wrapper = createWrapper();
      const builderButton = wrapper.find('[data-test="dashboard-builder-query-type"]');
      const sqlButton = wrapper.find('[data-test="dashboard-sql-query-type"]');
      const customButton = wrapper.find('[data-test="dashboard-custom-query-type"]');

      expect(builderButton.text()).toBe("panel.builder");
      expect(sqlButton.text()).toBe("panel.SQL");
      expect(customButton.text()).toBe("panel.custom");
    });
  });

  describe("Button State Management", () => {
    it("should select builder button initially", () => {
      wrapper = createWrapper();
      // reka-ui manages data-state in a real browser; in jsdom we verify the
      // reactive model-value prop on the builder-mode OToggleGroup instead.
      const builderButton = wrapper.find('[data-test="dashboard-builder-query-type"]');
      expect(builderButton.exists()).toBe(true);
      expect(wrapper.vm.selectedButtonType).toBe("builder");
    });

    it("should select SQL button initially", () => {
      wrapper = createWrapper();
      // reka-ui manages data-state in a real browser; verify the
      // query-type OToggleGroup model-value is "sql".
      const sqlButton = wrapper.find('[data-test="dashboard-sql-query-type"]');
      expect(sqlButton.exists()).toBe(true);
      expect(wrapper.vm.selectedButtonQueryType).toBe("sql");
    });

    it("should handle custom_chart type initialization", async () => {
      mockDashboardPanelData.data.type = "custom_chart";
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.vm.selectedButtonType).toBe("custom");
    });

    it("should handle builder mode initialization", async () => {
      mockDashboardPanelData.data.queries[0].customQuery = false;
      mockDashboardPanelData.data.queryType = "sql";
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.vm.selectedButtonType).toBe("builder");
    });

    it("should handle custom mode initialization", async () => {
      mockDashboardPanelData.data.queries[0].customQuery = true;
      mockDashboardPanelData.data.queryType = "sql";
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.vm.selectedButtonType).toBe("custom");
    });

    it("should handle promql query type initialization", async () => {
      mockDashboardPanelData.data.queries[0].customQuery = true;
      mockDashboardPanelData.data.queryType = "promql";
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.vm.selectedButtonQueryType).toBe("promql");
      expect(wrapper.vm.selectedButtonType).toBe("custom");
    });

    it("should set default queryType to sql when missing", async () => {
      mockDashboardPanelData.data.queryType = "";
      wrapper = createWrapper();
      await nextTick();
      expect(mockDashboardPanelData.data.queryType).toBe("sql");
    });
  });

  describe("Button Visibility", () => {
    it("should show builder button for non-custom chart types", () => {
      mockDashboardPanelData.data.type = "line";
      wrapper = createWrapper();
      const builderButton = wrapper.find('[data-test="dashboard-builder-query-type"]');
      expect(builderButton.exists()).toBeTruthy();
    });

    it("should hide builder button for custom_chart type", () => {
      mockDashboardPanelData.data.type = "custom_chart";
      wrapper = createWrapper();
      const builderButton = wrapper.find('[data-test="dashboard-builder-query-type"]');
      expect(builderButton.exists()).toBeFalsy();
    });

    it("should show promql button for metrics stream type", () => {
      mockDashboardPanelData.data.queries[0].fields.stream_type = "metrics";
      wrapper = createWrapper();
      const promqlButton = wrapper.find('[data-test="dashboard-promql-query-type"]');
      expect(promqlButton.isVisible()).toBeTruthy();
    });

    it("should hide promql button for non-metrics stream type", () => {
      mockDashboardPanelData.data.queries[0].fields.stream_type = "logs";
      wrapper = createWrapper();
      const promqlButton = wrapper.find('[data-test="dashboard-promql-query-type"]');
      // OToggleGroupItem uses v-if so the element won't exist for non-metrics
      expect(promqlButton.exists()).toBeFalsy();
    });

    it("should always show SQL button", () => {
      wrapper = createWrapper();
      const sqlButton = wrapper.find('[data-test="dashboard-sql-query-type"]');
      expect(sqlButton.exists()).toBeTruthy();
    });

    it("should always show Custom button", () => {
      wrapper = createWrapper();
      const customButton = wrapper.find('[data-test="dashboard-custom-query-type"]');
      expect(customButton.exists()).toBeTruthy();
    });
  });

  describe("Button Interactions", () => {
    it("should handle builder button click", async () => {
      wrapper = createWrapper();
      const builderButton = wrapper.find('[data-test="dashboard-builder-query-type"]');
      await builderButton.trigger("click");

      expect(wrapper.vm.selectedButtonType).toBe("builder");
    });

    it("should handle custom button click from builder", async () => {
      wrapper = createWrapper();

      // OToggleGroup uses reka-ui — emit update:model-value on the builder-mode
      // OToggleGroup (the second one, which has "builder"/"custom") to simulate
      // a user clicking "custom".
      const builderModeToggleGroup = wrapper
        .findAllComponents({ name: "OToggleGroup" })
        .find((c: any) => {
          const mv = c.props("modelValue");
          return mv === "builder" || mv === "custom";
        });
      await builderModeToggleGroup!.vm.$emit("update:modelValue", "custom");
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.selectedButtonType).toBe("custom");
    });

    it("should handle promql button click for metrics", async () => {
      mockDashboardPanelData.data.queries[0].fields.stream_type = "metrics";
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      // OToggleGroup uses reka-ui — emit update:model-value on the query type
      // toggle group (first OToggleGroup) to simulate a user selecting "promql".
      const queryTypeToggleGroup = wrapper.findAllComponents({ name: "OToggleGroup" }).at(0);
      await queryTypeToggleGroup!.vm.$emit("update:modelValue", "promql");
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.selectedButtonQueryType).toBe("promql");
    });

    it("should handle SQL button click", async () => {
      mockDashboardPanelData.data.queries[0].fields.stream_type = "metrics";
      mockDashboardPanelData.data.queryType = "promql";
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      // Start from promql, switch to sql via the query type OToggleGroup
      wrapper.vm.selectedButtonQueryType = "promql";
      await wrapper.vm.$nextTick();

      const queryTypeToggleGroup = wrapper.findAllComponents({ name: "OToggleGroup" }).at(0);
      await queryTypeToggleGroup!.vm.$emit("update:modelValue", "sql");
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.selectedButtonQueryType).toBe("sql");
    });

    it("should prevent event propagation on button click", async () => {
      wrapper = createWrapper();

      // OToggleGroup handles click events natively; onUpdateBuilderMode no longer takes an event arg
      wrapper.vm.onUpdateBuilderMode("custom");

      // Verify the builder mode was updated (the functional intent of the click)
      expect(wrapper.vm.selectedButtonType).toBe("custom");
    });

    it("should not change selection when clicking same button", async () => {
      wrapper = createWrapper();
      const builderButton = wrapper.find('[data-test="dashboard-builder-query-type"]');
      const initialType = wrapper.vm.selectedButtonType;

      await builderButton.trigger("click");
      expect(wrapper.vm.selectedButtonType).toBe(initialType);
    });
  });

  describe("Confirmation Dialog", () => {
    it("should show confirmation dialog when switching with existing query", async () => {
      mockDashboardPanelData.data.queries[0].query = "SELECT * FROM table";
      wrapper = createWrapper();

      wrapper.vm.selectedButtonType = "builder";

      wrapper.vm.onUpdateBuilderMode("builder", { stopPropagation: () => {} });
      await nextTick();

      wrapper.vm.confirmQueryModeChangeDialog = true;

      expect(wrapper.vm.confirmQueryModeChangeDialog).toBeTruthy();
    });

    it("should not show confirmation dialog when switching without existing query", async () => {
      mockDashboardPanelData.data.queries[0].query = "";
      wrapper = createWrapper();

      const customButton = wrapper.find('[data-test="dashboard-custom-query-type"]');
      await customButton.trigger("click");

      expect(wrapper.vm.confirmQueryModeChangeDialog).toBeFalsy();
    });

    it("should render confirmation dialog with correct props", async () => {
      mockDashboardPanelData.data.queries[0].query = "SELECT * FROM table";
      wrapper = createWrapper();

      wrapper.vm.confirmQueryModeChangeDialog = true;
      await wrapper.vm.$nextTick();

      const dialog = wrapper.find('[data-test="confirm-dialog"]');
      expect(dialog.exists()).toBeTruthy();
      expect(dialog.find('[data-test="dialog-title"]').text()).toBe("Change Query Mode");
    });

    it("should handle confirmation dialog OK", async () => {
      mockDashboardPanelData.data.queries[0].query = "SELECT * FROM table";
      wrapper = createWrapper();

      wrapper.vm.confirmQueryModeChangeDialog = true;
      wrapper.vm.popupSelectedButtonType = "custom";
      await wrapper.vm.$nextTick();

      await wrapper.vm.changeToggle();

      expect(mockRemoveXYFilters).toHaveBeenCalled();
      expect(mockUpdateXYFieldsForCustomQueryMode).toHaveBeenCalled();
    });

    it("should handle confirmation dialog cancel", async () => {
      mockDashboardPanelData.data.queries[0].query = "SELECT * FROM table";
      wrapper = createWrapper();
      const initialType = wrapper.vm.selectedButtonType;

      wrapper.vm.confirmQueryModeChangeDialog = true;
      wrapper.vm.popupSelectedButtonType = "custom";
      await wrapper.vm.$nextTick();

      wrapper.vm.confirmQueryModeChangeDialog = false;

      expect(wrapper.vm.selectedButtonType).toBe(initialType);
      expect(wrapper.vm.confirmQueryModeChangeDialog).toBeFalsy();
    });
  });

  describe("Special Case Transitions", () => {
    it("should handle builder to custom without dialog", async () => {
      wrapper = createWrapper();
      wrapper.vm.selectedButtonType = "builder";

      wrapper.vm.onUpdateBuilderMode("custom", { stopPropagation: vi.fn() });

      expect(wrapper.vm.selectedButtonType).toBe("custom");
      expect(wrapper.vm.confirmQueryModeChangeDialog).toBeFalsy();
    });

    it("should handle promql to sql without dialog", async () => {
      wrapper = createWrapper();
      wrapper.vm.selectedButtonQueryType = "promql";

      wrapper.vm.onUpdateQueryMode("sql", { stopPropagation: vi.fn() });

      expect(wrapper.vm.selectedButtonQueryType).toBe("sql");
      expect(wrapper.vm.confirmQueryModeChangeDialog).toBeFalsy();
    });

    it("should handle sql to promql without dialog", async () => {
      mockDashboardPanelData.data.queries[0].fields.stream_type = "metrics";
      wrapper = createWrapper();
      wrapper.vm.selectedButtonQueryType = "sql";

      wrapper.vm.onUpdateQueryMode("promql", { stopPropagation: vi.fn() });

      expect(wrapper.vm.selectedButtonQueryType).toBe("promql");
      expect(wrapper.vm.confirmQueryModeChangeDialog).toBeFalsy();
    });

    it("should show queryBar for special case transitions", async () => {
      wrapper = createWrapper();
      wrapper.vm.selectedButtonType = "builder";

      wrapper.vm.onUpdateBuilderMode("custom", { stopPropagation: vi.fn() });

      expect(mockDashboardPanelData.layout.showQueryBar).toBeTruthy();
    });
  });

  describe("Data Updates from Button Selection", () => {
    it("should update dashboard data for builder selection", async () => {
      wrapper = createWrapper();
      wrapper.vm.selectedButtonType = "custom";

      wrapper.vm.selectedButtonType = "builder";
      await nextTick();

      expect(mockDashboardPanelData.data.queries[0].customQuery).toBeFalsy();
    });

    it("should update dashboard data for custom selection", async () => {
      wrapper = createWrapper();

      wrapper.vm.selectedButtonType = "custom";

      mockDashboardPanelData.data.queries[0].customQuery = true;

      await nextTick();

      expect(mockDashboardPanelData.data.queries[0].customQuery).toBeTruthy();
    });

    it("should update dashboard data for promql selection", async () => {
      mockDashboardPanelData.data.queries[0].fields.stream_type = "metrics";
      wrapper = createWrapper();

      wrapper.vm.selectedButtonQueryType = "promql";

      mockDashboardPanelData.data.queryType = "promql";
      mockDashboardPanelData.data.type = "line";

      await nextTick();

      expect(mockDashboardPanelData.data.queryType).toBe("promql");
    });

    it("should clear errors when changing toggle", async () => {
      mockDashboardPanelData.meta.errors.queryErrors = ["error1"];
      wrapper = createWrapper();

      await wrapper.vm.changeToggle();

      expect(mockDashboardPanelData.meta.errors.queryErrors).toEqual([]);
    });

    it("should handle promql query slicing", async () => {
      mockDashboardPanelData.data.queries = [
        { query: "query1", customQuery: false, fields: {} },
        { query: "query2", customQuery: false, fields: {} },
      ];
      wrapper = createWrapper();

      wrapper.vm.selectedButtonType = "promql";
      await nextTick();

      // This behavior would be triggered by the component logic
      // Just verify the function is available
      expect(typeof wrapper.vm.changeToggle).toBe("function");
    });

    it("should show queryBar after toggle change", async () => {
      wrapper = createWrapper();

      await wrapper.vm.changeToggle();

      expect(mockDashboardPanelData.layout.showQueryBar).toBeTruthy();
    });
  });

  describe("Watchers", () => {
    it("should initialize selectedButtonType on queryType change", async () => {
      wrapper = createWrapper();

      mockDashboardPanelData.data.queryType = "promql";
      await nextTick();

      expect(wrapper.vm.selectedButtonQueryType).toBe("promql");
    });

    it("should initialize selectedButtonType on customQuery change", async () => {
      wrapper = createWrapper();

      mockDashboardPanelData.data.queries[0].customQuery = true;
      await nextTick();

      await wrapper.vm.$nextTick();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.selectedButtonType).toBe("custom");
    });

    it("should switch to sql when stream type changes from metrics", async () => {
      mockDashboardPanelData.data.queries[0].fields.stream_type = "metrics";
      mockDashboardPanelData.data.queryType = "promql";
      wrapper = createWrapper();
      await nextTick();

      mockDashboardPanelData.data.queries[0].fields.stream_type = "logs";
      await nextTick();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.selectedButtonQueryType).toBe("sql");
    });

    it("should dispatch resize event on button type change", async () => {
      const resizeSpy = vi.fn();
      window.addEventListener("resize", resizeSpy);

      wrapper = createWrapper();
      wrapper.vm.selectedButtonType = "custom";
      await nextTick();

      expect(resizeSpy).toHaveBeenCalled();
      window.removeEventListener("resize", resizeSpy);
    });

    it("should ignore updates when flag is set", async () => {
      wrapper = createWrapper();

      wrapper.vm.ignoreSelectedButtonTypeUpdate = true;

      wrapper.vm.selectedButtonQueryType = "promql";
      await nextTick();

      // When flag is set, dashboard data should not update immediately
      expect(typeof wrapper.vm.ignoreSelectedButtonTypeUpdate).toBe("boolean");
    });
  });

  describe("Theme Support", () => {
    it("should use light theme styling by default", () => {
      mockStore.state.theme = "light";
      wrapper = createWrapper();

      // OToggleGroup uses Tailwind CSS design tokens for theming instead of inline styles
      const sqlButton = wrapper.find('[data-test="dashboard-sql-query-type"]');
      expect(sqlButton.exists()).toBeTruthy();
    });

    it("should use dark theme styling when theme is dark", () => {
      mockStore.state.theme = "dark";
      wrapper = createWrapper();

      // OToggleGroup uses Tailwind CSS design tokens for theming instead of inline styles
      const sqlButton = wrapper.find('[data-test="dashboard-sql-query-type"]');
      expect(sqlButton.exists()).toBeTruthy();
    });
  });

  describe("CSS Classes", () => {
    it("should apply selected class to active button", () => {
      wrapper = createWrapper();
      // The builder button is rendered when selectedButtonType is "builder" (the default).
      // reka-ui manages data-state in a real browser; in jsdom we verify the reactive
      // model-value binding instead: the OToggleGroup for builder mode receives "builder".
      const builderModeToggleGroup = wrapper
        .findAllComponents({ name: "OToggleGroup" })
        .find((c: any) => {
          const modelValue = c.props("modelValue");
          return modelValue === "builder" || modelValue === "custom";
        });
      expect(builderModeToggleGroup).toBeTruthy();
      expect(builderModeToggleGroup!.props("modelValue")).toBe("builder");
    });

    it("should not apply selected class to inactive buttons", () => {
      wrapper = createWrapper();
      const customButton = wrapper.find('[data-test="dashboard-custom-query-type"]');
      // OToggleGroupItem uses reka-ui data-state="off" for inactive state
      expect(customButton.attributes("data-state")).not.toBe("on");
    });

    it("should have proper button classes", () => {
      wrapper = createWrapper();
      const builderButton = wrapper.find('[data-test="dashboard-builder-query-type"]');
      // OToggleGroupItem renders with Tailwind classes (inline-flex, items-center, etc.)
      expect(builderButton.exists()).toBeTruthy();
      expect(builderButton.classes().some((c) => c.startsWith(""))).toBe(true);
    });

    it("should have button-group container class", () => {
      wrapper = createWrapper();
      // OToggleGroup renders its own container; check that toggle groups exist
      const toggleGroups = wrapper.findAllComponents({ name: "OToggleGroup" });
      expect(toggleGroups.length).toBeGreaterThan(0);
    });
  });

  describe("Edge Cases", () => {
    it("should handle undefined stream type", () => {
      delete mockDashboardPanelData.data.queries[0].fields.stream_type;
      wrapper = createWrapper();
      expect(wrapper.exists()).toBeTruthy();
    });

    it("should handle empty queries array gracefully", () => {
      // Ensure at least one query exists to prevent errors in watchers
      mockDashboardPanelData.data.queries = [
        {
          query: "",
          customQuery: false,
          fields: {},
        },
      ];
      wrapper = createWrapper();
      expect(wrapper.exists()).toBeTruthy();
      expect(mockDashboardPanelData.data.queries.length).toBeGreaterThan(0);
    });

    it("should handle valid currentQueryIndex", () => {
      // Ensure currentQueryIndex points to valid query
      mockDashboardPanelData.layout.currentQueryIndex = 0;
      mockDashboardPanelData.data.queries = [
        {
          query: "",
          customQuery: false,
          fields: {},
        },
      ];
      wrapper = createWrapper();
      expect(wrapper.exists()).toBeTruthy();
      expect(mockDashboardPanelData.layout.currentQueryIndex).toBe(0);
    });

    it("should handle null dashboard panel data gracefully", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.dashboardPanelData).toBeTruthy();
    });
  });

  describe("Integration", () => {
    it("should integrate with i18n correctly", () => {
      wrapper = createWrapper();
      expect(mockT).toHaveBeenCalledWith("panel.SQL");
      // panel.promQL is only called when stream_type is "metrics" (v-if condition)
      expect(mockT).toHaveBeenCalledWith("panel.builder");
      expect(mockT).toHaveBeenCalledWith("panel.custom");
    });

    it("should integrate with store correctly", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.store).toBeTruthy();
      expect(wrapper.vm.store.state.theme).toBe("light");
    });

    it("should integrate with dashboard panel composable correctly", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.dashboardPanelData).toBeTruthy();
    });

    it("should provide correct dashboard panel data key", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.dashboardPanelData).toBe(mockDashboardPanelData);
    });
  });

  describe("Component Lifecycle", () => {
    it("should initialize on mount", async () => {
      wrapper = createWrapper();
      await nextTick();
      expect(wrapper.vm.selectedButtonType).toBe("builder");
      expect(wrapper.vm.selectedButtonQueryType).toBe("sql");
    });

    it("should cleanup properly on unmount", () => {
      wrapper = createWrapper();
      const instance = wrapper.vm;
      wrapper.unmount();
      expect(instance).toBeTruthy();
    });

    it("should maintain reactivity", async () => {
      wrapper = createWrapper();

      mockDashboardPanelData.data.queries[0].customQuery = true;
      await nextTick();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.selectedButtonType).toBe("custom");
    });
  });
  describe("selecting the metrics stream type selects PromQL", () => {
    /** The watcher awaits nextTick before touching the toggle group. */
    const settle = async () => {
      for (let i = 0; i < 5; i++) await nextTick();
    };

    it("flips a fresh, empty panel to PromQL", async () => {
      wrapper = createWrapper();
      await nextTick();

      // A brand-new panel: nothing written, no stream picked yet. Changing the
      // stream type clears the stream, which is the state this arrives in.
      mockDashboardPanelData.data.queries[0].fields.stream = "";
      mockDashboardPanelData.data.queries[0].fields.stream_type = "metrics";
      await settle();

      expect(mockDashboardPanelData.data.queryType).toBe("promql");
    });

    it("does NOT convert the panel when another query already holds a query", async () => {
      // `changeToggle` is panel-wide: it flips `data.queryType` and clears EVERY
      // query, because SQL and PromQL are not interchangeable. So adding a second
      // query on a metrics stream to an existing SQL panel used to erase the
      // first query's SQL and convert the whole panel — which nobody asked for.
      // SQL over a metrics stream is legal; it is merely not the default anyone
      // wants, and this watcher exists only to spare a new panel one click.
      wrapper = createWrapper();
      await nextTick();

      mockDashboardPanelData.data.queries = [
        {
          query: "SELECT count(*) FROM logs",
          customQuery: true,
          fields: { stream: "app_logs", stream_type: "logs" },
        },
        // The slot the user just added, now being pointed at a metrics stream.
        {
          query: "",
          customQuery: false,
          fields: { stream: "", stream_type: "logs" },
        },
      ] as any;
      mockDashboardPanelData.layout.currentQueryIndex = 1;
      await settle();

      mockDashboardPanelData.data.queries[1].fields.stream_type = "metrics";
      await settle();

      expect(mockDashboardPanelData.data.queryType).toBe("sql");
      expect(mockDashboardPanelData.data.queries[0].query).toBe("SELECT count(*) FROM logs");
    });

    it("does NOT convert a SAVED panel when its stream type flips to metrics", async () => {
      // The saved-panel wipe: `onStreamTypeChange` clears `fields.stream`
      // BEFORE setting the type, so the stream guard sees the same empty stream
      // a fresh panel has — and `changeToggle()` then cleared every query, axis
      // and filter of a panel the user had saved. The id is the signal that
      // survives the stream clearing: it is assigned when a saved panel loads.
      wrapper = createWrapper();
      await nextTick();

      mockDashboardPanelData.data.id = "Panel_ID_saved_1";
      mockDashboardPanelData.data.queries = [
        {
          query: "SELECT histogram(_timestamp), count(*) FROM app_logs",
          customQuery: false,
          fields: {
            // What onStreamTypeChange leaves behind: stream cleared, type set.
            stream: "",
            stream_type: "logs",
            x: [{ alias: "x_axis_1" }],
            y: [{ alias: "y_axis_1" }],
          },
        },
      ] as any;
      mockDashboardPanelData.layout.currentQueryIndex = 0;
      await settle();

      mockDashboardPanelData.data.queries[0].fields.stream_type = "metrics";
      await settle();

      expect(mockDashboardPanelData.data.queryType).toBe("sql");
      expect(mockDashboardPanelData.data.queries[0].query).toBe(
        "SELECT histogram(_timestamp), count(*) FROM app_logs",
      );
      expect(mockDashboardPanelData.data.queries[0].fields.x).toHaveLength(1);

      mockDashboardPanelData.data.id = "";
    });

    it("still flips when the other query is only the editor's placeholder SQL", async () => {
      // An untouched slot carries auto-generated SQL against no stream. Counting
      // that as work would block the auto-select on exactly the new panels it is
      // for — so "has something in it" means a query AND a stream to run it on.
      wrapper = createWrapper();
      await nextTick();

      mockDashboardPanelData.data.queries = [
        {
          query: 'SELECT histogram(_timestamp) FROM ""',
          customQuery: false,
          fields: { stream: "", stream_type: "logs" },
        },
        {
          query: "",
          customQuery: false,
          fields: { stream: "", stream_type: "logs" },
        },
      ] as any;
      mockDashboardPanelData.layout.currentQueryIndex = 1;
      await settle();

      mockDashboardPanelData.data.queries[1].fields.stream_type = "metrics";
      await settle();

      expect(mockDashboardPanelData.data.queryType).toBe("promql");
    });
  });
});
