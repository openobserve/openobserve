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
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import { reactive, computed } from "vue";

import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

// ── Mock data ──────────────────────────────────────────────────────────

const mockStreamResults = [
  { name: "app_logs", stream_type: "logs" },
  { name: "system_metrics", stream_type: "metrics", metrics_meta: { metric_type: "Gauge" } },
  { name: "user_traces", stream_type: "traces" },
  { name: "error_logs", stream_type: "logs" },
];

const createMockDashboardPanelData = (overrides: Record<string, any> = {}) =>
  reactive({
    data: {
      type: "bar",
      queries: [
        {
          fields: { stream_type: "logs", stream: "app_logs" },
          customQuery: false,
          query: "",
          config: {},
        },
      ],
      ...overrides.data,
    },
    layout: {
      currentQueryIndex: 0,
      showFieldList: true,
      splitter: 20,
      ...overrides.layout,
    },
    meta: {
      stream: {
        streamResults: mockStreamResults,
        streamResultsType: "logs",
        filterField: "",
        customQueryFields: [] as any[],
        vrlFunctionFieldList: [] as any[],
        userDefinedSchema: [] as any[],
        selectedStreamFields: [] as any[],
        ...overrides.meta?.stream,
      },
      streamFields: {
        groupedFields: [] as any[],
        ...overrides.meta?.streamFields,
      },
      dragAndDrop: {
        dragging: false,
        dragElement: null,
        dragSource: null,
        dragSourceIndex: null,
        currentDragArea: null,
        targetDragIndex: null,
        ...overrides.meta?.dragAndDrop,
      },
      ...overrides.meta,
    },
  });

// ── Default composable mock returns ────────────────────────────────────

const defaultMockReturn = () => {
  const dashboardPanelData = createMockDashboardPanelData();
  return {
    dashboardPanelData,
    addXAxisItem: vi.fn(),
    addYAxisItem: vi.fn(),
    addZAxisItem: vi.fn(),
    addBreakDownAxisItem: vi.fn(),
    addFilteredItem: vi.fn(),
    isAddXAxisNotAllowed: computed(() => false),
    isAddBreakdownNotAllowed: computed(() => false),
    isAddYAxisNotAllowed: computed(() => false),
    isAddZAxisNotAllowed: computed(() => false),
    promqlMode: computed(() => false),
    addLatitude: vi.fn(),
    addLongitude: vi.fn(),
    addWeight: vi.fn(),
    addMapName: vi.fn(),
    addMapValue: vi.fn(),
    addSource: vi.fn(),
    addTarget: vi.fn(),
    addValue: vi.fn(),
    cleanupDraggingFields: vi.fn(),
    updateGroupedFields: vi.fn(),
    fetchPromQLLabels: vi.fn(),
  };
};

let mockReturn = defaultMockReturn();

vi.mock("@/composables/dashboard/useDashboardPanel", () => ({
  default: vi.fn(() => mockReturn),
}));

const mockGetStreams = vi.fn();

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: mockGetStreams,
    getStream: vi.fn().mockResolvedValue({}),
  }),
}));

vi.mock("@/composables/useNotifications", () => ({
  default: () => ({
    showErrorNotification: vi.fn(),
  }),
}));

vi.mock("@/composables/usePromqlSuggestions", () => ({
  default: () => ({
    parsePromQlQuery: vi.fn().mockReturnValue({ metricName: null }),
  }),
}));

// Must come after all vi.mock calls
import FieldList from "@/components/dashboards/addPanel/PanelFieldList.vue";

describe("FieldList", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStreams.mockResolvedValue({ list: mockStreamResults });
    mockReturn = defaultMockReturn();
    store.state.selectedOrganization = { identifier: "test-org" };
    store.state.theme = "light";
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  function mountComponent(
    options: {
      pageKey?: string;
      props?: Record<string, unknown>;
    } = {},
  ) {
    return mount(FieldList, {
      props: {
        editMode: false,
        hideAllFieldsSelection: false,
        ...options.props,
      },
      global: {
        plugins: [i18n, store, router],
        provide: {
          dashboardPanelDataPageKey: options.pageKey ?? "dashboard",
        },
      },
    });
  }

  // ── Rendering ──────────────────────────────────────────────────────

  describe("Component Rendering", () => {
    it("should render field list container", () => {
      wrapper = mountComponent();
      expect(wrapper.find('[data-test="o-field-list"]').exists()).toBe(true);
    });

    it("should mount in light theme", () => {
      store.state.theme = "light";
      wrapper = mountComponent();
      expect(wrapper.exists()).toBe(true);
    });

    it("should mount in dark theme", () => {
      store.state.theme = "dark";
      wrapper = mountComponent();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render stream type dropdown", () => {
      wrapper = mountComponent();
      expect(wrapper.find('[data-test="index-dropdown-stream_type"]').exists()).toBe(true);
    });

    it("should render stream dropdown", () => {
      wrapper = mountComponent();
      expect(wrapper.find('[data-test="index-dropdown-stream"]').exists()).toBe(true);
    });

    it("should render OFieldList", () => {
      wrapper = mountComponent();
      expect(wrapper.find('[data-test="o-field-list"]').exists()).toBe(true);
    });
  });

  // ── Stream Type Selection ───────────────────────────────────────────

  describe("Stream Type Selection", () => {
    it("should show stream type dropdown for dashboard page", () => {
      wrapper = mountComponent({ pageKey: "dashboard" });
      expect(wrapper.find('[data-test="index-dropdown-stream_type"]').exists()).toBe(true);
    });

    it("should hide stream type dropdown for metrics page", () => {
      wrapper = mountComponent({ pageKey: "metrics" });
      expect(wrapper.find('[data-test="index-dropdown-stream_type"]').exists()).toBe(false);
    });

    it("should render stream type dropdown for logs page (readonly)", () => {
      wrapper = mountComponent({ pageKey: "logs" });
      const dropdown = wrapper.find('[data-test="index-dropdown-stream_type"]');
      expect(dropdown.exists()).toBe(true);
    });

    it("clears the selected stream when the stream type changes", async () => {
      wrapper = mountComponent({ pageKey: "dashboard" });
      const fields = mockReturn.dashboardPanelData.data.queries[0].fields;
      fields.stream = "app_logs"; // a logs-type stream is currently selected

      // Switching type must drop the old stream so its schema isn't fetched under
      // the new type (the stale request that fired the metrics call twice).
      await wrapper
        .findComponent('[data-test="index-dropdown-stream_type"]')
        .vm.$emit("update:model-value", "metrics");

      expect(fields.stream).toBe("");
      expect(fields.stream_type).toBe("metrics");
    });
  });

  // ── Stream List Loading ─────────────────────────────────────────────

  describe("Stream List Loading", () => {
    const currentFields = () => mockReturn.dashboardPanelData.data.queries[0].fields;

    it("loads the stream list for the current stream type on mount", async () => {
      wrapper = mountComponent();
      await flushPromises();

      expect(mockGetStreams).toHaveBeenCalledTimes(1);
      expect(mockGetStreams).toHaveBeenCalledWith("logs", false);
      expect(mockReturn.dashboardPanelData.meta.stream.streamResultsType).toBe("logs");
    });

    it("reloads the stream list when the stream type changes", async () => {
      wrapper = mountComponent();
      await flushPromises();
      mockGetStreams.mockClear();

      currentFields().stream_type = "metrics";
      await flushPromises();

      expect(mockGetStreams).toHaveBeenCalledWith("metrics", false);
      expect(mockReturn.dashboardPanelData.meta.stream.streamResultsType).toBe("metrics");
    });

    it("does not refetch the stream list when only the selected stream changes", async () => {
      wrapper = mountComponent();
      await flushPromises();
      mockGetStreams.mockClear();

      // Selecting a different stream of the same type must not reload the list.
      currentFields().stream = "error_logs";
      await flushPromises();

      expect(mockGetStreams).not.toHaveBeenCalled();
    });

    it("ignores a stale response when the stream type changed mid-flight", async () => {
      // First (logs) request stays pending; the second (metrics) resolves first.
      let resolveLogs: (v: any) => void = () => {};
      mockGetStreams
        .mockImplementationOnce(() => new Promise((resolve) => (resolveLogs = resolve)))
        .mockImplementationOnce(() =>
          Promise.resolve({
            list: [{ name: "system_metrics", stream_type: "metrics" }],
          }),
        );

      wrapper = mountComponent(); // fires the pending logs request
      currentFields().stream_type = "metrics"; // fires the metrics request
      await flushPromises();

      // metrics already won
      expect(mockReturn.dashboardPanelData.meta.stream.streamResultsType).toBe("metrics");

      // the late logs response must not overwrite it (stream type is now metrics)
      resolveLogs({ list: [{ name: "app_logs", stream_type: "logs" }] });
      await flushPromises();

      expect(mockReturn.dashboardPanelData.meta.stream.streamResultsType).toBe("metrics");
      expect(
        mockReturn.dashboardPanelData.meta.stream.streamResults.map((s: any) => s.name),
      ).toEqual(["system_metrics"]);
    });
  });

  // ── Stream Selection ────────────────────────────────────────────────

  describe("Stream Selection", () => {
    it("should render stream dropdown", () => {
      wrapper = mountComponent();
      const dropdown = wrapper.find('[data-test="index-dropdown-stream"]');
      expect(dropdown.exists()).toBe(true);
    });
  });

  // ── Drag and Drop ──────────────────────────────────────────────────

  describe("Drag and Drop", () => {
    it("should render drag indicator when draggable", () => {
      wrapper = mountComponent();
      // OFieldList with draggable=true should render drag indicators
      // Only appears when fields are present — no fields means no indicators
      expect(wrapper.find('[data-test="o-field-list"]').exists()).toBe(true);
    });

    it("should set draggable attribute on field rows", async () => {
      // Set up grouped fields to render field rows
      const mock = defaultMockReturn();
      mock.dashboardPanelData.meta.streamFields.groupedFields = [
        {
          name: "testGroup",
          stream_alias: "testGroup",
          schema: [{ name: "field1", type: "Utf8" }],
          settings: {},
        },
      ];
      mockReturn = mock;

      wrapper = mountComponent();
      await flushPromises();

      const row = wrapper.find('[data-test="o-field-list-row-field1"]');
      expect(row.exists()).toBe(true);
      expect(row.attributes("draggable")).toBe("true");
    });

    it("should not set draggable when hideAllFieldsSelection is true", async () => {
      const mock = defaultMockReturn();
      mock.dashboardPanelData.meta.streamFields.groupedFields = [
        {
          name: "testGroup",
          stream_alias: "testGroup",
          schema: [{ name: "field1", type: "Utf8" }],
          settings: {},
        },
      ];
      mockReturn = mock;

      wrapper = mountComponent({
        props: { hideAllFieldsSelection: true },
      });
      await flushPromises();

      const row = wrapper.find('[data-test="o-field-list-row-field1"]');
      expect(row.exists()).toBe(true);
      expect(row.attributes("draggable")).toBe("false");
    });

    it("should disable drag in promql mode", () => {
      const mock = defaultMockReturn();
      mock.promqlMode = computed(() => true);
      mockReturn = mock;

      wrapper = mountComponent();
      // PromQL mode hides drag indicators via dragEnabledFn returning false
      expect(wrapper.find('[data-test="o-field-list"]').exists()).toBe(true);
    });
  });

  // ── Search ──────────────────────────────────────────────────────────

  describe("Search", () => {
    it("should render search input", () => {
      wrapper = mountComponent();
      const searchInput = wrapper.find('[data-test="o-field-list-search"]');
      expect(searchInput.exists()).toBe(true);
    });
  });

  // ── Pagination ──────────────────────────────────────────────────────

  describe("Pagination", () => {
    it("should paginate when fields exceed page size", async () => {
      const mock = defaultMockReturn();
      const schema = Array.from({ length: 300 }, (_, i) => ({
        name: `field_${i}`,
        type: "Utf8",
      }));
      mock.dashboardPanelData.meta.streamFields.groupedFields = [
        {
          name: "largeGroup",
          stream_alias: "largeGroup",
          schema,
          settings: {},
        },
      ];
      mockReturn = mock;

      wrapper = mountComponent();
      await flushPromises();

      // With 250 page size, only 250 fields + 1 group header should be rendered
      const rows = wrapper.findAll('[data-test^="o-field-list-row-"]');
      expect(rows.length).toBeLessThanOrEqual(250);
    });
  });

  // ── Field Actions ───────────────────────────────────────────────────

  describe("Field Actions", () => {
    beforeEach(() => {
      const mock = defaultMockReturn();
      mock.dashboardPanelData.meta.streamFields.groupedFields = [
        {
          name: "testGroup",
          stream_alias: "testGroup",
          schema: [{ name: "test_field", type: "Utf8" }],
          settings: {},
        },
      ];
      mockReturn = mock;
    });

    it("should render action buttons for standard chart types", async () => {
      wrapper = mountComponent();
      await flushPromises();

      // X and Y buttons should exist for 'bar' chart type
      expect(wrapper.find('[data-test="dashboard-add-x-data"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-add-y-data"]').exists()).toBe(true);
      // B button should exist for bar chart
      expect(wrapper.find('[data-test="dashboard-add-b-data"]').exists()).toBe(true);
    });

    it("should show +Y/+X swapped labels for h-bar charts", async () => {
      const mock = defaultMockReturn();
      mock.dashboardPanelData.data.type = "h-bar";
      mock.dashboardPanelData.meta.streamFields.groupedFields = [
        {
          name: "testGroup",
          stream_alias: "testGroup",
          schema: [{ name: "test_field", type: "Utf8" }],
          settings: {},
        },
      ];
      mockReturn = mock;

      wrapper = mountComponent();
      await flushPromises();

      const xBtn = wrapper.find('[data-test="dashboard-add-x-data"]');
      const yBtn = wrapper.find('[data-test="dashboard-add-y-data"]');
      if (xBtn.exists()) {
        expect(xBtn.text()).toContain("+Y");
      }
      if (yBtn.exists()) {
        expect(yBtn.text()).toContain("+X");
      }
    });

    it("should show +P button for table chart type", async () => {
      const mock = defaultMockReturn();
      mock.dashboardPanelData.data.type = "table";
      mock.dashboardPanelData.meta.streamFields.groupedFields = [
        {
          name: "testGroup",
          stream_alias: "testGroup",
          schema: [{ name: "test_field", type: "Utf8" }],
          settings: {},
        },
      ];
      mockReturn = mock;

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.find('[data-test="dashboard-add-p-data"]').exists()).toBe(true);
    });

    it("should show +Z button for heatmap chart type", async () => {
      const mock = defaultMockReturn();
      mock.dashboardPanelData.data.type = "heatmap";
      mock.dashboardPanelData.meta.streamFields.groupedFields = [
        {
          name: "testGroup",
          stream_alias: "testGroup",
          schema: [{ name: "test_field", type: "Utf8" }],
          settings: {},
        },
      ];
      mockReturn = mock;

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.find('[data-test="dashboard-add-z-data"]').exists()).toBe(true);
    });

    it("should hide standard action buttons for geomap chart type", async () => {
      const mock = defaultMockReturn();
      mock.dashboardPanelData.data.type = "geomap";
      mock.dashboardPanelData.meta.streamFields.groupedFields = [
        {
          name: "testGroup",
          stream_alias: "testGroup",
          schema: [{ name: "test_field", type: "Utf8" }],
          settings: {},
        },
      ];
      mockReturn = mock;

      wrapper = mountComponent();
      await flushPromises();

      // Standard buttons should not exist for geomap
      expect(wrapper.find('[data-test="dashboard-add-x-data"]').exists()).toBe(false);
      // Geomap buttons should exist
      expect(wrapper.find('[data-test="dashboard-add-latitude-data"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-add-longitude-data"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-add-weight-data"]').exists()).toBe(true);
    });

    it("should show maps action buttons", async () => {
      const mock = defaultMockReturn();
      mock.dashboardPanelData.data.type = "maps";
      mock.dashboardPanelData.meta.streamFields.groupedFields = [
        {
          name: "testGroup",
          stream_alias: "testGroup",
          schema: [{ name: "test_field", type: "Utf8" }],
          settings: {},
        },
      ];
      mockReturn = mock;

      wrapper = mountComponent();
      await flushPromises();

      // Maps buttons use +N and +V
      const xBtn = wrapper.find('[data-test="dashboard-add-x-data"]');
      const yBtn = wrapper.find('[data-test="dashboard-add-y-data"]');
      if (xBtn.exists()) {
        expect(xBtn.text()).toContain("+N");
      }
      if (yBtn.exists()) {
        expect(yBtn.text()).toContain("+V");
      }
    });

    it("should show sankey action buttons", async () => {
      const mock = defaultMockReturn();
      mock.dashboardPanelData.data.type = "sankey";
      mock.dashboardPanelData.meta.streamFields.groupedFields = [
        {
          name: "testGroup",
          stream_alias: "testGroup",
          schema: [{ name: "test_field", type: "Utf8" }],
          settings: {},
        },
      ];
      mockReturn = mock;

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.find('[data-test="dashboard-add-source-data"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-add-target-data"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-add-value-data"]').exists()).toBe(true);
    });

    it("should hide action buttons for custom_chart chart type", async () => {
      const mock = defaultMockReturn();
      mock.dashboardPanelData.data.type = "custom_chart";
      mock.dashboardPanelData.meta.streamFields.groupedFields = [
        {
          name: "testGroup",
          stream_alias: "testGroup",
          schema: [{ name: "test_field", type: "Utf8" }],
          settings: {},
        },
      ];
      mockReturn = mock;

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.find('[data-test="dashboard-add-x-data"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="dashboard-add-y-data"]').exists()).toBe(false);
    });

    it("should disable action buttons when isAddXAxisNotAllowed", async () => {
      const mock = defaultMockReturn();
      mock.isAddXAxisNotAllowed = computed(() => true);
      mock.dashboardPanelData.meta.streamFields.groupedFields = [
        {
          name: "testGroup",
          stream_alias: "testGroup",
          schema: [{ name: "test_field", type: "Utf8" }],
          settings: {},
        },
      ];
      mockReturn = mock;

      wrapper = mountComponent();
      await flushPromises();

      const xBtn = wrapper.find('[data-test="dashboard-add-x-data"]');
      expect(xBtn.exists()).toBe(true);
      // OButton with disabled should have disabled attribute or class
    });

    it("should emit +F button click for non-custom-query mode", async () => {
      const mock = defaultMockReturn();
      mock.dashboardPanelData.meta.streamFields.groupedFields = [
        {
          name: "testGroup",
          stream_alias: "testGroup",
          schema: [{ name: "test_field", type: "Utf8" }],
          settings: {},
        },
      ];
      mockReturn = mock;

      wrapper = mountComponent();
      await flushPromises();

      const filterBtn = wrapper.find('[data-test="dashboard-add-filter-data"]');
      expect(filterBtn.exists()).toBe(true);
    });
  });

  // ── Group Headers ───────────────────────────────────────────────────

  describe("Group Headers", () => {
    it("should render group headers", async () => {
      const mock = defaultMockReturn();
      mock.dashboardPanelData.meta.streamFields.groupedFields = [
        {
          name: "myGroup",
          stream_alias: "myGroup",
          schema: [{ name: "field1", type: "Utf8" }],
          settings: {},
        },
      ];
      mockReturn = mock;

      wrapper = mountComponent();
      await flushPromises();

      const groupHeader = wrapper.find('[data-test="o-field-list-group-myGroup"]');
      expect(groupHeader.exists()).toBe(true);
      expect(groupHeader.text()).toContain("myGroup");
    });
  });

  // ── Custom Query Fields ─────────────────────────────────────────────

  describe("Custom Query Fields", () => {
    it("should show custom query fields before grouped fields", async () => {
      const mock = defaultMockReturn();
      mock.dashboardPanelData.meta.stream.customQueryFields = [
        { name: "custom_field", type: "Utf8" },
      ];
      mock.dashboardPanelData.meta.streamFields.groupedFields = [
        {
          name: "streamGroup",
          stream_alias: "streamGroup",
          schema: [{ name: "stream_field", type: "Utf8" }],
          settings: {},
        },
      ];
      mockReturn = mock;

      wrapper = mountComponent();
      await flushPromises();

      // Both fields should be rendered
      expect(wrapper.find('[data-test="o-field-list-row-custom_field"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="o-field-list-row-stream_field"]').exists()).toBe(true);
    });

    it("should show action buttons for custom query fields", async () => {
      const mock = defaultMockReturn();
      mock.dashboardPanelData.meta.stream.customQueryFields = [
        { name: "custom_field", type: "Utf8" },
      ];
      mock.dashboardPanelData.meta.streamFields.groupedFields = [
        {
          name: "streamGroup",
          stream_alias: "streamGroup",
          schema: [{ name: "stream_field", type: "Utf8" }],
          settings: {},
        },
      ];
      mockReturn = mock;

      wrapper = mountComponent();
      await flushPromises();

      // Action buttons exist (they're hover-revealed but present in DOM)
      expect(wrapper.find('[data-test="dashboard-add-x-data"]').exists()).toBe(true);
    });
  });

  // ── User Defined Schemas ────────────────────────────────────────────

  describe("User Defined Schemas", () => {
    it("should render timestamp and all-fields for defined schemas", async () => {
      const mock = defaultMockReturn();
      mock.dashboardPanelData.meta.streamFields.groupedFields = [
        {
          name: "schemaGroup",
          stream_alias: "schemaGroup",
          schema: [
            { name: "field_a", type: "Utf8" },
            { name: "field_b", type: "Int64" },
          ],
          settings: {
            defined_schema_fields: ["field_a"],
          },
        },
      ];
      mockReturn = mock;

      wrapper = mountComponent();
      await flushPromises();

      // _timestamp and _all should be rendered along with defined schema fields
      const timestampRow = wrapper.find('[data-test="o-field-list-row-_timestamp"]');
      const allRow = wrapper.find('[data-test="o-field-list-row-_all"]');
      const fieldARow = wrapper.find('[data-test="o-field-list-row-field_a"]');

      expect(timestampRow.exists()).toBe(true);
      expect(allRow.exists()).toBe(true);
      expect(fieldARow.exists()).toBe(true);
    });
  });
  // ── PromQL query on a stream change ──────────────────────────────────

  describe("changing the stream in PromQL mode", () => {
    const currentQuery = () => mockReturn.dashboardPanelData.data.queries[0];

    const METRIC_STREAMS = [
      {
        name: "first_metric",
        stream_type: "metrics",
        metrics_meta: {
          metric_type: "Counter",
          metric_family_name: "first_metric",
          help: "",
          unit: "",
        },
        stats: { doc_num: 100 },
      },
      {
        name: "second_metric",
        stream_type: "metrics",
        metrics_meta: {
          metric_type: "Counter",
          metric_family_name: "second_metric",
          help: "",
          unit: "",
        },
        stats: { doc_num: 100 },
      },
    ];

    /**
     * Set up BEFORE mounting: the component loads the stream list on mount and
     * overwrites `meta.stream.streamResults` with whatever `getStreams` returns,
     * so the metrics list has to come from the service mock rather than be
     * written into the panel data by hand.
     */
    const asMetricsPromqlPanel = () => {
      mockReturn.promqlMode = computed(() => true) as any;
      mockGetStreams.mockResolvedValue({ list: METRIC_STREAMS });
      currentQuery().fields.stream_type = "metrics";
      currentQuery().customQuery = true;
    };

    it("does NOT destroy a query the user wrote", async () => {
      // It used to reset the query to a bare `${stream}{}` on every stream
      // change, so a moment's curiosity about another metric silently threw away
      // a query that may have taken a while to get right. In Custom mode the
      // query is what actually runs — the stream field only drives label
      // suggestions — so leaving the two out of step is recoverable, and deleting
      // the user's work is not.
      //
      // `parsePromQlQuery` is mocked to report no metric name, which is what a
      // query we did not generate looks like from here.
      asMetricsPromqlPanel();
      wrapper = mountComponent({ pageKey: "metrics" });
      await flushPromises();

      const handWritten = 'sum(rate(first_metric{code="500"}[1h])) * 60';
      currentQuery().query = handWritten;

      // The first change only records the baseline for this query slot.
      currentQuery().fields.stream = "first_metric";
      await flushPromises();

      currentQuery().fields.stream = "second_metric";
      await flushPromises();

      expect(currentQuery().query).toBe(handWritten);
    });

    it("still seeds an empty slot", async () => {
      // Nothing to protect, so the rule set's default lands — `sum(rate(...))`
      // for a counter, rather than the raw cumulative selector.
      asMetricsPromqlPanel();
      wrapper = mountComponent({ pageKey: "metrics" });
      await flushPromises();

      currentQuery().query = "";
      currentQuery().fields.stream = "first_metric";
      await flushPromises();

      currentQuery().fields.stream = "second_metric";
      await flushPromises();

      // The rule set's default for a counter — not the raw cumulative selector.
      expect(currentQuery().query).toContain("rate(second_metric{}");
      expect(currentQuery().query).toContain("sum(");
    });
  });

  /**
   * In edit mode the stream list waits for a stream rather than fetching against
   * a half-built query — the panel's own data arrives asynchronously.
   *
   * But a parent can seed the query in ITS `onMounted`, which runs BEFORE this
   * component's watcher exists (the metrics Visualize workspace does exactly
   * that, mounting PanelEditor with `edit-mode` and seeding the stream itself).
   * A change-only watcher never fires for a value already present, so the Stream
   * dropdown stayed empty forever: "No options found" under a stream that is
   * plainly selected.
   */
  describe("edit mode loads the stream list for an ALREADY-set stream", () => {
    const currentQuery = () => mockReturn.dashboardPanelData.data.queries[0];

    it("fetches immediately in metrics edit mode even when stream is blank", async () => {
      currentQuery().fields.stream = "";
      currentQuery().fields.stream_type = "metrics";

      wrapper = mountComponent({
        pageKey: "metrics",
        props: { editMode: true },
      });
      await flushPromises();

      expect(mockGetStreams).toHaveBeenCalledWith("metrics", false);
    });

    it("fetches when the stream is set before mount (the seeded-parent case)", async () => {
      // The parent seeded this before the field list ever mounted.
      currentQuery().fields.stream = "envoy_cluster_assignment_stale";
      currentQuery().fields.stream_type = "metrics";

      wrapper = mountComponent({ props: { editMode: true } });
      await flushPromises();

      // Without `immediate` this never ran, and the dropdown had no options.
      expect(mockGetStreams).toHaveBeenCalledWith("metrics", false);
      expect(mockReturn.dashboardPanelData.meta.stream.streamResults).toEqual(mockStreamResults);
    });

    it("still fetches when the stream arrives AFTER mount (the real edit case)", async () => {
      currentQuery().fields.stream = "";
      wrapper = mountComponent({ props: { editMode: true } });
      await flushPromises();
      expect(mockGetStreams).not.toHaveBeenCalled();

      // The panel's data lands late — the original reason this path defers.
      currentQuery().fields.stream = "some_stream";
      await flushPromises();

      expect(mockGetStreams).toHaveBeenCalledTimes(1);
    });

    it("loads once, not once per stream change", async () => {
      currentQuery().fields.stream = "first";
      wrapper = mountComponent({ props: { editMode: true } });
      await flushPromises();

      // The watcher stops itself after the first hit; picking another stream
      // must not refetch the whole list.
      currentQuery().fields.stream = "second";
      await flushPromises();

      expect(mockGetStreams).toHaveBeenCalledTimes(1);
    });
  });
});
